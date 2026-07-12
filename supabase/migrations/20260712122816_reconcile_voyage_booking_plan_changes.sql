-- Reconcile voyage booking legs when the public waypoint plan changes.
--
-- Before this migration, sync_voyage_bookable_legs only upserted the new
-- canonical legs and deactivated old ones. That left stale direct legs visible
-- after adding intermediate stops (e.g. Cagliari -> Bastia remained next to
-- Cagliari -> Olbia -> Bastia). The sync now rewrites existing bookings to the
-- current canonical leg chain, records a pending plan-change approval for
-- travellers, auto-accepts crew bookings, and deletes obsolete legs.

alter table public.voyage_booking_requests
  add column if not exists plan_change_status text not null default 'none',
  add column if not exists plan_change_metadata jsonb not null default '{}'::jsonb,
  add column if not exists plan_change_requested_at timestamptz,
  add column if not exists plan_change_resolved_at timestamptz,
  add column if not exists is_crew boolean not null default false;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voyage_booking_requests_plan_change_status_check'
  ) then
    alter table public.voyage_booking_requests
      add constraint voyage_booking_requests_plan_change_status_check
      check (plan_change_status in ('none', 'pending_user_approval', 'auto_accepted'));
  end if;
end $$;
create table if not exists public.voyage_booking_plan_changes (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.voyage_booking_requests(id) on delete cascade,
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  status text not null default 'pending_user_approval',
  change_kind text not null,
  old_from_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  old_to_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  proposed_from_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  proposed_to_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  old_leg_ids uuid[] not null default '{}',
  proposed_leg_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  email_status text not null default 'not_configured',
  emailed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_booking_plan_changes_status_check
    check (status in ('pending_user_approval', 'auto_accepted', 'cancelled', 'superseded')),
  constraint voyage_booking_plan_changes_kind_check
    check (change_kind in ('intermediate_waypoints_changed', 'endpoint_waypoint_removed', 'route_replanned')),
  constraint voyage_booking_plan_changes_email_status_check
    check (email_status in ('not_configured', 'pending', 'sent', 'failed', 'skipped'))
);
create index if not exists voyage_booking_plan_changes_request_created_idx
  on public.voyage_booking_plan_changes(booking_request_id, created_at desc);
create index if not exists voyage_booking_plan_changes_pending_email_idx
  on public.voyage_booking_plan_changes(email_status, created_at)
  where email_status = 'pending';
alter table public.voyage_booking_plan_changes enable row level security;
drop policy if exists "booking owner reads plan changes" on public.voyage_booking_plan_changes;
create policy "booking owner reads plan changes"
  on public.voyage_booking_plan_changes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.voyage_booking_requests request
      where request.id = voyage_booking_plan_changes.booking_request_id
        and (
          request.profile_id = (select auth.uid())
          or public.has_role((select auth.uid()), 'admin'::public.app_role)
        )
    )
  );
drop policy if exists "admins manage plan changes" on public.voyage_booking_plan_changes;
create policy "admins manage plan changes"
  on public.voyage_booking_plan_changes
  for all
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
grant select on public.voyage_booking_plan_changes to authenticated;
grant insert, update on public.voyage_booking_plan_changes to service_role;
drop trigger if exists touch_voyage_booking_plan_changes_updated_at on public.voyage_booking_plan_changes;
create trigger touch_voyage_booking_plan_changes_updated_at
  before update on public.voyage_booking_plan_changes
  for each row execute function public.touch_updated_at();
create or replace function public.sync_voyage_bookable_legs(_voyage_id uuid)
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
    ranked.id,
    ranked.voyage_id,
    ranked.sort_order,
    ranked.public_rank::integer
  from (
    select
      w.id,
      w.voyage_id,
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
  ) ranked;

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
revoke execute on function public.sync_voyage_bookable_legs(uuid) from public, anon;
grant execute on function public.sync_voyage_bookable_legs(uuid) to authenticated;
