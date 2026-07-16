-- Citizen science observations: the sampling data collected during voyages and published
-- on data.biteproject.it (apps/data).
--
-- Storage is normalized (one row per measured parameter) so that adding a new sensor is a
-- single row in `observation_parameters` instead of a migration. Researchers, however, want
-- one row per sampling point with one column per variable, so `public.observations_export`
-- is a wide view that is rebuilt automatically from the catalog and is what /Data/downloads
-- serves as CSV.
--
-- Positions are NOT expected to sit on the voyage line: `voyages.cached_geometry` is an
-- estimated route, while observations carry the real GPS fix from the onboard logger.

-- ---------------------------------------------------------------------------
-- Parameter catalog
-- ---------------------------------------------------------------------------

create table if not exists public.observation_parameters (
  code text primary key,
  unit_code text not null,
  label_en text not null,
  label_it text,
  unit text not null,
  description_en text,
  description_it text,
  method_en text,
  method_it text,
  accuracy text,
  value_type text not null default 'numeric',
  scale_min numeric,
  scale_max numeric,
  color_ramp text not null default 'viridis',
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- `code` and `unit_code` become SQL identifiers in observations_export, so they are
  -- constrained to a safe shape rather than escaped at rebuild time.
  constraint observation_parameters_code_check check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint observation_parameters_unit_code_check check (unit_code ~ '^[a-z][a-z0-9_]*$'),
  constraint observation_parameters_value_type_check check (value_type in ('numeric', 'categorical')),
  constraint observation_parameters_scale_check check (
    scale_min is null or scale_max is null or scale_min < scale_max
  )
);
comment on table public.observation_parameters is
  'Catalog of measurable variables. Adding a sensor means inserting a row here: the export view and the map filters pick it up automatically.';
comment on column public.observation_parameters.unit_code is
  'Identifier-safe unit suffix used to build export column names, e.g. sst + degc -> sst_degc.';
comment on column public.observation_parameters.value_type is
  'numeric -> value column is used; categorical -> value_text is used (e.g. sea state, field notes).';
comment on column public.observation_parameters.scale_min is
  'Lower bound of the map color scale when this parameter is the only one selected. Null falls back to the data range.';
comment on column public.observation_parameters.accuracy is
  'Instrument accuracy as declared by the sensor datasheet, surfaced in the map tooltip so readings can be judged.';

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

create table if not exists public.observation_devices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  model text,
  firmware text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint observation_devices_code_check check (code ~ '^[a-z0-9][a-z0-9-]*$')
);
comment on table public.observation_devices is
  'Onboard loggers (and manual-entry pseudo-devices) that produce observations. Publicly readable: contains no secret.';

-- Ingest credentials live in their own table so that observation_devices can stay readable
-- by anon without ever exposing a key hash through the public views.
create table if not exists public.observation_device_keys (
  device_id uuid primary key references public.observation_devices (id) on delete cascade,
  key_hash text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
comment on table public.observation_device_keys is
  'Hashed ingest credentials for onboard loggers. Never granted to anon/authenticated: only service_role (and the ingest function) may read it.';

-- ---------------------------------------------------------------------------
-- Observations (one row per sampling point / GPS fix)
-- ---------------------------------------------------------------------------

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid references public.voyages (id) on delete set null,
  device_id uuid references public.observation_devices (id) on delete set null,
  recorded_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  gps_accuracy_m numeric,
  depth_m numeric,
  source text not null default 'sensor',
  qc_flag smallint not null default 0,
  notes text,
  is_published boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint observations_lat_check check (lat between -90 and 90),
  constraint observations_lng_check check (lng between -180 and 180),
  constraint observations_source_check check (source in ('sensor', 'manual', 'simulated')),
  -- IOC/UNESCO IODE primary QC levels, the scheme research institutes already read.
  constraint observations_qc_flag_check check (qc_flag in (0, 1, 2, 3, 4, 9))
);
comment on table public.observations is
  'One sampling point: a timestamped GPS fix produced by an onboard logger. Individual readings hang off observation_measurements.';
comment on column public.observations.recorded_at is
  'Instant the sample was taken, stored as timestamptz and exported as ISO 8601 UTC. This is what attributes the point to a voyage.';
comment on column public.observations.voyage_id is
  'Resolved from recorded_at by resolve_voyage_for_timestamp() when not supplied. Nullable: a point outside every voyage window stays unattributed rather than being forced onto the wrong voyage.';
comment on column public.observations.source is
  'sensor = onboard logger, manual = crew entry, simulated = seeded demo data that is NOT a real measurement.';
