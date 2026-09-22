-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): record the actual
-- departure from Roccella Ionica at 19:00 Europe/Rome on 21/09/2026.
--
-- The next actual stop (Reggio Calabria, reached 07:30 the following morning
-- as an alternative to the planned Messina stop) is intentionally NOT recorded
-- here: it is a new stop not in the original plan, and per product decision
-- it waits for the upcoming route-correction ("aggiunta soste") flow built on
-- insert_voyage_leg_correction_stops (see 20260917120000) instead of a raw
-- migration. Only the Roccella Ionica departure, which needs no new stop, is
-- set now.
--
-- apply_voyage_schedule cascades the actual into the departing leg the same
-- way every other actual correction on this voyage has. _notify = false:
-- recording an already-happened departure, not announcing a new delay.

update public.voyage_waypoints
set actual_departure_at = '2026-09-21T17:00:00Z' -- 19:00 Europe/Rome (CEST, UTC+2)
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and id = '7e338530-3be5-4538-a20a-7d5b8c752d62'; -- Roccella Ionica, sort_order 30

select public.apply_voyage_schedule('c421e207-86d0-42e9-be1c-6b7abb3e6c89', false);
