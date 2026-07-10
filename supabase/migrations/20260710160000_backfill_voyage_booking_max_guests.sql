-- The 20260710130000_crew_auto_booking migration bumped the *default* booking_max_guests
-- from 2 to 4 (2 crew + 2 guest slots), but only ALTER COLUMN SET DEFAULT applies to future
-- inserts. Every voyage row created before that migration is stuck at the old default of 2,
-- which — combined with the two now-auto-booked crew members occupying 2 seats — makes every
-- leg on those voyages show 0 remaining seats instead of the intended 2.
--
-- Backfill only rows still sitting at the old default; voyages an admin has since customized
-- to something other than 2 via the admin UI are left untouched.
update public.voyages
set booking_max_guests = 4
where booking_max_guests = 2;
