do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_post_authors'
  ) then
    alter publication supabase_realtime add table public.community_post_authors;
  end if;
end $$;
