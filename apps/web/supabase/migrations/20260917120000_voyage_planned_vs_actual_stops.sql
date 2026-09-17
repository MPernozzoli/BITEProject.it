-- Tappe previste vs tappe effettive.
--
-- Adds `actual_status` on voyage_waypoints ('planned' | 'skipped' | 'added') so a
-- stop can be annotated as not actually reached, or as an extra stop that was
-- never part of the plan. This is purely presentational for a mid-route
-- correction: the booking engine (voyage_bookable_legs / pricing) must stay
-- blind to it. The one exception, per product decision, is when the skipped
-- stop is the voyage's own overall first or last public stop — that genuinely
-- changes the priced span, so it re-triggers the existing plan-change
-- reconciliation in sync_voyage_bookable_legs.
--
-- To keep sync_voyage_bookable_legs_plan's candidate-selection logic exactly as
-- it is today (same tie-breaks, same auto-visibility bookend rule) plus the new
-- actual_status awareness in one place, the candidate query is extracted into
-- its own function, voyage_leg_candidate_waypoints(), reused by both the sync
-- function and the new RPC's boundary check. Everything else in
-- sync_voyage_bookable_legs_plan (the leg-building loop, the booking
-- reconciliation) is untouched.

-- 1. The new column. Default 'planned' for every existing row: zero behaviour
--    change until an admin explicitly annotates a stop.
alter table public.voyage_waypoints
  add column if not exists actual_status text not null default 'planned';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'voyage_waypoints_actual_status_check'
  ) then
    alter table public.voyage_waypoints
      add constraint voyage_waypoints_actual_status_check
      check (actual_status in ('planned', 'skipped', 'added'));
  end if;
end $$;

comment on column public.voyage_waypoints.actual_status is
  'planned (default): part of the plan, no correction recorded. skipped: was planned but not actually reached — excluded from the map/actual trail, kept (except at the voyage''s own boundary) in the booking leg chain. added: not part of the original plan, recorded only to show what actually happened — never a booking leg endpoint.';

