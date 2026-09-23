-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): alias Messina to
-- Reggio Calabria, the real stop reached instead.
--
-- Messina (3008ea66-013e-4ac8-b43a-60c053c319aa) was marked skipped in favour
-- of Reggio Calabria (7bfe760c-b1c9-49cb-ba76-2feb50eed938), added via the
-- route-correction flow with its own real arrival already recorded (05:30 on
-- 22/09). The pass-through actual set_voyage_waypoint_actual_status stamped on
-- Messina at correction time (arrival = departure = 12:52) was wrong on two
-- counts: it used the correction time instead of Reggio Calabria's real
-- arrival, and it told the schedule the boat had already left Messina, when
-- the crew is in fact still stopped there — as Reggio Calabria — waiting to
-- record "Parti ora".
--
-- This sets alias_of_waypoint_id (20260922140000) so the two waypoints share
-- their actuals from now on, and re-derives Messina's own actuals from Reggio
-- Calabria's real, already-recorded ones: arrival at 05:30, departure back to
-- null. The trigger keeps them in sync going forward — recording "Parti ora"
-- (which the widget still writes to Messina, the bookable leg's own waypoint)
-- will also stamp Reggio Calabria's record.
--
-- The recompute below also picks up the compute_voyage_schedule fix from
-- 20260922130000: now that its walk is actual_status-aware, this is what
-- finally closes the Crotone -> Messina leg (stuck since the correction — see
-- 20260922130000's comment) and opens Messina -> Lipari with the correct,
-- not-yet-departed state instead of the false "already left" one.
-- _notify = false: this corrects a data bug, it does not announce a new delay.

update public.voyage_waypoints
set alias_of_waypoint_id = '7bfe760c-b1c9-49cb-ba76-2feb50eed938' -- Reggio Calabria
where id = '3008ea66-013e-4ac8-b43a-60c053c319aa'; -- Messina

update public.voyage_waypoints
set actual_arrival_at = '2026-09-22T05:30:00Z',
    actual_departure_at = null
where id = '3008ea66-013e-4ac8-b43a-60c053c319aa'; -- Messina, now mirrors Reggio Calabria

select public.apply_voyage_schedule('c421e207-86d0-42e9-be1c-6b7abb3e6c89', false);
