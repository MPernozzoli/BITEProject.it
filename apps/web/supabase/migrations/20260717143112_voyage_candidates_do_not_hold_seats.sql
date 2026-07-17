-- Candidatures are qualitative applications and must not reserve voyage seats.
-- Seats become occupied only after admin approval (admin_approved) or final user
-- confirmation (user_confirmed). Public applications can therefore exceed nominal
-- capacity; admins approve only as many as the route can actually host.

create or replace function public.admin_booking_over_capacity(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer,
  _excluding_request_id uuid default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  with voyage_capacity as (
    select booking_max_guests as capacity
    from public.voyages
    where id = _voyage_id
  ),
  occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0) as occupied_count
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.status in ('admin_approved', 'user_confirmed')
      and (_excluding_request_id is null or req.id <> _excluding_request_id)
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select exists (
    select 1
    from unnest(_leg_ids) as requested_leg(id)
    cross join voyage_capacity
    left join occupied on occupied.bookable_leg_id = requested_leg.id
    where coalesce(occupied.occupied_count, 0) + coalesce(_party_size, 0) > voyage_capacity.capacity
  )
$$;

create or replace function public.get_public_voyage_leg_availability(_voyage_ids uuid[] default null)
returns table (
  id uuid,
  voyage_id uuid,
  from_waypoint_id uuid,
  to_waypoint_id uuid,
  sort_order integer,
  planned_nautical_miles numeric,
  starts_at_window_start timestamptz,
  starts_at_window_end timestamptz,
  ends_at_window_start timestamptz,
  ends_at_window_end timestamptz,
  is_bookable boolean,
  danger_level smallint,
  open_sea boolean,
  complexity_override smallint,
  occupied integer,
  capacity integer,
  remaining integer,
  available boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0)::integer as occupied
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where req.status in ('admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select
    leg.id,
    leg.voyage_id,
    leg.from_waypoint_id,
    leg.to_waypoint_id,
    leg.sort_order,
    leg.planned_nautical_miles,
    leg.starts_at_window_start,
    leg.starts_at_window_end,
    leg.ends_at_window_start,
    leg.ends_at_window_end,
    leg.is_bookable,
    leg.danger_level,
    leg.open_sea,
    leg.complexity_override,
    coalesce(occupied.occupied, 0)::integer as occupied,
    greatest(1, coalesce(voyage.booking_max_guests, 1))::integer as capacity,
    greatest(greatest(1, coalesce(voyage.booking_max_guests, 1)) - coalesce(occupied.occupied, 0), 0)::integer as remaining,
    (
      leg.is_bookable
      and greatest(1, coalesce(voyage.booking_max_guests, 1)) - coalesce(occupied.occupied, 0) > 0
      and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    ) as available
  from public.voyage_bookable_legs leg
  join public.voyages voyage
    on voyage.id = leg.voyage_id
  left join occupied
    on occupied.bookable_leg_id = leg.id
  where voyage.is_published
    and voyage.booking_enabled
    and (
      coalesce(
        voyage.end_date::date,
        voyage.departure_window_end::date,
        voyage.start_date::date,
        voyage.departure_window_start::date
      ) is null
      or coalesce(
        voyage.end_date::date,
        voyage.departure_window_end::date,
        voyage.start_date::date,
        voyage.departure_window_start::date
      ) >= current_date
    )
    and (_voyage_ids is null or leg.voyage_id = any(_voyage_ids))
  order by leg.voyage_id, leg.sort_order;
$$;

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

  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.profile_id = requester
      and req.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
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
    candidate_info
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    'requested',
    nullif(trim(coalesce(_message, '')), ''),
    case
      when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
      else '{}'::jsonb
    end
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  perform public.enqueue_voyage_booking_notification(new_request_id, 'requested');
  perform public.enqueue_admin_voyage_booking_notifications(
    new_request_id,
    'admin_new_booking',
    jsonb_build_object('status', 'requested')
  );

  booking_request_id := new_request_id;
  booking_status := 'requested';
  return next;
end;
$function$;

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

create or replace function public.admin_update_booking_legs(
  _booking_request_id uuid,
  _leg_ids uuid[],
  _allow_over_capacity boolean default false
)
returns table (over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_voyage_id uuid;
  target_status public.voyage_booking_status;
  target_party_size integer;
  selected_leg_count integer;
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking legs' using errcode = '42501';
  end if;

  if _leg_ids is null or cardinality(_leg_ids) = 0 then
    raise exception 'At least one leg is required' using errcode = '22023';
  end if;

  select voyage_id, status, party_size
  into target_voyage_id, target_status, target_party_size
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = target_voyage_id
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

  if target_status in ('admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(
      target_voyage_id, _leg_ids, target_party_size, _booking_request_id
    );
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  delete from public.voyage_booking_request_legs where booking_request_id = _booking_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select _booking_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  update public.voyage_booking_requests
  set updated_at = timezone('utc', now())
  where id = _booking_request_id;

  over_capacity := exceeds_capacity;
  return next;
end;
$$;

create or replace function public.admin_create_voyage_booking(
  _voyage_id uuid,
  _profile_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _status public.voyage_booking_status default 'admin_approved',
  _message text default null,
  _admin_notes text default null,
  _allow_over_capacity boolean default true
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
    confirmed_at
  )
  values (
    _voyage_id,
    _profile_id,
    _party_size,
    _status,
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end
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
  _allow_over_capacity boolean default true
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
      and request.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
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
    confirmed_at
  )
  values (
    _voyage_id,
    v_profile_id,
    1,
    _status,
    'each_pays_own',
    nullif(trim(coalesce(_message, '')), ''),
    nullif(trim(coalesce(_admin_notes, '')), ''),
    case when _status = 'user_confirmed' then timezone('utc', now()) else null end
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

revoke execute on function public.admin_booking_over_capacity(uuid, uuid[], integer, uuid) from public, anon;
grant execute on function public.admin_booking_over_capacity(uuid, uuid[], integer, uuid) to authenticated;
revoke execute on function public.get_public_voyage_leg_availability(uuid[]) from public;
grant execute on function public.get_public_voyage_leg_availability(uuid[]) to anon, authenticated;
revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) from public, anon;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) to authenticated;
revoke execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) from public, anon;
grant execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) to authenticated;
revoke execute on function public.admin_update_booking_legs(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_update_booking_legs(uuid, uuid[], boolean) to authenticated;
revoke execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) to authenticated;
revoke execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean) from public, anon;
grant execute on function public.admin_create_voyage_booking_invite_by_email(uuid, text, uuid[], text, text, public.voyage_booking_status, text, text, boolean) to authenticated;
