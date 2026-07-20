drop policy if exists "Admins insert community posts" on public.community_posts;
drop policy if exists "Admins update community posts" on public.community_posts;
drop policy if exists "Admins delete community posts" on public.community_posts;

drop policy if exists "Active members insert own community posts" on public.community_posts;
create policy "Active members insert own community posts"
  on public.community_posts for insert
  to authenticated
  with check (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    or (
      author_profile_id = (select auth.uid())
      and status = 'published'
      and visibility in ('members', 'tier')
      and public.has_active_membership((select auth.uid()))
      and (
        channel_id is null
        or public.can_read_community_channel(channel_id, (select auth.uid()))
      )
    )
  );

drop policy if exists "Active members update own community posts" on public.community_posts;
create policy "Active members update own community posts"
  on public.community_posts for update
  to authenticated
  using (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    or (
      author_profile_id = (select auth.uid())
      and public.has_active_membership((select auth.uid()))
    )
  )
  with check (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    or (
      author_profile_id = (select auth.uid())
      and status = 'published'
      and visibility in ('members', 'tier')
      and public.has_active_membership((select auth.uid()))
      and (
        channel_id is null
        or public.can_read_community_channel(channel_id, (select auth.uid()))
      )
    )
  );

drop policy if exists "Active members delete own community posts" on public.community_posts;
create policy "Active members delete own community posts"
  on public.community_posts for delete
  to authenticated
  using (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    or (
      author_profile_id = (select auth.uid())
      and public.has_active_membership((select auth.uid()))
    )
  );
