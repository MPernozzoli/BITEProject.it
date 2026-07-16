-- Photo points on the public logbook map.
--
-- Deliberately NOT voyage_waypoints: those rows drive the bookable legs, the route
-- geometry and sort_order (see the leg sync triggers in 20260712122816). A photo dropped
-- into that table would silently reshape the booking plan. This is a separate layer that
-- reads voyages but never feeds back into them.
--
-- The image itself lives in the existing `logbook-media` bucket under `logbook-points/`;
-- that bucket is public, so a known object URL renders for anonymous visitors while the
-- anon listing policy stays revoked (20260712012655).

create table if not exists public.logbook_photo_points (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid references public.voyages (id) on delete set null,
  -- When true the trigger stops recomputing voyage_id: the admin has made the call,
  -- including the call that this photo belongs to no voyage at all.
  voyage_is_manual boolean not null default false,
  taken_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  -- 'exif' = coordinates read from the photo, 'manual' = pinned by hand on the map.
  -- Kept because it is the difference between a real fix and someone's best guess.
  coordinates_source text not null default 'exif',
  title_it text not null,
  title_en text not null,
  description_it text,
  description_en text,
  storage_path text not null unique,
  width integer,
  height integer,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles (id) on delete set null,
  constraint logbook_photo_points_lat_check check (lat between -90 and 90),
  constraint logbook_photo_points_lng_check check (lng between -180 and 180),
  constraint logbook_photo_points_coordinates_source_check
    check (coordinates_source in ('exif', 'manual')),
  constraint logbook_photo_points_title_it_check check (length(btrim(title_it)) > 0),
  constraint logbook_photo_points_title_en_check check (length(btrim(title_en)) > 0)
);

comment on table public.logbook_photo_points is
  'Photo markers on the public logbook map. Coordinates and timestamp come from the photo EXIF when present, otherwise pinned by hand. Separate from voyage_waypoints on purpose: those drive booking legs.';
comment on column public.logbook_photo_points.voyage_id is
  'Resolved from taken_at by resolve_voyage_for_timestamp() unless voyage_is_manual. Nullable: a photo outside every voyage window stays unattributed rather than being forced onto the wrong voyage.';
comment on column public.logbook_photo_points.voyage_is_manual is
  'Admin override. Once set, automatic re-attribution leaves this row alone.';
comment on column public.logbook_photo_points.coordinates_source is
  'exif = GPS fix read from the file, manual = pinned on the map because the photo carried no geotag.';
comment on column public.logbook_photo_points.taken_at is
  'Capture instant. Preferred source is the EXIF GPS timestamp (already UTC); DateTimeOriginal is used as a fallback.';
comment on column public.logbook_photo_points.storage_path is
  'Object path inside the logbook-media bucket. Unique, so the same upload cannot yield two points.';

create index if not exists logbook_photo_points_voyage_idx
  on public.logbook_photo_points (voyage_id);
create index if not exists logbook_photo_points_taken_at_idx
  on public.logbook_photo_points (taken_at);
create index if not exists logbook_photo_points_published_idx
  on public.logbook_photo_points (is_published)
  where is_published;

-- ---------------------------------------------------------------------------
-- Voyage attribution, reusing the citizen-science resolver
-- ---------------------------------------------------------------------------

create or replace function public.logbook_photo_points_set_voyage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- resolve_voyage_for_timestamp is revoked from authenticated, so this definer trigger is
  -- the only way the admin client gets attribution on write.
  if not new.voyage_is_manual then
    new.voyage_id := public.resolve_voyage_for_timestamp(new.taken_at);
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.logbook_photo_points_set_voyage() from public, anon, authenticated;

drop trigger if exists logbook_photo_points_set_voyage_trg on public.logbook_photo_points;
create trigger logbook_photo_points_set_voyage_trg
  before insert or update of taken_at, voyage_id, voyage_is_manual
  on public.logbook_photo_points
  for each row
  execute function public.logbook_photo_points_set_voyage();

-- Lets the admin form show the matched voyage before saving, and offer the override
-- against something real. Mirrors the revoke on the underlying resolver by gating on role
-- rather than exposing it wholesale.
create or replace function public.resolve_voyage_for_photo(taken_at timestamptz)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'forbidden';
  end if;
  return public.resolve_voyage_for_timestamp(taken_at);
end;
$$;

comment on function public.resolve_voyage_for_photo(timestamptz) is
  'Admin-only preview of the voyage a photo timestamp would be attributed to, so the editor can confirm or override before saving.';

revoke all on function public.resolve_voyage_for_photo(timestamptz) from public, anon;
grant execute on function public.resolve_voyage_for_photo(timestamptz) to authenticated;

-- Voyage dates get corrected fairly often here; this re-runs attribution over the rows
-- that were never manually pinned. Same shape as reattribute_observation_voyages().
create or replace function public.reattribute_logbook_photo_voyages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  with resolved as (
    select p.id, public.resolve_voyage_for_timestamp(p.taken_at) as voyage_id
    from public.logbook_photo_points p
    where not p.voyage_is_manual
  )
  update public.logbook_photo_points p
  set voyage_id = r.voyage_id
  from resolved r
  where p.id = r.id
    and p.voyage_id is distinct from r.voyage_id;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.reattribute_logbook_photo_voyages() is
  'Recomputes voyage attribution for every non-overridden photo point. Run after editing voyage dates. Returns the number of rows changed.';

revoke all on function public.reattribute_logbook_photo_voyages() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.logbook_photo_points enable row level security;

grant select on public.logbook_photo_points to anon, authenticated;
grant insert, update, delete on public.logbook_photo_points to authenticated;

drop policy if exists "Published logbook photo points are publicly readable"
  on public.logbook_photo_points;
create policy "Published logbook photo points are publicly readable"
  on public.logbook_photo_points
  for select
  using (is_published);

drop policy if exists "Admins read every logbook photo point" on public.logbook_photo_points;
create policy "Admins read every logbook photo point"
  on public.logbook_photo_points
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Admins manage logbook photo points" on public.logbook_photo_points;
create policy "Admins manage logbook photo points"
  on public.logbook_photo_points
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));
