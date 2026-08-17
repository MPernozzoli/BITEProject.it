-- Guest shares wait for the negotiation, then get their own two-day window.
--
-- With proposals now open to parties (20260817140000), a guest could be asked for money while
-- the amount was still being argued over — and would have paid the standard figure the booker
-- was in the middle of renegotiating. The sequence is now explicit:
--
--   1. Booker applies for the party and proposes an amount. Only the booker's own fixed share is
--      collected; every guest's payment is SUSPENDED (enforced in resolveDepositPayer).
--   2. Organiser rejects or counters → still only the booker is involved. Guests stay suspended.
--   3. The amount is agreed (organiser accepts, or the booker accepts a counter) → every accepted
--      guest is emailed to pay their own share, due in two days.
--   4. A guest misses that deadline → the booker is emailed and chooses: drop that person, or
--      cancel the booking for everybody.
--
-- Step 4's "drop that person" is the RPC below. "Cancel for everybody" deliberately has no new
-- RPC: it is the ordinary user cancellation through POST /api/bookings/status, so the refund
-- tiers of the Terms apply as they always do. Giving it a full-refund trigger of its own would
-- turn "have a guest stall" into a way to cancel a confirmed booking for free at any notice.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_participants
  add column if not exists share_payment_due_at timestamptz,
  add column if not exists share_overdue_notified_at timestamptz;

comment on column public.voyage_booking_participants.share_payment_due_at is
  'Deadline for this guest to pay their own share, armed when the booking''s contribution negotiation resolves. Null when there is nothing to wait for (no negotiation, lead pays for everyone, or the guest has not accepted yet).';
comment on column public.voyage_booking_participants.share_overdue_notified_at is
  'When the booker was told this guest missed share_payment_due_at. Stamped so the sweep asks once and then waits for their decision, instead of re-mailing every run.';

alter table public.voyage_booking_notifications
  drop constraint if exists voyage_booking_notifications_event_type_check;
alter table public.voyage_booking_notifications
  add constraint voyage_booking_notifications_event_type_check check (
    event_type in (
      'requested',
      'waitlisted',
      'admin_approved',
      'user_confirmed',
      'cancelled',
      'rejected',
      'promoted_from_waitlist',
      'manual_added',
      'payment_pending',
      'payment_received',
      'payment_failed',
      'payment_expired',
      'payment_reminder',
      'plan_change_pending',
      'plan_change_auto_accepted',
      'first_briefing',
      'second_briefing',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change',
      'user_plan_change_requested',
      'user_plan_change_resolved',
      'balance_reminder',
      'balance_deadline_missed',
      'admin_balance_deadline_missed',
      'contribution_proposal_received',
      'contribution_proposal_accepted',
      'contribution_proposal_countered',
      'contribution_proposal_rejected',
      'admin_contribution_proposal_received',
      'admin_contribution_proposal_resolved',
      -- New: the guest-share sequence above.
      'guest_share_due',
      'guest_share_overdue',
      'guest_share_dropped',
      'admin_guest_share_overdue'
    )
  );

-- ---------------------------------------------------------------------------
-- Is the money still being argued over?
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_negotiation_open(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select r.contribution_fixed_only_payment
       and r.contribution_proposal_status in ('pending_admin_review', 'pending_user_approval')
    from public.voyage_booking_requests r
    where r.id = _booking_request_id
  ), false);
$$;

comment on function public.voyage_booking_negotiation_open(uuid) is
  'True while a contribution/workaway proposal on this booking is unresolved. Guests must not be charged in this window — the amount they would be paying is exactly what is being negotiated.';

revoke execute on function public.voyage_booking_negotiation_open(uuid) from public, anon;
grant execute on function public.voyage_booking_negotiation_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The negotiation resolved: release the guests' payments with a two-day window
-- ---------------------------------------------------------------------------

