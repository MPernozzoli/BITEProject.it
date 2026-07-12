-- Structured candidate information collected before voyage contribution/payment.
alter table public.voyage_booking_requests
  add column if not exists candidate_info jsonb not null default '{}'::jsonb;

alter table public.voyage_booking_participants
  add column if not exists candidate_info jsonb not null default '{}'::jsonb;

create or replace function public.request_voyage_booking(
  _voyage_id uuid,
  _leg_ids uuid[],
  _party_size integer default 1,
  _message text default null,
  _candidate_info jsonb default '{}'::jsonb
)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  requester uuid := auth.uid();
  capacity integer;
  selected_leg_count integer;
  full_leg_count integer;
  next_status public.voyage_booking_status;
  new_request_id uuid;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = requester) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = requester
    on conflict (id) do nothing;
  end if;

  if coalesce(_party_size, 0) <= 0 then
    raise exception 'party_size must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select booking_max_guests
  into capacity
  from public.voyages
  where id = _voyage_id
    and booking_enabled = true
    and is_published = true;

  if capacity is null then
    raise exception 'Voyage is not bookable' using errcode = '22023';
  end if;

  if _party_size > capacity then
    raise exception 'party_size exceeds voyage capacity' using errcode = '22023';
  end if;

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = _voyage_id
    and leg.is_bookable = true
    and public.booking_leg_is_current_or_future(
      leg.starts_at_window_start,
      leg.starts_at_window_end,
      leg.ends_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.profile_id = requester
      and req.status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  with occupied as (
    select
      link.bookable_leg_id,
      coalesce(sum(req.party_size), 0) as occupied_count
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req
      on req.id = link.booking_request_id
    where link.bookable_leg_id = any(_leg_ids)
      and req.status in ('requested', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
    group by link.bookable_leg_id
  )
  select count(*)
  into full_leg_count
  from unnest(_leg_ids) as requested_leg(id)
  left join occupied on occupied.bookable_leg_id = requested_leg.id
  where coalesce(occupied.occupied_count, 0) + _party_size > capacity;

  next_status := case when full_leg_count > 0 then 'waitlisted' else 'requested' end;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    candidate_info
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    next_status,
    nullif(trim(coalesce(_message, '')), ''),
    case
      when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
      else '{}'::jsonb
    end
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  perform public.enqueue_voyage_booking_notification(new_request_id, next_status::text);
  perform public.enqueue_admin_voyage_booking_notifications(
    new_request_id,
    'admin_new_booking',
    jsonb_build_object('status', next_status)
  );

  booking_request_id := new_request_id;
  booking_status := next_status;
  return next;
end;
$function$;

revoke execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) from public, anon;
grant execute on function public.request_voyage_booking(uuid, uuid[], integer, text, jsonb) to authenticated;

create or replace function public.accept_booking_participation(
  _participant_id uuid,
  _candidate_info jsonb default '{}'::jsonb
)
returns public.voyage_booking_participants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.voyage_booking_participants%rowtype;
begin
  select * into v_row
  from public.voyage_booking_participants
  where id = _participant_id;

  if not found then
    raise exception 'participation_not_found';
  end if;
  if v_row.profile_id <> auth.uid()
     and lower(v_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'not_your_participation';
  end if;
  if v_row.status not in ('pending') then
    raise exception 'participation_not_pending';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, email, name)
    select
      u.id,
      coalesce(u.email, v_row.email, ''),
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(concat_ws(' ', v_row.first_name, v_row.last_name)), ''),
        nullif(split_part(coalesce(u.email, v_row.email, ''), '@', 1), ''),
        'Guest'
      )
    from auth.users u
    where u.id = auth.uid()
    on conflict (id) do nothing;
  end if;

  update public.voyage_booking_participants
  set profile_id = auth.uid(),
      status = 'accepted',
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else '{}'::jsonb
      end,
      conditions_accepted_at = timezone('utc', now()),
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = _participant_id
  returning * into v_row;

  update public.voyage_booking_requests request
  set profile_id = auth.uid(),
      candidate_info = case
        when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
        else request.candidate_info
      end,
      updated_at = timezone('utc', now())
  where request.id = v_row.booking_request_id
    and request.party_size = 1
    and not exists (
      select 1
      from public.voyage_booking_participants other_participant
      where other_participant.booking_request_id = request.id
        and other_participant.id <> v_row.id
    );

  return v_row;
