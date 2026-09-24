-- Admins travelling on a voyage are staff, not guests.
--
-- Until now an admin's own booking went through the guest pipeline: a new application landed in
-- 'pending_payment' behind the contribution checkout, and every leg change — whether dragged by
-- the admin on their own matrix or on the /admin/bookings Gantt — became a proposal waiting for
-- approval (from the admin team, or from the admin themselves as "traveller"). Nobody had to
-- approve anything: the person asking is the person who approves.
--
-- After this migration:
--   * request_voyage_booking: an admin's application is born 'user_confirmed' and comped (no
--     contribution, no payment timer).
--   * user_propose_voyage_booking_legs: an admin dragging their own bar applies the new legs
--     immediately; the audit row is written as 'auto_accepted' (email skipped by the existing
--     prepare trigger, no admin notification).
--   * admin_propose_voyage_booking_legs: when the booking belongs to an admin or to the crew the
--     change is applied directly instead of opening a proposal — the same rule
--     sync_voyage_bookable_legs and apply_voyage_schedule already follow.
--   * Both propose RPCs accept legs already on the booking even when no longer bookable (already
--     sailed), so extending or shortening a trip in progress no longer fails with
--     invalid_proposed_legs just because its first legs are in the past.
--   * Active admin bookings are backfilled as comped.

