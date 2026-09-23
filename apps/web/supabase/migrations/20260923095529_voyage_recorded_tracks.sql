-- Tracciati reali dei viaggi (GPX del plotter / telefono di bordo).
--
-- Design: docs/voyage-track-import-and-memento-plan.md (parte A) e
-- Wiki/29 - Tracciati Reali GPX.md.
--
-- Regola non negoziabile: il tracciato è un record DOCUMENTALE e non tocca la
-- programmazione. Niente scritture su voyage_waypoints.actual_*, niente
-- apply_voyage_schedule, niente plan change, niente email. Vive solo qui.
--
-- Modello:
--   voyage_tracks          un file caricato (originale intoccato nel bucket
--                          privato `voyage-tracks`, così un filtro migliore in
--                          futuro ri-deriva tutto senza richiedere l'export).
--   voyage_track_segments  il risultato riconciliato: un intervallo di tempo
--                          del tracciato assegnato a una tratta. Un tracciato
--                          può coprire più tratte (N segmenti) e una tratta può
--                          essere coperta da più tracciati (registrazione
--                          interrotta e ripresa): la granularità è il segmento.
--
-- I tagli sono salvati come timestamp (started_at/ended_at), che sono
-- l'autorità: gli indici di punto sono solo una cache dell'editor e cambiano se
-- cambia la pulizia del tracciato.

create table if not exists public.voyage_tracks (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_sha256 text not null,
  file_size_bytes integer,
  source_creator text,
  source_name text,
  started_at timestamptz,
  ended_at timestamptz,
  point_count integer not null default 0,
  -- Cosa porta il file: {time, elevation, speed, speedUnit, course, hdop, sat, extras[], timezone, source}
  capabilities jsonb not null default '{}'::jsonb,
  -- Esito della pulizia: {inputPoints, keptPoints, droppedDuplicates, droppedSpikes, breaks, breakSeconds}
  quality jsonb not null default '{}'::jsonb,
  -- Metriche dell'intero file, per l'elenco admin.
  stats jsonb not null default '{}'::jsonb,
  -- Geometria semplificata dell'intero file, per l'anteprima admin.
  geometry jsonb,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'archived')),
  notes text,
  imported_by uuid default auth.uid(),
  confirmed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (voyage_id, file_sha256)
);

comment on table public.voyage_tracks is
  'Tracciati GPX registrati durante un viaggio. Documentali: non influenzano mai la programmazione (actual, finestre, prenotabilità, notifiche).';

create index if not exists voyage_tracks_voyage_idx on public.voyage_tracks (voyage_id, started_at);

create table if not exists public.voyage_track_segments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.voyage_tracks(id) on delete cascade,
  voyage_id uuid not null references public.voyages(id) on delete cascade,
  -- Tratta prenotabile coperta; null per i viaggi storici senza tratte, dove
  -- l'identità è la coppia di tappe.
  leg_id uuid references public.voyage_bookable_legs(id) on delete set null,
  from_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  to_waypoint_id uuid references public.voyage_waypoints(id) on delete set null,
  sort_order integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  start_point_index integer,
  end_point_index integer,
  distance_nm numeric(8, 2),
  bridged_nm numeric(8, 2),
  elapsed_seconds integer,
  moving_seconds integer,
  stopped_seconds integer,
  avg_sog_kn numeric(5, 2),
  max_sog_kn numeric(5, 2),
  -- Distanza fra il primo/ultimo punto registrato e la tappa prevista: > 0
  -- quando la registrazione è partita dopo la partenza o si è fermata prima.
  start_gap_nm numeric(7, 2),
  end_gap_nm numeric(7, 2),
  match_confidence text not null default 'manual'
    check (match_confidence in ('high', 'medium', 'low', 'manual')),
  -- Soste dentro la tratta: [{startedAt, endedAt, durationSec, lat, lng, waypointId, name}]
  stops jsonb not null default '[]'::jsonb,
  -- Statistiche dei canali extra del file (profondità, temperatura…): {key: {min, avg, max}}
  extras jsonb not null default '{}'::jsonb,
  -- {c: [[lng,lat]...], t: [epoch s], s: [kn], b: [indici di interruzione]}
  geometry jsonb not null default '{}'::jsonb,
  -- [{t: epoch s, s: kn}]
  speed_profile jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voyage_track_segments_time_order check (started_at is null or ended_at is null or started_at <= ended_at)
);

