-- Real-time voyage tracking: actual arrival/departure per waypoint, cascading
-- recomputation of the downstream schedule, and derived voyage/leg phases.
--
-- Two schedules now coexist on voyage_bookable_legs:
--   * baseline_*  — the plan as last approved by an admin. Frozen here; only a
--     real replan (sync_voyage_bookable_legs) rewrites it.
--   * starts_at_window_* / ends_at_window_* — the effective schedule, which
--     folds in the actuals. Every existing consumer (deposits, refunds, booking
--     matrix, gantt, public UI) already reads these, so they pick up real dates
--     with no change.
--
-- Scheduling rule: the baseline is a floor, not an offset. A late arrival pushes
-- everything downstream; an early arrival is absorbed by extending the stop,
-- because a stop never ends before the baseline said it would. Departing early
-- stays possible, but only as an explicit manual actual.

-- 1. Actuals live on the waypoint: it owns an arrival and a departure, and the
--    gap between them is the real stop. Legs mirror them for read convenience.
alter table public.voyage_waypoints
  add column if not exists actual_arrival_at timestamptz,
  add column if not exists actual_departure_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_waypoints_actual_order_check'
  ) then
    alter table public.voyage_waypoints
      add constraint voyage_waypoints_actual_order_check
      check (
        actual_arrival_at is null
        or actual_departure_at is null
        or actual_departure_at >= actual_arrival_at
      );
  end if;
end $$;

comment on column public.voyage_waypoints.actual_arrival_at is
  'Recorded arrival. Pins the effective schedule at this waypoint and cascades downstream.';
comment on column public.voyage_waypoints.actual_departure_at is
  'Recorded departure. Overrides the baseline floor, so an early manual departure is honoured.';

alter table public.voyage_bookable_legs
  add column if not exists baseline_starts_at_window_start timestamptz,
  add column if not exists baseline_starts_at_window_end timestamptz,
  add column if not exists baseline_ends_at_window_start timestamptz,
  add column if not exists baseline_ends_at_window_end timestamptz,
  add column if not exists actual_departure_at timestamptz,
  add column if not exists actual_arrival_at timestamptz;

comment on column public.voyage_bookable_legs.baseline_starts_at_window_start is
  'Departure window from the last admin-approved plan. Floor for earliness absorption and reference for the delay test.';

-- 2. Manual override for the otherwise derived voyage status.
alter table public.voyages
  add column if not exists status_override public.voyage_status;

comment on column public.voyages.status_override is
  'Forces the voyage status. When null, voyages.status is a cache derived from actuals and dates.';
comment on column public.voyages.status is
  'Derived cache: coalesce(status_override, computed from actuals/dates). Refreshed by trigger and cron; the UI computes it live.';

-- 3. Plan changes gain a kind for pure delays: the leg chain is unchanged, only
--    the clock moved, so the existing waypoint-remap reconciliation never fires.
alter table public.voyage_booking_plan_changes
  drop constraint if exists voyage_booking_plan_changes_kind_check;
alter table public.voyage_booking_plan_changes
  add constraint voyage_booking_plan_changes_kind_check
  check (change_kind in (
    'intermediate_waypoints_changed',
    'endpoint_waypoint_removed',
    'route_replanned',
    'schedule_delayed'
  ));

