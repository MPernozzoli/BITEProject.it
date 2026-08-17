-- A concluded leg, or a concluded voyage, never notifies again.
--
-- Until now apply_voyage_schedule() announced *any* leg that newly slipped past
-- its baseline window, regardless of whether that leg had already been sailed.
-- Correcting the record after the fact — fixing an arrival time weeks later, or
-- re-syncing the plan of a voyage that is already over — therefore mailed the
-- travellers a "your voyage is running late" plan change about a leg they had
-- already completed.
--
-- The rule this migration installs:
--
--   A variation on a leg that is already `completed`, or on a voyage whose
--   derived status is `completed`, produces no notification. It is a
--   retroactive correction of information that is no longer actionable for
--   whoever was aboard. Only legs that are still `active` or `planned` notify.
--
-- Example: the boat is already in Palermo and the Bari → Santa Maria di Leuca
-- leg gets corrected. Whoever sailed that leg hears nothing — it is over.
--
-- Two independent guards, because they catch different cases:
--   * per leg   — filters the delayed set by phase, using the post-recompute row
--   * per voyage — catches `status_override = 'completed'`, where an admin has
--                  declared the voyage over even though some leg still lacks an
--                  actual arrival and would not be filtered by phase alone.
--
-- Everything else is byte-identical to 20260722150000: the schedule recompute,
-- the baseline, the boarding-leg filter and the crew/admin auto-accept are
-- untouched. Only the selection of legs worth announcing changes.

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
  v_voyage_status public.voyage_status;
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

  v_voyage_status := public.refresh_voyage_status(_voyage_id);

  if not coalesce(_notify, true) then
    return v_affected;
  end if;

  -- Guard 1 — the voyage is over. Catches status_override in particular: the
  -- admin has declared it concluded, so nothing about it is actionable anymore.
  if v_voyage_status = 'completed'::public.voyage_status then
    return v_affected;
  end if;

  -- Guard 2 — drop legs that have already been sailed. The join reads the rows
  -- just updated above, so the phase reflects the recompute, not the pre-state:
  -- a leg whose actual arrival was recorded in this very call is already
  -- 'completed' here and correctly stays silent.
  select coalesce(array_agg(buffer.leg_id), '{}'::uuid[])
  into v_delayed_leg_ids
  from pg_temp.voyage_effective_buffer buffer
  join public.voyage_bookable_legs leg on leg.id = buffer.leg_id
  where buffer.is_late
    and not buffer.was_late
    and public.voyage_leg_phase(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    ) <> 'completed';

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
      -- Admins booked on their own voyage (the common skipper case) should never be
      -- asked to approve a delay they themselves just caused by editing the schedule.
      coalesce(request.is_crew, false)
        or public.has_role(request.profile_id, 'admin'::public.app_role) as auto_accept,
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
      -- Only travellers who have not boarded yet care: if their own first (boarding) leg
      -- is itself one of the delayed legs, the delay hits before they get on. Someone who
      -- boarded earlier and is just sailing through a downstream delayed leg is already
      -- aboard, already knows, and has no real choice about it — do not prompt them.
      and bounds.leg_ids[1] = any(bounds.delayed_leg_ids)
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
      case when candidates.auto_accept then 'auto_accepted' else 'pending_user_approval' end,
      'schedule_delayed',
      candidates.from_waypoint_id,
      candidates.to_waypoint_id,
      candidates.from_waypoint_id,
      candidates.to_waypoint_id,
      candidates.leg_ids,
      candidates.leg_ids,
      jsonb_build_object(
        'reason', 'schedule_delayed',
        'requires_manual_approval', not candidates.auto_accept,
        'checkout_required_for_accepting_proposed_change', false,
        'available_actions', jsonb_build_array('acknowledge_delay', 'cancel_with_full_refund'),
        'delayed_leg_ids', to_jsonb(candidates.delayed_leg_ids),
        'new_departure_at', candidates.new_departure_at,
        'baseline_departure_window_end', candidates.baseline_departure_window_end
      )
    from candidates
    returning booking_request_id, id as change_id, status as change_status, metadata as change_metadata
  )
  update public.voyage_booking_requests request
  set plan_change_status = inserted.change_status,
      plan_change_requested_at = case when inserted.change_status = 'auto_accepted' then null else timezone('utc', now()) end,
      plan_change_resolved_at = case when inserted.change_status = 'auto_accepted' then timezone('utc', now()) else null end,
      -- Carries the delay specifics (not just change_kind/plan_change_id) so the booking
      -- UI can render "which leg, old window, new departure" without a second query.
      plan_change_metadata = jsonb_build_object(
        'change_kind', 'schedule_delayed',
        'plan_change_id', inserted.change_id,
        'delayed_leg_ids', inserted.change_metadata -> 'delayed_leg_ids',
        'new_departure_at', inserted.change_metadata -> 'new_departure_at',
        'baseline_departure_window_end', inserted.change_metadata -> 'baseline_departure_window_end',
        'available_actions', inserted.change_metadata -> 'available_actions'
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
  'Recomputes the effective leg schedule from the recorded actuals. The baseline is untouched. Legs that newly slip past their baseline window raise a schedule_delayed plan change; shifts inside the window are silent. Completed legs and completed voyages never notify — a retroactive correction is not news. Crew and admins auto-accept silently.';
