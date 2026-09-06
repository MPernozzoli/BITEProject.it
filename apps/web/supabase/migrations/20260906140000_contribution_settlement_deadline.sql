-- A resolved contribution/workaway negotiation now carries a real, explicit deadline: the
-- traveller has 24 hours from OUR acceptance (either admin accepting their own proposal, or the
-- candidate accepting our counter — both are "the negotiation is now resolved") to settle the
-- upfront deposit on the agreed total, exactly like anyone else who pays the standard
-- contribution. Missing it cancels the booking; the fixed €20 already paid while negotiating is
-- forfeited, not refunded — same reasoning as missing the 15-day balance deadline, just applied
-- to this shorter, negotiation-specific window.
--
-- This closes a real gap: until now there was no deadline at all here (only the general 15-day
-- balance deadline, which fires close to departure, and the short Bunq-link window, which has no
-- consequence since the booking already holds a paid deposit and is excluded from the payment
-- sweep). A candidate could sit in "accepted" forever, blocking admin review indefinitely, or pay
-- weeks later after everyone assumed the negotiation had lapsed.
--
-- The Bunq side (revoking the link so it cannot be paid after this deadline, and refunding a
-- payment that lands anyway) lives in api/cron/reconcile-expired-bunq-links.ts — pg_cron cannot
-- call the Bunq REST API, so the new `expiry_kind` column tags exactly which cancelled deposits
-- that job must refund-if-late rather than reactivate-if-late (the pre-existing behaviour for a
-- fresh application's very first, pre-review payment — see 20260906130000).

-- ---------------------------------------------------------------------------
-- 0. Fix: the approval gate was requiring the FULL negotiated total paid, not just the upfront
--    deposit — inconsistent with every other payer, who is reviewable after the deposit alone
--    and owes the balance only by the 15-day mark. That made the 24h window pointless: even a
--    payer who met it exactly would still block their own approval until the balance too.
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_negotiated_balance_paid(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(d.amount_cents), 0) >= (
    -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR (booking-deposit.ts) in cents; 0.5 / 49900 mirror
    -- DEPOSIT_PERCENT / DEPOSIT_CAP_EUR (same file) — none otherwise duplicated in SQL. Only the
    -- upfront deposit on the agreed total gates approval, same as depositTargetEur() for a
    -- standard payer; the rest is the balance, due 15 days before departure like everyone else's
    -- (expire_unpaid_voyage_booking_balance already checks the FULL contribution_due_cents there).
    select least(
      round((2000 + coalesce(r.contribution_resolved_variable_cents, 0)) * greatest(1, r.party_size) * 0.5),
      49900
    )
    from public.voyage_booking_requests r
    where r.id = _booking_request_id
  )
  from public.voyage_booking_deposits d
  where d.booking_request_id = _booking_request_id
    and d.status = 'paid';
$$;

comment on function public.voyage_booking_negotiated_balance_paid(uuid) is
  'Whether the upfront deposit on the agreed total after a contribution/workaway negotiation (50% of fixed+resolved-variable, per person, times the party size, capped at EUR 499) has been paid across every payer on the booking. The remaining balance is governed separately by expire_unpaid_voyage_booking_balance. Used only as the admin_set_voyage_booking_status gate.';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_requests
  add column if not exists contribution_settlement_deadline timestamptz;

comment on column public.voyage_booking_requests.contribution_settlement_deadline is
  'Set to now()+24h the moment a contribution/workaway negotiation resolves to accepted (by either party). Cleared once the upfront deposit on the agreed total settles. expire_unpaid_voyage_booking_contribution_settlement() cancels the booking if this passes unmet — independent of voyage_booking_requests.expires_at, which armBookingPaymentDeadline no-ops here since the booking already holds an earlier paid deposit.';

alter table public.voyage_booking_deposits
  add column if not exists expiry_kind text;

comment on column public.voyage_booking_deposits.expiry_kind is
  'Tags WHY a cancelled deposit was cancelled, so api/cron/reconcile-expired-bunq-links.ts knows how to treat a payment that lands anyway: null/legacy (the first-payment-gate sweep, expire_pending_voyage_booking_payments) reactivates the booking on a late acceptance; ''contribution_settlement'' (this settlement-deadline sweep) refunds the late payment instead — the booking is not coming back.';

-- ---------------------------------------------------------------------------
-- 2. Stamp the deadline (+ a specific amount/deadline for the email) on both ways a negotiation
--    can resolve to accepted: admin accepting the candidate's own proposal, and the candidate
--    accepting admin's counter.
-- ---------------------------------------------------------------------------

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
  v_covered_persons integer;
  v_due_cents integer;
  v_deposit_target_cents integer;
  v_already_paid_cents integer;
  v_amount_due_cents integer;
  v_deadline timestamptz;
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
  v_deadline := timezone('utc', now()) + interval '24 hours';

  update public.voyage_booking_contribution_proposals
  set status = 'accepted',
      admin_note = coalesce(v_note, admin_note),
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_proposal.id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'accepted',
      contribution_resolved_variable_cents = v_resolved_cents,
      contribution_settlement_deadline = v_deadline,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  -- Informational figure for the email only (the "Pagamento" card + intro copy): the actual
  -- amount charged is always recomputed authoritatively by resolveDepositPayer at payment time,
  -- exactly as for every other payer. lead_pays_all covers the whole party; everything else is
  -- one person's own share, mirroring resolveDepositPayer's coveredPersons.
  v_covered_persons := case when coalesce(v_request.payment_mode, 'lead_pays_all') = 'lead_pays_all'
    then greatest(1, v_request.party_size) else 1 end;
  v_due_cents := (2000 + v_resolved_cents) * v_covered_persons;
  v_deposit_target_cents := least(round(v_due_cents * 0.5), 49900);
  select coalesce(sum(amount_cents), 0) into v_already_paid_cents
  from public.voyage_booking_deposits
  where booking_request_id = _booking_request_id and status = 'paid';
  v_amount_due_cents := greatest(0, v_deposit_target_cents - v_already_paid_cents);

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_accepted',
    jsonb_build_object(
      'proposal_id', v_proposal.id,
      'resolved_variable_cents', v_resolved_cents,
      'amount_eur', v_amount_due_cents / 100.0,
      'payment_expires_at', v_deadline
    )
  );
  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_contribution_proposal_resolved',
    jsonb_build_object('proposal_id', v_proposal.id, 'admin_note', v_note)
  );
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
  v_request public.voyage_booking_requests%rowtype;
  v_proposal public.voyage_booking_contribution_proposals%rowtype;
  v_resolved_cents integer;
  v_message text := nullif(trim(coalesce(_message, '')), '');
  v_covered_persons integer;
  v_due_cents integer;
  v_deposit_target_cents integer;
  v_already_paid_cents integer;
  v_amount_due_cents integer;
  v_deadline timestamptz;