comment on column public.observations.qc_flag is
  'Position quality, IODE scale: 0 no QC, 1 good, 2 probably good, 3 probably bad, 4 bad, 9 missing.';

create index if not exists observations_recorded_at_idx on public.observations (recorded_at);
create index if not exists observations_voyage_recorded_idx on public.observations (voyage_id, recorded_at);
create index if not exists observations_published_idx on public.observations (is_published) where is_published;

-- ---------------------------------------------------------------------------
-- Measurements (one row per parameter measured at a point)
-- ---------------------------------------------------------------------------

create table if not exists public.observation_measurements (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.observations (id) on delete cascade,
  parameter_code text not null references public.observation_parameters (code) on update cascade on delete restrict,
  value numeric,
  value_text text,
  qc_flag smallint not null default 0,
  constraint observation_measurements_unique unique (observation_id, parameter_code),
  constraint observation_measurements_qc_flag_check check (qc_flag in (0, 1, 2, 3, 4, 9)),
  constraint observation_measurements_value_check check (value is not null or value_text is not null)
);
comment on table public.observation_measurements is
  'A single reading: parameter + value + its own QC flag. Unit and scale come from observation_parameters, never duplicated here.';

create index if not exists observation_measurements_observation_idx on public.observation_measurements (observation_id);
create index if not exists observation_measurements_parameter_idx on public.observation_measurements (parameter_code);

-- ---------------------------------------------------------------------------
-- Voyage attribution from the timestamp
-- ---------------------------------------------------------------------------

create or replace function public.resolve_voyage_for_timestamp(ts timestamptz)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with windows as (
    select
      v.id,
      case
        when nullif(v.start_date, '') is not null
          then ((v.start_date::date + coalesce(nullif(v.start_time, ''), '00:00')::time) at time zone 'Europe/Rome')
      end as starts_at,
      case
        when nullif(v.end_date, '') is not null
          then ((v.end_date::date + coalesce(nullif(v.end_time, ''), '23:59')::time) at time zone 'Europe/Rome')
      end as ends_at
    from public.voyages v
    where v.type = 'water'
  )
  select coalesce(
    -- Primary: the voyage whose date window contains the timestamp.
    (
      select w.id
      from windows w
      where w.starts_at is not null
        and w.ends_at is not null
        and ts between w.starts_at and w.ends_at
      order by w.starts_at desc
      limit 1
    ),
    -- Fallback: only one water voyage is ever under way at a time, so an unambiguous
    -- 'active' voyage attributes points that arrive before the dates are finalised.
    (
      select v.id
      from public.voyages v
      where v.type = 'water'
        and v.status = 'active'
        and (select count(*) from public.voyages a where a.type = 'water' and a.status = 'active') = 1
      limit 1
    )
  );
$$;
comment on function public.resolve_voyage_for_timestamp(timestamptz) is
  'Maps an observation timestamp to a water voyage: first by date window (Europe/Rome, matching the booking helpers), then by the single active voyage. Returns null when ambiguous.';

create or replace function public.observations_set_voyage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.voyage_id is null then
    new.voyage_id := public.resolve_voyage_for_timestamp(new.recorded_at);
  end if;
  return new;
end;
$$;

drop trigger if exists observations_set_voyage_trg on public.observations;
create trigger observations_set_voyage_trg
  before insert or update of recorded_at, voyage_id on public.observations
  for each row
  execute function public.observations_set_voyage();

-- Voyage dates get corrected fairly often in this project; this re-runs attribution over
-- points that were never attributed or whose voyage window has since moved.
create or replace function public.reattribute_observation_voyages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  with resolved as (
    select o.id, public.resolve_voyage_for_timestamp(o.recorded_at) as voyage_id
    from public.observations o
  )
  update public.observations o
  set voyage_id = r.voyage_id
  from resolved r
  where o.id = r.id
    and o.voyage_id is distinct from r.voyage_id;
  get diagnostics touched = row_count;
  return touched;
end;
$$;
comment on function public.reattribute_observation_voyages() is
  'Recomputes voyage attribution for every observation. Run after editing voyage dates. Returns the number of rows changed.';

revoke all on function public.reattribute_observation_voyages() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Map view: one row per point, readings folded into a jsonb object
-- ---------------------------------------------------------------------------

create or replace view public.observations_map
with (security_invoker = on) as
select
  o.id,
  o.voyage_id,
  o.recorded_at,
  o.lat,
  o.lng,
  o.depth_m,
  o.gps_accuracy_m,
  o.source,
  o.qc_flag,
  o.notes,
  d.code as device_code,
  d.label as device_label,
  coalesce(
    jsonb_object_agg(
      m.parameter_code,
      jsonb_build_object('value', m.value, 'text', m.value_text, 'qc', m.qc_flag)
    ) filter (where m.parameter_code is not null),
    '{}'::jsonb
  ) as measurements
