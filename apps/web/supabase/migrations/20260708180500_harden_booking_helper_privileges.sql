revoke execute on function public.admin_booking_over_capacity(uuid, uuid[], integer, uuid) from public, anon;
grant execute on function public.admin_booking_over_capacity(uuid, uuid[], integer, uuid) to authenticated;
