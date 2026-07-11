-- Dynamic voyage contribution calculation.
-- Adds:
-- - per-voyage EUR/NM coefficient (default 0.90);
-- - planned nautical miles on bookable legs, populated by the sync function;
-- - public leg availability RPC output for the planned distance used by the client.

alter table public.voyages
  add column if not exists booking_contribution_per_nm_eur numeric(8, 2) not null default 0.90;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyages_booking_contribution_per_nm_nonnegative'
  ) then
    alter table public.voyages
      add constraint voyages_booking_contribution_per_nm_nonnegative
      check (booking_contribution_per_nm_eur >= 0);
  end if;
end $$;

alter table public.voyage_bookable_legs
  add column if not exists planned_nautical_miles numeric(10, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_bookable_legs_planned_nm_nonnegative'
  ) then
    alter table public.voyage_bookable_legs
      add constraint voyage_bookable_legs_planned_nm_nonnegative
      check (planned_nautical_miles >= 0);
  end if;
end $$;

update public.voyage_bookable_legs leg
set planned_nautical_miles = round(
  greatest(
    0,
    3440.065 * acos(least(1, greatest(-1,
      sin(radians(from_wp.lat::double precision)) * sin(radians(to_wp.lat::double precision)) +
      cos(radians(from_wp.lat::double precision)) * cos(radians(to_wp.lat::double precision)) *
      cos(radians((to_wp.lng - from_wp.lng)::double precision))
    )))
  )::numeric,
  2
)
from public.voyage_waypoints from_wp, public.voyage_waypoints to_wp
where from_wp.id = leg.from_waypoint_id
  and to_wp.id = leg.to_waypoint_id
  and from_wp.lat is not null
  and from_wp.lng is not null
  and to_wp.lat is not null
  and to_wp.lng is not null
  and coalesce(leg.planned_nautical_miles, 0) = 0;

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
  leg_nm numeric;
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
    planned_nautical_miles numeric(10, 2) not null,
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
      leg_nm := 0;
      leg_hours := 0;
    else
      central_angle := acos(least(1, greatest(-1,
        sin(radians(previous_wp.lat::double precision)) * sin(radians(current_wp.lat::double precision)) +
        cos(radians(previous_wp.lat::double precision)) * cos(radians(current_wp.lat::double precision)) *
        cos(radians((current_wp.lng - previous_wp.lng)::double precision))
      )));
      leg_nm := 3440.065 * central_angle;
      leg_hours := leg_nm / v_speed;
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
      planned_nautical_miles,
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
      round(greatest(coalesce(leg_nm, 0), 0), 2),
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
    planned_nautical_miles,
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
    planned_nautical_miles,
    starts_at_window_start,
    starts_at_window_end,
    ends_at_window_start,
    ends_at_window_end,
    is_bookable
  from pg_temp.voyage_leg_sync_buffer
  on conflict (voyage_id, from_waypoint_id, to_waypoint_id)
  do update set
    sort_order = excluded.sort_order,
    planned_nautical_miles = excluded.planned_nautical_miles,
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

drop function if exists public.get_public_voyage_leg_availability(uuid[]);

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
    where req.status in ('requested', 'admin_approved', 'user_confirmed')
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
      and (
        coalesce(leg.starts_at_window_end, leg.starts_at_window_start, leg.ends_at_window_end, leg.ends_at_window_start) is null
        or coalesce(leg.starts_at_window_end, leg.starts_at_window_start, leg.ends_at_window_end, leg.ends_at_window_start)::date >= current_date
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

revoke execute on function public.get_public_voyage_leg_availability(uuid[]) from public;
grant execute on function public.get_public_voyage_leg_availability(uuid[]) to anon, authenticated;
