-- Internal booking maintenance/notification helpers should not be callable directly by
-- signed-in users through the Data API. Public RPCs that call them run as SECURITY DEFINER.

revoke execute on function public.deactivate_past_voyage_bookable_legs() from public, anon, authenticated;
grant execute on function public.deactivate_past_voyage_bookable_legs() to service_role;
revoke execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.promote_waitlisted_voyage_bookings(uuid, uuid[]) to service_role;
revoke execute on function public.enqueue_voyage_booking_notification(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_voyage_booking_notification(uuid, text, jsonb) to service_role;
revoke execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_admin_voyage_booking_notifications(uuid, text, jsonb) to service_role;