end;
$$;

revoke execute on function public.accept_booking_participation(uuid, jsonb) from public, anon;
grant execute on function public.accept_booking_participation(uuid, jsonb) to authenticated;

create or replace function public.admin_propose_voyage_booking_legs(
  _booking_request_id uuid,
  _proposed_leg_ids uuid[],
  _admin_note text default null
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
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can propose booking leg changes' using errcode = '42501';
  end if;

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
        'admin_message', nullif(trim(coalesce(_admin_note, '')), '')
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), nullif(trim(coalesce(_admin_note, '')), '')),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  return v_change_id;
end;
$$;

revoke execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text) from public, anon;
grant execute on function public.admin_propose_voyage_booking_legs(uuid, uuid[], text) to authenticated;

create or replace function public.admin_set_voyage_booking_status(
  _booking_request_id uuid,
  _status public.voyage_booking_status,
  _allow_over_capacity boolean default false,
  _admin_notes text default null
)
returns table (booking_request_id uuid, over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  booking record;
  leg_ids uuid[];
  previous_status public.voyage_booking_status;
  exceeds_capacity boolean := false;
  admin_message text := nullif(trim(coalesce(_admin_notes, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select req.*
  into booking
  from public.voyage_booking_requests as req
  where req.id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  previous_status := booking.status;
  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(link.bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs as link
  where link.booking_request_id = _booking_request_id;

  if _status in ('requested', 'admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(
      booking.voyage_id,
      coalesce(leg_ids, array[]::uuid[]),
      booking.party_size,
      _booking_request_id
    );
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  update public.voyage_booking_requests as req
  set
    status = _status,
    admin_notes = coalesce(admin_message, req.admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else req.confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else req.cancelled_at end
  where req.id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed', 'cancelled', 'rejected') and previous_status is distinct from _status then
    perform public.enqueue_voyage_booking_notification(
      _booking_request_id,
      _status::text,
      jsonb_build_object('admin_message', admin_message)
    );
  end if;

  if previous_status in ('requested', 'admin_approved', 'user_confirmed')
    and _status not in ('requested', 'admin_approved', 'user_confirmed')
  then
    perform public.promote_waitlisted_voyage_bookings(booking.voyage_id, leg_ids);
  end if;

  booking_request_id := _booking_request_id;
  over_capacity := exceeds_capacity;
  return next;
end;
$$;

revoke execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) from public, anon;
grant execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) to authenticated;

alter table public.voyage_booking_plan_changes
  drop constraint if exists voyage_booking_plan_changes_status_check;
alter table public.voyage_booking_plan_changes
  add constraint voyage_booking_plan_changes_status_check
  check (status in ('pending_user_approval', 'auto_accepted', 'accepted', 'rejected', 'counter_requested', 'cancelled', 'superseded'));

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
    delete from public.voyage_booking_request_legs
    where booking_request_id = _booking_request_id;

    insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
    select _booking_request_id, selected.id
    from unnest(v_change.proposed_leg_ids) as selected(id);

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

    perform public.enqueue_voyage_booking_notification(
      _booking_request_id,
      'plan_change_auto_accepted',
      coalesce(v_change.metadata, '{}'::jsonb) || jsonb_build_object(
        'plan_change_id', v_change.id,
        'change_kind', v_change.change_kind,
        'old_leg_ids', coalesce(v_old_leg_ids, '{}'::uuid[]),
        'proposed_leg_ids', v_change.proposed_leg_ids,
        'user_response_action', v_action
      )
    );
    perform public.enqueue_admin_voyage_booking_notifications(
      _booking_request_id,
      'admin_plan_change',
      jsonb_build_object('plan_change_id', v_change.id, 'user_response_action', v_action, 'user_message', v_message)
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
