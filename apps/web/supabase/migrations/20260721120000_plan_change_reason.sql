-- Records WHY an admin proposes a voyage plan change, because the refund owed when the traveller
-- declines it depends on that reason:
--   force majeure -> same tiers as a traveller withdrawal (100/50/0 by days to departure)
--   otherwise     -> full refund
--
-- The admin picks a single reason in the UI; `force_majeure` is derived here rather than being a
-- separate operator-controlled flag, so a contradictory pair can never be stored.
-- Mirrored for labels only in apps/web/src/lib/plan-change-reasons.ts — keep both lists in sync.

create or replace function public.plan_change_reason_is_force_majeure(_reason text)
returns boolean
language sql
immutable
as $$
  select _reason in ('weather', 'safety', 'technical_failure', 'authority_order', 'health_emergency');
$$;

-- Replaced by the 4-argument version below; dropped so PostgREST cannot resolve the stale overload.
drop function if exists public.admin_propose_voyage_booking_legs(uuid, uuid[], text);

create or replace function public.admin_propose_voyage_booking_legs(
  _booking_request_id uuid,
  _proposed_leg_ids uuid[],
  _admin_note text default null,
  _change_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_old_leg_ids uuid[];
  v_selected_count integer;
  v_change_id uuid;
  v_old_from uuid;
  v_old_to uuid;
  v_new_from uuid;
  v_new_to uuid;
  v_reason text;
  v_force_majeure boolean;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can propose booking leg changes' using errcode = '42501';
  end if;

  v_reason := nullif(trim(coalesce(_change_reason, '')), '');
  if v_reason is not null and v_reason not in (
    'weather', 'safety', 'technical_failure', 'authority_order', 'health_emergency',
    'crew_reorganization', 'logistics', 'other'
  ) then
    raise exception 'invalid_change_reason';
  end if;
  -- An unspecified reason must never silently downgrade the refund, so it is treated as
  -- non-force-majeure (full refund) rather than as force majeure.
  v_force_majeure := coalesce(public.plan_change_reason_is_force_majeure(v_reason), false);

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if coalesce(cardinality(_proposed_leg_ids), 0) = 0 then
    raise exception 'proposed_legs_required';
  end if;

  select array_agg(link.bookable_leg_id order by leg.sort_order)
  into v_old_leg_ids
  from public.voyage_booking_request_legs link
  join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
  where link.booking_request_id = _booking_request_id;

  select count(*)
  into v_selected_count
  from public.voyage_bookable_legs leg
  where leg.id = any(_proposed_leg_ids)
    and leg.voyage_id = v_request.voyage_id
    and leg.is_bookable = true;

  if v_selected_count <> cardinality(_proposed_leg_ids) then
    raise exception 'invalid_proposed_legs';
  end if;

  select first_leg.from_waypoint_id, last_leg.to_waypoint_id
  into v_old_from, v_old_to
  from (
    select leg.*
    from public.voyage_booking_request_legs link
    join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
    where link.booking_request_id = _booking_request_id
    order by leg.sort_order asc
    limit 1
  ) first_leg
  cross join (
    select leg.*
    from public.voyage_booking_request_legs link
    join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
    where link.booking_request_id = _booking_request_id
    order by leg.sort_order desc
    limit 1
  ) last_leg;

  select first_leg.from_waypoint_id, last_leg.to_waypoint_id
  into v_new_from, v_new_to
  from (
    select leg.*
    from public.voyage_bookable_legs leg
    where leg.id = any(_proposed_leg_ids)
    order by leg.sort_order asc
    limit 1
  ) first_leg
  cross join (
    select leg.*
    from public.voyage_bookable_legs leg
    where leg.id = any(_proposed_leg_ids)
    order by leg.sort_order desc
    limit 1
  ) last_leg;

  update public.voyage_booking_plan_changes
  set status = 'superseded',
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where booking_request_id = _booking_request_id
    and status = 'pending_user_approval';

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
    metadata
  )
  values (
    _booking_request_id,
    v_request.voyage_id,
    'pending_user_approval',
    'route_replanned',
    v_old_from,
    v_old_to,
    v_new_from,
    v_new_to,
    coalesce(v_old_leg_ids, '{}'::uuid[]),
    _proposed_leg_ids,
    jsonb_build_object(
      'source', 'admin_candidate_review',
      'admin_note', nullif(trim(coalesce(_admin_note, '')), ''),
      'admin_message', nullif(trim(coalesce(_admin_note, '')), ''),
      'change_reason', v_reason,
      'force_majeure', v_force_majeure,
      'available_actions', jsonb_build_array('accept_proposed_change', 'cancel_with_full_refund', 'request_different_route'),
      'checkout_required_for_accepting_proposed_change', false
    )
  )
  returning id into v_change_id;

  update public.voyage_booking_requests
  set plan_change_status = 'pending_user_approval',
      plan_change_requested_at = timezone('utc', now()),
      plan_change_resolved_at = null,
      plan_change_metadata = jsonb_build_object(
        'source', 'admin_candidate_review',
        'plan_change_id', v_change_id,
        'old_leg_ids', to_jsonb(coalesce(v_old_leg_ids, '{}'::uuid[])),
        'proposed_leg_ids', to_jsonb(_proposed_leg_ids),
        'admin_note', nullif(trim(coalesce(_admin_note, '')), ''),
        'admin_message', nullif(trim(coalesce(_admin_note, '')), ''),
        'change_reason', v_reason,
        'force_majeure', v_force_majeure
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), nullif(trim(coalesce(_admin_note, '')), '')),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  return v_change_id;
end;
$$;

revoke execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text, text) from public, anon;
grant execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text, text) to authenticated;
