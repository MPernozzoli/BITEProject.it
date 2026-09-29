-- Instradamento fiume/canale per singola tratta: quando true, la tratta che ARRIVA a questo
-- waypoint (dal precedente) segue le vie navigabili OSM (BRouter, profilo river). Le altre tratte
-- del viaggio restano mare aperto (corda retta che aggira la costa). Il flag ha effetto solo se
-- il viaggio ha waterway_autoroute = true; il default false lascia invariati i viaggi esistenti.
alter table public.voyage_waypoints
  add column if not exists river_leg boolean not null default false;
comment on column public.voyage_waypoints.river_leg is
  'When true (and the voyage has waterway_autoroute), the leg from the previous waypoint to this one is routed along inland waterways (BRouter river profile) instead of open sea.';
