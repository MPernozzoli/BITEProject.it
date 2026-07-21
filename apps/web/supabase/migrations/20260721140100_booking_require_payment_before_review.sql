-- No candidature reaches admin review before its contribution has actually been paid.
--
-- Before this migration a self-service application was inserted straight into 'requested':
-- the payment flow was a separate, entirely optional step afterwards, so abandoning the
-- payment dialog left a permanent unpaid candidature sitting in the admin review list. The
-- only DB-side guard (20260720115735) blocked approval when a deposit row existed with
-- status 'pending' — it did nothing at all when no deposit row had ever been created, which
-- is exactly the abandoned-payment case.
--
-- New model:
--   * applications are born 'pending_payment' and are invisible to admin review;
--   * they carry a short grace deadline, extended to the usual 48h once a payment is armed;
--   * settlement (deposit -> 'paid') promotes them to 'requested' and only then notifies;
--   * approval requires a paid deposit unless the booking is explicitly comped ('omaggio').
--
-- 'pending_payment' never holds a seat: admin_booking_over_capacity and
-- get_public_voyage_leg_availability already count only admin_approved/user_confirmed.

-- How long an application may sit unpaid before it is swept away, when no payment has been
-- armed yet. Once a deposit exists, expires_at is managed by armBookingPaymentDeadline (48h).
-- Deliberately short: an abandoned dialog must not block the applicant from re-applying.
alter table public.voyage_booking_requests
  add column if not exists is_comped boolean not null default false;

comment on column public.voyage_booking_requests.is_comped is
  'Admin-granted "omaggio": the booking is exempt from the contribution payment gate.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.voyage_booking_has_paid_deposit(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.voyage_booking_deposits d
    where d.booking_request_id = _booking_request_id
      and d.status = 'paid'
  );
$$;

-- A booking is exempt from the payment gate when an admin comped it. Admin-created
-- bookings and email invites pass their own _is_comped flag through to this column.
create or replace function public.voyage_booking_payment_exempt(_booking_request_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.is_comped from public.voyage_booking_requests r where r.id = _booking_request_id),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Applications start unpaid and unreviewable
-- ---------------------------------------------------------------------------

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null,
  _candidate_info jsonb default '{}'::jsonb
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  requester uuid := auth.uid();
  capacity integer;
  selected_leg_count integer;
  new_request_id uuid;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = requester) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = requester
    on conflict (id) do nothing;
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select booking_max_guests
  into capacity
  from public.voyages
  where id = _voyage_id
    and booking_enabled = true
    and is_published = true;

  if capacity is null then
    raise exception 'Voyage is not bookable' using errcode = '22023';
  end if;

  if _party_size > capacity then
    raise exception 'party_size exceeds voyage capacity' using errcode = '22023';
  end if;

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  -- 'pending_payment' joins the duplicate guard so a user cannot stack half-finished
  -- applications on the same leg; the grace deadline below makes it self-healing.
  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.profile_id = requester
      and req.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    candidate_info,
    expires_at
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    'pending_payment',
    nullif(trim(coalesce(_message, '')), ''),
    case
      when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
      else '{}'::jsonb
    end,
    timezone('utc', now()) + interval '1 hour'
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  -- No notification here on purpose: the applicant has not paid yet, so neither they nor
  -- the admins should be told a candidature exists. settle_voyage_booking_payment does it.

  booking_request_id := new_request_id;
  booking_status := 'pending_payment';
  return next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Settlement: a paid deposit is what turns an application into a candidature
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

  return 'requested'::public.voyage_booking_status;
end;
$$;

