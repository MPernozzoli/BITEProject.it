-- Contribution/workaway negotiation: a candidate applying to a voyage may, when the voyage's
-- settings allow it (voyage_booking_settings.contribution_proposal_enabled /
-- workaway_enabled), propose an alternative to the system-calculated VARIABLE contribution
-- instead of accepting it outright. The €20 fixed minimum (CONTRIBUTION_FIXED_MINIMUM_EUR in
-- booking-deposit.ts) is never part of the negotiation and is always paid in full through the
-- existing pending_payment gate before the application is even visible to admin review — see
-- resolveDepositPayer (deposit-resolver.ts) for how the fixed-only amount is computed.
--
-- Flow, mirroring the existing admin_propose_voyage_booking_legs / respond_voyage_booking_plan_change
-- pattern (20260721140200_plan_change_settlement.sql) for route changes:
--   1. attach_voyage_booking_contribution_proposal (service_role only, called right after
--      request_voyage_booking by the apply-with-proposal endpoint) records the candidate's
--      proposal while the booking still sits in 'pending_payment'.
--   2. Once the €20 fixed amount is paid, settle_voyage_booking_payment promotes the booking to
--      'requested' as usual, and now also flags admin that a proposal is waiting.
--   3. Admin reviews: admin_accept_voyage_booking_contribution_proposal,
--      admin_counter_voyage_booking_contribution_proposal, or the existing "Scarta" flow
--      (updateBookingStatusWithRefund with trigger 'admin_rejected' — unchanged, already
--      refunds the €20 at 100%, see refunds.ts).
--   4. A counter-proposal allows exactly one further round: the candidate can only
--      accept_voyage_booking_contribution_counter or reject it (rejection reuses the refund
--      endpoint with the new 'user_rejected_contribution_counter' trigger, added in the next
--      migration) — there is no "request different terms" action, unlike route-change proposals.

create table public.voyage_booking_contribution_proposals (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  proposed_by text not null check (proposed_by in ('candidate', 'admin')),
  status text not null default 'pending_admin_review'
    check (status in ('pending_admin_review', 'pending_user_approval', 'accepted', 'rejected', 'superseded')),
  proposal_kind text not null check (proposal_kind in ('contribution', 'workaway', 'hybrid')),
  -- Snapshot of what the mileage formula alone would have asked, at proposal time.
  standard_variable_cents integer not null check (standard_variable_cents >= 0),
  -- Null = pure workaway offset, no euro figure attached to this side of the proposal.
  proposed_variable_cents integer check (proposed_variable_cents is null or proposed_variable_cents >= 0),
  proposed_variable_percent numeric(6, 2),
  workaway_role_keys text[] not null default '{}',
  workaway_other_role_text text,
  workaway_message text,
  workaway_hours_commitment_type text check (workaway_hours_commitment_type in ('per_day', 'per_week')),
  workaway_hours_commitment_value numeric check (workaway_hours_commitment_value is null or workaway_hours_commitment_value >= 0),
  workaway_cv_storage_path text,
  workaway_portfolio_storage_path text,
  workaway_portfolio_url text,
  workaway_requests_compensation boolean not null default false,
  workaway_requested_compensation_cents integer check (workaway_requested_compensation_cents is null or workaway_requested_compensation_cents >= 0),
  candidate_message text,
  admin_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

comment on table public.voyage_booking_contribution_proposals is
  'History of contribution/workaway negotiation rounds for a booking request. One row per round per side (candidate proposal, admin counter-proposal). Mirrors voyage_booking_plan_changes.';

create index voyage_booking_contribution_proposals_request_idx
  on public.voyage_booking_contribution_proposals(booking_request_id, created_at desc);

alter table public.voyage_booking_contribution_proposals enable row level security;

create policy "Booking owner reads own contribution proposals"
  on public.voyage_booking_contribution_proposals for select
  to authenticated
  using (
    exists (
      select 1 from public.voyage_booking_requests r
      where r.id = booking_request_id
        and (r.profile_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role))
    )
  );

