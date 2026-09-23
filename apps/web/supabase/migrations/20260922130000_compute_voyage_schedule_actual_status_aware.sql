-- compute_voyage_schedule() walked every narrative waypoint regardless of
-- actual_status, while voyage_leg_candidate_waypoints() (added in
-- 20260917120000 to build voyage_bookable_legs) excludes 'added' stops and
-- peels boundary 'skipped' ones. The two walks were meant to describe the same
-- leg chain — one its identity, the other its timing — but diverged the moment
-- a route correction inserted an 'added' stop mid-route: the (from, to) pairs
-- compute_voyage_schedule produced no longer matched any row in
-- voyage_bookable_legs for the leg spanning the correction, so
-- apply_voyage_schedule's UPDATE (joined on that pair) silently skipped it
-- forever. Concretely: after adding Roccella Ionica/Reggio Calabria between
-- Crotone and Messina and marking Messina skipped, the pass-through actual
-- recorded on Messina never closed the Crotone -> Messina leg, because
-- compute_voyage_schedule's chain was Crotone -> Roccella Ionica ->
-- Reggio Calabria -> Messina -> ... while voyage_bookable_legs' chain was
-- Crotone -> Messina -> ... — no shared (Crotone, Messina) pair to join on.
--
-- Fix: reuse voyage_leg_candidate_waypoints() here too, so both walks are
-- built from the exact same candidate set and order, and their (from, to)
-- pairs always line up. Everything else in the function (the timing math) is
-- untouched.

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
    select
      w.id,
      w.lat,
      w.lng,
      candidate.public_rank,
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
    join public.voyage_leg_candidate_waypoints(_voyage_id) candidate on candidate.id = w.id
    order by candidate.public_rank
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
        select leg.baseline_starts_at_window_start
        into baseline_floor
        from public.voyage_bookable_legs leg
        where leg.voyage_id = _voyage_id
          and leg.from_waypoint_id = current_wp.id
        limit 1;

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
  'Walks the candidate waypoint chain (voyage_leg_candidate_waypoints, actual_status-aware) and returns the leg schedule. _use_actuals=false yields the baseline plan; true folds in recorded actuals and clamps stops to the baseline floor. Uses the same candidate set as sync_voyage_bookable_legs_plan so its (from, to) pairs always match voyage_bookable_legs.';
