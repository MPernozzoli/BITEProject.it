-- Resize an existing booking request's leg range (used by the drag handles on the Gantt
-- bar in the admin bookings table). Mirrors admin_create_voyage_booking's validation but
-- replaces the leg set of a request that already exists, instead of creating a new one.
create or replace function public.admin_update_booking_legs(
  _booking_request_id uuid,
  _leg_ids uuid[],
  _allow_over_capacity boolean default false
)
returns table (over_capacity boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_voyage_id uuid;
  target_status public.voyage_booking_status;
  target_party_size integer;
  selected_leg_count integer;
  exceeds_capacity boolean := false;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking legs' using errcode = '42501';
  end if;

  if _leg_ids is null or cardinality(_leg_ids) = 0 then
    raise exception 'At least one leg is required' using errcode = '22023';
  end if;

  select voyage_id, status, party_size
  into target_voyage_id, target_status, target_party_size
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select count(*)
  into selected_leg_count
  from public.voyage_bookable_legs leg
  where leg.voyage_id = target_voyage_id
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

  if target_status in ('requested', 'admin_approved', 'user_confirmed') then
    exceeds_capacity := public.admin_booking_over_capacity(
      target_voyage_id, _leg_ids, target_party_size, _booking_request_id
    );
    if exceeds_capacity and not _allow_over_capacity then
      raise exception 'Booking exceeds voyage capacity' using errcode = '22023';
    end if;
  end if;

  delete from public.voyage_booking_request_legs where booking_request_id = _booking_request_id;

  insert into public.voyage_booking_request_legs (booking_request_id, bookable_leg_id)
  select _booking_request_id, id
  from unnest(_leg_ids) as selected_leg(id);

  update public.voyage_booking_requests
  set updated_at = timezone('utc', now())
  where id = _booking_request_id;

  over_capacity := exceeds_capacity;
  return next;
end;
$$;

grant execute on function public.admin_update_booking_legs(uuid, uuid[], boolean) to authenticated;
