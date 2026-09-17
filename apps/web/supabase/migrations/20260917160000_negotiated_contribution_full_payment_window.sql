-- Departure under 15 days: full contribution up front, no negotiated-proposal exception.
--
-- apps/web/src/lib/booking-deposit.ts's depositTargetEur() now takes a fullPaymentRequired flag
-- (isWithinFullPaymentWindow): when the earliest departure among a booking's own legs is less
-- than 15 days away, splitting acconto/saldo would set a balance deadline already in the past, so
-- the whole contribution is requested at once instead. resolveDepositPayer (the TS function that
-- actually charges the payer) already applies this for every payer, negotiated or not — the money
-- collected has been correct since that change.
--
-- Two SQL spots still assumed the old, unconditional 50%-capped-at-€499 split for a negotiated
-- contribution/workaway proposal:
--   1. voyage_booking_negotiated_balance_paid — the gate admin_set_voyage_booking_status uses to
--      let an admin approve a negotiated booking once "the deposit" is paid. Inside the 15-day
--      window this let an admin approve at 50% paid, even though resolveDepositPayer would keep
--      asking the payer for the rest until they reached 100% — a gate weaker than reality, not a
--      billing bug, but worth closing.
--   2. admin_accept_voyage_booking_contribution_proposal / accept_voyage_booking_contribution_
--      counter — the "contribution_proposal_accepted" notification email's amount_eur, which
--      would have quoted 50% of the negotiated total to a traveller resolveDepositPayer was about
--      to charge in full.
--
-- Both now check the same condition as isWithinFullPaymentWindow, via the existing
-- voyage_booking_balance_deadline(_booking_request_id): that deadline is
-- min(leg.starts_at_window_start) - interval '15 days', so "departure is under 15 days away" is
-- exactly "that deadline has already passed".

create or replace function public.voyage_booking_full_payment_required(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.voyage_booking_balance_deadline(_booking_request_id) <= timezone('utc', now()), false);
$$;

comment on function public.voyage_booking_full_payment_required(uuid) is
  'Mirrors isWithinFullPaymentWindow (booking-deposit.ts): true once the booking''s balance deadline (15 days before the earliest departure among its own legs) has already passed, meaning the whole contribution is due at once instead of being split into acconto/saldo. False (not true) when the legs carry no departure time yet, same as the TS function.';

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
    -- (expire_unpaid_voyage_booking_balance already checks the FULL contribution_due_cents there)
    -- — unless departure is already inside that window, in which case the gate is the full total,
    -- mirroring depositTargetEur's fullPaymentRequired.
    select case
      when public.voyage_booking_full_payment_required(_booking_request_id)
        -- Integer cents arithmetic already, unlike the else branch's *0.5 — no round() needed
        -- (and round(integer) is not even a valid Postgres call).
        then (2000 + coalesce(r.contribution_resolved_variable_cents, 0)) * greatest(1, r.party_size)
      else least(
        round((2000 + coalesce(r.contribution_resolved_variable_cents, 0)) * greatest(1, r.party_size) * 0.5),
        49900
      )
    end
    from public.voyage_booking_requests r
    where r.id = _booking_request_id
  )
  from public.voyage_booking_deposits d
  where d.booking_request_id = _booking_request_id
    and d.status = 'paid';
$$;

comment on function public.voyage_booking_negotiated_balance_paid(uuid) is
  'Whether the upfront deposit on the agreed total after a contribution/workaway negotiation (50% of fixed+resolved-variable, per person, times the party size, capped at EUR 499 — or the full total when voyage_booking_full_payment_required) has been paid across every payer on the booking. The remaining balance is governed separately by expire_unpaid_voyage_booking_balance. Used only as the admin_set_voyage_booking_status gate.';

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
  v_deposit_target_cents := case
    when public.voyage_booking_full_payment_required(_booking_request_id) then v_due_cents
    else least(round(v_due_cents * 0.5), 49900)
  end;
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
  v_deposit_target_cents := case
    when public.voyage_booking_full_payment_required(_booking_request_id) then v_due_cents
    else least(round(v_due_cents * 0.5), 49900)
  end;
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
