-- Fixes from the post-implementation audit of the contribution/workaway negotiation feature:
--
--   1. request_voyage_booking_with_contribution_proposal: the Node endpoint used to call
--      request_voyage_booking and attach_voyage_booking_contribution_proposal as two separate
--      RPCs. If the second failed after the first succeeded, the application was left in
--      'pending_payment' with no proposal attached — if the candidate then paid, they would be
--      charged the full standard contribution instead of the fixed-only amount they expected.
--      This wrapper does both in a single transaction: either both succeed or neither does.
--      It also hard-codes party_size = 1 server-side (previously only enforced by the client UI).
--   2. attach_voyage_booking_contribution_proposal: fixed a real bug where a voyage whose
--      variable contribution is €0 (very short leg) made ANY monetary proposal fail the
--      percent-range check, since 0/0-adjacent math always resolved to 0%, under any minimum
--      percent bound greater than zero — even proposing €0 was rejected. The range check is now
--      skipped entirely when there is no variable quota to be a percentage of.
--   3. admin_counter_voyage_booking_contribution_proposal: the amount was previously mandatory,
--      so a pure-workaway proposal (no monetary component at all) could never receive a
--      counter-proposal — the admin could only accept or reject it outright. The amount is now
--      optional, and role/hours can be countered independently, defaulting to the candidate's
--      original terms when not overridden.
--   4. Storage: the workaway-applications bucket had no size/type limits, and the candidate
--      read/write/update policies only checked the top-level folder (their own uid), not that
--      the booking_request_id segment actually belongs to a booking they own.

-- ---------------------------------------------------------------------------
-- 1. attach_voyage_booking_contribution_proposal: fix the zero-standard-quota bound bug
-- ---------------------------------------------------------------------------

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
    -- No variable quota to be a percentage of: any non-negative amount is accepted as-is.
    -- Previously this always resolved to 0%, which made every proposal fail a positive minimum
    -- bound — even proposing €0 on a €0 leg.
    if _standard_variable_cents > 0 then
      v_percent := round((_proposed_variable_cents::numeric / _standard_variable_cents::numeric) * 100, 2);
      if v_percent < v_settings.contribution_proposal_min_percent or v_percent > v_settings.contribution_proposal_max_percent then
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
-- 2. Atomic wrapper: create the application and attach the proposal in one transaction
-- ---------------------------------------------------------------------------

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
  _candidate_message text default null
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking record;
begin
  -- Contribution/workaway proposals are v1-scoped to solo applications (no per-guest split) —
  -- party_size is fixed at 1 here rather than accepted as an argument, so there is no way to
  -- attach a proposal to a multi-person booking regardless of what a caller passes.
  select * into v_booking
  from public.request_voyage_booking(_voyage_id, _leg_ids, 1, _message, _candidate_info);

  -- Runs inside the same transaction as the insert above: if this raises, the whole booking
  -- creation rolls back too, so a failed/invalid proposal never leaves a dangling application
  -- that would silently default to the full standard contribution if paid. CV/portfolio storage
  -- paths are attached separately later (update_voyage_booking_contribution_proposal_files) —
  -- they depend on this call's own booking_request_id, so they cannot be known upfront. The
  -- portfolio URL is plain text the candidate typed, so it travels with everything else.
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
  uuid, uuid[], text, jsonb, text, integer, integer, text[], text, text, text, numeric, text, boolean, integer, text
) from public, anon;
grant execute on function public.request_voyage_booking_with_contribution_proposal(
  uuid, uuid[], text, jsonb, text, integer, integer, text[], text, text, text, numeric, text, boolean, integer, text
) to authenticated;

comment on function public.request_voyage_booking_with_contribution_proposal is
  'Atomic combination of request_voyage_booking + attach_voyage_booking_contribution_proposal, used by /api/bookings/apply-with-proposal instead of two separate RPC calls. party_size is always 1.';

-- ---------------------------------------------------------------------------
-- 3. Admin counter-proposal: amount becomes optional, workaway terms become counterable
-- ---------------------------------------------------------------------------

drop function if exists public.admin_counter_voyage_booking_contribution_proposal(uuid, integer, text);

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
  v_original public.voyage_booking_contribution_proposals%rowtype;
  v_new_id uuid;
  v_percent numeric;
  v_note text := nullif(trim(coalesce(_admin_note, '')), '');
  v_cents integer;
  v_role_keys text[];
  v_other_role_text text;
  v_hours_type text;
  v_hours_value numeric;
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

  v_percent := case
    when v_cents is not null and v_original.standard_variable_cents > 0
      then round((v_cents::numeric / v_original.standard_variable_cents::numeric) * 100, 2)
    else null
  end;

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

revoke execute on function public.admin_counter_voyage_booking_contribution_proposal(
  uuid, integer, text, text[], text, text, numeric
) from public, anon;
grant execute on function public.admin_counter_voyage_booking_contribution_proposal(
  uuid, integer, text, text[], text, text, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage: size/type limits + real ownership check on the booking_request_id path segment
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 15728640, -- 15 MB
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
where id = 'workaway-applications';

drop policy if exists "Candidate read own workaway-applications" on storage.objects;
create policy "Candidate read own workaway-applications"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workaway-applications'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.voyage_booking_requests r
      where r.id::text = (storage.foldername(name))[2]
        and r.profile_id = auth.uid()
    )
  );

drop policy if exists "Candidate write own workaway-applications" on storage.objects;
create policy "Candidate write own workaway-applications"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workaway-applications'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.voyage_booking_requests r
      where r.id::text = (storage.foldername(name))[2]
        and r.profile_id = auth.uid()
    )
  );

drop policy if exists "Candidate update own workaway-applications" on storage.objects;
create policy "Candidate update own workaway-applications"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workaway-applications'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.voyage_booking_requests r
      where r.id::text = (storage.foldername(name))[2]
        and r.profile_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'workaway-applications'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.voyage_booking_requests r
      where r.id::text = (storage.foldername(name))[2]
        and r.profile_id = auth.uid()
    )
  );
