-- Guests are held to the same acconto/saldo rule as the booker.
--
-- resolveDepositPayer (src/server/bunq/deposit-resolver.ts) charges every payer the same way:
-- the first payment collects the acconto — 50% of their contribution, capped at €499 — and the
-- saldo is due later, 15 days before their own embarkation leg departs. That is what the booking
-- flows show a guest before they pay, and what the guest's payment link actually collects.
--
-- The two-day guest-share window, however, still measured that payment against the guest's WHOLE
-- share (voyage_booking_guest_share_due_cents). A guest who did exactly what the site asked —
-- paid their acconto inside the window — was therefore reported to the booker as overdue, and
-- lead_drop_unpaid_guest_share would let the booker drop them and refund them out of the voyage.
-- The booker's own booking has never worked that way: paying the acconto clears the initial gate,
-- and only the balance deadline enforces the rest.
--
-- Both paths now compare against the acconto. Nothing changes for a guest who paid nothing, and
-- nothing changes about the saldo: expire_unpaid_voyage_booking_guest_shares still enforces the
-- full share (p.contribution_due_cents) at the 15-day balance deadline.

-- What the guest must have paid for their two-day window to be satisfied: the acconto
-- resolveDepositPayer stamped on their row when they opened their payment. A negotiated
-- contribution is the exception the resolver itself makes — it is collected in one payment, with
-- no acconto/saldo split — so there the whole agreed amount is the figure.
create or replace function public.voyage_booking_guest_share_deposit_cents(
  _booking_request_id uuid,
  _participant_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Nothing of their own to pay: they are the booker, or the booker covers the party.
    when p.is_lead or r.payment_mode is distinct from 'each_pays_own' then null
    -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR in cents. An accepted proposal is charged in full up
    -- front (see resolveDepositPayer), so acconto and total coincide.
    when r.contribution_proposal_status = 'accepted'
      then 2000 + coalesce(r.contribution_resolved_variable_cents, 0)
    -- Otherwise: min(50%, €499) of their share, as stamped by resolveDepositPayer. Null until
    -- they start a payment — better than a wrong figure, and the "paid nothing at all" branch of
    -- the sweep already covers a guest who never opened the flow.
    else p.contribution_deposit_cents
  end
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  where p.id = _participant_id
    and p.booking_request_id = _booking_request_id;
$$;

comment on function public.voyage_booking_guest_share_deposit_cents(uuid, uuid) is
  'What one guest must have paid by their two-day share window on an each_pays_own booking: the acconto resolveDepositPayer stamped on their row (min(50%, EUR 499)), or the whole negotiated amount when a contribution proposal was accepted, since that one is collected without a split. Null when they owe nothing of their own, or when nothing has computed it yet. Internal helper — never granted to client roles.';

revoke execute on function public.voyage_booking_guest_share_deposit_cents(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voyage_booking_guest_share_deposit_cents(uuid, uuid) to service_role;

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
      and (
        -- Nothing arrived at all. This is the case the sweep most needs to catch and the one
        -- where the amount is unknowable here: a guest who never opened the payment flow has no
        -- contribution_due_cents stamped, and the mileage formula lives in booking-deposit.ts,
        -- not in SQL. Zero paid after the deadline is delinquent whatever the exact figure is.
        coalesce((
          select sum(d.amount_cents) from public.voyage_booking_deposits d
          where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
        ), 0) = 0
        -- Something arrived, but not even the acconto — only checkable once the figure is known,
        -- which it is precisely because a payment was started. The saldo is NOT chased here: it
        -- has its own, much later deadline (expire_unpaid_voyage_booking_guest_shares, 15 days
        -- before departure), exactly like the booker's own balance.
        or (
          public.voyage_booking_guest_share_deposit_cents(r.id, p.id) is not null
          and coalesce((
            select sum(d.amount_cents) from public.voyage_booking_deposits d
            where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
          ), 0) < public.voyage_booking_guest_share_deposit_cents(r.id, p.id)
        )
      )
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
  v_deposit_cents integer;
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

  -- Paying the acconto within the window IS paying on time: the saldo is not owed until the
  -- balance deadline, so a guest who paid it cannot be dropped for non-payment. If they later
  -- miss the saldo, expire_unpaid_voyage_booking_guest_shares removes them on its own.
  v_deposit_cents := public.voyage_booking_guest_share_deposit_cents(v_request.id, v_participant.id);
  if v_deposit_cents is not null and v_paid_cents >= v_deposit_cents then
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