create policy "Admins manage contribution proposals"
  on public.voyage_booking_contribution_proposals for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

grant select on public.voyage_booking_contribution_proposals to authenticated;
grant select, insert, update on public.voyage_booking_contribution_proposals to service_role;

-- ---------------------------------------------------------------------------
-- voyage_booking_requests: negotiation state
-- ---------------------------------------------------------------------------

alter table public.voyage_booking_requests
  add column if not exists contribution_proposal_status text not null default 'none',
  add column if not exists contribution_proposal_metadata jsonb not null default '{}'::jsonb,
  add column if not exists contribution_fixed_only_payment boolean not null default false,
  add column if not exists contribution_resolved_variable_cents integer;

alter table public.voyage_booking_requests
  add constraint voyage_booking_requests_contribution_proposal_status_check
  check (contribution_proposal_status in ('none', 'pending_admin_review', 'pending_user_approval', 'accepted', 'rejected'));

comment on column public.voyage_booking_requests.contribution_fixed_only_payment is
  'True when this application carries a contribution/workaway proposal: only the €20 fixed minimum is collected up front, the variable part is negotiated first. Set by attach_voyage_booking_contribution_proposal, read by resolveDepositPayer.';
comment on column public.voyage_booking_requests.contribution_resolved_variable_cents is
  'The variable contribution actually agreed after negotiation (may be 0 for a pure workaway trade). Requested as a single balance payment once set — see resolveDepositPayer.';

-- ---------------------------------------------------------------------------
-- Widen the notification event-type catalog
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
      'admin_contribution_proposal_resolved'
    )
  );

-- ---------------------------------------------------------------------------
-- Settlement: also flag admin when the just-paid application carries a proposal
-- ---------------------------------------------------------------------------

create or replace function public.settle_voyage_booking_payment(_booking_request_id uuid)
returns public.voyage_booking_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
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

  if not public.voyage_booking_has_paid_deposit(_booking_request_id)
     and not coalesce(v_request.is_comped, false)
  then
    return v_request.status;
  end if;

  update public.voyage_booking_requests
  set status = 'requested',
      expires_at = null,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(_booking_request_id, 'requested');
  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_new_booking',
    jsonb_build_object('status', 'requested')
  );

  if v_request.contribution_proposal_status = 'pending_admin_review' then
    perform public.enqueue_voyage_booking_notification(_booking_request_id, 'contribution_proposal_received');
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_contribution_proposal_received',
      jsonb_build_object('status', 'requested')
    );
  end if;

  return 'requested'::public.voyage_booking_status;
end;
$$;

