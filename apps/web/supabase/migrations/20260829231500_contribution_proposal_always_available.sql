-- Proposing a different contribution amount is now available on every voyage, unconditionally.
--
-- It used to be a per-voyage opt-in (voyage_booking_settings.contribution_proposal_enabled,
-- default false), which meant the public voyage pages could not promise it and most voyages
-- silently refused it. The site now states everywhere that the displayed amounts are an
-- indicative estimate and that a different one can be proposed during the application, so the
-- gate has to go: the only thing left bounding a proposal is the ceiling
-- (contribution_proposal_max_percent) and the €20 fixed minimum, which is structural.
--
-- Workaway stays opt-in: it depends on the crew actually wanting help on that voyage, and on the
-- role list configured for it, so it is a genuine per-voyage decision.
--
-- The column is kept (rather than dropped) so nothing reading the row breaks mid-deploy, but it
-- no longer gates anything: it is defaulted and backfilled to true, and its last two readers —
-- attach_voyage_booking_contribution_proposal below and api/bookings/apply-with-proposal.ts —
-- stop consulting it.

alter table public.voyage_booking_settings
  alter column contribution_proposal_enabled set default true;

update public.voyage_booking_settings
set contribution_proposal_enabled = true
where contribution_proposal_enabled is distinct from true;

comment on column public.voyage_booking_settings.contribution_proposal_enabled is
  'Deprecated and always true: proposing an alternative contribution is available on every voyage. Kept only so existing readers of this row keep resolving; nothing gates on it any more.';

-- ---------------------------------------------------------------------------
-- attach_voyage_booking_contribution_proposal: drop the contribution gate
-- ---------------------------------------------------------------------------
--
-- Identical to the 20260811100000 definition except that (a) the
-- 'contribution_proposal_disabled' guard is gone, and (b) the ceiling coalesces to 150 so a
-- voyage with no voyage_booking_settings row at all accepts a proposal instead of failing on a
-- null comparison. The workaway guard is unchanged and still requires an explicit settings row.
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
    if _proposed_variable_cents is null or _proposed_variable_cents < 0 then
      raise exception 'proposed_variable_cents_required' using errcode = '22023';
    end if;
    -- Floor: none beyond >= 0 above — the €20 fixed is the real floor and is always collected
    -- separately, so "propose €0 variable" is already the most generous the candidate can be.
    -- Ceiling: measured against the TOTAL standard contribution.
    v_percent := round(((_proposed_variable_cents + 2000)::numeric / v_standard_total_cents::numeric) * 100, 2);
    if v_percent > coalesce(v_settings.contribution_proposal_max_percent, 150) then
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

comment on function public.attach_voyage_booking_contribution_proposal is
  'Attaches a candidate contribution/workaway proposal to a pending_payment booking. Proposing a different amount is allowed on every voyage (bounded only by contribution_proposal_max_percent, default 150%, and the structural €20 fixed minimum); the workaway side still requires voyage_booking_settings.workaway_enabled.';
