create or replace function public.promote_waitlisted_voyage_bookings(
  _voyage_id uuid,
  _changed_leg_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  candidate_leg_ids uuid[];
  promoted_count integer := 0;
begin
  for candidate in
    select *
    from public.voyage_booking_requests
    where voyage_id = _voyage_id
      and status = 'waitlisted'
    order by requested_at asc, id asc
  loop
    select array_agg(bookable_leg_id)
    into candidate_leg_ids
    from public.voyage_booking_request_legs
    where booking_request_id = candidate.id;

    if coalesce(array_length(candidate_leg_ids, 1), 0) = 0 then
      continue;
    end if;

    if _changed_leg_ids is not null and not (candidate_leg_ids && _changed_leg_ids) then
      continue;
    end if;

    if not public.admin_booking_over_capacity(candidate.voyage_id, candidate_leg_ids, candidate.party_size, candidate.id) then
      update public.voyage_booking_requests
      set
        status = 'requested',
        admin_notes = concat_ws(
          E'\n',
          nullif(admin_notes, ''),
          'Promosso automaticamente dalla waiting list per disponibilita posti.'
        )
      where id = candidate.id;
      promoted_count := promoted_count + 1;
    end if;
  end loop;

  return promoted_count;
end;
$$;

create or replace function public.cancel_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_voyage_id uuid;
  changed_leg_ids uuid[];
begin
  select voyage_id
  into booking_voyage_id
  from public.voyage_booking_requests
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status in ('requested', 'waitlisted', 'admin_approved', 'user_confirmed');

  if booking_voyage_id is null then
    raise exception 'Booking cannot be cancelled' using errcode = '42501';
  end if;

  select array_agg(bookable_leg_id)
  into changed_leg_ids
  from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

  perform pg_advisory_xact_lock(hashtextextended(booking_voyage_id::text, 0));

  update public.voyage_booking_requests
  set
    status = 'cancelled',
    cancelled_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.promote_waitlisted_voyage_bookings(booking_voyage_id, changed_leg_ids);
end;
$$;

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
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only admins can update booking status' using errcode = '42501';
  end if;

  select *
  into booking
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if booking.id is null then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  previous_status := booking.status;
  perform pg_advisory_xact_lock(hashtextextended(booking.voyage_id::text, 0));

  select array_agg(bookable_leg_id)
  into leg_ids
  from public.voyage_booking_request_legs
  where booking_request_id = _booking_request_id;

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

  update public.voyage_booking_requests
  set
    status = _status,
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else cancelled_at end
  where id = _booking_request_id;

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

revoke execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) from public, anon;
grant execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) to authenticated, service_role;
revoke execute on function public.cancel_voyage_booking(uuid) from public, anon;
grant execute on function public.cancel_voyage_booking(uuid) to authenticated;
revoke execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) from public, anon;
grant execute on function public.admin_set_voyage_booking_status(uuid, public.voyage_booking_status, boolean, text) to authenticated;
