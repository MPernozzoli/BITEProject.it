-- Public buckets can serve known object URLs without allowing clients to list every object.
-- Keep admin listing/management for logbook-media, but remove anonymous object enumeration.

drop policy if exists "Public read logbook-media" on storage.objects;
drop policy if exists "Admin read logbook-media" on storage.objects;
create policy "Admin read logbook-media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'logbook-media'
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
