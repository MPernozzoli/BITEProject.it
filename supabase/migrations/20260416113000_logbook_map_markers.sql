create table if not exists public.logbook_map_markers (
  id text primary key,
  label_it text not null,
  label_en text not null,
  description_it text,
  description_en text,
  latitude double precision,
  longitude double precision,
  is_visible boolean not null default true,
  is_onboard boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint logbook_map_markers_id_check check (id in ('boat', 'crew')),
  constraint logbook_map_markers_coordinates_check check (
    (latitude is null and longitude is null)
    or (
      latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

comment on table public.logbook_map_markers is
  'Manual map markers for the public logbook map, currently used for boat and crew presence.';

comment on column public.logbook_map_markers.is_onboard is
  'Crew-only flag: when true the crew marker is hidden and the boat marker switches to the onboard variant.';

alter table public.logbook_map_markers enable row level security;

grant select on public.logbook_map_markers to anon, authenticated;
grant insert, update, delete on public.logbook_map_markers to authenticated;

drop policy if exists "Logbook map markers are publicly readable" on public.logbook_map_markers;
create policy "Logbook map markers are publicly readable"
  on public.logbook_map_markers
  for select
  using (true);

drop policy if exists "Admins manage logbook map markers" on public.logbook_map_markers;
create policy "Admins manage logbook map markers"
  on public.logbook_map_markers
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

insert into public.logbook_map_markers (
  id,
  label_it,
  label_en,
  description_it,
  description_en,
  is_visible,
  is_onboard
)
values
  (
    'boat',
    'Spritz',
    'Spritz',
    'Posizione manuale della barca sulla mappa del logbook.',
    'Manual boat position shown on the logbook map.',
    true,
    false
  ),
  (
    'crew',
    'Equipaggio',
    'Crew',
    'Posizione manuale dell''equipaggio quando non e a bordo.',
    'Manual crew position when not onboard.',
    true,
    false
  )
on conflict (id) do nothing;
