-- "Atlantic Bound!" (c421e207-86d0-42e9-be1c-6b7abb3e6c89): Otranto was added
-- via the live widget's route-correction modal right after Bari (sort_order
-- 11, between two waypoints already south of it), instead of where it
-- actually sits along the coast — between the technical waypoint at
-- 40.09°N/18.74°E (then sort_order 7) and the next one south (then sort_order
-- 8). That put a waypoint at 40.15°N between two points at ~39.79°N, a real
-- zigzag on the map.
--
-- voyage_waypoints has no uniqueness constraint on sort_order (only the id
-- primary key), so this single UPDATE permutes the four affected rows in one
-- statement: the old 8/9/10 shift up by one, Otranto takes the freed slot 8.
-- Otranto's own actual_status = 'added' keeps it out of
-- voyage_leg_candidate_waypoints() regardless of position, so this never
-- touches voyage_bookable_legs or booking-leg identity — pure display
-- ordering.
update public.voyage_waypoints
set sort_order = case
  when id = '599a31f3-2fda-480d-8acf-ac12da2e1eae' then 8   -- Otranto
  else sort_order + 1                                        -- old 8, 9, 10
end
where voyage_id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89'
  and sort_order between 8 and 11;

-- The cached route line was built (straight chords only: this voyage has
-- waterway_autoroute = false) before Otranto existed, so it jumps straight
-- from the 40.09°N/18.74°E point to the one that is now three slots further
-- along, skipping Otranto's position entirely. Inserted its coordinate at
-- the matching spot (index 8, right after that same point) rather than
-- rebuilding the whole 263-point line.
--
-- Checked against real OSM coastline data (natural=coastline ways fetched
-- for both new chords, via the same Overpass query buildSeaSegmentGeometry
-- uses) before inserting, instead of assuming a straight line is fine:
-- neither the 40.09°N/18.74°E -> Otranto chord nor the Otranto -> next-point
-- chord crosses land, so no bulge is needed here — a plain coordinate
-- insertion already matches what the land-avoidance system itself would
-- produce for these two chords.
update public.voyages
set cached_geometry = jsonb_build_object(
  'type', 'LineString',
  'coordinates', (
    select jsonb_agg(coordinate order by sort_key)
    from (
      select idx::numeric as sort_key, coordinate
      from jsonb_array_elements(cached_geometry -> 'coordinates') with ordinality as t(coordinate, idx)
      where idx <= 8
      union all
      select 8.5 as sort_key, jsonb_build_array(18.49627, 40.14654) as coordinate -- Otranto
      union all
      select idx::numeric as sort_key, coordinate
      from jsonb_array_elements(cached_geometry -> 'coordinates') with ordinality as t(coordinate, idx)
      where idx > 8
    ) spliced
  )
)
where id = 'c421e207-86d0-42e9-be1c-6b7abb3e6c89';
