-- Fix ambiguous PL/pgSQL name resolution in admin_set_voyage_booking_status.
--
-- The function returns a column named booking_request_id, which is also visible as a
-- PL/pgSQL variable inside the function body. Unqualified SQL references like
-- `where booking_request_id = _booking_request_id` can therefore collide with the
-- output column variable. Qualify table columns explicitly.

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
    admin_notes = coalesce(nullif(trim(_admin_notes), ''), req.admin_notes),
    confirmed_at = case when _status = 'user_confirmed' then timezone('utc', now()) else req.confirmed_at end,
    cancelled_at = case when _status = 'cancelled' then timezone('utc', now()) else req.cancelled_at end
  where req.id = _booking_request_id;

  if _status in ('admin_approved', 'user_confirmed', 'cancelled', 'rejected') and previous_status is distinct from _status then
    perform public.enqueue_voyage_booking_notification(_booking_request_id, _status::text);
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
