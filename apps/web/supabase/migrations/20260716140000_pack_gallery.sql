-- Pack gallery, moved off the hardcoded /photos/*.webp list into a managed bucket + table.
-- The public pack site renders strictly what this table returns, so the gallery can never
-- drift from the bucket. Cropping/rotation happens client-side before upload; the stored
-- object is already the final 4:5 frame the gallery shows.

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('pack-gallery', 'pack-gallery', true)
on conflict (id) do update set public = excluded.public;

-- The bucket is public, so known object URLs render for anyone without a SELECT policy.
-- We deliberately do NOT grant anon a broad SELECT (which would let clients enumerate the
-- whole bucket); only admins get listing/management access. Mirrors the logbook-media
-- hardening in 20260712012655.
drop policy if exists "Public read pack-gallery" on storage.objects;
drop policy if exists "Admin read pack-gallery" on storage.objects;
create policy "Admin read pack-gallery"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pack-gallery'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );

drop policy if exists "Admin insert pack-gallery" on storage.objects;
create policy "Admin insert pack-gallery"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pack-gallery'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );

drop policy if exists "Admin update pack-gallery" on storage.objects;
create policy "Admin update pack-gallery"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pack-gallery'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    bucket_id = 'pack-gallery'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );

drop policy if exists "Admin delete pack-gallery" on storage.objects;
create policy "Admin delete pack-gallery"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pack-gallery'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- ---------------------------------------------------------------------------
-- Gallery table
-- ---------------------------------------------------------------------------

create table if not exists public.pack_gallery_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  -- One of galleryCategories in apps/pack/src/data/site.ts. Free text so a new category
  -- does not need a migration; the pack UI maps known values to Italian labels.
  category text not null default 'Portraits',
  alt text not null default '',
  sort_order integer not null default 0,
  is_published boolean not null default true,
  width integer,
  height integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles (id) on delete set null
);

comment on table public.pack_gallery_photos is
  'The pack site gallery. The public site renders exactly these rows, so the gallery is always the bucket and nothing else. Images are pre-cropped to 4:5 before upload.';
comment on column public.pack_gallery_photos.storage_path is
  'Object path inside the pack-gallery bucket. Unique so one upload maps to one gallery entry.';

create index if not exists pack_gallery_photos_order_idx
  on public.pack_gallery_photos (sort_order, created_at);
create index if not exists pack_gallery_photos_published_idx
  on public.pack_gallery_photos (is_published)
  where is_published;

alter table public.pack_gallery_photos enable row level security;

grant select on public.pack_gallery_photos to anon, authenticated;
grant insert, update, delete on public.pack_gallery_photos to authenticated;

drop policy if exists "Published pack gallery photos are publicly readable"
  on public.pack_gallery_photos;
create policy "Published pack gallery photos are publicly readable"
  on public.pack_gallery_photos
  for select
  using (is_published);

drop policy if exists "Admins read every pack gallery photo" on public.pack_gallery_photos;
create policy "Admins read every pack gallery photo"
  on public.pack_gallery_photos
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Admins manage pack gallery photos" on public.pack_gallery_photos;
create policy "Admins manage pack gallery photos"
  on public.pack_gallery_photos
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));
