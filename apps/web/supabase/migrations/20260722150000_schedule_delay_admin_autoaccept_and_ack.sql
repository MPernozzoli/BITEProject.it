-- Schedule-delay plan changes ("il viaggio è in ritardo") currently behave exactly like
-- a route-change proposal for every non-crew traveller: plan_change_status flips to
-- 'pending_user_approval' and the booking UI blocks on it. Two problems with that:
--
--   1. An admin who is also booked on their own voyage (the common case for the skipper)
--      gets asked to "approve" a delay they themselves just caused by editing the
--      schedule/stops. That should auto-accept silently, same as crew already do.
--   2. Regular travellers have no dedicated way to resolve a delay notice — the metadata
--      copied onto voyage_booking_requests only carried change_kind + plan_change_id, not
--      the delayed leg / new departure details, and respond_voyage_booking_plan_change had
--      no action matching the 'acknowledge_delay' the delay's own metadata advertises.
--
-- This migration: (a) treats admins like crew in apply_voyage_schedule's auto-accept
-- check, (b) carries the delay specifics onto voyage_booking_requests.plan_change_metadata
-- so the UI can render them without a second query, and (c) teaches
-- respond_voyage_booking_plan_change the 'acknowledge_delay' action.

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
  'Recomputes the effective leg schedule from the recorded actuals. The baseline is untouched. Legs that newly slip past their baseline window raise a schedule_delayed plan change; shifts inside the window are silent. Crew and admins auto-accept silently.';

-- ---------------------------------------------------------------------------
-- Traveller-side resolution: acknowledge a delay without touching the route.
-- ---------------------------------------------------------------------------

create or replace function public.respond_voyage_booking_plan_change(
  _booking_request_id uuid,
  _action text,
  _message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_change public.voyage_booking_plan_changes%rowtype;
  v_message text := nullif(trim(coalesce(_message, '')), '');
  v_action text := trim(coalesce(_action, ''));
  v_old_leg_ids uuid[];
  v_require_settlement boolean;
  v_holds_seat boolean;
  v_next_status public.voyage_booking_status;
begin
  select req.*
  into v_request
  from public.voyage_booking_requests req
  where req.id = _booking_request_id
    and req.profile_id = auth.uid()
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select change.*
  into v_change
  from public.voyage_booking_plan_changes change
  where change.booking_request_id = _booking_request_id
    and change.status = 'pending_user_approval'
  order by change.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'pending_plan_change_not_found' using errcode = '22023';
  end if;

  select array_agg(link.bookable_leg_id order by leg.sort_order)
  into v_old_leg_ids
  from public.voyage_booking_request_legs link
  join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
  where link.booking_request_id = _booking_request_id;

  if v_action = 'accept_proposed_change' then
    v_require_settlement := coalesce((v_change.metadata ->> 'require_settlement')::boolean, false);
    v_holds_seat := v_request.status in ('admin_approved', 'user_confirmed');

    delete from public.voyage_booking_request_legs
    where booking_request_id = _booking_request_id;

    insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
    select _booking_request_id, selected.id
    from unnest(v_change.proposed_leg_ids) as selected(id);

    -- A booking that has not been approved yet goes back behind the payment gate; one that
    -- already holds a seat keeps it, because an admin-initiated reroute must not evict a
    -- traveller who did nothing wrong.
    v_next_status := case
      when v_require_settlement and not v_holds_seat and not coalesce(v_request.is_comped, false)
        then 'pending_payment'::public.voyage_booking_status
      else v_request.status
    end;

    update public.voyage_booking_plan_changes
    set status = 'accepted',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'user_response_action', v_action,
          'user_message', v_message,
          'settlement_due', v_require_settlement
        ),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        status = v_next_status,
        expires_at = case
          when v_next_status = 'pending_payment' then timezone('utc', now()) + interval '1 hour'
          else expires_at
        end,
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object(
          'plan_change_id', v_change.id,
          'user_response_action', v_action,
          'user_message', v_message,
          'settlement_due', v_require_settlement
        ),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_voyage_booking_notification(
      _booking_request_id,
      'plan_change_auto_accepted',
      coalesce(v_change.metadata, '{}'::jsonb) || jsonb_build_object(
        'plan_change_id', v_change.id,
        'change_kind', v_change.change_kind,
        'old_leg_ids', coalesce(v_old_leg_ids, '{}'::uuid[]),
        'proposed_leg_ids', v_change.proposed_leg_ids,
        'user_response_action', v_action,
        'settlement_due', v_require_settlement
      )
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_plan_change',
      jsonb_build_object(
        'plan_change_id', v_change.id,
        'user_response_action', v_action,
        'user_message', v_message,
        'settlement_due', v_require_settlement
      )
    );
    return;
  end if;

  if v_action = 'cancel_with_full_refund' then
    update public.voyage_booking_plan_changes
    set status = 'cancelled',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'user_response_action', v_action,
          'user_message', v_message
        ),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set status = 'cancelled',
        cancelled_at = timezone('utc', now()),
        plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object(
          'plan_change_id', v_change.id,
          'user_response_action', v_action,
          'user_message', v_message
        ),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_voyage_booking_notification(_booking_request_id, 'cancelled');
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_cancelled',
      jsonb_build_object('plan_change_id', v_change.id, 'user_response_action', v_action, 'user_message', v_message)
    );
    perform public.promote_waitlisted_voyage_bookings(v_request.voyage_id, coalesce(v_old_leg_ids, '{}'::uuid[]));
    return;
  end if;

  if v_action = 'request_different_route' then
    update public.voyage_booking_plan_changes
    set status = 'counter_requested',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'user_response_action', v_action,
          'user_message', v_message
        ),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'pending_user_approval',
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object(
          'plan_change_id', v_change.id,
          'user_response_action', v_action,
          'user_message', v_message
        ),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_plan_change',
      jsonb_build_object('plan_change_id', v_change.id, 'user_response_action', v_action, 'user_message', v_message)
    );
    return;
  end if;

  if v_action = 'reject_proposed_change' then
    update public.voyage_booking_plan_changes
    set status = 'rejected',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'user_response_action', v_action,
          'user_message', v_message
        ),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object(
          'plan_change_id', v_change.id,
          'user_response_action', v_action,
          'user_message', v_message
        ),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_plan_change',
      jsonb_build_object('plan_change_id', v_change.id, 'user_response_action', v_action, 'user_message', v_message)
    );
    return;
  end if;

  -- A delay notice ("il viaggio è in ritardo") never touches the route: proposed_leg_ids
  -- already mirrors old_leg_ids, so acknowledging it just clears the pending flag and
  -- tells the admin the traveller has seen it.
  if v_action = 'acknowledge_delay' then
    update public.voyage_booking_plan_changes
    set status = 'accepted',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'user_response_action', v_action,
          'user_message', v_message
        ),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object(
          'plan_change_id', v_change.id,
          'user_response_action', v_action,
          'user_message', v_message
        ),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_plan_change',
      jsonb_build_object('plan_change_id', v_change.id, 'user_response_action', v_action, 'user_message', v_message)
    );
    return;
  end if;

  raise exception 'invalid_plan_change_action' using errcode = '22023';
end;
$$;

revoke execute on function public.respond_voyage_booking_plan_change(uuid, text, text) from public, anon;
grant execute on function public.respond_voyage_booking_plan_change(uuid, text, text) to authenticated;