begin
  -- Only the booker answers a counter-proposal: guests never negotiate, they inherit the agreed
  -- figure and pay it.
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id and profile_id = auth.uid()
  for update;
  if not found then
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
  v_deadline := timezone('utc', now()) + interval '24 hours';

  update public.voyage_booking_contribution_proposals
  set status = 'accepted',
      candidate_message = coalesce(v_message, candidate_message),
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = v_proposal.id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'accepted',
      contribution_resolved_variable_cents = v_resolved_cents,
      contribution_settlement_deadline = v_deadline,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  v_covered_persons := case when coalesce(v_request.payment_mode, 'lead_pays_all') = 'lead_pays_all'
    then greatest(1, v_request.party_size) else 1 end;
  v_due_cents := (2000 + v_resolved_cents) * v_covered_persons;
  v_deposit_target_cents := least(round(v_due_cents * 0.5), 49900);
  select coalesce(sum(amount_cents), 0) into v_already_paid_cents
  from public.voyage_booking_deposits
  where booking_request_id = _booking_request_id and status = 'paid';
  v_amount_due_cents := greatest(0, v_deposit_target_cents - v_already_paid_cents);

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_accepted',
    jsonb_build_object(
      'proposal_id', v_proposal.id,
      'resolved_variable_cents', v_resolved_cents,
      'amount_eur', v_amount_due_cents / 100.0,
      'payment_expires_at', v_deadline
    )
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
-- 3. The sweep: cancels a booking whose accepted negotiation missed its 24h settlement deadline.
-- ---------------------------------------------------------------------------

create or replace function public.expire_unpaid_voyage_booking_contribution_settlement()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer := 0;
  v_rec record;
  v_leg_ids uuid[];
