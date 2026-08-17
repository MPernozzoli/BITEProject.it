-- Contribution/workaway proposals for multi-person bookings.
--
-- v1 pinned proposals to solo applications (party_size hard-coded to 1 in
-- request_voyage_booking_with_contribution_proposal). They are now allowed for a party of any
-- size, under one rule: **only the booker negotiates, once, for everybody**.
--
--   * The negotiated figure stays PER PERSON, exactly as it is stored today
--     (contribution_resolved_variable_cents = one traveller's variable share). Nothing about the
--     proposal row's meaning changes; only who it ends up covering does.
--   * 'lead_pays_all'  → the lead owes (fixed + negotiated) × party_size.
--   * 'each_pays_own'  → the lead owes it once, and every guest owes the same agreed figure for
--     themselves. Guests cannot re-open the negotiation: they accept the invite and pay.
--
-- That per-person convention is what resolveDepositPayer already implements
-- (perPersonEur = fixed + resolvedVariable, then × coveredPersons), so the TypeScript side
-- needs no change. The percentage bounds are scale-invariant — proposed_total/standard_total is
-- the same ratio per person or per party — so attach_voyage_booking_contribution_proposal's
-- ceiling check is correct as-is too.
--
-- The one piece that disagreed was voyage_booking_negotiated_balance_paid, fixed below.

-- ---------------------------------------------------------------------------
-- 1. The approval gate: the party's whole obligation, not a mixed-up half of it
-- ---------------------------------------------------------------------------

-- Previously `2000 * party_size + resolved_variable`: the fixed minimum was multiplied by the
-- party while the negotiated variable was not, which only ever produced the right number
-- because party_size could not exceed 1. With a party of N the group owes the agreed per-person
-- total N times over.
--
-- Summing every paid deposit for the booking regardless of participant_id is deliberate and
-- correct for both modes: under 'lead_pays_all' there is one payer covering N, under
-- 'each_pays_own' there are N payers covering one each. Either way the gate asks the same
-- question — "has the party paid what it agreed?" — so an approval cannot land while any
-- member's share is still outstanding.
create or replace function public.voyage_booking_negotiated_balance_paid(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(d.amount_cents), 0) >= (
    -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR (booking-deposit.ts) in cents; not otherwise
    -- mirrored in SQL. Per-person agreed total × the party it covers.
    select (2000 + coalesce(r.contribution_resolved_variable_cents, 0)) * greatest(1, r.party_size)
    from public.voyage_booking_requests r
    where r.id = _booking_request_id
  )
  from public.voyage_booking_deposits d
  where d.booking_request_id = _booking_request_id
    and d.status = 'paid';
$$;

comment on function public.voyage_booking_negotiated_balance_paid(uuid) is
  'Whether the total agreed after a contribution/workaway negotiation (fixed minimum + resolved variable, per person, times the party size) has been paid in full across every payer on the booking. Used only as the admin_set_voyage_booking_status gate.';

-- ---------------------------------------------------------------------------
-- 2. Applications with a proposal may now carry a party
-- ---------------------------------------------------------------------------

-- _party_size is appended last with a default of 1 so a client still calling the old argument
-- list (a deploy landing after this migration) keeps resolving to the previous behaviour
-- instead of erroring.
drop function if exists public.request_voyage_booking_with_contribution_proposal(
  uuid, uuid[], text, jsonb, text, integer, integer, text[], text, text, text, numeric, text, boolean, integer, text
);

create or replace function public.request_voyage_booking_with_contribution_proposal(
  _voyage_id uuid,
  _leg_ids uuid[],
  _message text,
  _candidate_info jsonb,
  _proposal_kind text,
  _standard_variable_cents integer,
  _proposed_variable_cents integer default null,
  _workaway_role_keys text[] default '{}',
  _workaway_other_role_text text default null,
  _workaway_message text default null,
  _workaway_hours_commitment_type text default null,
  _workaway_hours_commitment_value numeric default null,
  _workaway_portfolio_url text default null,
  _workaway_requests_compensation boolean default false,
  _workaway_requested_compensation_cents integer default null,
  _candidate_message text default null,
  _party_size integer default 1
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking record;
begin
  -- Party size is validated (positive, within the voyage's booking_max_guests) inside
  -- request_voyage_booking itself, together with every other invariant — capacity, leg
  -- bookability, the duplicate-leg guard and the advisory lock.
  select * into v_booking
  from public.request_voyage_booking(
    _voyage_id, _leg_ids, greatest(1, coalesce(_party_size, 1)), _message, _candidate_info
  );

  -- Runs inside the same transaction as the insert above: if this raises, the whole booking
  -- creation rolls back too, so a failed/invalid proposal never leaves a dangling application
  -- that would silently default to the full standard contribution if paid. CV/portfolio storage
  -- paths are attached separately later (update_voyage_booking_contribution_proposal_files) —
  -- they depend on this call's own booking_request_id, so they cannot be known upfront. The
  -- portfolio URL is plain text the candidate typed, so it travels with everything else.
  --
  -- _standard_variable_cents and _proposed_variable_cents are per-person figures whatever the
  -- party size: the negotiation fixes one traveller's share, and the payment layer multiplies it
  -- by however many people each payer covers.
  perform public.attach_voyage_booking_contribution_proposal(
    v_booking.booking_request_id,
    _proposal_kind,
    _standard_variable_cents,
    _proposed_variable_cents,
    _workaway_role_keys,
    _workaway_other_role_text,
    _workaway_message,
    _workaway_hours_commitment_type,
    _workaway_hours_commitment_value,
    null,
    null,
    _workaway_portfolio_url,
    _workaway_requests_compensation,
    _workaway_requested_compensation_cents,
    _candidate_message
  );

  booking_request_id := v_booking.booking_request_id;
  booking_status := v_booking.booking_status;
  return next;
end;
$function$;

revoke execute on function public.request_voyage_booking_with_contribution_proposal(
  uuid, uuid[], text, jsonb, text, integer, integer, text[], text, text, text, numeric, text, boolean, integer, text, integer
) from public, anon;
grant execute on function public.request_voyage_booking_with_contribution_proposal(
  uuid, uuid[], text, jsonb, text, integer, integer, text[], text, text, text, numeric, text, boolean, integer, text, integer
) to authenticated;

comment on function public.request_voyage_booking_with_contribution_proposal is
  'Atomic combination of request_voyage_booking + attach_voyage_booking_contribution_proposal, used by /api/bookings/apply-with-proposal instead of two separate RPC calls. Works for a party of any size: the amounts negotiated are per person, and only the booker negotiates — guests accept the agreed figure and pay their own share when the booking is each_pays_own.';
