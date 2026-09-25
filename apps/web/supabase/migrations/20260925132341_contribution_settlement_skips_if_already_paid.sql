-- Bug: a negotiated booking whose upfront deposit was already paid in full got auto-cancelled
-- 24h after the negotiation was accepted, forfeiting the payment, even though nothing was owed.
--
-- Real case: Andrea Di Salvo applied with a EUR 200 offer and paid it. The admin recorded that
-- payment via admin_confirm_voyage_booking_payment BEFORE formally accepting his contribution
-- proposal. admin_accept_voyage_booking_contribution_proposal then unconditionally armed
-- contribution_settlement_deadline = now() + 24h, with no regard for the fact that the deposit it
-- exists to enforce was already sitting in the deposits table as 'paid'. Nothing paid afterwards,
-- so nothing ever cleared the deadline again (clearBookingPaymentDeadlineIfSettled and
-- admin_confirm_voyage_booking_payment both only run when a NEW payment settles), and
-- expire_unpaid_voyage_booking_contribution_settlement — which never itself checks whether the
-- negotiated deposit is paid, only the timestamp — cancelled the booking a day later and marked
-- the deposit forfeited.
--
-- Two independent fixes:
--  1. The two "negotiation resolved" entry points no longer arm the 24h deadline when the
--     resolution itself finds the deposit already covered (whatever order payment vs. acceptance
--     happened in) — the settlement window exists to chase an outstanding payment, not to punish
--     one that already landed.
--  2. Defense in depth: the sweep itself now re-checks voyage_booking_negotiated_balance_paid
--     before cancelling, exactly like its sibling expire_unpaid_voyage_booking_balance always
--     checks paid-vs-due before acting rather than trusting a flag alone. This also protects any
--     booking already sitting with a stale armed deadline.

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

  -- Computed BEFORE deciding the deadline (moved up from below): an admin who already recorded
  -- this payment manually, in either order relative to accepting the proposal, must never have
  -- the 24h window re-armed over it.
  v_covered_persons := case when coalesce(v_request.payment_mode, 'lead_pays_all') = 'lead_pays_all'
    then greatest(1, v_request.party_size) else 1 end;
  v_due_cents := (2000 + v_resolved_cents) * v_covered_persons;
  v_deposit_target_cents := least(round(v_due_cents * 0.5), 49900);
  select coalesce(sum(amount_cents), 0) into v_already_paid_cents
  from public.voyage_booking_deposits
  where booking_request_id = _booking_request_id and status = 'paid';
  v_amount_due_cents := greatest(0, v_deposit_target_cents - v_already_paid_cents);
  v_deadline := case when v_amount_due_cents > 0 then timezone('utc', now()) + interval '24 hours' else null end;

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

  -- Same reordering as admin_accept_voyage_booking_contribution_proposal above: never arm the
  -- 24h window over a deposit that is already covered.
  v_covered_persons := case when coalesce(v_request.payment_mode, 'lead_pays_all') = 'lead_pays_all'
    then greatest(1, v_request.party_size) else 1 end;
  v_due_cents := (2000 + v_resolved_cents) * v_covered_persons;
  v_deposit_target_cents := least(round(v_due_cents * 0.5), 49900);
  select coalesce(sum(amount_cents), 0) into v_already_paid_cents
  from public.voyage_booking_deposits
  where booking_request_id = _booking_request_id and status = 'paid';
  v_amount_due_cents := greatest(0, v_deposit_target_cents - v_already_paid_cents);
  v_deadline := case when v_amount_due_cents > 0 then timezone('utc', now()) + interval '24 hours' else null end;

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

-- Defense in depth: re-check the actual payment before cancelling, not just the timestamp, so a
-- stale/mis-armed deadline (this bug, or any future variant of it) can never forfeit a booking
-- that is, right now, already paid in full for its negotiated deposit.
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
      and not public.voyage_booking_negotiated_balance_paid(r.id)
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
