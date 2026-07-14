-- Public booking matrix: anonymized occupancy for /bookings, and a user-initiated
-- mirror of the admin "propose a leg change" flow (drag-resize on the public matrix
-- creates a proposal that an admin must accept/reject, rather than writing legs directly).

alter table public.voyage_booking_requests
  drop constraint if exists voyage_booking_requests_plan_change_status_check;
alter table public.voyage_booking_requests
  add constraint voyage_booking_requests_plan_change_status_check
  check (plan_change_status in ('none', 'pending_user_approval', 'pending_admin_approval', 'auto_accepted'));

alter table public.voyage_booking_plan_changes
  drop constraint if exists voyage_booking_plan_changes_status_check;
alter table public.voyage_booking_plan_changes
  add constraint voyage_booking_plan_changes_status_check
  check (status in ('pending_user_approval', 'pending_admin_approval', 'auto_accepted', 'accepted', 'rejected', 'counter_requested', 'cancelled', 'superseded'));

alter table public.voyage_booking_notifications
  drop constraint if exists voyage_booking_notifications_event_type_check;
alter table public.voyage_booking_notifications
  add constraint voyage_booking_notifications_event_type_check check (
    event_type in (
      'requested',
      'waitlisted',
      'admin_approved',
      'user_confirmed',
      'cancelled',
      'rejected',
      'promoted_from_waitlist',
      'manual_added',
      'payment_pending',
      'payment_received',
      'payment_failed',
      'payment_expired',
      'plan_change_pending',
      'plan_change_auto_accepted',
      'admin_new_booking',
      'admin_cancelled',
      'admin_modified',
      'admin_payment_pending',
      'admin_payment_received',
      'admin_plan_change',
      'user_plan_change_requested',
      'user_plan_change_resolved'
    )
  );

-- Anonymized occupancy for the public /bookings matrix: one row per active booking
-- request on the voyage. `display_name` is only populated for requests that overlap
-- (share at least one leg) with the caller's own confirmed request AND are themselves
-- confirmed — i.e. travel companions are only named once both bookings are locked in.
create or replace function public.list_voyage_booking_occupancy(_voyage_id uuid)
returns table (
  booking_request_id uuid,
  leg_ids uuid[],
  party_size integer,
  status text,
  is_own boolean,
  is_crew boolean,
  display_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_confirmed_legs uuid[];
begin
  if v_caller is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select array_agg(distinct link.bookable_leg_id)
  into v_caller_confirmed_legs
  from public.voyage_booking_requests req
  join public.voyage_booking_request_legs link on link.booking_request_id = req.id
  where req.voyage_id = _voyage_id
    and req.profile_id = v_caller
    and req.status in ('admin_approved', 'user_confirmed');

  return query
  select
    req.id as booking_request_id,
    coalesce(array_agg(distinct link.bookable_leg_id) filter (where link.bookable_leg_id is not null), '{}'::uuid[]) as leg_ids,
    req.party_size,
    req.status::text,
    (req.profile_id = v_caller) as is_own,
    coalesce(req.is_crew, false) as is_crew,
    case
      when req.profile_id = v_caller then null
      when req.status in ('admin_approved', 'user_confirmed')
        and v_caller_confirmed_legs is not null
        and exists (
          select 1
          from public.voyage_booking_request_legs overlap_link
          where overlap_link.booking_request_id = req.id
            and overlap_link.bookable_leg_id = any(v_caller_confirmed_legs)
        )
        then coalesce(nullif(trim(profile.name), ''), profile.email)
      else null
    end as display_name
  from public.voyage_booking_requests req
  left join public.voyage_booking_request_legs link on link.booking_request_id = req.id
  left join public.profiles profile on profile.id = req.profile_id
  where req.voyage_id = _voyage_id
    and req.status not in ('cancelled', 'rejected', 'expired')
  group by req.id, req.party_size, req.status, req.profile_id, req.is_crew, profile.name, profile.email;
end;
$$;

revoke execute on function public.list_voyage_booking_occupancy(uuid) from public, anon;
grant execute on function public.list_voyage_booking_occupancy(uuid) to authenticated;

-- Traveller-initiated mirror of admin_propose_voyage_booking_legs: dragging one's own
-- bar on the public matrix does not write voyage_booking_request_legs directly, it opens
-- a proposal that an admin must accept via admin_respond_voyage_booking_plan_change.
create or replace function public.user_propose_voyage_booking_legs(
  _booking_request_id uuid,
  _proposed_leg_ids uuid[],
  _user_message text default null
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
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
    and profile_id = auth.uid()
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.status in ('cancelled', 'rejected', 'expired') then
    raise exception 'booking_not_active' using errcode = '22023';
  end if;

  if v_request.plan_change_status <> 'none' then
    raise exception 'plan_change_already_pending' using errcode = '22023';
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
    'pending_admin_approval',
    'route_replanned',
    v_old_from,
    v_old_to,
    v_new_from,
    v_new_to,
    coalesce(v_old_leg_ids, '{}'::uuid[]),
    _proposed_leg_ids,
    jsonb_build_object(
      'source', 'user_matrix_drag',
      'user_message', nullif(trim(coalesce(_user_message, '')), '')
    )
  )
  returning id into v_change_id;

  update public.voyage_booking_requests
  set plan_change_status = 'pending_admin_approval',
      plan_change_requested_at = timezone('utc', now()),
      plan_change_resolved_at = null,
      plan_change_metadata = jsonb_build_object(
        'source', 'user_matrix_drag',
        'plan_change_id', v_change_id,
        'old_leg_ids', to_jsonb(coalesce(v_old_leg_ids, '{}'::uuid[])),
        'proposed_leg_ids', to_jsonb(_proposed_leg_ids),
        'user_message', nullif(trim(coalesce(_user_message, '')), '')
      ),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'user_plan_change_requested',
    jsonb_build_object('plan_change_id', v_change_id, 'proposed_leg_ids', _proposed_leg_ids, 'user_message', _user_message)
  );

  return v_change_id;