create or replace function public.arm_voyage_booking_guest_shares(_booking_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_due_at timestamptz := timezone('utc', now()) + interval '2 days';
  v_amount_eur numeric;
  v_armed integer := 0;
  v_guest record;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id;
  if not found then
    return 0;
  end if;

  -- Only 'each_pays_own' has guest-side money at all: when the lead covers the party there is
  -- nothing for a guest to pay, so there is nothing to release or chase.
  if v_request.payment_mode is distinct from 'each_pays_own' then
    return 0;
  end if;

  -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR in cents. The agreed variable is per person, so this
  -- is one guest's whole obligation. It is informational (the payment endpoint recomputes the
  -- authoritative figure, including any waiver that applies to that specific payer).
  v_amount_eur := (2000 + coalesce(v_request.contribution_resolved_variable_cents, 0))::numeric / 100;

  for v_guest in
    select id, profile_id
    from public.voyage_booking_participants
    where booking_request_id = _booking_request_id
      and is_lead = false
      and status = 'accepted'
  loop
    update public.voyage_booking_participants
    set share_payment_due_at = v_due_at,
        share_overdue_notified_at = null,
        updated_at = timezone('utc', now())
    where id = v_guest.id;

    -- The guest is not the booking owner, so enqueue_voyage_booking_notification (which always
    -- targets the owner) cannot be used — same reason as expire_unpaid_voyage_booking_guest_shares.
    if v_guest.profile_id is not null then
      insert into public.voyage_booking_notifications (
        booking_request_id, recipient_profile_id, event_type, metadata
      )
      values (
        _booking_request_id,
        v_guest.profile_id,
        'guest_share_due',
        jsonb_build_object(
          'participant_id', v_guest.id,
          'amount_eur', v_amount_eur,
          'balance_due_at', v_due_at
        )
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

    v_armed := v_armed + 1;
  end loop;

  return v_armed;
end;
$$;

revoke execute on function public.arm_voyage_booking_guest_shares(uuid) from public, anon, authenticated;
grant execute on function public.arm_voyage_booking_guest_shares(uuid) to service_role;

-- Both ways a negotiation can end in agreement now release the guests.
create or replace function public.admin_accept_voyage_booking_contribution_proposal(
  _booking_request_id uuid,
  _admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_proposal public.voyage_booking_contribution_proposals%rowtype;
  v_resolved_cents integer;
  v_note text := nullif(trim(coalesce(_admin_note, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can accept contribution proposals' using errcode = '42501';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;
  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select * into v_proposal
  from public.voyage_booking_contribution_proposals
  where booking_request_id = _booking_request_id
    and status = 'pending_admin_review'
    and proposed_by = 'candidate'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'no_pending_proposal' using errcode = '22023';
  end if;

  v_resolved_cents := coalesce(v_proposal.proposed_variable_cents, 0);

  update public.voyage_booking_contribution_proposals
  set status = 'accepted',
      admin_note = coalesce(v_note, admin_note),
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_proposal.id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'accepted',
      contribution_resolved_variable_cents = v_resolved_cents,
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), v_note),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_accepted',
    jsonb_build_object('proposal_id', v_proposal.id, 'resolved_variable_cents', v_resolved_cents)
  );
  -- The amount is settled, so the guests' own shares can finally be asked for.
  perform public.arm_voyage_booking_guest_shares(_booking_request_id);

  return v_proposal.id;
end;
$$;

revoke execute on function public.admin_accept_voyage_booking_contribution_proposal(uuid, text) from public, anon;
grant execute on function public.admin_accept_voyage_booking_contribution_proposal(uuid, text) to authenticated;

create or replace function public.accept_voyage_booking_contribution_counter(
  _booking_request_id uuid,
  _message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proposal public.voyage_booking_contribution_proposals%rowtype;
  v_resolved_cents integer;
  v_message text := nullif(trim(coalesce(_message, '')), '');
begin
  -- Only the booker answers a counter-proposal: guests never negotiate, they inherit the agreed
  -- figure and pay it.
  if not exists (
    select 1 from public.voyage_booking_requests
    where id = _booking_request_id and profile_id = auth.uid()
    for update
  ) then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select * into v_proposal
  from public.voyage_booking_contribution_proposals
  where booking_request_id = _booking_request_id
    and status = 'pending_user_approval'
    and proposed_by = 'admin'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'no_pending_counter' using errcode = '22023';
  end if;

  v_resolved_cents := coalesce(v_proposal.proposed_variable_cents, 0);

  update public.voyage_booking_contribution_proposals
  set status = 'accepted',
      candidate_message = coalesce(v_message, candidate_message),
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_proposal.id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'accepted',
      contribution_resolved_variable_cents = v_resolved_cents,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_accepted',
    jsonb_build_object('proposal_id', v_proposal.id, 'resolved_variable_cents', v_resolved_cents)
  );
  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_contribution_proposal_resolved',
    jsonb_build_object('proposal_id', v_proposal.id, 'user_response_action', 'accept', 'user_message', v_message)
  );
  perform public.arm_voyage_booking_guest_shares(_booking_request_id);

  return v_proposal.id;
end;
$$;

revoke execute on function public.accept_voyage_booking_contribution_counter(uuid, text) from public, anon;
grant execute on function public.accept_voyage_booking_contribution_counter(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A guest missed the two-day window: ask the booker what to do
-- ---------------------------------------------------------------------------

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
      and coalesce((
        select sum(d.amount_cents) from public.voyage_booking_deposits d
        where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
      ), 0) < (2000 + coalesce(r.contribution_resolved_variable_cents, 0))
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

select cron.schedule(
  'notify-leads-of-overdue-guest-shares',
  '35 * * * *',
  $$select public.notify_leads_of_overdue_guest_shares();$$
)
where not exists (
  select 1 from cron.job where jobname = 'notify-leads-of-overdue-guest-shares'
);

-- ---------------------------------------------------------------------------
-- The booker's decision: drop the guest who did not pay
-- ---------------------------------------------------------------------------

-- The other half of the decision — cancelling for everybody — is the ordinary cancellation
-- through POST /api/bookings/status, so the refund tiers apply. Nothing new is needed for it.
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

  if v_paid_cents >= (2000 + coalesce(v_request.contribution_resolved_variable_cents, 0)) then
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

-- ---------------------------------------------------------------------------
-- What every member of a party can see about the others
-- ---------------------------------------------------------------------------

-- Members of a party see each other's share and whether it is settled: they are travelling
-- together and the booking stands or falls as a group. Deliberately a narrow RPC rather than a
-- widened RLS policy on voyage_booking_participants — this exposes exactly these columns to
-- exactly the people on the same booking, and nothing else.
create or replace function public.get_booking_party_overview(_booking_request_id uuid)
returns table (
  participant_id uuid,
  first_name text,
  last_name text,
  email text,
  is_lead boolean,
  status text,
  share_due_cents integer,
  share_paid_cents integer,
  share_payment_due_at timestamptz,
  is_me boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    p.email,
    p.is_lead,
    p.status,
    case
      when r.payment_mode = 'each_pays_own' and p.is_lead = false
        then (2000 + coalesce(r.contribution_resolved_variable_cents, 0))
      else null
    end as share_due_cents,
    coalesce((
      select sum(d.amount_cents)::integer
      from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ), 0) as share_paid_cents,
    p.share_payment_due_at,
    (p.profile_id = auth.uid() or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))) as is_me
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  where p.booking_request_id = _booking_request_id
    -- Caller must be on this booking: its owner, or one of its participants.
    and (
      r.profile_id = auth.uid()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or exists (
        select 1
        from public.voyage_booking_participants me
        where me.booking_request_id = r.id
          and (
            me.profile_id = auth.uid()
            or lower(me.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
    )
  order by p.is_lead desc, p.created_at asc;
$$;

comment on function public.get_booking_party_overview(uuid) is
  'Everyone on a booking, with each member''s own share and whether it is settled. Readable by any member of that booking (and by admins); returns nothing to anyone else.';

revoke execute on function public.get_booking_party_overview(uuid) from public, anon;
grant execute on function public.get_booking_party_overview(uuid) to authenticated;