comment on table public.voyage_track_segments is
  'Porzione di un tracciato riconciliata con una tratta. Letta dal biglietto ricordo e dal confronto previsto/effettivo della pagina viaggio.';

create index if not exists voyage_track_segments_track_idx on public.voyage_track_segments (track_id, sort_order);
create index if not exists voyage_track_segments_voyage_idx on public.voyage_track_segments (voyage_id, started_at);
create index if not exists voyage_track_segments_leg_idx on public.voyage_track_segments (leg_id);

-- Coerenza: il segmento appartiene al viaggio del suo tracciato, e tratta/tappe
-- appartengono a quello stesso viaggio.
create or replace function public.validate_voyage_track_segment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.voyage_tracks t where t.id = new.track_id and t.voyage_id = new.voyage_id) then
    raise exception 'voyage_track_segments: voyage_id % does not match the track', new.voyage_id;
  end if;
  if new.leg_id is not null and not exists (
    select 1 from public.voyage_bookable_legs l where l.id = new.leg_id and l.voyage_id = new.voyage_id
  ) then
    raise exception 'voyage_track_segments: leg % is not part of voyage %', new.leg_id, new.voyage_id;
  end if;
  if exists (
    select 1 from public.voyage_waypoints w
    where w.id in (new.from_waypoint_id, new.to_waypoint_id) and w.voyage_id <> new.voyage_id
  ) then
    raise exception 'voyage_track_segments: waypoints must belong to voyage %', new.voyage_id;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_voyage_track_segment on public.voyage_track_segments;
create trigger validate_voyage_track_segment
  before insert or update on public.voyage_track_segments
  for each row execute function public.validate_voyage_track_segment();

drop trigger if exists touch_voyage_tracks_updated_at on public.voyage_tracks;
create trigger touch_voyage_tracks_updated_at
  before update on public.voyage_tracks
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_voyage_track_segments_updated_at on public.voyage_track_segments;
create trigger touch_voyage_track_segments_updated_at
  before update on public.voyage_track_segments
  for each row execute function public.touch_updated_at();

-- RLS ----------------------------------------------------------------------

alter table public.voyage_tracks enable row level security;
alter table public.voyage_track_segments enable row level security;

drop policy if exists "Admins manage voyage_tracks" on public.voyage_tracks;
create policy "Admins manage voyage_tracks"
  on public.voyage_tracks for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Admins manage voyage_track_segments" on public.voyage_track_segments;
create policy "Admins manage voyage_track_segments"
  on public.voyage_track_segments for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Il pubblico vede solo i segmenti di tracciati CONFERMATI di viaggi pubblicati:
-- una bozza in riconciliazione non deve mai arrivare su pagina o biglietto.
drop policy if exists "Confirmed track segments of published voyages are readable" on public.voyage_track_segments;
create policy "Confirmed track segments of published voyages are readable"
  on public.voyage_track_segments for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.voyage_tracks t
      join public.voyages v on v.id = t.voyage_id
      where t.id = voyage_track_segments.track_id
        and t.status = 'confirmed'
        and v.is_published = true
    )
  );

grant select on public.voyage_track_segments to anon, authenticated;
grant select, insert, update, delete on public.voyage_tracks to authenticated;
grant insert, update, delete on public.voyage_track_segments to authenticated;

-- Storage: file originali, privati, solo admin -----------------------------

insert into storage.buckets (id, name, public)
values ('voyage-tracks', 'voyage-tracks', false)
on conflict (id) do update set public = excluded.public;

-- Path convention: {voyage_id}/{sha256}.gpx
drop policy if exists "Admin manage voyage-tracks" on storage.objects;
create policy "Admin manage voyage-tracks"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'voyage-tracks' and public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (bucket_id = 'voyage-tracks' and public.has_role(auth.uid(), 'admin'::public.app_role));
