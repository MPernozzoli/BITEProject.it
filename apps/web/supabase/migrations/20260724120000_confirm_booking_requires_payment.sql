-- confirm_voyage_booking (the traveller's own "Conferma" button, admin_approved -> user_confirmed)
-- had no payment check at all, unlike its admin-side counterpart
-- (admin_set_voyage_booking_status), which already refuses admin_approved/user_confirmed
-- without a paid deposit or an explicit comp. That gap meant a traveller on 'each_pays_own'
-- could click "Conferma" and become fully confirmed without ever paying their contribution —
-- directly defeating the guarantee that a booking is only 100% confirmed once paid (settled
-- automatically for accepted invites by settle_voyage_booking_payment). 'lead_pays_all'
-- bookings are unaffected: their payment is tracked on the lead's own deposit, not gated here.

create or replace function public.confirm_voyage_booking(_booking_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.voyage_booking_requests%rowtype;
begin
  select *
  into v_request
  from public.voyage_booking_requests
  where id = _booking_request_id
    and profile_id = auth.uid()
    and status = 'admin_approved'
  for update;

  if not found then
    raise exception 'Booking cannot be confirmed' using errcode = '42501';
  end if;

  if v_request.payment_mode = 'each_pays_own'
     and not coalesce(v_request.is_comped, false)
     and not public.voyage_booking_has_paid_deposit(_booking_request_id)
  then
    raise exception 'Booking has no paid contribution' using errcode = '22023';
  end if;

  update public.voyage_booking_requests
  set status = 'user_confirmed',
      confirmed_at = timezone('utc', now())
  where id = _booking_request_id;

  perform public.enqueue_voyage_booking_notification(_booking_request_id, 'user_confirmed');
  perform public.enqueue_admin_voyage_booking_notifications(
    _booking_request_id,
    'admin_modified',
    jsonb_build_object('status', 'user_confirmed')
  );
end;
$$;
