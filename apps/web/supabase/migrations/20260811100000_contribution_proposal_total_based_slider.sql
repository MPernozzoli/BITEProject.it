-- Reframes the negotiable range around the TOTAL contribution (fixed €20 + variable) instead of
-- the variable share alone — the split was confusing in the UI ("propose the variable part, the
-- fixed always adds on top") and led to a real floor bug: a candidate could propose €0 variable,
-- which read as "pay nothing", even though the €20 fixed is always due regardless.
--
-- The UI moves to a slider (see ContributionProposalForm.tsx / VoyageCandidatesPanel.tsx) whose
-- own [min, max] makes an out-of-range value physically impossible to pick, so the separate
-- "minimum percent" concept is retired entirely: the floor is now simply the €20 fixed itself
-- (already unconditionally collected upfront, before any proposal is even reviewed — see
-- request_voyage_booking_with_contribution_proposal / resolveDepositPayer), which in variable-cents
-- terms is just "proposed_variable_cents >= 0", already enforced by the existing not-null/>=0
-- check. Only the ceiling survives, now measured against the TOTAL standard contribution
-- (standard_variable_cents + the €20 fixed) rather than the variable share alone.

alter table public.voyage_booking_settings
  drop column if exists contribution_proposal_min_percent;

comment on column public.voyage_booking_settings.contribution_proposal_max_percent is
  'Ceiling, as a percentage of the TOTAL standard contribution (variable + the €20 fixed), that a candidate or admin counter-proposal may reach. There is no configurable floor: the €20 fixed is always the minimum, enforced structurally rather than as a percentage.';

create or replace function public.attach_voyage_booking_contribution_proposal(
  _booking_request_id uuid,
  _proposal_kind text,
  _standard_variable_cents integer,
  _proposed_variable_cents integer default null,
  _workaway_role_keys text[] default '{}',
  _workaway_other_role_text text default null,
  _workaway_message text default null,
  _workaway_hours_commitment_type text default null,
  _workaway_hours_commitment_value numeric default null,
  _workaway_cv_storage_path text default null,
  _workaway_portfolio_storage_path text default null,
  _workaway_portfolio_url text default null,
  _workaway_requests_compensation boolean default false,
  _workaway_requested_compensation_cents integer default null,
  _candidate_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_settings public.voyage_booking_settings%rowtype;
  v_percent numeric;
  v_proposal_id uuid;
  v_kind text := trim(coalesce(_proposal_kind, ''));
  -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR (booking-deposit.ts) in cents, mirrored here because
  -- the ceiling is measured against the total contribution, not the variable share alone.
  v_standard_total_cents integer;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.status <> 'pending_payment' then
    raise exception 'booking_not_pending_payment' using errcode = '22023';
  end if;

  if v_kind not in ('contribution', 'workaway', 'hybrid') then
    raise exception 'invalid_proposal_kind' using errcode = '22023';
  end if;

  select * into v_settings
  from public.voyage_booking_settings
  where voyage_id = v_request.voyage_id;

  if coalesce(_standard_variable_cents, -1) < 0 then
    raise exception 'invalid_standard_variable_cents' using errcode = '22023';
  end if;
  v_standard_total_cents := _standard_variable_cents + 2000;

  v_percent := null;

  if v_kind in ('contribution', 'hybrid') then
    if v_settings.voyage_id is null or coalesce(v_settings.contribution_proposal_enabled, false) is not true then
      raise exception 'contribution_proposal_disabled' using errcode = '22023';
    end if;
    if _proposed_variable_cents is null or _proposed_variable_cents < 0 then
      raise exception 'proposed_variable_cents_required' using errcode = '22023';
    end if;
    -- Floor: none beyond >= 0 above — the €20 fixed is the real floor and is always collected
    -- separately, so "propose €0 variable" is already the most generous the candidate can be.
    -- Ceiling: measured against the TOTAL standard contribution.
    v_percent := round(((_proposed_variable_cents + 2000)::numeric / v_standard_total_cents::numeric) * 100, 2);
    if v_percent > v_settings.contribution_proposal_max_percent then
      raise exception 'proposal_out_of_range' using errcode = '22023';
    end if;
  end if;

  if v_kind in ('workaway', 'hybrid') then
    if v_settings.voyage_id is null or coalesce(v_settings.workaway_enabled, false) is not true then
      raise exception 'workaway_disabled' using errcode = '22023';
    end if;
    if coalesce(cardinality(_workaway_role_keys), 0) = 0
       and nullif(trim(coalesce(_workaway_other_role_text, '')), '') is null
    then
      raise exception 'workaway_role_required' using errcode = '22023';
    end if;
  end if;

  update public.voyage_booking_contribution_proposals
  set status = 'superseded', updated_at = timezone('utc', now())
  where booking_request_id = _booking_request_id
    and status in ('pending_admin_review', 'pending_user_approval');

  insert into public.voyage_booking_contribution_proposals (
    booking_request_id, voyage_id, proposed_by, status, proposal_kind,
    standard_variable_cents, proposed_variable_cents, proposed_variable_percent,
    workaway_role_keys, workaway_other_role_text, workaway_message,
    workaway_hours_commitment_type, workaway_hours_commitment_value,
    workaway_cv_storage_path, workaway_portfolio_storage_path, workaway_portfolio_url,
    workaway_requests_compensation, workaway_requested_compensation_cents,
    candidate_message
  )
  values (
    _booking_request_id, v_request.voyage_id, 'candidate', 'pending_admin_review', v_kind,
    _standard_variable_cents, _proposed_variable_cents, v_percent,
    coalesce(_workaway_role_keys, '{}'), nullif(trim(coalesce(_workaway_other_role_text, '')), ''),
    nullif(trim(coalesce(_workaway_message, '')), ''),
    _workaway_hours_commitment_type, _workaway_hours_commitment_value,
    _workaway_cv_storage_path, _workaway_portfolio_storage_path, _workaway_portfolio_url,
    coalesce(_workaway_requests_compensation, false), _workaway_requested_compensation_cents,
    nullif(trim(coalesce(_candidate_message, '')), '')
  )
  returning id into v_proposal_id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'pending_admin_review',
      contribution_fixed_only_payment = true,
      contribution_proposal_metadata = jsonb_build_object('proposal_id', v_proposal_id, 'proposal_kind', v_kind),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  return v_proposal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin counter-proposal: same total-based ceiling, floor is now
-- max(€20, 50% of the standard total) rather than admin's unrestricted discretion.
-- ---------------------------------------------------------------------------

create or replace function public.admin_counter_voyage_booking_contribution_proposal(
  _booking_request_id uuid,
  _proposed_variable_cents integer default null,
  _admin_note text default null,
  _workaway_role_keys text[] default null,
  _workaway_other_role_text text default null,
  _workaway_hours_commitment_type text default null,
  _workaway_hours_commitment_value numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_settings public.voyage_booking_settings%rowtype;
  v_original public.voyage_booking_contribution_proposals%rowtype;
  v_new_id uuid;
  v_percent numeric;
  v_note text := nullif(trim(coalesce(_admin_note, '')), '');
  v_cents integer;
  v_role_keys text[];
  v_other_role_text text;
  v_hours_type text;
  v_hours_value numeric;
  v_standard_total_cents integer;
  v_floor_cents integer;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can counter-propose' using errcode = '42501';
  end if;
  if _proposed_variable_cents is not null and _proposed_variable_cents < 0 then
    raise exception 'invalid_proposed_variable_cents' using errcode = '22023';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;
  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select * into v_original
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

  select * into v_settings
  from public.voyage_booking_settings
  where voyage_id = v_request.voyage_id;

  -- Anything not explicitly overridden keeps the candidate's original term, so an admin
  -- countering only on hours (say) does not accidentally wipe the proposed amount, and vice
  -- versa — this is what makes a workaway-only counter (no monetary side at all) possible.
  v_cents := coalesce(_proposed_variable_cents, v_original.proposed_variable_cents);
  v_role_keys := coalesce(_workaway_role_keys, v_original.workaway_role_keys);
  v_other_role_text := coalesce(nullif(trim(_workaway_other_role_text), ''), v_original.workaway_other_role_text);
  v_hours_type := coalesce(_workaway_hours_commitment_type, v_original.workaway_hours_commitment_type);
  v_hours_value := coalesce(_workaway_hours_commitment_value, v_original.workaway_hours_commitment_value);

  if v_cents is null and coalesce(cardinality(v_role_keys), 0) = 0 and v_other_role_text is null then
    raise exception 'counter_proposal_requires_terms' using errcode = '22023';
  end if;

  if v_cents is not null then
    v_standard_total_cents := v_original.standard_variable_cents + 2000;
    -- Floor: the greater of the €20 fixed and half the standard total — a counter-proposal
    -- should not casually undercut what the fixed minimum alone already guarantees.
    v_floor_cents := greatest(2000, round(v_standard_total_cents * 0.5));
    if (v_cents + 2000) < v_floor_cents then
      raise exception 'counter_below_floor' using errcode = '22023';
    end if;
    v_percent := round(((v_cents + 2000)::numeric / v_standard_total_cents::numeric) * 100, 2);
    if v_percent > coalesce(v_settings.contribution_proposal_max_percent, 150) then
      raise exception 'counter_out_of_range' using errcode = '22023';
    end if;
  else
    v_percent := null;
  end if;

  update public.voyage_booking_contribution_proposals
  set status = 'superseded', updated_at = timezone('utc', now())
  where id = v_original.id;

  insert into public.voyage_booking_contribution_proposals (
    booking_request_id, voyage_id, proposed_by, status, proposal_kind,
    standard_variable_cents, proposed_variable_cents, proposed_variable_percent,
    workaway_role_keys, workaway_other_role_text, workaway_message,
    workaway_hours_commitment_type, workaway_hours_commitment_value,
    workaway_requests_compensation, workaway_requested_compensation_cents,
    admin_note
  )
  values (
    _booking_request_id, v_request.voyage_id, 'admin', 'pending_user_approval', v_original.proposal_kind,
    v_original.standard_variable_cents, v_cents, v_percent,
    v_role_keys, v_other_role_text, v_original.workaway_message,
    v_hours_type, v_hours_value,
    v_original.workaway_requests_compensation, v_original.workaway_requested_compensation_cents,
    v_note
  )
  returning id into v_new_id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'pending_user_approval',
      contribution_proposal_metadata = jsonb_build_object(
        'proposal_id', v_new_id,
        'countered_variable_cents', v_cents,
        'admin_note', v_note
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), v_note),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_countered',
    jsonb_build_object('proposal_id', v_new_id, 'proposed_variable_cents', v_cents, 'admin_note', v_note)
  );

  return v_new_id;
end;
$$;
