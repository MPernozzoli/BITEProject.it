-- Keep the homepage hero dynamic loader working, but stop exposing a full public listing of
-- every object in the homepage-media bucket.

drop policy if exists "Public read homepage-media" on storage.objects;

create policy "Public read homepage hero media"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'homepage-media'
    and name ~* '^hero-(horizontal|vertical)/.+\.(mp4|webm|m4v|mov|jpg|jpeg|png|webp|avif)$'
  );
