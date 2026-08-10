-- Two follow-ups requested after trying the negotiation flow live:
--
--   1. A candidate combining workaway with a monetary offer (kind='hybrid') should not be forced
--      through the same MINIMUM percent bound as someone proposing money alone (kind='contribution')
--      — someone offering to work should be free to propose €0 economically, letting the work
--      stand in for the whole variable share. The MAXIMUM bound still applies to both: an amount
--      far above the standard quota still looks like a disguised payment for a service regardless
--      of whether work is also offered.
--   2. voyage_booking_negotiated_balance_paid / the admin approval gate already tolerate a €0
--      resolved balance, but nothing lets a booking whose FIXED share was waived to €0 (the
--      candidate already holds another active application on the same voyage) ever leave
--      'pending_payment' — resolveDepositPayer refuses to create a payment request for a €0
--      amount, and settle_voyage_booking_payment only promotes on a paid deposit or is_comped.
--      settle_voyage_booking_payment_if_zero_due gives the Node endpoint a safe way to promote
--      such a booking directly, without ever trusting a client-supplied "yes it's zero".

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

  v_percent := null;

  if v_kind in ('contribution', 'hybrid') then
    if v_settings.voyage_id is null or coalesce(v_settings.contribution_proposal_enabled, false) is not true then
      raise exception 'contribution_proposal_disabled' using errcode = '22023';
    end if;
    if _proposed_variable_cents is null or _proposed_variable_cents < 0 then
      raise exception 'proposed_variable_cents_required' using errcode = '22023';
    end if;
    if _standard_variable_cents > 0 then
      v_percent := round((_proposed_variable_cents::numeric / _standard_variable_cents::numeric) * 100, 2);
      -- A pure economic proposal still has to clear the floor: it is the candidate's whole
      -- offer. A hybrid one has work standing behind it, so it is exempt from the floor — only
      -- the ceiling still applies, to both, so the amount never reads as a disguised payment.
      if v_kind = 'contribution' and v_percent < v_settings.contribution_proposal_min_percent then
        raise exception 'proposal_out_of_range' using errcode = '22023';
      end if;
      if v_percent > v_settings.contribution_proposal_max_percent then
        raise exception 'proposal_out_of_range' using errcode = '22023';
      end if;
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
-- Settle a booking whose fixed share resolved to €0 (already covered by another
-- active application on the same voyage), with no deposit ever created.
-- ---------------------------------------------------------------------------

create or replace function public.settle_voyage_booking_payment_if_zero_due(_booking_request_id uuid)
returns public.voyage_booking_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_has_deposit boolean;
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.status <> 'pending_payment' then
    return v_request.status;
  end if;

  -- Only ever a no-op shortcut for a genuinely nothing-to-collect booking: if a deposit already
  -- exists (paid or pending) this defers entirely to the normal settle_voyage_booking_payment
  -- path instead of second-guessing it.
  select exists(
    select 1 from public.voyage_booking_deposits where booking_request_id = _booking_request_id
  ) into v_has_deposit;
  if v_has_deposit then
    raise exception 'booking_has_deposit' using errcode = '22023';
  end if;

  return public.settle_voyage_booking_payment(_booking_request_id);
end;
$$;

comment on function public.settle_voyage_booking_payment_if_zero_due(uuid) is
  'Promotes a pending_payment booking with no deposit rows at all. The caller (apply-with-proposal''s companion endpoint) must have already recomputed the due amount via resolveDepositPayer and confirmed it is €0 — this function does not recompute the price itself, it only refuses to run if a deposit already exists (meaning the price was NOT zero and a payment attempt was already made).';

revoke execute on function public.settle_voyage_booking_payment_if_zero_due(uuid) from public, anon, authenticated;
grant execute on function public.settle_voyage_booking_payment_if_zero_due(uuid) to service_role;
