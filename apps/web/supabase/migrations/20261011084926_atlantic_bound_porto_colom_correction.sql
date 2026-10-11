-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): record what
-- actually happened between Cagliari and Palma de Mallorca.
--
--   - Departed Cagliari at 23:40 Europe/Rome on 06/10/2026.
--   - Porto Pino (planned) was skipped: the boat went straight out to sea.
--   - Maó (planned) was skipped in favour of Porto Colom, Mallorca
--     (39.41879°N, 3.27070°E), a stop not in the original plan: arrived 21:30
--     on 09/10/2026, departed for Palma at 12:00 on 11/10/2026.
--
-- Same shape as the Messina -> Reggio Calabria correction (20260922150000):
-- Porto Colom is an 'added' narrative stop and Maó, the bookable leg's own
-- waypoint, becomes its alias (alias_of_waypoint_id, 20260922140000), so the
-- live widget's "Parti ora"/"Arriva ora" and the leg chain keep working on Maó
-- while the map and narrative show Porto Colom. Porto Pino, with no real stop
-- in its place, gets the usual pass-through actual (arrival = departure =
-- Cagliari's departure) set_voyage_waypoint_actual_status would have stamped,
-- so the schedule does not stay stuck waiting for an arrival there.
--
-- Neither skip touches voyage_bookable_legs identity or pricing: both stops
-- are mid-route (see voyage_leg_candidate_waypoints, 20260917203938).

-- 1. Make room after the last Maó exit point (sort_order 89, 39.81°N/4.29°E)
--    and insert Porto Colom with its harbour approach/exit route points.
--    Raw chords would cut across land: Porto Colom -> the next planned point
--    south of Mallorca (39.23°N/3.06°E) crosses the coast at Cala d'Or, so the
--    exit goes back out through the harbour mouth and runs offshore of the
--    south-east coast first.
update public.voyage_waypoints
set sort_order = sort_order + 4
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and sort_order >= 90;

insert into public.voyage_waypoints (
  voyage_id, lat, lng, name, name_it, name_en,
  sort_order, waypoint_type, visibility_mode, actual_status
) values
  ('c421e207-86d0-42e9-be1c-6b7abb3e6c89', 39.405, 3.292, '39.41°N · 3.29°E', null, null,
    90, 'technical', 'manual', 'added'),
  ('c421e207-86d0-42e9-be1c-6b7abb3e6c89', 39.41879, 3.27070, 'Porto Colom, Spagna', 'Porto Colom, Spagna', 'Porto Colom, Spain',
    91, 'narrative', 'manual', 'added'),
  ('c421e207-86d0-42e9-be1c-6b7abb3e6c89', 39.400, 3.292, '39.40°N · 3.29°E', null, null,
    92, 'technical', 'manual', 'added'),
  ('c421e207-86d0-42e9-be1c-6b7abb3e6c89', 39.330, 3.240, '39.33°N · 3.24°E', null, null,
    93, 'technical', 'manual', 'added');

-- 2. Skips.
update public.voyage_waypoints
set actual_status = 'skipped'
where id in (
  '691f6918-98ba-41db-8ad9-c2c0653f1f15', -- Porto Pino
  '2763d032-7f9d-4132-85b4-c3ea07bdbccb'  -- Maó
);

update public.voyage_waypoints
set alias_of_waypoint_id = (
  select id from public.voyage_waypoints
  where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
    and actual_status = 'added'
    and name_it = 'Porto Colom, Spagna'
)
where id = '2763d032-7f9d-4132-85b4-c3ea07bdbccb'; -- Maó

-- 3. Actuals (Europe/Rome is CEST, UTC+2, on all these dates).
update public.voyage_waypoints
set actual_departure_at = '2026-10-06T21:40:00Z' -- 23:40, 06/10
where id = 'f805d2e2-91ff-440e-a5b1-ca4fa91dc283'; -- Cagliari

update public.voyage_waypoints
set actual_arrival_at = '2026-10-06T21:40:00Z',
    actual_departure_at = '2026-10-06T21:40:00Z'
where id = '691f6918-98ba-41db-8ad9-c2c0653f1f15'; -- Porto Pino, pass-through

-- Written on Porto Colom: the alias trigger mirrors it onto Maó.
update public.voyage_waypoints
set actual_arrival_at = '2026-10-09T19:30:00Z',   -- 21:30, 09/10
    actual_departure_at = '2026-10-11T10:00:00Z'  -- 12:00, 11/10
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and actual_status = 'added'
  and name_it = 'Porto Colom, Spagna';

-- 4. Keep cached_geometry 1:1 with the waypoint list, as on the rest of this
--    voyage: splice the four new coordinates in right after index 90
--    (sort_order 89).
update public.voyages
set cached_geometry = jsonb_build_object(
  'type', 'LineString',
  'coordinates', (
    select jsonb_agg(coordinate order by sort_key)
    from (
      select idx::numeric as sort_key, coordinate
      from jsonb_array_elements(cached_geometry -> 'coordinates') with ordinality as t(coordinate, idx)
      where idx <= 90
      union all
      select 90.1, jsonb_build_array(3.292, 39.405)
      union all
      select 90.2, jsonb_build_array(3.27070, 39.41879) -- Porto Colom
      union all
      select 90.3, jsonb_build_array(3.292, 39.400)
      union all
      select 90.4, jsonb_build_array(3.240, 39.330)
      union all
      select idx::numeric as sort_key, coordinate
      from jsonb_array_elements(cached_geometry -> 'coordinates') with ordinality as t(coordinate, idx)
      where idx > 90
    ) spliced
  )
)
where id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89';

-- 5. Cascade into voyage_bookable_legs. _notify = false: this records
--    already-happened history, not a new delay to announce.
select public.apply_voyage_schedule('c421e207-86d0-42e9-be1c-6b7abb3e6c89', false);
