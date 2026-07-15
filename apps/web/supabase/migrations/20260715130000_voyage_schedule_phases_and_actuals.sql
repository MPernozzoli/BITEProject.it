-- Phase derivation and the admin write path for actuals.
--
-- Builds on 20260715111314_voyage_realtime_schedule.sql, which added the actual
-- columns and compute_voyage_schedule(). Here we add:
--   * voyage_leg_phase()      — the single rule for planned/active/completed
--   * voyage_derived_status() — the voyage phase, from the leg phases
--   * apply_voyage_schedule() — recompute the effective schedule after an actual,
--                               and raise a plan change only for legs that slip
--                               past their baseline window
--   * set_voyage_waypoint_actual() — the RPC behind "parti ora" / "arriva ora"
--   * sync_voyage_bookable_legs() — rewritten to freeze the baseline, then derive
--                               the effective schedule from it
--
-- The same rule is mirrored in apps/web/src/lib/voyage-schedule.ts so the UI can
-- compute a phase live, without waiting for the cron to refresh the cache.

-- 1. The one phase rule. Day granularity in Europe/Rome, matching the existing
--    booking_leg_effective_date convention. An actual always beats the clock.
create or replace function public.voyage_leg_phase(
  _actual_departure_at timestamptz,
  _actual_arrival_at timestamptz,
  _starts_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when _actual_arrival_at is not null then 'completed'
    when _actual_departure_at is not null then 'active'
    when _starts_at_window_start is null then 'planned'
    when _ends_at_window_end is not null
      and (timezone('Europe/Rome', _ends_at_window_end))::date < (timezone('Europe/Rome', now()))::date
      then 'completed'
    when (timezone('Europe/Rome', _starts_at_window_start))::date <= (timezone('Europe/Rome', now()))::date
      then 'active'
    else 'planned'
  end
$$;

comment on function public.voyage_leg_phase(timestamptz, timestamptz, timestamptz, timestamptz) is
  'Canonical leg phase: planned | active | completed. Recorded actuals win over the clock. Mirrored in src/lib/voyage-schedule.ts.';

grant execute on function public.voyage_leg_phase(timestamptz, timestamptz, timestamptz, timestamptz) to authenticated, anon, service_role;

-- 2. Only a leg that has not started yet can be booked. This tightens the old
--    booking_leg_is_current_or_future rule, which still allowed booking a leg on
--    the day it departed, and it now also refuses a leg that has actually left.
create or replace function public.voyage_leg_is_bookable_now(
  _actual_departure_at timestamptz,
  _actual_arrival_at timestamptz,
  _starts_at_window_start timestamptz,
  _ends_at_window_end timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.voyage_leg_phase(
    _actual_departure_at, _actual_arrival_at, _starts_at_window_start, _ends_at_window_end
  ) = 'planned'
$$;

grant execute on function public.voyage_leg_is_bookable_now(timestamptz, timestamptz, timestamptz, timestamptz) to authenticated, anon, service_role;

-- 3. Voyage phase: an override wins, otherwise the leg phases decide. Voyages
--    with no legs (every historical one) fall back to their own dates.
create or replace function public.voyage_derived_status(_voyage_id uuid)
returns public.voyage_status
language plpgsql
stable
set search_path = public
as $$
declare
  v_voyage record;
  v_leg_count integer := 0;
  v_completed integer := 0;
  v_planned integer := 0;
  v_start date;
  v_end date;
  v_today date := (timezone('Europe/Rome', now()))::date;
begin
  select * into v_voyage from public.voyages where id = _voyage_id;
  if not found then
    return null;
  end if;

  if v_voyage.status_override is not null then
    return v_voyage.status_override;
  end if;

  select
    count(*),
    count(*) filter (where phase.value = 'completed'),
    count(*) filter (where phase.value = 'planned')
  into v_leg_count, v_completed, v_planned
  from public.voyage_bookable_legs leg
  cross join lateral (
    select public.voyage_leg_phase(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    ) as value
  ) phase
  where leg.voyage_id = _voyage_id;

  if v_leg_count > 0 then
    if v_completed = v_leg_count then
      return 'completed'::public.voyage_status;
    elsif v_planned = v_leg_count then
      return 'planned'::public.voyage_status;
    else
      return 'active'::public.voyage_status;
    end if;
  end if;

  v_start := nullif(v_voyage.start_date::text, '')::date;
  v_end := nullif(v_voyage.end_date::text, '')::date;

  if v_start is null then
    return 'planned'::public.voyage_status;
  elsif v_end is not null and v_end < v_today then
    return 'completed'::public.voyage_status;
  elsif v_start <= v_today then
    return 'active'::public.voyage_status;
  end if;

  return 'planned'::public.voyage_status;
end;
$$;

comment on function public.voyage_derived_status(uuid) is
  'Voyage phase from status_override, else the leg phases, else the voyage dates. Mirrored in src/lib/voyage-schedule.ts.';

grant execute on function public.voyage_derived_status(uuid) to authenticated, anon, service_role;

-- 4. voyages.status is only a cache of the above. Refreshed on write and by cron;
--    the UI recomputes live so it is never stale on screen.
create or replace function public.refresh_voyage_status(_voyage_id uuid)
returns public.voyage_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.voyage_status;
begin
  v_status := public.voyage_derived_status(_voyage_id);
  if v_status is null then
    return null;
  end if;

  update public.voyages
  set status = v_status,
      updated_at = timezone('utc', now())
  where id = _voyage_id
    and status is distinct from v_status;

  return v_status;
end;
$$;

revoke execute on function public.refresh_voyage_status(uuid) from public, anon;
grant execute on function public.refresh_voyage_status(uuid) to authenticated, service_role;

create or replace function public.refresh_all_voyage_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voyage record;
  v_changed integer := 0;
  v_before public.voyage_status;
  v_after public.voyage_status;
begin
  for v_voyage in select id, status from public.voyages loop
    v_before := v_voyage.status;
    v_after := public.refresh_voyage_status(v_voyage.id);
    if v_after is distinct from v_before then
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

revoke execute on function public.refresh_all_voyage_statuses() from public, anon, authenticated;
grant execute on function public.refresh_all_voyage_statuses() to service_role;

-- 5. Recompute the effective schedule from the actuals, leaving the baseline
--    alone, and notify only where a leg newly slips past its baseline window.
--    A shift that stays inside the window updates the dates silently.
create or replace function public.apply_voyage_schedule(
  _voyage_id uuid,
  _notify boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_enabled boolean;
  v_delayed_leg_ids uuid[];
  v_affected integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));

  select v.booking_enabled into v_booking_enabled
  from public.voyages v where v.id = _voyage_id;

  create temporary table if not exists pg_temp.voyage_effective_buffer (
    leg_id uuid primary key,
    was_late boolean not null,
    is_late boolean not null
  ) on commit drop;
  truncate table pg_temp.voyage_effective_buffer;

  -- Snapshot which legs were already late, so a delay is only announced once.
  insert into pg_temp.voyage_effective_buffer (leg_id, was_late, is_late)
  select
    leg.id,
    coalesce(leg.starts_at_window_start > leg.baseline_starts_at_window_end, false),
    coalesce(computed.departure_window_start > leg.baseline_starts_at_window_end, false)
  from public.voyage_bookable_legs leg
  join public.compute_voyage_schedule(_voyage_id, true) computed
    on computed.from_waypoint_id = leg.from_waypoint_id
   and computed.to_waypoint_id = leg.to_waypoint_id
  where leg.voyage_id = _voyage_id;

  update public.voyage_bookable_legs leg
  set starts_at_window_start = computed.departure_window_start,
      starts_at_window_end   = computed.departure_window_end,
      ends_at_window_start   = computed.arrival_window_start,
      ends_at_window_end     = computed.arrival_window_end,
      actual_departure_at    = computed.leg_actual_departure_at,
      actual_arrival_at      = computed.leg_actual_arrival_at,
      is_bookable = coalesce(v_booking_enabled, false) and public.voyage_leg_is_bookable_now(
        computed.leg_actual_departure_at,
        computed.leg_actual_arrival_at,
        computed.departure_window_start,
        computed.arrival_window_end
      ),
      updated_at = timezone('utc', now())
  from public.compute_voyage_schedule(_voyage_id, true) computed
  where leg.voyage_id = _voyage_id
    and leg.from_waypoint_id = computed.from_waypoint_id
    and leg.to_waypoint_id = computed.to_waypoint_id;

  get diagnostics v_affected = row_count;

  perform public.refresh_voyage_status(_voyage_id);

  if not coalesce(_notify, true) then
    return v_affected;
  end if;

  select coalesce(array_agg(leg_id), '{}'::uuid[])
  into v_delayed_leg_ids
  from pg_temp.voyage_effective_buffer
  where is_late and not was_late;

  if cardinality(v_delayed_leg_ids) = 0 then
    return v_affected;
  end if;

  -- One plan change per affected booking. The leg chain itself is unchanged, so
  -- proposed_leg_ids mirrors old_leg_ids: the traveller is being told the voyage
  -- is running late, not asked to accept a different route. The insert triggers
  -- from 20260712125731 enqueue the traveller and admin emails.
  with candidates as (
    select
      request.id as request_id,
      coalesce(request.is_crew, false) as is_crew,
      bounds.leg_ids,
      bounds.delayed_leg_ids,
      bounds.from_waypoint_id,
      bounds.to_waypoint_id,
      bounds.new_departure_at,
      bounds.baseline_departure_window_end
    from public.voyage_booking_requests request
    join lateral (
      select
        array_agg(leg.id order by leg.sort_order) as leg_ids,
        array_agg(leg.id order by leg.sort_order) filter (where leg.id = any(v_delayed_leg_ids)) as delayed_leg_ids,
        (array_agg(leg.from_waypoint_id order by leg.sort_order))[1] as from_waypoint_id,
        (array_agg(leg.to_waypoint_id order by leg.sort_order desc))[1] as to_waypoint_id,
        min(leg.starts_at_window_start) filter (where leg.id = any(v_delayed_leg_ids)) as new_departure_at,
        min(leg.baseline_starts_at_window_end) filter (where leg.id = any(v_delayed_leg_ids)) as baseline_departure_window_end
      from public.voyage_booking_request_legs link
      join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
      where link.booking_request_id = request.id
    ) bounds on true
    where request.voyage_id = _voyage_id
      and request.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      -- Skip only bookings with something genuinely pending: 'auto_accepted' is a
      -- resting state (crew sit in it permanently) and must stay notifiable.
      and request.plan_change_status not in ('pending_user_approval', 'pending_admin_approval')
      and bounds.delayed_leg_ids is not null
  ),
  inserted as (
    insert into public.voyage_booking_plan_changes (
      booking_request_id, voyage_id, status, change_kind,
      old_from_waypoint_id, old_to_waypoint_id,
      proposed_from_waypoint_id, proposed_to_waypoint_id,
      old_leg_ids, proposed_leg_ids, metadata
    )
    select
      candidates.request_id,
      _voyage_id,
      case when candidates.is_crew then 'auto_accepted' else 'pending_user_approval' end,
      'schedule_delayed',
      candidates.from_waypoint_id,
      candidates.to_waypoint_id,
      candidates.from_waypoint_id,
      candidates.to_waypoint_id,
      candidates.leg_ids,
      candidates.leg_ids,
      jsonb_build_object(
        'reason', 'schedule_delayed',
        'requires_manual_approval', not candidates.is_crew,
        'checkout_required_for_accepting_proposed_change', false,
        'available_actions', jsonb_build_array('acknowledge_delay', 'cancel_with_full_refund'),
        'delayed_leg_ids', to_jsonb(candidates.delayed_leg_ids),
        'new_departure_at', candidates.new_departure_at,
        'baseline_departure_window_end', candidates.baseline_departure_window_end
      )
    from candidates
    returning booking_request_id, id as change_id
  )
  update public.voyage_booking_requests request
  set plan_change_status = case when coalesce(request.is_crew, false) then 'auto_accepted' else 'pending_user_approval' end,
      plan_change_requested_at = case when coalesce(request.is_crew, false) then null else timezone('utc', now()) end,
      plan_change_resolved_at = case when coalesce(request.is_crew, false) then timezone('utc', now()) else null end,
      plan_change_metadata = jsonb_build_object(
        'change_kind', 'schedule_delayed',
        'plan_change_id', inserted.change_id
      ),
      updated_at = timezone('utc', now())
  from inserted
  where request.id = inserted.booking_request_id;

  return v_affected;
end;
$$;

revoke execute on function public.apply_voyage_schedule(uuid, boolean) from public, anon;
grant execute on function public.apply_voyage_schedule(uuid, boolean) to authenticated, service_role;

comment on function public.apply_voyage_schedule(uuid, boolean) is
  'Recomputes the effective leg schedule from the recorded actuals. The baseline is untouched. Legs that newly slip past their baseline window raise a schedule_delayed plan change; shifts inside the window are silent.';

-- 6. The write path behind the widget buttons.
create or replace function public.set_voyage_waypoint_actual(
  _waypoint_id uuid,
  _kind text,
  _at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_waypoint record;
  v_upstream_departure timestamptz;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can record voyage actuals' using errcode = '42501';
  end if;

  if _kind not in ('arrival', 'departure') then
    raise exception 'invalid_actual_kind' using errcode = '22023';
  end if;

  select * into v_waypoint from public.voyage_waypoints where id = _waypoint_id for update;
  if not found then
    raise exception 'waypoint_not_found' using errcode = '22023';
  end if;

  if _at is not null then
    if _kind = 'departure' and v_waypoint.actual_arrival_at is not null and _at < v_waypoint.actual_arrival_at then
      raise exception 'departure_before_arrival' using errcode = '22023';
    end if;

    if _kind = 'arrival' and v_waypoint.actual_departure_at is not null and _at > v_waypoint.actual_departure_at then
      raise exception 'arrival_after_departure' using errcode = '22023';
    end if;

    -- An arrival cannot precede the departure of the leg that led here.
    if _kind = 'arrival' then
      select upstream.actual_departure_at
      into v_upstream_departure
      from public.voyage_bookable_legs leg
      join public.voyage_waypoints upstream on upstream.id = leg.from_waypoint_id
      where leg.to_waypoint_id = _waypoint_id
      limit 1;

      if v_upstream_departure is not null and _at < v_upstream_departure then
        raise exception 'arrival_before_upstream_departure' using errcode = '22023';
      end if;
    end if;
  end if;

  if _kind = 'arrival' then
    update public.voyage_waypoints set actual_arrival_at = _at where id = _waypoint_id;
  else
    update public.voyage_waypoints set actual_departure_at = _at where id = _waypoint_id;
  end if;

  perform public.apply_voyage_schedule(v_waypoint.voyage_id, true);

  return _at;
end;
$$;

revoke execute on function public.set_voyage_waypoint_actual(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_voyage_waypoint_actual(uuid, text, timestamptz) to authenticated;

comment on function public.set_voyage_waypoint_actual(uuid, text, timestamptz) is
  'Records or clears an actual arrival/departure on a waypoint and cascades the schedule. Pass _at = null to clear.';

-- 7. Cron: phases move with the clock even when nobody writes anything.
select cron.schedule(
  'refresh-voyage-statuses',
  '*/15 * * * *',
  $$select public.refresh_all_voyage_statuses();$$
)
where not exists (select 1 from cron.job where jobname = 'refresh-voyage-statuses');

-- 8. Backfill: freeze the current plan as the baseline wherever it is missing,
--    then align the caches. Without this the earliness clamp has no floor.
update public.voyage_bookable_legs leg
set baseline_starts_at_window_start = leg.starts_at_window_start,
    baseline_starts_at_window_end   = leg.starts_at_window_end,
    baseline_ends_at_window_start   = leg.ends_at_window_start,
    baseline_ends_at_window_end     = leg.ends_at_window_end
where leg.baseline_starts_at_window_start is null;

select public.refresh_all_voyage_statuses();
