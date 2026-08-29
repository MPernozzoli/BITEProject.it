-- Finish centralising "what this guest owes for themselves".
--
-- 20260826173000 introduced voyage_booking_guest_share_due_cents and pointed the two READ paths
-- at it, because `2000 + contribution_resolved_variable_cents` is only the truth once a
-- negotiation has been accepted. The two WRITE paths were left re-deriving it inline.
--
-- They are correct today purely by accident of scope: both are gated on share_payment_due_at,
-- which is only ever set when a negotiation resolved — so the hardcoded expression is always
-- evaluated in exactly the case where it holds. That is a landmine, not a design: widening the
-- two-day window to guests on ordinary (never-negotiated) bookings is an open question, and the
-- day it is answered "yes" these two would start comparing real payments against a bare €20 —
-- chasing guests who owe more, and letting the booker drop someone who had in fact paid.
--
-- No behaviour changes here. The formula now lives in one place, and widening the scope becomes
-- a one-line change instead of a silent money bug.

create or replace function public.notify_leads_of_overdue_guest_shares()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notified integer := 0;
  v_rec record;
begin
  for v_rec in
    select p.id as participant_id,
           p.booking_request_id,
           trim(concat_ws(' ', p.first_name, p.last_name)) as guest_name,
           p.email as guest_email
    from public.voyage_booking_participants p
    join public.voyage_booking_requests r on r.id = p.booking_request_id
    where p.is_lead = false
      and p.status = 'accepted'
      and p.share_payment_due_at is not null
      and p.share_payment_due_at <= timezone('utc', now())
      and p.share_overdue_notified_at is null
      and r.payment_mode = 'each_pays_own'
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and coalesce(r.is_comped, false) = false
      and public.voyage_booking_guest_share_due_cents(r.id, p.id) is not null
      and coalesce((
        select sum(d.amount_cents) from public.voyage_booking_deposits d
        where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
      ), 0) < public.voyage_booking_guest_share_due_cents(r.id, p.id)
  loop
    update public.voyage_booking_participants
    set share_overdue_notified_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_rec.participant_id
      and share_overdue_notified_at is null;

    if not found then
      continue;
    end if;

    -- Goes to the booking owner: they are the one who chooses between dropping this person and
    -- calling the whole thing off.
    perform public.enqueue_voyage_booking_notification(
      v_rec.booking_request_id,
      'guest_share_overdue',
      jsonb_build_object(
        'participant_id', v_rec.participant_id,
        'guest_name', nullif(v_rec.guest_name, ''),
        'guest_email', v_rec.guest_email
      )
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      v_rec.booking_request_id,
      'admin_guest_share_overdue',
      jsonb_build_object('participant_id', v_rec.participant_id, 'guest_email', v_rec.guest_email)
    );

    v_notified := v_notified + 1;
  end loop;

  return v_notified;
end;
$$;

revoke execute on function public.notify_leads_of_overdue_guest_shares() from public, anon, authenticated;
grant execute on function public.notify_leads_of_overdue_guest_shares() to service_role;

create or replace function public.lead_drop_unpaid_guest_share(_participant_id uuid)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participant public.voyage_booking_participants%rowtype;
  v_request public.voyage_booking_requests%rowtype;
  v_paid_cents integer;
  v_due_cents integer;
begin
  select * into v_participant
  from public.voyage_booking_participants
  where id = _participant_id
  for update;
  if not found then
    raise exception 'participation_not_found' using errcode = '22023';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = v_participant.booking_request_id
  for update;
  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.profile_id <> auth.uid() then
    raise exception 'not_booking_owner' using errcode = '42501';
  end if;
  if v_participant.is_lead then
    raise exception 'cannot_drop_lead' using errcode = '22023';
  end if;
  if v_participant.status <> 'accepted' then
    raise exception 'participation_not_accepted' using errcode = '22023';
  end if;

  -- Only a genuinely overdue, genuinely unpaid share can be dropped this way: this is a remedy
  -- for someone who did not pay, not a way to remove a travelling companion at will.
  if v_participant.share_payment_due_at is null
     or v_participant.share_payment_due_at > timezone('utc', now())
  then
    raise exception 'share_not_overdue' using errcode = '22023';
  end if;

  select coalesce(sum(d.amount_cents), 0)
  into v_paid_cents
  from public.voyage_booking_deposits d
  where d.booking_request_id = v_request.id
    and d.participant_id = v_participant.id
    and d.status = 'paid';

  v_due_cents := public.voyage_booking_guest_share_due_cents(v_request.id, v_participant.id);
  if v_due_cents is not null and v_paid_cents >= v_due_cents then
    raise exception 'share_already_paid' using errcode = '22023';
  end if;

  update public.voyage_booking_participants
  set status = 'balance_unpaid',
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_participant;

  -- Free the seat, exactly like a declined invite or a lapsed balance.
  update public.voyage_booking_requests
  set party_size = greatest(1, party_size - 1),
      updated_at = timezone('utc', now())
  where id = v_request.id;

  -- Anything they did pay towards the share is queued for refund rather than forfeited: unlike
  -- the balance-deadline case, they never held a confirmed seat to forfeit — the booking was
  -- still waiting on the group.
  update public.voyage_booking_deposits
  set refund_pending = true,
      refund_pending_amount_cents = amount_cents,
      refund_pending_reason = 'guest_share_dropped_by_lead',
      updated_at = timezone('utc', now())
  where booking_request_id = v_request.id
    and participant_id = v_participant.id
    and status = 'paid';

  if v_participant.profile_id is not null then
    insert into public.voyage_booking_notifications (
      booking_request_id, recipient_profile_id, event_type, metadata
    )
    values (
      v_request.id,
      v_participant.profile_id,
      'guest_share_dropped',
      jsonb_build_object('participant_id', v_participant.id)
    )
    on conflict (booking_request_id, event_type, recipient_profile_id)
    do update set
      metadata = excluded.metadata,
      queued_at = timezone('utc', now()),
      processed_at = null,
      emailed_at = null,
      push_sent_at = null,
      attempts = 0,
      failed_at = null,
      error_message = null;
  end if;

  perform public.enqueue_admin_voyage_booking_notifications(
    v_request.id,
    'admin_modified',
    jsonb_build_object('source', 'lead_dropped_unpaid_guest', 'participant_id', v_participant.id)
  );

  return v_participant;
end;
$$;

revoke execute on function public.lead_drop_unpaid_guest_share(uuid) from public, anon;
grant execute on function public.lead_drop_unpaid_guest_share(uuid) to authenticated;
