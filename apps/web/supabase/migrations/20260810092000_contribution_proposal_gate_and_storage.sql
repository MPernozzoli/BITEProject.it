-- Closes two gaps left open by the previous migration:
--   1. admin_set_voyage_booking_status must not let a booking through to admin_approved /
--      user_confirmed while a contribution/workaway negotiation is still open, or once
--      accepted, before the negotiated variable balance has actually been paid.
--   2. A private, per-candidate Storage bucket for workaway CV/portfolio uploads — no bucket in
--      this codebase has ever been per-user-writable before (every existing one is either
--      public-read or fully admin-only), so this introduces the storage.foldername(name)
--      ownership idiom for the first time.
--
-- Scope note: the balance-paid check below sums *all* paid deposits for the booking regardless
-- of participant_id. This is correct for the lead-only / single-party scope this feature ships
-- with (see the plan: multi-guest split of a negotiated contribution is out of scope for v1) —
-- it is not the general each_pays_own-aware total that resolveDepositPayer computes per payer.

create or replace function public.voyage_booking_negotiated_balance_paid(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(d.amount_cents), 0) >= (
    -- 2000 = CONTRIBUTION_FIXED_MINIMUM_EUR (booking-deposit.ts) in cents; not otherwise
    -- mirrored in SQL. party_size covers the lead_pays_all case; each_pays_own splits are out
    -- of scope for negotiated proposals in v1 (see plan).
    select 2000 * greatest(1, r.party_size) + coalesce(r.contribution_resolved_variable_cents, 0)
    from public.voyage_booking_requests r
    where r.id = _booking_request_id
  )
  from public.voyage_booking_deposits d
  where d.booking_request_id = _booking_request_id
    and d.status = 'paid';
$$;

comment on function public.voyage_booking_negotiated_balance_paid(uuid) is
  'Whether the total agreed after a contribution/workaway negotiation (fixed minimum + resolved variable) has been paid in full. Used only as the admin_set_voyage_booking_status gate.';

create or replace function public.admin_set_voyage_booking_status(
  _booking_request_id uuid,
  _status public.voyage_booking_status,
  _allow_over_capacity boolean default false,
  _admin_notes text default null
)
returns table (booking_request_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  booking record;
  leg_ids uuid[];
  previous_status public.voyage_booking_status;
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select req.*
  into booking
  from public.voyage_booking_requests as req
  where req.id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  if _status in ('admin_approved', 'user_confirmed') then
    if exists (
      select 1
      from public.voyage_booking_deposits as deposit
      where deposit.booking_request_id = _booking_request_id
        and deposit.status = 'pending'
    ) then
      raise exception 'Booking has a pending contribution payment' using errcode = '22023';
    end if;

    -- The gap the payment-gate migration closed: previously a booking with *no* deposit row
    -- at all sailed straight through the check above.
    if not public.voyage_booking_has_paid_deposit(_booking_request_id)
       and not coalesce(booking.is_comped, false)
    then
      raise exception 'Booking has no paid contribution' using errcode = '22023';
    end if;

    -- A contribution/workaway negotiation must be resolved (accepted or never started) before
    -- the booking can move forward — never mid pending_admin_review/pending_user_approval.
    if booking.contribution_proposal_status in ('pending_admin_review', 'pending_user_approval') then
      raise exception 'Booking has an unresolved contribution/workaway proposal' using errcode = '22023';
    end if;

    -- Once accepted, the negotiated variable balance is due before approval — same spirit as
    -- the fixed-deposit check above, applied to the resolved amount instead of the default one.
    if booking.contribution_proposal_status = 'accepted'
       and coalesce(booking.contribution_resolved_variable_cents, 0) > 0
       and not public.voyage_booking_negotiated_balance_paid(_booking_request_id)
    then
      raise exception 'Booking has an unpaid negotiated contribution balance' using errcode = '22023';
    end if;
  end if;

  previous_status := booking.status;
  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(link.bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs as link
  where link.booking_request_id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(
      booking.voyage_id,
      coalesce(leg_ids, array[]::uuid[]),
      booking.party_size,
      _booking_request_id
    );
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  update public.voyage_booking_requests as req
  set
    status = _status,
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), req.admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else req.confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else req.cancelled_at end
  where req.id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed', 'cancelled', 'rejected') and previous_status is distinct from _status then
    perform public.enqueue_voyage_booking_notification(_booking_request_id, _status::text);
  end if;

  if previous_status in ('admin_approved', 'user_confirmed')
    and _status not in ('admin_approved', 'user_confirmed')
  then
    perform public.promote_waitlisted_voyage_bookings(booking.voyage_id, leg_ids);
  end if;

  booking_request_id := _booking_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private storage bucket for CV / portfolio uploads
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('workaway-applications', 'workaway-applications', false)
on conflict (id) do update set public = excluded.public;

-- Path convention: {auth.uid()}/{booking_request_id}/cv.<ext>, {auth.uid()}/{booking_request_id}/portfolio.<ext>
drop policy if exists "Admin read workaway-applications" on storage.objects;
create policy "Admin read workaway-applications"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'workaway-applications' and public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Candidate read own workaway-applications" on storage.objects;
create policy "Candidate read own workaway-applications"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'workaway-applications' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Candidate write own workaway-applications" on storage.objects;
create policy "Candidate write own workaway-applications"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'workaway-applications' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Candidate update own workaway-applications" on storage.objects;
create policy "Candidate update own workaway-applications"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'workaway-applications' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'workaway-applications' and (storage.foldername(name))[1] = auth.uid()::text);

-- No candidate delete policy, on purpose: mirrors every other bucket in this project
-- ("admin deletes, users don't" — see 20260708133441_admin_media_storage_buckets.sql).
drop policy if exists "Admin manage workaway-applications" on storage.objects;
create policy "Admin manage workaway-applications"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'workaway-applications' and public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (bucket_id = 'workaway-applications' and public.has_role(auth.uid(), 'admin'::public.app_role));
