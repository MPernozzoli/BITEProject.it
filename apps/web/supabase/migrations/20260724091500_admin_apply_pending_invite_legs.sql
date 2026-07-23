-- Lets an admin directly change the tratte of a booking that was created as an email invite
-- and has NOT been accepted yet (the invitee has no real account/session to approve anything).
--
-- admin_propose_voyage_booking_legs is for changing an ALREADY-ESTABLISHED traveller's plan and
-- deliberately requires their approval (it must not evict someone who already committed). Routing
-- a still-pending, not-yet-signed-up invite through that same mechanism is wrong on two counts:
-- it sends no notification at all (the invitee would never find out), and nobody can even respond
-- to it, since voyage_booking_plan_changes/respond_voyage_booking_plan_change require
-- auth.uid() = profile_id, which is impossible until the invitee signs up and accepts via
-- accept_booking_participation. This function applies the leg change immediately instead, since
-- nobody has agreed to anything yet — there is nothing to protect.

create or replace function public.admin_apply_pending_invite_legs(
  _booking_request_id uuid,
  _leg_ids uuid[],
  _allow_over_capacity boolean default false
)
returns table (over_capacity boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
  v_selected_leg_count integer;
  v_exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update invite legs' using errcode = '42501';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = '22023';
  end if;

  if v_request.party_size <> 1 or exists (
    select 1
    from public.voyage_booking_participants participant
    where participant.booking_request_id = _booking_request_id
      and participant.status = 'accepted'
  ) then
    raise exception 'not_a_pending_invite' using errcode = '22023';
  end if;

  if coalesce(cardinality(_leg_ids), 0) = 0 then
    raise exception 'proposed_legs_required' using errcode = '22023';
  end if;

  select count(*)
  into v_selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = v_request.voyage_id
    and leg.is_bookable = true
    and leg.id = any(_leg_ids);

  if v_selected_leg_count = 0 or v_selected_leg_count <> cardinality(_leg_ids) then
    raise exception 'Invalid booking legs' using errcode = '22023';
  end if;

  v_exceeds_capacity := public.admin_booking_over_capacity(
    v_request.voyage_id, _leg_ids, v_request.party_size, _booking_request_id
  );
  if v_exceeds_capacity and not _allow_over_capacity then
    raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
  end if;

  delete from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select _booking_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  -- Defensive: clear any stray proposal left over from before this shortcut existed.
  update public.voyage_booking_plan_changes
  set status = 'superseded',
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where booking_request_id = _booking_request_id
    and status = 'pending_user_approval';

  update public.voyage_booking_requests
  set plan_change_status = 'none',
      plan_change_metadata = '{}'::jsonb,
      plan_change_resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  over_capacity := v_exceeds_capacity;
  return next;
end;
$$;

revoke execute on function public.admin_apply_pending_invite_legs(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_apply_pending_invite_legs(uuid, uuid[], boolean) to authenticated;