begin
  for v_rec in
    select r.id, r.voyage_id
    from public.voyage_booking_requests r
    where r.contribution_proposal_status = 'accepted'
      and r.contribution_settlement_deadline is not null
      and r.contribution_settlement_deadline <= timezone('utc', now())
      and r.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
  loop
    select array_agg(bookable_leg_id)
    into v_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = v_rec.id;

    update public.voyage_booking_requests
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      contribution_settlement_deadline = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

    if not found then
      continue;
    end if;

    -- The still-unpaid top-up attempt (if the traveller ever created one): cancelled and tagged
    -- so the Bunq-side sweep refunds a payment that lands anyway instead of reactivating the
    -- booking — the negotiation window is over, unlike the first-payment-gate case.
    update public.voyage_booking_deposits
    set status = 'cancelled', expiry_kind = 'contribution_settlement', updated_at = timezone('utc', now())
    where booking_request_id = v_rec.id
      and status = 'pending';

    -- The fixed EUR 20 already collected while negotiating is forfeited, not refunded — the
    -- traveller had a real, stated 24h window and let it lapse; same reasoning as forfeiting a
    -- deposit for missing the 15-day balance deadline, just on this shorter window.
    update public.voyage_booking_deposits
    set refund_policy = 'contribution_settlement_deadline_missed', updated_at = timezone('utc', now())
    where booking_request_id = v_rec.id
      and status = 'paid';

    perform public.enqueue_voyage_booking_notification(
      v_rec.id,
      'contribution_settlement_deadline_missed',
      jsonb_build_object('reason', 'contribution_settlement_deadline_missed')
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      v_rec.id,
      'admin_contribution_settlement_deadline_missed',
      jsonb_build_object('reason', 'contribution_settlement_deadline_missed')
    );
    perform public.promote_waitlisted_voyage_bookings(v_rec.voyage_id, coalesce(v_leg_ids, array[]::uuid[]));

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_unpaid_voyage_booking_contribution_settlement() from public, anon, authenticated;
grant execute on function public.expire_unpaid_voyage_booking_contribution_settlement() to service_role;

select cron.schedule(
  'expire-unpaid-voyage-booking-contribution-settlement',
  '*/10 * * * *',
  $$select public.expire_unpaid_voyage_booking_contribution_settlement();$$
)
where not exists (
  select 1 from cron.job where jobname = 'expire-unpaid-voyage-booking-contribution-settlement'
);

-- ---------------------------------------------------------------------------
-- 4. Notification vocabulary + admin forfeited-deposits visibility
-- ---------------------------------------------------------------------------

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
      'guest_share_due',
      'guest_share_overdue',
      'guest_share_dropped',
      'admin_guest_share_overdue',
      -- New: the 24h contribution-settlement deadline and its late-payment safety net.
      'contribution_settlement_deadline_missed',
      'admin_contribution_settlement_deadline_missed',
      'late_payment_after_cancellation',
      'admin_late_payment_after_cancellation'
    )
  );