-- 4. The schedule engine, extracted from sync_voyage_bookable_legs so the same
--    walk produces both schedules. _use_actuals = false reproduces the previous
--    behaviour exactly.
create or replace function public.compute_voyage_schedule(
  _voyage_id uuid,
  _use_actuals boolean
)
returns table (
  from_waypoint_id uuid,
  to_waypoint_id uuid,
  leg_sort_order integer,
  leg_nautical_miles numeric,
  departure_window_start timestamptz,
  departure_window_end timestamptz,
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  leg_actual_departure_at timestamptz,
  leg_actual_arrival_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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
  rule_departure_start timestamptz;
  rule_departure_end timestamptz;
  baseline_floor timestamptz;
  leg_hours numeric;
  leg_nm numeric;
  central_angle numeric;
begin
  select
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
  into v_speed, v_departure_start, v_departure_end
  from public.voyages v
  where v.id = _voyage_id;

  if v_speed is null then
    return;
  end if;

  for current_wp in
    with public_waypoints as (
      select
        w.id,
        w.lat,
        w.lng,
        w.sort_order,
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
    )
    select
      w.id,
      w.lat,
      w.lng,
      pw.public_rank::integer as public_rank,
      nullif(w.date_start::text, '')::timestamptz as date_start_at,
      nullif(w.date_end::text, '')::timestamptz as date_end_at,
      coalesce(w.planned_stop_duration_minutes, 0) as planned_stop_duration_minutes,
      coalesce(w.stop_mode, 'legacy') as stop_mode,
      w.stop_hours,
      w.stop_nights,
      w.stop_departure_time,
      w.actual_arrival_at,
      w.actual_departure_at
    from public.voyage_waypoints w
    join public_waypoints pw on pw.id = w.id
    order by pw.public_rank
  loop
    if previous_wp is null then
      if _use_actuals and current_wp.actual_departure_at is not null then
        next_departure_start := current_wp.actual_departure_at;
        next_departure_end := current_wp.actual_departure_at;
      else
        next_departure_start := coalesce(current_wp.date_start_at, v_departure_start);
        next_departure_end := coalesce(current_wp.date_start_at, v_departure_end, v_departure_start);
      end if;
      previous_wp := current_wp;
      continue;
    end if;

    leg_start_start := next_departure_start;
    leg_start_end := next_departure_end;

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

    if _use_actuals and current_wp.actual_arrival_at is not null then
      arrival_start := current_wp.actual_arrival_at;
      arrival_end := current_wp.actual_arrival_at;
    else
      arrival_start := coalesce(
        current_wp.date_end_at,
        case when leg_start_start is not null then leg_start_start + make_interval(secs => round(leg_hours * 3600)::integer) else null end
      );
      arrival_end := coalesce(
        current_wp.date_end_at,
        case when leg_start_end is not null then leg_start_end + make_interval(secs => round(leg_hours * 3600)::integer) else null end
      );
    end if;

    return query select
      previous_wp.id,
      current_wp.id,
      previous_wp.public_rank - 1,
      round(greatest(coalesce(leg_nm, 0), 0), 2),
      leg_start_start,
      leg_start_end,
      arrival_start,
      arrival_end,
      case when _use_actuals then previous_wp.actual_departure_at else null end,
      case when _use_actuals then current_wp.actual_arrival_at else null end;

    if _use_actuals and current_wp.actual_departure_at is not null then
      next_departure_start := current_wp.actual_departure_at;
      next_departure_end := current_wp.actual_departure_at;
    else
      rule_departure_start := public.booking_next_departure(
        arrival_start,
        current_wp.stop_mode,
        current_wp.stop_hours,
        current_wp.stop_nights,
        current_wp.stop_departure_time,
        current_wp.planned_stop_duration_minutes
      );
      rule_departure_end := public.booking_next_departure(
        arrival_end,
        current_wp.stop_mode,
        current_wp.stop_hours,
        current_wp.stop_nights,
        current_wp.stop_departure_time,
        current_wp.planned_stop_duration_minutes
      );

      if _use_actuals then
        -- Absorb earliness into the stop: never depart before the earliest the
        -- baseline allowed. Both bounds clamp to the same floor, otherwise an
        -- actual-collapsed point would re-open into the old flex window.
        select leg.baseline_starts_at_window_start
        into baseline_floor
        from public.voyage_bookable_legs leg
        where leg.voyage_id = _voyage_id
          and leg.from_waypoint_id = current_wp.id
        limit 1;

        -- greatest() ignores nulls, so a missing baseline simply skips the clamp.
        rule_departure_start := greatest(rule_departure_start, baseline_floor);
        rule_departure_end := greatest(rule_departure_end, baseline_floor);
      end if;

      next_departure_start := coalesce(current_wp.date_start_at, rule_departure_start);
      next_departure_end := coalesce(current_wp.date_start_at, rule_departure_end);
    end if;

    previous_wp := current_wp;
  end loop;

  return;
end;
$$;

revoke execute on function public.compute_voyage_schedule(uuid, boolean) from public, anon;
grant execute on function public.compute_voyage_schedule(uuid, boolean) to authenticated, service_role;

comment on function public.compute_voyage_schedule(uuid, boolean) is
  'Walks the public waypoint chain and returns the leg schedule. _use_actuals=false yields the baseline plan; true folds in recorded actuals and clamps stops to the baseline floor.';