revoke execute on function public.settle_voyage_booking_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_voyage_booking_payment(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Candidate proposal: recorded while the booking is still pending_payment
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

  -- Only reachable right after request_voyage_booking, before the fixed minimum is paid: once
  -- settled the booking is visible to admin and its terms should not silently change underneath.
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
    v_percent := case
      when _standard_variable_cents > 0
        then round((_proposed_variable_cents::numeric / _standard_variable_cents::numeric) * 100, 2)
      else 0
    end;
    -- Defense-in-depth: the caller (apply-with-proposal) already validates the range, this
    -- guards direct RPC calls from ever recording an out-of-policy proposal.
    if v_percent < v_settings.contribution_proposal_min_percent or v_percent > v_settings.contribution_proposal_max_percent then
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

  -- Defensive: normally nothing exists yet at this point in the flow.
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

revoke execute on function public.attach_voyage_booking_contribution_proposal(
  uuid, text, integer, integer, text[], text, text, text, numeric, text, text, text, boolean, integer, text
) from public, anon, authenticated;
grant execute on function public.attach_voyage_booking_contribution_proposal(
  uuid, text, integer, integer, text[], text, text, text, numeric, text, text, text, boolean, integer, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Admin: accept as proposed
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

  return v_proposal.id;
end;
$$;

revoke execute on function public.admin_accept_voyage_booking_contribution_proposal(uuid, text) from public, anon;
grant execute on function public.admin_accept_voyage_booking_contribution_proposal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: counter-propose (the one and only round of back-and-forth)
-- ---------------------------------------------------------------------------

create or replace function public.admin_counter_voyage_booking_contribution_proposal(
  _booking_request_id uuid,
  _proposed_variable_cents integer,
  _admin_note text default null
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
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can counter-propose' using errcode = '42501';
  end if;
  if _proposed_variable_cents is null or _proposed_variable_cents < 0 then
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

  v_percent := case
    when v_original.standard_variable_cents > 0
      then round((_proposed_variable_cents::numeric / v_original.standard_variable_cents::numeric) * 100, 2)
    else 0
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
    v_original.standard_variable_cents, _proposed_variable_cents, v_percent,
    v_original.workaway_role_keys, v_original.workaway_other_role_text, v_original.workaway_message,
    v_original.workaway_hours_commitment_type, v_original.workaway_hours_commitment_value,
    v_original.workaway_requests_compensation, v_original.workaway_requested_compensation_cents,
    v_note
  )
  returning id into v_new_id;

  update public.voyage_booking_requests
  set contribution_proposal_status = 'pending_user_approval',
      contribution_proposal_metadata = jsonb_build_object(
        'proposal_id', v_new_id,
        'countered_variable_cents', _proposed_variable_cents,
        'admin_note', v_note
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), v_note),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(
    _booking_request_id,
    'contribution_proposal_countered',
    jsonb_build_object('proposal_id', v_new_id, 'proposed_variable_cents', _proposed_variable_cents, 'admin_note', v_note)
  );

  return v_new_id;
end;
$$;

revoke execute on function public.admin_counter_voyage_booking_contribution_proposal(uuid, integer, text) from public, anon;
grant execute on function public.admin_counter_voyage_booking_contribution_proposal(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Candidate: accept the admin's counter-proposal (the only SQL-side response;
-- rejecting one goes through updateBookingStatusWithRefund, see next migration)
-- ---------------------------------------------------------------------------

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

  return v_proposal.id;
end;
$$;

revoke execute on function public.accept_voyage_booking_contribution_counter(uuid, text) from public, anon;
grant execute on function public.accept_voyage_booking_contribution_counter(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Candidate: attach CV/portfolio storage paths after the fact
--
-- The storage path convention is {auth.uid()}/{booking_request_id}/..., so the candidate can
-- only know the final path once attach_voyage_booking_contribution_proposal has returned a
-- booking_request_id and the file has been uploaded — this patches the proposal row with the
-- resulting paths from the browser, after the direct-to-Storage upload completes.
-- ---------------------------------------------------------------------------

create or replace function public.update_voyage_booking_contribution_proposal_files(
  _booking_request_id uuid,
  _workaway_cv_storage_path text default null,
  _workaway_portfolio_storage_path text default null,
  _workaway_portfolio_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proposal_id uuid;
begin
  if not exists (
    select 1 from public.voyage_booking_requests
    where id = _booking_request_id and profile_id = auth.uid()
  ) then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select id into v_proposal_id
  from public.voyage_booking_contribution_proposals
  where booking_request_id = _booking_request_id
    and proposed_by = 'candidate'
    and status in ('pending_admin_review', 'pending_user_approval')
  order by created_at desc
  limit 1;

  if v_proposal_id is null then
    raise exception 'no_open_proposal_found' using errcode = '22023';
  end if;

  update public.voyage_booking_contribution_proposals
  set workaway_cv_storage_path = coalesce(_workaway_cv_storage_path, workaway_cv_storage_path),
      workaway_portfolio_storage_path = coalesce(_workaway_portfolio_storage_path, workaway_portfolio_storage_path),
      workaway_portfolio_url = coalesce(_workaway_portfolio_url, workaway_portfolio_url),
      updated_at = timezone('utc', now())
  where id = v_proposal_id;

  return v_proposal_id;
end;
$$;

revoke execute on function public.update_voyage_booking_contribution_proposal_files(uuid, text, text, text) from public, anon;
grant execute on function public.update_voyage_booking_contribution_proposal_files(uuid, text, text, text) to authenticated;