revoke execute on function public.settle_voyage_booking_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_voyage_booking_payment(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Approval gate: a paid deposit (or an explicit omaggio) is mandatory
-- ---------------------------------------------------------------------------

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

    -- The gap this migration exists to close: previously a booking with *no* deposit row
    -- at all sailed straight through the check above.
    if not public.voyage_booking_has_paid_deposit(_booking_request_id)
       and not coalesce(booking.is_comped, false)
    then
      raise exception 'Booking has no paid contribution' using errcode = '22023';
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
-- Sweep abandoned applications
-- ---------------------------------------------------------------------------

create or replace function public.expire_pending_voyage_booking_payments()
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
    -- (a) applications abandoned before any payment was armed, past their grace deadline
    select r.id, r.voyage_id
    from public.voyage_booking_requests r
    where r.status = 'pending_payment'
      and r.expires_at is not null
      and r.expires_at <= timezone('utc', now())
      and not public.voyage_booking_has_paid_deposit(r.id)
    union
    -- (b) the pre-existing rule: a payment was armed but never settled
    select distinct r.id, r.voyage_id
    from public.voyage_booking_requests r
    join public.voyage_booking_deposits d
      on d.booking_request_id = r.id
     and d.status = 'pending'
    where r.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (
        (r.expires_at is not null and r.expires_at <= timezone('utc', now()))
        or d.created_at <= timezone('utc', now()) - interval '2 days'
      )
  loop
    select array_agg(bookable_leg_id)
    into v_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = v_rec.id;

    update public.voyage_booking_requests
    set
      status = 'expired',
      expires_at = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status = 'pending_payment';

    if found then
      -- Never reviewed by anyone and never paid: retire it silently, no notifications.
      update public.voyage_booking_deposits
      set status = 'cancelled', updated_at = timezone('utc', now())
      where booking_request_id = v_rec.id
        and status = 'pending';

      v_expired := v_expired + 1;
      continue;
    end if;

    update public.voyage_booking_requests
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      expires_at = null,
      updated_at = timezone('utc', now())
    where id = v_rec.id
      and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

    if found then
      update public.voyage_booking_deposits
      set status = 'cancelled', updated_at = timezone('utc', now())
      where booking_request_id = v_rec.id
        and status = 'pending';

      perform public.enqueue_voyage_booking_notification(v_rec.id, 'payment_expired');
      perform public.enqueue_admin_voyage_booking_notifications(
        v_rec.id,
        'admin_cancelled',
        jsonb_build_object('reason', 'payment_expired')
      );
      perform public.promote_waitlisted_voyage_bookings(v_rec.voyage_id, coalesce(v_leg_ids, array[]::uuid[]));

      v_expired := v_expired + 1;
    end if;
  end loop;

  return v_expired;
end;
$$;

revoke execute on function public.expire_pending_voyage_booking_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_voyage_booking_payments() to service_role;

-- The sweep must run often enough that a 1h grace deadline means something.
select cron.unschedule('expire-pending-voyage-booking-payments')
where exists (select 1 from cron.job where jobname = 'expire-pending-voyage-booking-payments');

select cron.schedule(
  'expire-pending-voyage-booking-payments',
  '*/10 * * * *',
  $$select public.expire_pending_voyage_booking_payments();$$
);

-- ---------------------------------------------------------------------------
-- Comped bookings: admin-created and admin-invited people can be exempted
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_voyage_booking(
  _voyage_id uuid,
  _profile_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default true,
  _is_comped boolean default true
)
returns table (booking_request_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_leg_count integer;
  exceeds_capacity boolean := false;
  new_request_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can create bookings' using errcode = '42501';
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = _profile_id) then
    raise exception 'Profile not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if _status in ('admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(_voyage_id, _leg_ids, _party_size, null);
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    admin_notes,
    confirmed_at,
    is_comped
  )
  values (
    _voyage_id,
    _profile_id,
    _party_size,
    _status,
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end,
    coalesce(_is_comped, true)
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  perform public.enqueue_voyage_booking_notification(new_request_id, 'manual_added', jsonb_build_object('status', _status));
  if _status in ('admin_approved', 'user_confirmed', 'waitlisted') then
    perform public.enqueue_voyage_booking_notification(new_request_id, _status::text);
  end if;

  booking_request_id := new_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

create or replace function public.admin_create_voyage_booking_invite_by_email(
  _voyage_id uuid,
  _email text,
  _leg_ids uuid[],
  _first_name text default null,
  _last_name text default null,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default true,
  _is_comped boolean default false
)
returns table (booking_request_id uuid, participant_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(coalesce(_email, '')), ''));
  v_profile_id uuid;
  v_selected_leg_count integer;
  v_exceeds_capacity boolean := false;
  v_request_id uuid;
  v_participant_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can create bookings' using errcode = '42501';
  end if;

  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'Valid email is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select profile.id
  into v_profile_id
  from public.profiles profile
  where lower(profile.email) = v_email
  order by profile.created_at asc nulls last, profile.id asc
  limit 1;

  if v_profile_id is null then
    insert into public.profiles (email, name)
    values (
      v_email,
      coalesce(
        nullif(trim(concat_ws(' ', _first_name, _last_name)), ''),
        split_part(v_email, '@', 1)
      )
    )
    returning id into v_profile_id;
  end if;

  select count(*)
  into v_selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if v_selected_leg_count = 0 or v_selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests request on request.id = link.booking_request_id
    left join public.profiles profile on profile.id = request.profile_id
    left join public.voyage_booking_participants participant
      on participant.booking_request_id = request.id
    where link.bookable_leg_id = any(_leg_ids)
      and request.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (request.expires_at is null or request.expires_at > timezone('utc', now()))
      and (
        request.profile_id = v_profile_id
        or lower(coalesce(profile.email, '')) = v_email
        or lower(coalesce(participant.email, '')) = v_email
      )
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  if _status in ('admin_approved', 'user_confirmed') then
    v_exceeds_capacity := public.admin_booking_over_capacity(_voyage_id, _leg_ids, 1, null);
    if v_exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    payment_mode,
    message,
    admin_notes,
    confirmed_at,
    is_comped
  )
  values (
    _voyage_id,
    v_profile_id,
    1,
    _status,
    'each_pays_own',
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end,
    coalesce(_is_comped, false)
  )
  returning id into v_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select v_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  insert into public.voyage_booking_participants (
    booking_request_id,
    profile_id,
    email,
    first_name,
    last_name,
    is_lead,
    status,
    expires_at
  )
  values (
    v_request_id,
    v_profile_id,
    v_email,
    nullif(trim(coalesce(_first_name, '')), ''),
    nullif(trim(coalesce(_last_name, '')), ''),
    false,
    'pending',
    timezone('utc', now()) + interval '7 days'
  )
  returning id into v_participant_id;

  perform public.enqueue_voyage_booking_notification(v_request_id, 'manual_added', jsonb_build_object('status', _status));
  if _status in ('admin_approved', 'user_confirmed', 'waitlisted') then
    perform public.enqueue_voyage_booking_notification(v_request_id, _status::text);
  end if;
  perform public.enqueue_admin_voyage_booking_notifications(
    v_request_id,
    'admin_modified',
    jsonb_build_object('source', 'admin_email_invite')
  );

  booking_request_id := v_request_id;
  participant_id := v_participant_id;
  over_capacity := v_exceeds_capacity;
  return next;
