-- Harden SECURITY DEFINER functions that were still executable through the inherited PUBLIC grant.
-- Keep authenticated access only for RPCs intentionally called by signed-in users.

revoke execute on function public._migration_exec(text) from public, anon, authenticated;

revoke execute on function public.accept_booking_participation(uuid) from public, anon;
grant execute on function public.accept_booking_participation(uuid) to authenticated;

revoke execute on function public.admin_update_booking_legs(uuid, uuid[], boolean) from public, anon;
grant execute on function public.admin_update_booking_legs(uuid, uuid[], boolean) to authenticated;

revoke execute on function public.decline_booking_participation(uuid) from public, anon;
grant execute on function public.decline_booking_participation(uuid) to authenticated;

revoke execute on function public.ensure_voyage_crew_bookings() from public, anon, authenticated;
grant execute on function public.ensure_voyage_crew_bookings() to service_role;

revoke execute on function public.expire_pending_booking_participants() from public, anon, authenticated;
grant execute on function public.expire_pending_booking_participants() to service_role;

revoke execute on function public.get_my_participations() from public, anon;
grant execute on function public.get_my_participations() to authenticated;

revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

revoke execute on function public.set_booking_participants(uuid, text, jsonb) from public, anon;
grant execute on function public.set_booking_participants(uuid, text, jsonb) to authenticated;

-- Internal staging table used by the legacy migration helper. It should not be readable through
-- the Data API even if explicit table grants are added later.
alter table if exists public._migration_chunks enable row level security;
revoke all on table public._migration_chunks from public, anon, authenticated;
