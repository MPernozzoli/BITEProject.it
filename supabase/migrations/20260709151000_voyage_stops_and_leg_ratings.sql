-- Voyage planning improvements:
--   1. Friendlier stop planning on waypoints: instead of a raw minute count, a stop is
--      expressed either as a number of hours ("short technical stop") or as a number of
--      days plus a target local departure time (e.g. leave Palermo at 19:00 two days after
--      arrival). The legacy minute value is kept as a fallback for untouched waypoints.
--   2. Per-leg difficulty/danger ratings on bookable legs. danger_level and open_sea are
--      manual (not derivable from geometry); complexity is computed client-side from these
--      plus duration/night-navigation, with an optional manual override.

-- 1. Stop configuration on waypoints -----------------------------------------------------
alter table public.voyage_waypoints
  add column if not exists stop_mode text not null default 'legacy',
  add column if not exists stop_hours smallint,
  add column if not exists stop_nights smallint,
  add column if not exists stop_departure_time time;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_waypoints_stop_mode_check'
  ) then
    alter table public.voyage_waypoints
      add constraint voyage_waypoints_stop_mode_check
      check (stop_mode in ('legacy', 'hours', 'nights'));
  end if;
end $$;
-- 2. Leg difficulty / danger -------------------------------------------------------------
alter table public.voyage_bookable_legs
  add column if not exists danger_level smallint not null default 0,
  add column if not exists open_sea boolean not null default false,
  add column if not exists complexity_override smallint;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_bookable_legs_danger_level_check'
  ) then
    alter table public.voyage_bookable_legs
      add constraint voyage_bookable_legs_danger_level_check
      check (danger_level between 0 and 3);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_bookable_legs_complexity_override_check'
  ) then
    alter table public.voyage_bookable_legs
      add constraint voyage_bookable_legs_complexity_override_check
      check (complexity_override is null or complexity_override between 1 and 5);
  end if;
end $$;
-- Helper: given an arrival instant and a waypoint's stop configuration, return the next
-- departure instant. 'hours' adds a fixed number of hours; 'nights' lands on
-- arrival_date + N days at the chosen local (Europe/Rome) time; 'legacy' uses the old
-- minute value. Guards against a computed departure that would fall before arrival.
create or replace function public.booking_next_departure(
  _arrival timestamptz,
  _stop_mode text,
  _stop_hours integer,
  _stop_nights integer,
  _stop_departure_time time,
  _legacy_minutes integer
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  d timestamptz;
begin
  if _arrival is null then
    return null;
  end if;

  if _stop_mode = 'hours' then
    return _arrival + make_interval(hours => greatest(coalesce(_stop_hours, 0), 0));
  elsif _stop_mode = 'nights' then
    d := (
      ((timezone('Europe/Rome', _arrival))::date + greatest(coalesce(_stop_nights, 1), 0))
      + coalesce(_stop_departure_time, '07:00'::time)
    ) at time zone 'Europe/Rome';
    if d < _arrival then
      d := d + interval '1 day';
    end if;
    return d;
  else
    return _arrival + make_interval(mins => greatest(coalesce(_legacy_minutes, 0), 0));
  end if;
end;
$$;
grant execute on function public.booking_next_departure(timestamptz, text, integer, integer, time, integer) to authenticated;
-- Rebuild the sync function to source the post-stop departure from booking_next_departure.
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
      nullif(w.date_start::text, '')::timestamptz as date_start_at,
      nullif(w.date_end::text, '')::timestamptz as date_end_at,
      coalesce(w.planned_stop_duration_minutes, 0) as planned_stop_duration_minutes,
      coalesce(w.stop_mode, 'legacy') as stop_mode,
      w.stop_hours,
      w.stop_nights,
      w.stop_departure_time,
      row_number() over (order by w.sort_order, w.created_at, w.id) as public_rank
    from public.voyage_waypoints w
    where w.voyage_id = _voyage_id
      and (
        (w.visibility_mode = 'manual' and w.waypoint_type = 'narrative')
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
      next_departure_start := coalesce(current_wp.date_start_at, v_departure_start);
      next_departure_end := coalesce(current_wp.date_start_at, v_departure_end, v_departure_start);
      previous_wp := current_wp;
      continue;
    end if;

    leg_start_start := coalesce(previous_wp.date_start_at, next_departure_start);
    leg_start_end := coalesce(previous_wp.date_start_at, next_departure_end, leg_start_start);

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
      current_wp.date_end_at,
      case when leg_start_start is not null then leg_start_start + make_interval(secs => round(leg_hours * 3600)::integer) else null end
    );
    arrival_end := coalesce(
      current_wp.date_end_at,
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
      current_wp.date_start_at,
      public.booking_next_departure(
        arrival_start,
        current_wp.stop_mode,
        current_wp.stop_hours,
        current_wp.stop_nights,
        current_wp.stop_departure_time,
        current_wp.planned_stop_duration_minutes
      )
    );
    next_departure_end := coalesce(
      current_wp.date_start_at,
      public.booking_next_departure(
        arrival_end,
        current_wp.stop_mode,
        current_wp.stop_hours,
        current_wp.stop_nights,
        current_wp.stop_departure_time,
        current_wp.planned_stop_duration_minutes
      )
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
grant execute on function public.sync_voyage_bookable_legs(uuid) to authenticated;