create or replace function public.admin_list_forfeited_deposits()
returns table (
  deposit_id uuid,
  booking_request_id uuid,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  traveller_name text,
  traveller_email text,
  amount_cents integer,
  refund_amount_cents integer,
  environment text,
  reference text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can list forfeited deposits' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.booking_request_id,
    req.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    p.name,
    p.email,
    d.amount_cents,
    d.refund_amount_cents,
    d.environment,
    d.reference,
    d.updated_at
  from public.voyage_booking_deposits d
  join public.voyage_booking_requests req on req.id = d.booking_request_id
  left join public.voyages v on v.id = req.voyage_id
  left join public.profiles p on p.id = req.profile_id
  where d.refund_policy in ('balance_deadline_missed', 'contribution_settlement_deadline_missed')
    and d.refund_pending = false
    and d.status in ('paid', 'partially_refunded')
    and coalesce(d.refund_amount_cents, 0) < d.amount_cents
  order by d.updated_at desc;
end;
$$;

revoke execute on function public.admin_list_forfeited_deposits() from public, anon;
grant execute on function public.admin_list_forfeited_deposits() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_confirm_voyage_booking_payment (manual confirmation, e.g. a bank transfer that
--    landed with the wrong causale) is the other path that can settle a negotiated deposit
--    outside clearBookingPaymentDeadlineIfSettled — it must clear the same deadline, or the
--    sweep above could cancel a booking an admin already vouched for as paid.
-- ---------------------------------------------------------------------------

create or replace function public.admin_confirm_voyage_booking_payment(
  _booking_request_id uuid,
  _amount_eur numeric,
  _reference text default null,
  _participant_id uuid default null,
  _admin_note text default null
)
returns table (
  booking_request_id uuid,
  booking_status public.voyage_booking_status,
  deposit_id uuid,
  amount_cents integer,
  reused_pending_deposit boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_amount_cents integer;
  v_party_size integer;
  v_reference text;
  v_environment text;
  v_pending public.voyage_booking_deposits%rowtype;
  v_deposit public.voyage_booking_deposits%rowtype;
  v_reused boolean := false;
  v_status public.voyage_booking_status;
  v_audit text;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can confirm payments' using errcode = '42501';
  end if;

  v_amount_cents := round(coalesce(_amount_eur, 0) * 100)::integer;
  if v_amount_cents <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  -- Refusing these two is the guard against resurrecting a booking whose money has already been
  -- given back: a cancelled/rejected booking may carry a completed refund, and re-confirming a
  -- payment on it would make the deposit ledger claim funds that are no longer held.
  if v_request.status in ('cancelled', 'rejected') then
    raise exception 'booking_not_active' using errcode = '22023';
  end if;

  -- An application that timed out waiting for a transfer that had, in fact, already been sent is
  -- put back into 'pending_payment' so the settlement path below can promote it normally. Safe
  -- without re-checking capacity: settlement lands it in 'requested', and a candidature holds no
  -- seat (see 20260717143112) — the seat check happens later, at approval.
  if v_request.status = 'expired' then
    update public.voyage_booking_requests
    set status = 'pending_payment',
        expires_at = null,
        updated_at = timezone('utc', now())
    where id = _booking_request_id
    returning * into v_request;
  end if;

  -- Mirrors the resolver's coveredPersons: only a lead paying for everyone covers the whole
  -- party; a named participant, or an 'each_pays_own' booking, settles a single share.
  v_party_size := greatest(1, coalesce(v_request.party_size, 1));
  if _participant_id is not null or coalesce(v_request.payment_mode, 'lead_pays_all') <> 'lead_pays_all' then
    v_party_size := 1;
  end if;

  -- Deposits are read back per environment (refunds.ts filters on it), so a manual row must land
  -- in the same one the booking's other deposits used; 'production' is the only sane default for
  -- money that actually arrived.
  select deposit.environment into v_environment
  from public.voyage_booking_deposits deposit
  where deposit.booking_request_id = _booking_request_id
  order by deposit.created_at desc
  limit 1;
  v_environment := coalesce(v_environment, 'production');

  v_reference := nullif(trim(coalesce(_reference, '')), '');

  -- Settle the payer's own armed-but-unsettled deposit when there is one, instead of adding a
  -- second row: paidDepositTotalEur sums every 'paid' deposit for a payer, so a duplicate would
  -- overstate what was received and wrongly zero out a later route-change delta.
  select * into v_pending
  from public.voyage_booking_deposits deposit
  where deposit.booking_request_id = _booking_request_id
    and deposit.status = 'pending'
    and deposit.participant_id is not distinct from _participant_id
  order by deposit.created_at desc
  limit 1
  for update;
  v_reused := found;

  if v_reused then
    update public.voyage_booking_deposits
    set status = 'paid',
        paid_at = timezone('utc', now()),
        updated_at = timezone('utc', now()),
        amount_cents = v_amount_cents,
        per_person_cents = (v_amount_cents / v_party_size)::integer,
        party_size = v_party_size,
        -- Keep the original causale when the admin did not supply one: it is still the string the
        -- payer was asked to use, and refunds try to find the incoming payment by it.
        reference = coalesce(v_reference, reference),
        payment_method = 'manual'
    where id = v_pending.id
    returning * into v_deposit;
  else
    insert into public.voyage_booking_deposits (
      booking_request_id,
      participant_id,
      environment,
      per_person_cents,
      party_size,
      amount_cents,
      currency,
      status,
      reference,
      payment_method,
      paid_at
    )
    values (
      _booking_request_id,
      _participant_id,
      v_environment,
      (v_amount_cents / v_party_size)::integer,
      v_party_size,
      v_amount_cents,
      'EUR',
      'paid',
      coalesce(v_reference, 'MAN-' || upper(substring(_booking_request_id::text, 1, 8))),
      'manual',
      timezone('utc', now())
    )
    returning * into v_deposit;
  end if;

  -- Appended, not replaced: this is a ledger of who vouched for what, and it must survive the
  -- next admin note.
  v_audit := format(
    '[%s] Pagamento confermato manualmente: EUR %s (causale: %s).%s',
    to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI'),
    trim(to_char(v_amount_cents / 100.0, 'FM999999990.00')),
    v_deposit.reference,
    coalesce(' ' || nullif(trim(coalesce(_admin_note, '')), ''), '')
  );
  update public.voyage_booking_requests
  set admin_notes = case
        when coalesce(trim(admin_notes), '') = '' then v_audit
        else admin_notes || E'\n' || v_audit
      end,
      -- Same reasoning as clearBookingPaymentDeadlineIfSettled (deposit-resolver.ts): an admin
      -- vouching for this payment resolves the negotiated top-up exactly like an automated
      -- settlement would, so the 24h window no longer applies.
      contribution_settlement_deadline = null,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  v_status := public.settle_voyage_booking_payment(_booking_request_id);

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'payment_received',
    jsonb_build_object(
      'amount_eur', v_amount_cents / 100.0,
      'payment_method', 'manual',
      'payment_reference', v_deposit.reference
    )
  );

  booking_request_id := _booking_request_id;
  booking_status := v_status;
  deposit_id := v_deposit.id;
  amount_cents := v_amount_cents;
  reused_pending_deposit := v_reused;
  return next;
end;
$$;

revoke execute on function public.admin_confirm_voyage_booking_payment(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.admin_confirm_voyage_booking_payment(uuid, numeric, text, uuid, text) to authenticated;
