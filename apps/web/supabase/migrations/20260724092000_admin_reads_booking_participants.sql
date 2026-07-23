-- The admin Gantt (AdminVoyageBookings.tsx) now loads voyage_booking_participants to tell
-- unaccepted email invites apart from confirmed bookings, but voyage_booking_participants had
-- no admin-wide SELECT policy — only the guest themselves and the booking's own lead/profile_id
-- could read a row (mirroring voyage_booking_requests, which does grant admins SELECT). Without
-- this, the admin query is RLS-filtered down to just their own bookings and the feature silently
-- sees no participants for anyone else's invites.

create policy "Admins read all booking participants"
on public.voyage_booking_participants
for select
using (has_role(auth.uid(), 'admin'::public.app_role));
