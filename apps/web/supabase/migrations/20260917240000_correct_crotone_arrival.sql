-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): correct the
-- recorded Crotone arrival to 14:30 Europe/Rome (was 16:12, an imprecise
-- entry). Cascades into the "Santa Maria di Leuca -> Crotone" leg's
-- actual_arrival_at the same way every other actual correction on this
-- voyage has (apply_voyage_schedule, _notify = false: fixing an already-
-- recorded fact, not a new delay).

update public.voyage_waypoints
set actual_arrival_at = '2026-09-17T12:30:00Z' -- 14:30 Europe/Rome (CEST, UTC+2)
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and name = 'Crotone'
  and actual_status = 'planned';

select public.apply_voyage_schedule('c421e207-86d0-42e9-be1c-6b7abb3e6c89', false);