create or replace function public.apply_voyage_booking_legs_directly(
  _booking_request_id uuid,
  _proposed_leg_ids uuid[],
  _source text,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_old_leg_ids uuid[];
  v_old_from uuid;
  v_old_to uuid;
  v_new_from uuid;
  v_new_to uuid;
  v_change_id uuid;
  v_note text := nullif(trim(coalesce(_note, '')), '');
begin
  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  select array_agg(link.bookable_leg_id order by leg.sort_order)
  into v_old_leg_ids
  from public.voyage_booking_request_legs link
  join public.voyage_bookable_legs leg on leg.id = link.bookable_leg_id
  where link.booking_request_id = _booking_request_id;

  select
    (select leg.from_waypoint_id from public.voyage_bookable_legs leg
      where leg.id = any(coalesce(v_old_leg_ids, '{}'::uuid[])) order by leg.sort_order asc limit 1),
    (select leg.to_waypoint_id from public.voyage_bookable_legs leg
      where leg.id = any(coalesce(v_old_leg_ids, '{}'::uuid[])) order by leg.sort_order desc limit 1),
    (select leg.from_waypoint_id from public.voyage_bookable_legs leg
      where leg.id = any(_proposed_leg_ids) order by leg.sort_order asc limit 1),
    (select leg.to_waypoint_id from public.voyage_bookable_legs leg
      where leg.id = any(_proposed_leg_ids) order by leg.sort_order desc limit 1)
  into v_old_from, v_old_to, v_new_from, v_new_to;

  -- A direct change replaces whatever proposal was still open on this booking.
  update public.voyage_booking_plan_changes
  set status = 'superseded',
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where booking_request_id = _booking_request_id
    and status in ('pending_user_approval', 'pending_admin_approval');

  delete from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select _booking_request_id, selected.id
  from unnest(_proposed_leg_ids) as selected(id);

  insert into public.voyage_booking_plan_changes (
    booking_request_id, voyage_id, status, change_kind,
    old_from_waypoint_id, old_to_waypoint_id,
    proposed_from_waypoint_id, proposed_to_waypoint_id,
    old_leg_ids, proposed_leg_ids, metadata
  )
  values (
    _booking_request_id, v_request.voyage_id, 'auto_accepted', 'route_replanned',
    v_old_from, v_old_to, v_new_from, v_new_to,
    coalesce(v_old_leg_ids, '{}'::uuid[]), _proposed_leg_ids,
    jsonb_build_object('source', _source, 'admin_note', v_note, 'applied_directly', true)
  )
  returning id into v_change_id;

  update public.voyage_booking_requests
  set plan_change_status = 'none',
      plan_change_resolved_at = timezone('utc', now()),
      plan_change_metadata = jsonb_build_object(
        'source', _source,
        'plan_change_id', v_change_id,
        'old_leg_ids', to_jsonb(coalesce(v_old_leg_ids, '{}'::uuid[])),
        'proposed_leg_ids', to_jsonb(_proposed_leg_ids),
        'applied_directly', true
      ),
      admin_notes = concat_ws(E'\n\n', nullif(admin_notes, ''), v_note),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  -- Legs the booking just gave up may have freed a seat for someone on the waitlist.
  perform public.promote_waitlisted_voyage_bookings(
    v_request.voyage_id,
    array(
      select old_leg.id
      from unnest(coalesce(v_old_leg_ids, '{}'::uuid[])) as old_leg(id)
      where not (old_leg.id = any(_proposed_leg_ids))
    )
  );

  return v_change_id;
end;
$function$;

revoke all on function public.apply_voyage_booking_legs_directly(uuid, uuid[], text, text) from public, anon, authenticated;


create or replace function public.admin_propose_voyage_booking_legs(_booking_request_id uuid, _proposed_leg_ids uuid[], _admin_note text default null::text, _change_reason text default null::text, _require_settlement boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Legs already on the booking stay valid even once they are no longer bookable (already
  -- sailed): otherwise a trip in progress could never be extended or shortened.
  select count(*)
  into v_selected_count
  from public.voyage_bookable_legs leg
  where leg.id = any(_proposed_leg_ids)
    and leg.voyage_id = v_request.voyage_id
    and (leg.is_bookable = true or leg.id = any(coalesce(v_old_leg_ids, '{}'::uuid[])));

  if v_selected_count <> cardinality(_proposed_leg_ids) then
    raise exception 'invalid_proposed_legs';
  end if;

  -- Staff (admins travelling, crew) do not approve their own reroutes: apply it now.
  if v_request.is_crew or public.has_role(v_request.profile_id, 'admin'::public.app_role) then
    return public.apply_voyage_booking_legs_directly(
      _booking_request_id, _proposed_leg_ids, 'admin_direct_staff', _admin_note
    );
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
$function$;


create or replace function public.user_propose_voyage_booking_legs(_booking_request_id uuid, _proposed_leg_ids uuid[], _user_message text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_old_leg_ids uuid[];
  v_selected_count integer;
  v_change_id uuid;
  v_old_from uuid;
  v_old_to uuid;
  v_new_from uuid;
  v_new_to uuid;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
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

  -- An admin's own change supersedes whatever was pending; a guest must wait for the answer.
  if v_request.plan_change_status <> 'none' and not v_is_admin then
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
    and (leg.is_bookable = true or leg.id = any(coalesce(v_old_leg_ids, '{}'::uuid[])));

  if v_selected_count <> cardinality(_proposed_leg_ids) then
    raise exception 'invalid_proposed_legs';
  end if;

  -- The admin team would be approving its own member's request: apply it straight away.
  if v_is_admin then
    return public.apply_voyage_booking_legs_directly(
      _booking_request_id, _proposed_leg_ids, 'admin_self_matrix_drag', _user_message
    );
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
    booking_request_id, voyage_id, status, change_kind,
    old_from_waypoint_id, old_to_waypoint_id,
    proposed_from_waypoint_id, proposed_to_waypoint_id,
    old_leg_ids, proposed_leg_ids, metadata
  )
  values (
    _booking_request_id, v_request.voyage_id, 'pending_admin_approval', 'route_replanned',
    v_old_from, v_old_to, v_new_from, v_new_to,
    coalesce(v_old_leg_ids, '{}'::uuid[]), _proposed_leg_ids,
    jsonb_build_object('source', 'user_matrix_drag', 'user_message', nullif(trim(coalesce(_user_message, '')), ''))
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
$function$;


create or replace function public.request_voyage_booking(_voyage_id uuid, _leg_ids uuid[], _party_size integer default 1, _message text default null::text, _candidate_info jsonb default '{}'::jsonb)
 returns table(booking_request_id uuid, booking_status voyage_booking_status)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  requester uuid := auth.uid();
  requester_email text;
  requester_is_admin boolean;
  capacity integer;
  selected_leg_count integer;
  new_request_id uuid;
  new_status public.voyage_booking_status;
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
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    )
    and leg.id = any(_leg_ids);

  if selected_leg_count = 0 or selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  -- 'pending_payment' joins the duplicate guard so a user cannot stack half-finished
  -- applications on the same leg; the grace deadline below makes it self-healing. The guard
  -- now also covers being someone else's guest on those legs — see
  -- voyage_leg_booking_conflict_exists.
  requester_email := lower(nullif(trim(coalesce(
    auth.jwt() ->> 'email',
    (select p.email from public.profiles p where p.id = requester)
  )), ''));

  if public.voyage_leg_booking_conflict_exists(_leg_ids, requester, requester_email, null) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  -- Admins are staff: no contribution to pay and nobody to approve them, so their booking is
  -- confirmed and comped from the start instead of waiting behind the payment gate.
  requester_is_admin := public.has_role(requester, 'admin'::public.app_role);
  new_status := case when requester_is_admin then 'user_confirmed' else 'pending_payment' end;

  insert into public.voyage_booking_requests (
    voyage_id,
    profile_id,
    party_size,
    status,
    message,
    candidate_info,
    expires_at,
    is_comped,
    confirmed_at
  )
  values (
    _voyage_id,
    requester,
    _party_size,
    new_status,
    nullif(trim(coalesce(_message, '')), ''),
    case
      when jsonb_typeof(coalesce(_candidate_info, '{}'::jsonb)) = 'object' then coalesce(_candidate_info, '{}'::jsonb)
      else '{}'::jsonb
    end,
    case when requester_is_admin then null else timezone('utc', now()) + interval '1 hour' end,
    requester_is_admin,
    case when requester_is_admin then timezone('utc', now()) else null end
  )
  returning id into new_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select new_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  -- No notification here on purpose: the applicant has not paid yet, so neither they nor
  -- the admins should be told a candidature exists. settle_voyage_booking_payment does it.
  -- (An admin's confirmed booking gets its first briefing from the status trigger.)

  booking_request_id := new_request_id;
  booking_status := new_status;
  return next;
end;
$function$;


-- Admins already on board are not guests either.
update public.voyage_booking_requests request
set is_comped = true,
    updated_at = timezone('utc', now())
where not request.is_comped
  and request.status not in ('cancelled', 'rejected', 'expired')
  and public.has_role(request.profile_id, 'admin'::public.app_role);
