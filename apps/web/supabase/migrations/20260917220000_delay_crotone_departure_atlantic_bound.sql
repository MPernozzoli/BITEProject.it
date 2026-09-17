-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): push the planned
-- departure from Crotone to Saturday 19/09 23:00 Europe/Rome (favourable wind
-- window), cascading every downstream leg from that new anchor.
--
-- Crotone had no date_start override (it was riding the stop_mode='hours'
-- rule: depart 10h after arrival, snapped to 19:00). Setting date_start
-- explicitly is the same field the admin route editor's "Partenza" input
-- writes (see computeWaypointFormChanges in src/lib/waypoint-form.ts) — it
-- takes priority over the stop-hours rule in compute_voyage_schedule's walk,
-- so every leg after Crotone recomputes its window from this new instant
-- instead of the old rule-derived one. Legs already closed (actual_arrival_at
-- recorded) are untouched: apply_voyage_schedule always prefers a recorded
-- actual over the plan.
--
-- _notify = false matches how sync_voyage_bookable_legs() itself treats a
-- pure re-plan of a leg that has not departed yet: a schedule adjustment made
-- in advance is not a "your voyage is running late" delay notice — no leg's
-- from/to waypoints change, so it wouldn't trigger the plan-change
-- reconciliation either if this had gone through the full admin replan.

update public.voyage_waypoints
set date_start = '2026-09-19T21:00:00Z' -- 23:00 Europe/Rome (CEST, UTC+2)
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and name = 'Crotone'
  and sort_order = 14;

select public.apply_voyage_schedule('c421e207-86d0-42e9-be1c-6b7abb3e6c89', false);
