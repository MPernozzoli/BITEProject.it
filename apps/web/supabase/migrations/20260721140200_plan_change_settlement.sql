-- Lets the admin decide, per proposal, whether accepting a route change also requires
-- settling the difference in contribution ("conguaglio").
--
-- Two shapes, chosen when the proposal is sent:
--   _require_settlement = false -> accepting applies the new legs, nothing is charged.
--   _require_settlement = true  -> accepting applies the new legs and leaves a settlement due.
--
-- How the settlement is collected depends on whether the booking already holds a seat:
--   * not yet approved (pending_payment / requested / waitlisted) -> the booking returns to
--     'pending_payment', so it drops out of admin review until the difference is paid;
--   * already admin_approved / user_confirmed -> the seat is deliberately NOT revoked (an
--     admin-initiated reroute must not cost a confirmed traveller their place). The booking
--     keeps its status and carries a settlement_due marker for the admin to chase.
--
-- The amount itself is never stored here: the payment endpoints recompute the contribution
-- from the current legs and subtract what has already been paid, so the traveller is charged
-- exactly the difference. A negative difference is a refund and is surfaced to the admin
-- rather than auto-issued, since the money has already left the payer's account.

create or replace function public.admin_propose_voyage_booking_legs(
  _booking_request_id uuid,
  _proposed_leg_ids uuid[],
  _admin_note text default null,
  _change_reason text default null,
  _require_settlement boolean default false
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
  v_require_settlement boolean := coalesce(_require_settlement, false);
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
      'checkout_required_for_accepting_proposed_change', v_require_settlement,
      'require_settlement', v_require_settlement
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
        'force_majeure', v_force_majeure,
        'require_settlement', v_require_settlement
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), nullif(trim(coalesce(_admin_note, '')), '')),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  return v_change_id;
end;
$$;

-- Replaced by the 5-argument version; drop the stale overload so PostgREST cannot resolve
-- a call that silently loses the settlement choice.
drop function if exists public.admin_propose_voyage_booking_legs(uuid, uuid[], text, text);

revoke execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text, text, boolean) from public, anon;
grant execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting a proposal that carries a settlement
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

  raise exception 'invalid_plan_change_action' using errcode = '22023';
end;
$$;

revoke execute on function public.respond_voyage_booking_plan_change(uuid, text, text) from public, anon;
grant execute on function public.respond_voyage_booking_plan_change(uuid, text, text) to authenticated;
