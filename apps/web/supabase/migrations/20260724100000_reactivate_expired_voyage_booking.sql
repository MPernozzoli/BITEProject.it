-- Lets a traveller reactivate their own expired application, resetting only the payment
-- timer while preserving the same voyage_booking_requests row (legs, party size, candidate
-- info, message). Today an expired application is a dead end: the only way to retry is to
-- resubmit the whole form, which creates an unrelated new row.
--
-- Availability on the original legs is re-checked exactly like a fresh application: still
-- bookable, still within their booking window, and not already filled by
-- admin_approved/user_confirmed occupants (candidatures never hold seats, so an application
-- that expired unreviewed never blocked its own legs in the first place).

create or replace function public.reactivate_expired_voyage_booking(_booking_request_id uuid)
returns table(booking_request_id uuid, booking_status public.voyage_booking_status, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  v_request public.voyage_booking_requests%rowtype;
  v_leg_ids uuid[];
  v_bookable_leg_count integer;
  v_new_expires_at timestamptz;
begin
  if requester is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
  for update;

  if not found then
    raise exception 'Booking request not found' using errcode = '22023';
  end if;

  if v_request.profile_id <> requester then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_request.status <> 'expired' then
    raise exception 'Booking request is not expired' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request.voyage_id::text, 0));
  perform public.deactivate_past_voyage_bookable_legs();

  select array_agg(link.bookable_leg_id)
  into v_leg_ids
  from public.voyage_booking_request_legs link
  where link.booking_request_id = _booking_request_id;

  if v_leg_ids is null or cardinality(v_leg_ids) = 0 then
    raise exception 'Booking request has no legs' using errcode = '22023';
  end if;

  -- Every original leg must still be open for booking and within its time window.
  select count(*)
  into v_bookable_leg_count
  from public.voyage_bookable_legs leg
  where leg.id = any(v_leg_ids)
    and leg.is_bookable = true
    and public.voyage_leg_is_bookable_now(
      leg.actual_departure_at,
      leg.actual_arrival_at,
      leg.starts_at_window_start,
      leg.ends_at_window_end
    );

  if v_bookable_leg_count <> cardinality(v_leg_ids) then
    raise exception 'legs_unavailable' using errcode = 'BK002';
  end if;

  if public.admin_booking_over_capacity(v_request.voyage_id, v_leg_ids, v_request.party_size, _booking_request_id) then
    raise exception 'legs_unavailable' using errcode = 'BK002';
  end if;

  -- Same duplicate guard as a fresh application: another active request of the same
  -- traveller must not already sit on one of these legs.
  if exists (
    select 1
    from public.voyage_booking_request_legs link
    join public.voyage_booking_requests req on req.id = link.booking_request_id
    where link.bookable_leg_id = any(v_leg_ids)
      and req.profile_id = requester
      and req.id <> _booking_request_id
      and req.status in ('pending_payment', 'requested', 'waitlisted', 'admin_approved', 'user_confirmed')
      and (req.expires_at is null or req.expires_at > timezone('utc', now()))
  ) then
    raise exception 'duplicate_leg_booking' using errcode = 'BK001';
  end if;

  v_new_expires_at := timezone('utc', now()) + interval '1 hour';

  update public.voyage_booking_requests
  set status = 'pending_payment',
      expires_at = v_new_expires_at,
      updated_at = timezone('utc', now())
  where id = _booking_request_id;

  booking_request_id := _booking_request_id;
  booking_status := 'pending_payment';
  expires_at := v_new_expires_at;
  return next;
end;
$$;

revoke execute on function public.reactivate_expired_voyage_booking(uuid) from public, anon;
grant execute on function public.reactivate_expired_voyage_booking(uuid) to authenticated;