-- 2. The single source of truth for "which waypoints can be a bookable leg
--    endpoint", now actual_status-aware:
--      - actual_status = 'added' is never a candidate, at any position.
--      - actual_status = 'skipped' is peeled only from the two ends of the
--        candidate sequence (the voyage's own first/last public stop); a
--        skipped stop in the middle of the route stays a candidate exactly as
--        before, so a mid-route correction never changes a single leg.
create or replace function public.voyage_leg_candidate_waypoints(_voyage_id uuid)
returns table (
  id uuid,
  voyage_id uuid,
  sort_order integer,
  public_rank integer
)
language sql
stable
set search_path = public
as $$
  with base as (
    select
      w.id,
      w.voyage_id,
      w.sort_order,
      w.created_at,
      w.actual_status,
      row_number() over (order by w.sort_order, w.created_at, w.id) as rn
    from public.voyage_waypoints w
    where w.voyage_id = _voyage_id
      and w.actual_status <> 'added'
      and (
        (w.visibility_mode = 'manual' and w.waypoint_type = 'narrative')
        or (
          w.visibility_mode = 'auto'
          and (
            w.sort_order = (
              select min(w2.sort_order) from public.voyage_waypoints w2
              where w2.voyage_id = _voyage_id and w2.actual_status <> 'added'
            )
            or w.sort_order = (
              select max(w3.sort_order) from public.voyage_waypoints w3
              where w3.voyage_id = _voyage_id and w3.actual_status <> 'added'
            )
          )
        )
      )
  ),
  bounds as (
    select
      min(rn) filter (where actual_status <> 'skipped') as first_rn,
      max(rn) filter (where actual_status <> 'skipped') as last_rn
    from base
  )
  select
    base.id,
    base.voyage_id,
    base.sort_order,
    (row_number() over (order by base.sort_order, base.created_at, base.id))::integer as public_rank
  from base, bounds
  where bounds.first_rn is not null
    and base.rn between bounds.first_rn and bounds.last_rn;
$$;

comment on function public.voyage_leg_candidate_waypoints(uuid) is
  'Waypoints eligible to be a voyage_bookable_legs endpoint, in booking order. Excludes actual_status = added always; peels a leading/trailing run of actual_status = skipped from the two ends only, leaving a mid-route skip with zero effect on the leg chain.';

grant execute on function public.voyage_leg_candidate_waypoints(uuid) to authenticated, anon, service_role;

-- 3. sync_voyage_bookable_legs_plan: identical to the live definition, except
--    the candidate-selection insert now delegates to voyage_leg_candidate_waypoints
--    instead of repeating the query inline.
create or replace function public.sync_voyage_bookable_legs_plan(_voyage_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  deleted_count integer := 0;
  changed_booking_count integer := 0;
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

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));

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
    get diagnostics affected_count = row_count;
    return affected_count;
  end if;

  create temporary table if not exists pg_temp.voyage_public_waypoint_buffer (
    id uuid not null primary key,
    voyage_id uuid not null,
    waypoint_sort_order integer not null,
    public_rank integer not null
  ) on commit drop;

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
    is_bookable boolean not null,
    leg_id uuid
  ) on commit drop;

  create temporary table if not exists pg_temp.voyage_booking_replan_buffer (
    booking_request_id uuid not null primary key,
    voyage_id uuid not null,
    is_crew boolean not null,
    old_leg_ids uuid[] not null,
    new_leg_ids uuid[] not null,
    old_from_waypoint_id uuid,
    old_to_waypoint_id uuid,
    proposed_from_waypoint_id uuid,
    proposed_to_waypoint_id uuid,
    endpoints_changed boolean not null,
    change_kind text not null
  ) on commit drop;

  truncate table pg_temp.voyage_public_waypoint_buffer;
  truncate table pg_temp.voyage_leg_sync_buffer;
  truncate table pg_temp.voyage_booking_replan_buffer;

  insert into pg_temp.voyage_public_waypoint_buffer (id, voyage_id, waypoint_sort_order, public_rank)
  select
    candidate.id,
    candidate.voyage_id,
    candidate.sort_order,
    candidate.public_rank
  from public.voyage_leg_candidate_waypoints(_voyage_id) candidate;

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
      wp.public_rank
    from public.voyage_waypoints w
    join pg_temp.voyage_public_waypoint_buffer wp on wp.id = w.id
    order by wp.public_rank
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

  update pg_temp.voyage_leg_sync_buffer buffer
  set leg_id = leg.id
  from public.voyage_bookable_legs leg
  where leg.voyage_id = buffer.voyage_id
    and leg.from_waypoint_id = buffer.from_waypoint_id
    and leg.to_waypoint_id = buffer.to_waypoint_id;

  with booking_bounds as (
    select
      request.id as booking_request_id,
      request.voyage_id,
      coalesce(request.is_crew, false) as is_crew,
      array_agg(link.bookable_leg_id order by old_leg.sort_order, old_leg.id) as old_leg_ids,
      (array_agg(old_leg.from_waypoint_id order by old_from_wp.sort_order, old_leg.sort_order, old_leg.id))[1] as old_from_waypoint_id,
      (array_agg(old_leg.to_waypoint_id order by old_to_wp.sort_order desc, old_leg.sort_order desc, old_leg.id desc))[1] as old_to_waypoint_id,
      min(least(old_from_wp.sort_order, old_to_wp.sort_order)) as old_start_sort_order,
      max(greatest(old_from_wp.sort_order, old_to_wp.sort_order)) as old_end_sort_order
    from public.voyage_booking_requests request
    join public.voyage_booking_request_legs link on link.booking_request_id = request.id
    join public.voyage_bookable_legs old_leg on old_leg.id = link.bookable_leg_id
    join public.voyage_waypoints old_from_wp on old_from_wp.id = old_leg.from_waypoint_id
    join public.voyage_waypoints old_to_wp on old_to_wp.id = old_leg.to_waypoint_id
    where request.voyage_id = _voyage_id
      and request.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
    group by request.id, request.voyage_id, request.is_crew
  ),
  proposed_bounds as (
    select
      bounds.*,
      coalesce(
        old_start_public.public_rank,
        (
          select public_rank
          from pg_temp.voyage_public_waypoint_buffer candidate
          where candidate.waypoint_sort_order <= bounds.old_start_sort_order
          order by candidate.waypoint_sort_order desc, candidate.public_rank desc
          limit 1
        ),
        (
          select public_rank
          from pg_temp.voyage_public_waypoint_buffer candidate
          where candidate.waypoint_sort_order > bounds.old_start_sort_order
          order by candidate.waypoint_sort_order asc, candidate.public_rank asc
          limit 1
        )
      ) as proposed_start_rank,
      coalesce(
        old_end_public.public_rank,
        (
          select public_rank
          from pg_temp.voyage_public_waypoint_buffer candidate
          where candidate.waypoint_sort_order >= bounds.old_end_sort_order
          order by candidate.waypoint_sort_order asc, candidate.public_rank asc
          limit 1
        ),
        (
          select public_rank
          from pg_temp.voyage_public_waypoint_buffer candidate
          where candidate.waypoint_sort_order < bounds.old_end_sort_order
          order by candidate.waypoint_sort_order desc, candidate.public_rank desc
          limit 1
        )
      ) as proposed_end_rank,
      old_start_public.id is null as old_start_missing,
      old_end_public.id is null as old_end_missing
    from booking_bounds bounds
    left join pg_temp.voyage_public_waypoint_buffer old_start_public
      on old_start_public.id = bounds.old_from_waypoint_id
    left join pg_temp.voyage_public_waypoint_buffer old_end_public
      on old_end_public.id = bounds.old_to_waypoint_id
  ),
  proposed_legs as (
    select
      bounds.booking_request_id,
      bounds.voyage_id,
      bounds.is_crew,
      bounds.old_leg_ids,
      bounds.old_from_waypoint_id,
      bounds.old_to_waypoint_id,
      start_wp.id as proposed_from_waypoint_id,
      end_wp.id as proposed_to_waypoint_id,
      (bounds.old_start_missing or bounds.old_end_missing) as endpoints_changed,
      case
        when bounds.old_start_missing or bounds.old_end_missing then 'endpoint_waypoint_removed'
        when cardinality(bounds.old_leg_ids) = 1 and count(buffer.leg_id) > 1 then 'intermediate_waypoints_changed'
        when cardinality(bounds.old_leg_ids) > 1 and count(buffer.leg_id) = 1 then 'intermediate_waypoints_changed'
        else 'route_replanned'
      end as change_kind,
      coalesce(array_agg(buffer.leg_id order by buffer.sort_order) filter (where buffer.leg_id is not null), '{}'::uuid[]) as new_leg_ids
    from proposed_bounds bounds
    left join pg_temp.voyage_public_waypoint_buffer start_wp on start_wp.public_rank = bounds.proposed_start_rank
    left join pg_temp.voyage_public_waypoint_buffer end_wp on end_wp.public_rank = bounds.proposed_end_rank
    left join pg_temp.voyage_leg_sync_buffer buffer
      on buffer.sort_order >= least(bounds.proposed_start_rank, bounds.proposed_end_rank) - 1
      and buffer.sort_order < greatest(bounds.proposed_start_rank, bounds.proposed_end_rank) - 1
    group by
      bounds.booking_request_id,
      bounds.voyage_id,
      bounds.is_crew,
      bounds.old_leg_ids,
      bounds.old_from_waypoint_id,
      bounds.old_to_waypoint_id,
      start_wp.id,
      end_wp.id,
      bounds.old_start_missing,
      bounds.old_end_missing
  )
  insert into pg_temp.voyage_booking_replan_buffer (
    booking_request_id,
    voyage_id,
    is_crew,
    old_leg_ids,
    new_leg_ids,
    old_from_waypoint_id,
    old_to_waypoint_id,
    proposed_from_waypoint_id,
    proposed_to_waypoint_id,
    endpoints_changed,
    change_kind
  )
  select
    booking_request_id,
    voyage_id,
    is_crew,
    old_leg_ids,
    new_leg_ids,
    old_from_waypoint_id,
    old_to_waypoint_id,
    proposed_from_waypoint_id,
    proposed_to_waypoint_id,
    endpoints_changed,
    change_kind
  from proposed_legs
  where cardinality(new_leg_ids) > 0
    and old_leg_ids is distinct from new_leg_ids;

  insert into public.voyage_booking_plan_changes (
    booking_request_id,
    voyage_id,
    status,
    change_kind,
    old_from_waypoint_id,
    old_to_waypoint_id,
    proposed_from_waypoint_id,
    proposed_to_waypoint_id,
    old_leg_ids,
    proposed_leg_ids,
    metadata,
    email_status,
    resolved_at
  )
  select
    buffer.booking_request_id,
    buffer.voyage_id,
    case when buffer.is_crew then 'auto_accepted' else 'pending_user_approval' end,
    buffer.change_kind,
    buffer.old_from_waypoint_id,
    buffer.old_to_waypoint_id,
    buffer.proposed_from_waypoint_id,
    buffer.proposed_to_waypoint_id,
    buffer.old_leg_ids,
    buffer.new_leg_ids,
    jsonb_build_object(
      'reason', buffer.change_kind,
      'requires_manual_approval', not buffer.is_crew,
      'checkout_required_for_accepting_proposed_change', false,
      'available_actions', jsonb_build_array('accept_proposed_change', 'cancel_with_full_refund', 'request_different_route'),
      'email_prepared_not_sent', true
    ),
    case when buffer.is_crew then 'skipped' else 'not_configured' end,
    case when buffer.is_crew then timezone('utc', now()) else null end
  from pg_temp.voyage_booking_replan_buffer buffer;

  delete from public.voyage_booking_request_legs link
  using pg_temp.voyage_booking_replan_buffer buffer
  where link.booking_request_id = buffer.booking_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select buffer.booking_request_id, leg_id
  from pg_temp.voyage_booking_replan_buffer buffer
  cross join unnest(buffer.new_leg_ids) as selected(leg_id);

  update public.voyage_booking_requests request
  set
    plan_change_status = case when buffer.is_crew then 'auto_accepted' else 'pending_user_approval' end,
    plan_change_requested_at = case when buffer.is_crew then null else timezone('utc', now()) end,
    plan_change_resolved_at = case when buffer.is_crew then timezone('utc', now()) else null end,
    plan_change_metadata = jsonb_build_object(
      'change_kind', buffer.change_kind,
      'old_leg_ids', to_jsonb(buffer.old_leg_ids),
      'proposed_leg_ids', to_jsonb(buffer.new_leg_ids),
      'old_from_waypoint_id', buffer.old_from_waypoint_id,
      'old_to_waypoint_id', buffer.old_to_waypoint_id,
      'proposed_from_waypoint_id', buffer.proposed_from_waypoint_id,
      'proposed_to_waypoint_id', buffer.proposed_to_waypoint_id,
      'email_prepared_not_sent', true
    ),
    updated_at = timezone('utc', now())
  from pg_temp.voyage_booking_replan_buffer buffer
  where request.id = buffer.booking_request_id;

  get diagnostics changed_booking_count = row_count;

  delete from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and not exists (
      select 1
      from pg_temp.voyage_leg_sync_buffer buffer
      where buffer.leg_id = leg.id
    );

  get diagnostics deleted_count = row_count;

  return affected_count + deleted_count + changed_booking_count;