end;
$$;

revoke execute on function public.user_propose_voyage_booking_legs(uuid, uuid[], text) from public, anon;
grant execute on function public.user_propose_voyage_booking_legs(uuid, uuid[], text) to authenticated;

-- Admin response to a traveller-initiated change proposal (accept writes the new legs,
-- reject just clears the pending state); speculative counterpart to
-- respond_voyage_booking_plan_change, which handles the reverse (admin -> traveller) case.
create or replace function public.admin_respond_voyage_booking_plan_change(
  _booking_request_id uuid,
  _action text,
  _admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_change public.voyage_booking_plan_changes%rowtype;
  v_action text := trim(coalesce(_action, ''));
  v_admin_note text := nullif(trim(coalesce(_admin_note, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can respond to booking change proposals' using errcode = '42501';
  end if;

  select change.*
  into v_change
  from public.voyage_booking_plan_changes change
  where change.booking_request_id = _booking_request_id
    and change.status = 'pending_admin_approval'
  order by change.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'pending_plan_change_not_found' using errcode = '22023';
  end if;

  if v_action = 'accept' then
    delete from public.voyage_booking_request_legs
    where booking_request_id = _booking_request_id;

    insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
    select _booking_request_id, selected.id
    from unnest(v_change.proposed_leg_ids) as selected(id);

    update public.voyage_booking_plan_changes
    set status = 'accepted',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('admin_note', v_admin_note),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object('admin_note', v_admin_note),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_voyage_booking_notification(
      _booking_request_id,
      'user_plan_change_resolved',
      jsonb_build_object('plan_change_id', v_change.id, 'decision', 'accepted', 'admin_note', v_admin_note)
    );
    return;
  end if;

  if v_action = 'reject' then
    update public.voyage_booking_plan_changes
    set status = 'rejected',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('admin_note', v_admin_note),
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = v_change.id;

    update public.voyage_booking_requests
    set plan_change_status = 'none',
        plan_change_resolved_at = timezone('utc', now()),
        plan_change_metadata = coalesce(plan_change_metadata, '{}'::jsonb) || jsonb_build_object('admin_note', v_admin_note),
        updated_at = timezone('utc', now())
    where id = _booking_request_id;

    perform public.enqueue_voyage_booking_notification(
      _booking_request_id,
      'user_plan_change_resolved',
      jsonb_build_object('plan_change_id', v_change.id, 'decision', 'rejected', 'admin_note', v_admin_note)
    );
    return;
  end if;

  raise exception 'invalid_plan_change_action' using errcode = '22023';
end;
$$;

revoke execute on function public.admin_respond_voyage_booking_plan_change(uuid, text, text) from public, anon;
grant execute on function public.admin_respond_voyage_booking_plan_change(uuid, text, text) to authenticated;
