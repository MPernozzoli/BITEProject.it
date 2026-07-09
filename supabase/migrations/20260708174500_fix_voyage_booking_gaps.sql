create or replace function public.booking_leg_effective_date(
  _starts_at_window_start timestamptz,
  _starts_at_window_end timestamptz,
  _ends_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns date
language sql
stable
set search_path = public
as $$
  select (timezone(
    'Europe/Rome',
    coalesce(_starts_at_window_end, _starts_at_window_start, _ends_at_window_end, _ends_at_window_start)
  ))::date
$$;

create or replace function public.booking_leg_is_current_or_future(
  _starts_at_window_start timestamptz,
  _starts_at_window_end timestamptz,
  _ends_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.booking_leg_effective_date(
    _starts_at_window_start,
    _starts_at_window_end,
    _ends_at_window_start,
    _ends_at_window_end
  ) is null
  or public.booking_leg_effective_date(
    _starts_at_window_start,
    _starts_at_window_end,
    _ends_at_window_start,
    _ends_at_window_end
  ) >= (timezone('Europe/Rome', now()))::date
$$;

create or replace function public.deactivate_past_voyage_bookable_legs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  update public.voyage_bookable_legs leg
  set is_bookable = false
  where leg.is_bookable = true
    and not public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.sync_voyage_bookable_legs(_voyage_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  deactivated_count integer := 0;
  v_booking_enabled boolean;
  v_speed numeric;
  v_departure_start timestamptz;
  v_departure_end timestamptz;
  previous_wp record;
  current_wp record;
  leg_start_start timestamptz;
  leg_start_end timestamptz;
  arrival_start timestamptz;
  arrival_end timestamptz;
  next_departure_start timestamptz;
  next_departure_end timestamptz;
  leg_hours numeric;
  central_angle numeric;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can sync voyage booking legs' using errcode = '42501';
  end if;

  select
    v.booking_enabled,
    greatest(coalesce(v.booking_planning_speed_kn, 5), 0.1),
    coalesce(
      v.departure_window_start,
      case
        when v.start_date is not null then ((v.start_date::date + coalesce(v.start_time, '00:00')::time) at time zone 'Europe/Rome')
        else null
      end
    ),
    coalesce(
      v.departure_window_end,
      case
        when v.start_date is not null then (((v.start_date::date + coalesce(v.start_date_flex_days, 0)) + coalesce(v.start_time, '23:59')::time) at time zone 'Europe/Rome')
        else null
      end,
      v.departure_window_start
    )
  into v_booking_enabled, v_speed, v_departure_start, v_departure_end
  from public.voyages v
  where v.id = _voyage_id;

  if v_booking_enabled is distinct from true then
    update public.voyage_bookable_legs
    set is_bookable = false
    where voyage_id = _voyage_id
      and is_bookable = true;
    get diagnostics deactivated_count = row_count;
    return deactivated_count;
  end if;

  create temporary table if not exists pg_temp.voyage_leg_sync_buffer (
    voyage_id uuid not null,
    from_waypoint_id uuid not null,
    to_waypoint_id uuid not null,
    sort_order integer not null,
    starts_at_window_start timestamptz,
    starts_at_window_end timestamptz,
    ends_at_window_start timestamptz,
    ends_at_window_end timestamptz,
    is_bookable boolean not null
  ) on commit drop;

  truncate table pg_temp.voyage_leg_sync_buffer;

  for current_wp in
    select
      w.id,
      w.voyage_id,
      w.lat,
      w.lng,
      w.sort_order,
      w.date_start,
      w.date_end,
      coalesce(w.planned_stop_duration_minutes, 0) as planned_stop_duration_minutes,
      row_number() over (order by w.sort_order, w.created_at, w.id) as public_rank
    from public.voyage_waypoints w
    where w.voyage_id = _voyage_id
      and (
        w.visibility_mode = 'narrative'
        or (
          w.visibility_mode = 'auto'
          and (
            w.sort_order = (select min(w2.sort_order) from public.voyage_waypoints w2 where w2.voyage_id = _voyage_id)
            or w.sort_order = (select max(w3.sort_order) from public.voyage_waypoints w3 where w3.voyage_id = _voyage_id)
          )
        )
      )
    order by w.sort_order, w.created_at, w.id
  loop
    if previous_wp is null then
      next_departure_start := coalesce(current_wp.date_start, v_departure_start);
      next_departure_end := coalesce(current_wp.date_start, v_departure_end, v_departure_start);
      previous_wp := current_wp;
      continue;
    end if;

    leg_start_start := coalesce(previous_wp.date_start, next_departure_start);
    leg_start_end := coalesce(previous_wp.date_start, next_departure_end, leg_start_start);

    if previous_wp.lat is null or previous_wp.lng is null or current_wp.lat is null or current_wp.lng is null then
      leg_hours := 0;
    else
      central_angle := acos(least(1, greatest(-1,
        sin(radians(previous_wp.lat::double precision)) * sin(radians(current_wp.lat::double precision)) +
        cos(radians(previous_wp.lat::double precision)) * cos(radians(current_wp.lat::double precision)) *
        cos(radians((current_wp.lng - previous_wp.lng)::double precision))
      )));
      leg_hours := (3440.065 * central_angle) / v_speed;
    end if;

    arrival_start := coalesce(
      current_wp.date_end,
      case when leg_start_start is not null then leg_start_start + make_interval(secs => round(leg_hours * 3600)::integer) else null end
    );
    arrival_end := coalesce(
      current_wp.date_end,
      case when leg_start_end is not null then leg_start_end + make_interval(secs => round(leg_hours * 3600)::integer) else null end
    );

    insert into pg_temp.voyage_leg_sync_buffer (
      voyage_id,
      from_waypoint_id,
      to_waypoint_id,
      sort_order,
      starts_at_window_start,
      starts_at_window_end,
      ends_at_window_start,
      ends_at_window_end,
      is_bookable
    )
    values (
      _voyage_id,
      previous_wp.id,
      current_wp.id,
      previous_wp.public_rank::integer - 1,
      leg_start_start,
      leg_start_end,
      arrival_start,
      arrival_end,
      public.booking_leg_is_current_or_future(leg_start_start, leg_start_end, arrival_start, arrival_end)
    );

    next_departure_start := coalesce(
      current_wp.date_start,
      case when arrival_start is not null then arrival_start + make_interval(mins => current_wp.planned_stop_duration_minutes) else null end
    );
    next_departure_end := coalesce(
      current_wp.date_start,
      case when arrival_end is not null then arrival_end + make_interval(mins => current_wp.planned_stop_duration_minutes) else null end
    );
    previous_wp := current_wp;
  end loop;

  insert into public.voyage_bookable_legs (
    voyage_id,
    from_waypoint_id,
    to_waypoint_id,
    sort_order,
    starts_at_window_start,
    starts_at_window_end,
    ends_at_window_start,
    ends_at_window_end,
    is_bookable
  )
  select
    voyage_id,
    from_waypoint_id,
    to_waypoint_id,
    sort_order,
    starts_at_window_start,
    starts_at_window_end,
    ends_at_window_start,
    ends_at_window_end,
    is_bookable
  from pg_temp.voyage_leg_sync_buffer
  on conflict (voyage_id, from_waypoint_id, to_waypoint_id)
  do update set
    sort_order = excluded.sort_order,
    starts_at_window_start = excluded.starts_at_window_start,
    starts_at_window_end = excluded.starts_at_window_end,
    ends_at_window_start = excluded.ends_at_window_start,
    ends_at_window_end = excluded.ends_at_window_end,
    is_bookable = excluded.is_bookable,
    updated_at = timezone('utc', now());

  get diagnostics affected_count = row_count;

  update public.voyage_bookable_legs leg
  set is_bookable = false
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and (
      not exists (
        select 1
        from pg_temp.voyage_leg_sync_buffer buffer
        where buffer.voyage_id = leg.voyage_id
          and buffer.from_waypoint_id = leg.from_waypoint_id
          and buffer.to_waypoint_id = leg.to_waypoint_id
      )
      or not public.booking_leg_is_current_or_future(
        leg.starts_at_window_start,
        leg.starts_at_window_end,
        leg.ends_at_window_start,
        leg.ends_at_window_end
      )
    );

  get diagnostics deactivated_count = row_count;
  return affected_count + deactivated_count;
end;
$$;

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null
)
returns table (booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  capacity integer;
  selected_leg_count integer;
  full_leg_count integer;
  next_status public.voyage_booking_status;
  new_request_id uuid;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
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
    and public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0) as occupied_count
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.status in ('requested', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select count(*)
  into full_leg_count
  from unnest(_leg_ids) as requested_leg(id)
  left join occupied on occupied.bookable_leg_id = requested_leg.id
  where coalesce(occupied.occupied_count, 0) + _party_size > capacity;

  next_status := case when full_leg_count > 0 then 'waitlisted' else 'requested' end;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    next_status,
    nullif(trim(coalesce(_message, '')), '')
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  booking_request_id := new_request_id;
  booking_status := next_status;
  return next;
end;
$$;

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
      and req.status in ('requested', 'admin_approved', 'user_confirmed')
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
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select *
  into booking
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
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

  update public.voyage_booking_requests
  set
    status = _status,
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else cancelled_at end
  where id = _booking_request_id;

  booking_request_id := _booking_request_id;
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
    and public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
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

  booking_request_id := new_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

drop policy if exists "Published bookable legs are readable" on public.voyage_bookable_legs;
create policy "Published bookable legs are readable"
  on public.voyage_bookable_legs
  for select
  using (
    exists (
      select 1
      from public.voyages v
      where v.id = voyage_bookable_legs.voyage_id
        and v.is_published = true
        and v.booking_enabled = true
    )
    or public.has_role(auth.uid(), 'admin'::public.app_role)
  );

revoke execute on function public.sync_voyage_bookable_legs(uuid) from public, anon;
revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text) from public, anon;
revoke execute on function public.confirm_voyage_booking(uuid) from public, anon;
revoke execute on function public.cancel_voyage_booking(uuid) from public, anon;
revoke execute on function public.deactivate_past_voyage_bookable_legs() from public, anon;
revoke execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) from public, anon;
revoke execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) from public, anon;

grant execute on function public.sync_voyage_bookable_legs(uuid) to authenticated;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text) to authenticated;
grant execute on function public.confirm_voyage_booking(uuid) to authenticated;
grant execute on function public.cancel_voyage_booking(uuid) to authenticated;
grant execute on function public.deactivate_past_voyage_bookable_legs() to authenticated, service_role;
grant execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) to authenticated;
grant execute on function public.admin_create_voyage_booking(uuid, uuid, uuid[], integer, public.voyage_booking_status, text, text, boolean) to authenticated;

select cron.schedule(
  'deactivate-past-voyage-bookable-legs',
  '0 0 * * *',
  $$select public.deactivate_past_voyage_bookable_legs();$$
)
where not exists (
  select 1
  from cron.job
  where jobname = 'deactivate-past-voyage-bookable-legs'
);

select public.deactivate_past_voyage_bookable_legs();
