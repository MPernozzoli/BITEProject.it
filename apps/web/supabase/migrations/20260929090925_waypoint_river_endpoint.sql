-- Cambio di semantica del flag introdotto in 20260929090227: non marca più "la tratta in arrivo è
-- fiume" ma i due ESTREMI di un tratto fiume. I waypoint marcati si accoppiano nell'ordine della
-- rotta (1º+2º, 3º+4º, ...): tutte le tratte fra i due estremi, waypoint intermedi compresi, sono
-- fiume/canale; un waypoint appartiene al più a un tratto fiume. Rinominato per non mentire.
alter table public.voyage_waypoints rename column river_leg to river_endpoint;
comment on column public.voyage_waypoints.river_endpoint is
  'Marks the start or end of an inland-waterway stretch (BRouter river profile). Flagged waypoints pair up in route order (1st+2nd, 3rd+4th, ...); every leg between a pair is routed along the waterway, the rest is open sea. Only used when the voyage has waterway_autoroute.';
