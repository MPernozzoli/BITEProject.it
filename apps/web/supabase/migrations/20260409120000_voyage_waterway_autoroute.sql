-- Inland waterway routing (BRouter river profile); default false keeps all existing voyages unchanged.
alter table public.voyages
  add column if not exists waterway_autoroute boolean not null default false;
comment on column public.voyages.waterway_autoroute is
  'When true and type=water, cached_geometry follows OSM navigable waterways (BRouter river profile). Public UI still treats voyage as water.';