from public.observations o
left join public.observation_devices d on d.id = o.device_id
left join public.observation_measurements m on m.observation_id = o.id
where o.is_published
group by o.id, d.code, d.label;
comment on view public.observations_map is
  'Feed for the /Data map: one row per published point with its readings as jsonb, so the client can filter by parameter and colour by value without a second round trip.';

-- ---------------------------------------------------------------------------
-- Export view: wide, one column per parameter, rebuilt from the catalog
-- ---------------------------------------------------------------------------

create or replace function public.rebuild_observations_export_view()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  value_cols text;
  ddl text;
begin
  select coalesce(
    string_agg(
      case p.value_type
        when 'numeric' then format(
          'max(m.value) filter (where m.parameter_code = %1$L) as %2$I, '
          'max(m.qc_flag) filter (where m.parameter_code = %1$L) as %3$I',
          p.code, p.code || '_' || p.unit_code, p.code || '_' || p.unit_code || '_qc'
        )
        else format(
          'max(m.value_text) filter (where m.parameter_code = %1$L) as %2$I, '
          'max(m.qc_flag) filter (where m.parameter_code = %1$L) as %3$I',
          p.code, p.code, p.code || '_qc'
        )
      end,
      ', ' order by p.sort_order, p.code
    ),
    ''
  )
  into value_cols
  from public.observation_parameters p
  where p.is_published;

  ddl := format($view$
    create view public.observations_export
    with (security_invoker = on) as
    select
      o.id as observation_id,
      v.id as voyage_id,
      coalesce(v.name_en, v.name) as voyage_name,
      to_char(o.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as recorded_at_utc,
      o.lat as latitude_deg,
      o.lng as longitude_deg,
      o.depth_m as depth_m,
      o.gps_accuracy_m as gps_accuracy_m,
      d.code as device_code,
      o.source as source,
      o.qc_flag as position_qc,
      o.notes as notes%1$s
    from public.observations o
    left join public.voyages v on v.id = o.voyage_id
    left join public.observation_devices d on d.id = o.device_id
    left join public.observation_measurements m on m.observation_id = o.id
    where o.is_published
    group by o.id, v.id, d.code
  $view$, case when value_cols = '' then '' else ', ' || value_cols end);

  execute 'drop view if exists public.observations_export';
  execute ddl;
  execute 'grant select on public.observations_export to anon, authenticated';
  execute $c$comment on view public.observations_export is
    'Analysis-ready export: one row per sampling point, one column per published parameter (named <code>_<unit>, each followed by its IODE QC flag), timestamps as ISO 8601 UTC. Rebuilt automatically whenever observation_parameters changes.'$c$;
end;
$$;
comment on function public.rebuild_observations_export_view() is
  'Regenerates public.observations_export from the parameter catalog. Called by trigger; safe to call manually.';

revoke all on function public.rebuild_observations_export_view() from public, anon, authenticated;

create or replace function public.observation_parameters_rebuild_export()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rebuild_observations_export_view();
  return null;
end;
$$;

drop trigger if exists observation_parameters_rebuild_export_trg on public.observation_parameters;
create trigger observation_parameters_rebuild_export_trg
  after insert or update or delete on public.observation_parameters
  for each statement
  execute function public.observation_parameters_rebuild_export();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.observation_parameters enable row level security;
alter table public.observation_devices enable row level security;
alter table public.observation_device_keys enable row level security;
alter table public.observations enable row level security;
alter table public.observation_measurements enable row level security;

grant select on public.observation_parameters to anon, authenticated;
grant select on public.observation_devices to anon, authenticated;
grant select on public.observations to anon, authenticated;
grant select on public.observation_measurements to anon, authenticated;
grant select on public.observations_map to anon, authenticated;

drop policy if exists "Observation parameters are publicly readable" on public.observation_parameters;
create policy "Observation parameters are publicly readable"
  on public.observation_parameters
  for select
  using (is_published);

drop policy if exists "Admins manage observation parameters" on public.observation_parameters;
create policy "Admins manage observation parameters"
  on public.observation_parameters
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Observation devices are publicly readable" on public.observation_devices;
create policy "Observation devices are publicly readable"
  on public.observation_devices
  for select
  using (true);

drop policy if exists "Admins manage observation devices" on public.observation_devices;
create policy "Admins manage observation devices"
  on public.observation_devices
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- No policy on observation_device_keys: service_role bypasses RLS, everyone else is denied.

drop policy if exists "Published observations are publicly readable" on public.observations;
create policy "Published observations are publicly readable"
  on public.observations
  for select
  using (is_published);

drop policy if exists "Admins manage observations" on public.observations;
create policy "Admins manage observations"
  on public.observations
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Measurements of published observations are readable" on public.observation_measurements;
create policy "Measurements of published observations are readable"
  on public.observation_measurements
  for select
  using (
    exists (
      select 1
      from public.observations o
      where o.id = observation_measurements.observation_id
        and o.is_published
    )
  );

drop policy if exists "Admins manage observation measurements" on public.observation_measurements;
create policy "Admins manage observation measurements"
  on public.observation_measurements
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Catalog seed: the sensors described on /Data/sensors, plus the water-column
-- variables the onboard probe will add.
-- ---------------------------------------------------------------------------

insert into public.observation_parameters
  (code, unit_code, label_en, label_it, unit, value_type, scale_min, scale_max, color_ramp, sort_order, accuracy, description_en, description_it)
values
  ('sst', 'degc', 'Sea surface temperature', 'Temperatura superficiale del mare', '°C', 'numeric', 10, 30, 'thermal', 10, '±0.2 °C',
   'Water temperature at hull depth, roughly 0.3–0.5 m below the waterline. Not a true skin SST.',
   'Temperatura dell''acqua alla profondità dello scafo, circa 0,3–0,5 m sotto la linea di galleggiamento. Non è una vera SST superficiale.'),
  ('air_temp', 'degc', 'Air temperature', 'Temperatura dell''aria', '°C', 'numeric', 0, 40, 'thermal', 20, '±0.3 °C',
   'Ambient air temperature from a shielded sensor on deck.',
   'Temperatura dell''aria ambiente da sensore schermato in coperta.'),
  ('humidity', 'pct', 'Relative humidity', 'Umidità relativa', '% RH', 'numeric', 30, 100, 'haline', 30, '±3 % RH',
   'Moisture content of the air at the measurement location.',
   'Contenuto di umidità dell''aria nel punto di misura.'),
  ('pressure', 'hpa', 'Barometric pressure', 'Pressione barometrica', 'hPa', 'numeric', 980, 1040, 'viridis', 40, '±1 hPa',
   'Atmospheric pressure at sea level.',
   'Pressione atmosferica al livello del mare.'),
  ('wind_speed', 'kt', 'Wind speed', 'Velocità del vento', 'kt', 'numeric', 0, 40, 'viridis', 50, '±5 %',
   'True wind speed, derived from masthead apparent wind and GPS course over ground.',
   'Velocità del vento reale, derivata dal vento apparente in testa d''albero e dalla rotta GPS.'),
  ('wind_direction', 'deg', 'Wind direction', 'Direzione del vento', '°', 'numeric', 0, 360, 'cyclic', 60, '±5°',
   'True wind direction in degrees clockwise from north.',
   'Direzione del vento reale, in gradi orari da nord.'),
  ('dissolved_oxygen', 'mgl', 'Dissolved oxygen', 'Ossigeno disciolto', 'mg/L', 'numeric', 4, 12, 'haline', 70, '±0.2 mg/L',
   'Oxygen concentration in surface water, an indicator of water column health.',
   'Concentrazione di ossigeno nell''acqua superficiale, indicatore di salute della colonna d''acqua.'),
  ('salinity', 'psu', 'Salinity', 'Salinità', 'PSU', 'numeric', 33, 40, 'haline', 80, '±0.1 PSU',
   'Practical salinity of surface water, derived from conductivity and temperature.',
   'Salinità pratica dell''acqua superficiale, derivata da conducibilità e temperatura.'),
  ('plankton_density', 'indm3', 'Plankton density', 'Densità di plancton', 'ind/m³', 'numeric', 0, 5000, 'viridis', 90, 'Net tow, ±20 %',
   'Plankton individuals per cubic metre from a towed net sample, counted after the voyage.',
   'Individui di plancton per metro cubo da campione con retino trainato, contati dopo il viaggio.'),
  ('sea_state', 'douglas', 'Sea state', 'Stato del mare', 'Douglas scale', 'categorical', null, null, 'viridis', 100, 'Crew observation',
   'Crew observation of sea state on the Douglas scale. Subjective and recorded at irregular intervals.',
   'Osservazione dell''equipaggio sullo stato del mare secondo la scala Douglas. Soggettiva e a intervalli irregolari.')
on conflict (code) do nothing;

-- The catalog trigger already built the view during the insert above, but a standing voyage
-- with an empty catalog would leave it missing; this makes the migration idempotent.
select public.rebuild_observations_export_view();
;
