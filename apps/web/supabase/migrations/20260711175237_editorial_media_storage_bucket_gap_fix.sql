-- Missing piece of 20260417120000_editorial_channels_and_social.sql: the editorial-media
-- storage bucket and its admin-only policies were never created on remote, but
-- AdminEditorialPlanSlotDialog.tsx actively uploads to this bucket.

insert into storage.buckets (id, name, public)
values ('editorial-media', 'editorial-media', false)
on conflict (id) do nothing;

drop policy if exists "Admin read editorial-media" on storage.objects;
create policy "Admin read editorial-media"
  on storage.objects for select to authenticated
  using (bucket_id = 'editorial-media' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admin insert editorial-media" on storage.objects;
create policy "Admin insert editorial-media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'editorial-media' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admin update editorial-media" on storage.objects;
create policy "Admin update editorial-media"
  on storage.objects for update to authenticated
  using (bucket_id = 'editorial-media' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admin delete editorial-media" on storage.objects;
create policy "Admin delete editorial-media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'editorial-media' and public.has_role(auth.uid(), 'admin'));
;