end;
$$;

comment on function public.sync_voyage_bookable_legs_plan(uuid) is
  'Internal: rebuilds the planned leg chain from voyage_leg_candidate_waypoints() and reconciles bookings. Knows nothing about timing actuals, so its output is the baseline. Call sync_voyage_bookable_legs instead.';

-- 4. The write path behind the live widget's "tappa saltata/sostituita" toggle.
--    Only planned <-> skipped is accepted here: 'added' stops are created
--    directly by the route-correction insert, never toggled onto an existing
--    planned row. Syncs the booking engine only when the touched waypoint was,
--    or becomes, the voyage's own first/last bookable stop.
--
--    A mid-route skip must not leave the live-tracking widget (and the voyage's
--    own derived status) stuck forever: voyage_leg_phase only ever completes a
--    leg once its to_waypoint has an actual_arrival_at, and nobody is ever going
--    to press "arriva ora" for a place the boat never reached. So when the
--    skipped waypoint is exactly the one the widget is currently waiting on (its
--    upstream leg has already departed, and nothing has arrived here yet), we
--    record a pass-through actual — arrival == departure, "reached and left
--    without stopping" — so apply_voyage_schedule can carry the schedule past
--    it. This only ever touches timing (the displayed windows/delay state);
--    it never changes voyage_bookable_legs' identity or its NM-based pricing,
--    and it is skipped entirely for any waypoint the widget isn't actually
--    waiting on (e.g. the voyage's own start, which never gets an arrival).
create or replace function public.set_voyage_waypoint_actual_status(
  _waypoint_id uuid,
  _status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_waypoint record;
  v_was_boundary boolean;
  v_is_boundary boolean;
  v_upstream_departure timestamptz;
  v_pass_through_at timestamptz;
  v_has_pending_arrival boolean;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can record voyage waypoint status' using errcode = '42501';
  end if;

  if _status not in ('planned', 'skipped') then
    raise exception 'invalid_actual_status' using errcode = '22023';
  end if;

  select * into v_waypoint from public.voyage_waypoints where id = _waypoint_id for update;
  if not found then
    raise exception 'waypoint_not_found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_waypoint.voyage_id::text, 0));

  with candidates as (
    select * from public.voyage_leg_candidate_waypoints(v_waypoint.voyage_id)
  )
  select exists (
    select 1 from candidates where id = _waypoint_id and public_rank = (select min(public_rank) from candidates)
  ) or exists (
    select 1 from candidates where id = _waypoint_id and public_rank = (select max(public_rank) from candidates)
  ) into v_was_boundary;

  update public.voyage_waypoints set actual_status = _status where id = _waypoint_id;

  v_has_pending_arrival := false;
  if _status = 'skipped' and v_waypoint.actual_arrival_at is null then
    select upstream.actual_departure_at
    into v_upstream_departure
    from public.voyage_bookable_legs leg
    join public.voyage_waypoints upstream on upstream.id = leg.from_waypoint_id
    where leg.to_waypoint_id = _waypoint_id
    limit 1;

    if v_upstream_departure is not null then
      v_has_pending_arrival := true;
      v_pass_through_at := greatest(timezone('utc', now()), v_upstream_departure);
      update public.voyage_waypoints
      set actual_arrival_at = v_pass_through_at,
          actual_departure_at = coalesce(actual_departure_at, v_pass_through_at)
      where id = _waypoint_id;
    end if;
  end if;

  with candidates as (
    select * from public.voyage_leg_candidate_waypoints(v_waypoint.voyage_id)
  )
  select exists (
    select 1 from candidates where id = _waypoint_id and public_rank = (select min(public_rank) from candidates)
  ) or exists (
    select 1 from candidates where id = _waypoint_id and public_rank = (select max(public_rank) from candidates)
  ) into v_is_boundary;

  if coalesce(v_was_boundary, false) or coalesce(v_is_boundary, false) then
    perform public.sync_voyage_bookable_legs(v_waypoint.voyage_id);
  elsif v_has_pending_arrival then
    perform public.apply_voyage_schedule(v_waypoint.voyage_id, true);
  end if;
end;
$$;

revoke execute on function public.set_voyage_waypoint_actual_status(uuid, text) from public, anon;
grant execute on function public.set_voyage_waypoint_actual_status(uuid, text) to authenticated;

comment on function public.set_voyage_waypoint_actual_status(uuid, text) is
  'Marks a waypoint planned/skipped. A mid-route toggle never touches voyage_bookable_legs identity or pricing. Only re-syncs (existing plan-change reconciliation) when the waypoint was or becomes the voyage''s own first/last bookable stop. When skipping the stop the widget is actively waiting to arrive at, records a pass-through actual (arrival = departure) so the schedule/live-tracking chain is not stuck forever waiting for an arrival that will never come.';

-- 5. Atomic write path behind the route-correction modal's "insert stops"
--    action: shifts the tail of the itinerary and inserts the new actual-only
--    stops in a single transaction, instead of the several separate client-side
--    round trips it replaces (which could leave sort_order inconsistent on a
--    partial failure or two concurrent corrections on the same leg).
--    _stops is a JSON array of {lat, lng, name, waypoint_type}, in insertion
--    order; waypoint_type is 'narrative' (at most one) or 'technical'.
create or replace function public.insert_voyage_leg_correction_stops(
  _voyage_id uuid,
  _anchor_sort_order integer,
  _stops jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stop_count integer;
  v_narrative_count integer;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can correct a voyage route' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where elem->>'waypoint_type' = 'narrative')
  into v_stop_count, v_narrative_count
  from jsonb_array_elements(coalesce(_stops, '[]'::jsonb)) as elem;

  if v_stop_count = 0 then
    return;
  end if;

  if v_narrative_count > 1 then
    raise exception 'at_most_one_narrative_stop' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_stops) as elem
    where elem->>'waypoint_type' not in ('narrative', 'technical')
      or elem->>'lat' is null
      or elem->>'lng' is null
  ) then
    raise exception 'invalid_correction_stop' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));

  update public.voyage_waypoints
  set sort_order = sort_order + v_stop_count
  where voyage_id = _voyage_id
    and sort_order >= _anchor_sort_order;

  insert into public.voyage_waypoints (
    voyage_id, lat, lng, name, name_it, name_en,
    sort_order, waypoint_type, visibility_mode, actual_status
  )
  select
    _voyage_id,
    (elem->>'lat')::double precision,
    (elem->>'lng')::double precision,
    elem->>'name',
    case when elem->>'waypoint_type' = 'narrative' then elem->>'name' else null end,
    case when elem->>'waypoint_type' = 'narrative' then elem->>'name' else null end,
    _anchor_sort_order + (ordinality - 1)::integer,
    elem->>'waypoint_type',
    'manual',
    'added'
  from jsonb_array_elements(_stops) with ordinality as t(elem, ordinality);
end;
$$;

revoke execute on function public.insert_voyage_leg_correction_stops(uuid, integer, jsonb) from public, anon;
grant execute on function public.insert_voyage_leg_correction_stops(uuid, integer, jsonb) to authenticated;

comment on function public.insert_voyage_leg_correction_stops(uuid, integer, jsonb) is
  'Atomically shifts sort_order for every waypoint at/after _anchor_sort_order and inserts the given stops (actual_status = added) starting at that position. Used by the live widget''s route-correction modal instead of separate client-side update/insert calls.';
