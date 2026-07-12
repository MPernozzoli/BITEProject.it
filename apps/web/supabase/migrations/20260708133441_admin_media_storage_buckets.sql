-- Media buckets used by the public site and admin media console.
-- `homepage-media` powers the video/image hero on the home page.
-- `logbook-media` is used by article, profile, newsletter and waypoint media.

insert into storage.buckets (id, name, public)
values
  ('homepage-media', 'homepage-media', true),
  ('logbook-media', 'logbook-media', true)
on conflict (id) do update
set public = excluded.public;
-- Public read/list for media that is intentionally rendered through public URLs.
drop policy if exists "Public read homepage-media" on storage.objects;
create policy "Public read homepage-media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'homepage-media');
drop policy if exists "Public read logbook-media" on storage.objects;
create policy "Public read logbook-media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'logbook-media');
-- Admin CRUD for both public media buckets.
drop policy if exists "Admin insert homepage-media" on storage.objects;
create policy "Admin insert homepage-media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'homepage-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
drop policy if exists "Admin update homepage-media" on storage.objects;
create policy "Admin update homepage-media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'homepage-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    bucket_id = 'homepage-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
drop policy if exists "Admin delete homepage-media" on storage.objects;
create policy "Admin delete homepage-media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'homepage-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
drop policy if exists "Admin insert logbook-media" on storage.objects;
create policy "Admin insert logbook-media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'logbook-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
drop policy if exists "Admin update logbook-media" on storage.objects;
create policy "Admin update logbook-media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'logbook-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    bucket_id = 'logbook-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
drop policy if exists "Admin delete logbook-media" on storage.objects;
create policy "Admin delete logbook-media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'logbook-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