end;
$$;

-- Replaced by the 9/10-argument versions above; drop the stale overloads so PostgREST
-- cannot resolve them and silently bypass the comped flag.
drop function if exists public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean);
drop function if exists public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean);

revoke execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean, boolean) to authenticated;
revoke execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- A comped participant is never asked to pay
-- ---------------------------------------------------------------------------

create or replace function public.get_my_participations()
returns table (
  participant_id uuid,
  booking_request_id uuid,
  status text,
  is_lead boolean,
  voyage_id uuid,
  voyage_name text,
  voyage_name_it text,
  voyage_name_en text,
  party_size integer,
  payment_mode text,
  requires_payment boolean,
  deposit_paid boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.booking_request_id,
    p.status,
    p.is_lead,
    r.voyage_id,
    v.name,
    v.name_it,
    v.name_en,
    r.party_size,
    r.payment_mode,
    (
      r.payment_mode = 'each_pays_own'
      and p.is_lead = false
      and coalesce(r.is_comped, false) = false
    ) as requires_payment,
    exists (
      select 1 from public.voyage_booking_deposits d
      where d.booking_request_id = r.id and d.participant_id = p.id and d.status = 'paid'
    ) as deposit_paid,
    p.expires_at
  from public.voyage_booking_participants p
  join public.voyage_booking_requests r on r.id = p.booking_request_id
  join public.voyages v on v.id = r.voyage_id
  where p.is_lead = false
    and (
      p.profile_id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by p.created_at desc;
$$;

grant execute on function public.get_my_participations() to authenticated;
