alter table public.community_live_events
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists community_live_events_created_by_idx
  on public.community_live_events(created_by, starts_at desc);

update public.community_live_events
set created_by = p.author_profile_id
from public.community_posts p
where community_live_events.post_id = p.id
  and community_live_events.created_by is null;

drop policy if exists "Active members insert own community polls" on public.community_polls;
create policy "Active members insert own community polls"
  on public.community_polls for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and is_published = true
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
    and (
      post_id is null
      or exists (
        select 1
        from public.community_posts p
        where p.id = post_id
          and p.author_profile_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Active members update own community polls" on public.community_polls;
create policy "Active members update own community polls"
  on public.community_polls for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  )
  with check (
    created_by = (select auth.uid())
    and is_published = true
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
  );

drop policy if exists "Active members delete own community polls" on public.community_polls;
create policy "Active members delete own community polls"
  on public.community_polls for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  );

drop policy if exists "Active members insert options for own polls" on public.community_poll_options;
create policy "Active members insert options for own polls"
  on public.community_poll_options for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.community_polls p
      where p.id = poll_id
        and p.created_by = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
  );

drop policy if exists "Active members update options for own polls" on public.community_poll_options;
create policy "Active members update options for own polls"
  on public.community_poll_options for update
  to authenticated
  using (
    exists (
      select 1
      from public.community_polls p
      where p.id = poll_id
        and p.created_by = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from public.community_polls p
      where p.id = poll_id
        and p.created_by = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
  );

drop policy if exists "Active members delete options for own polls" on public.community_poll_options;
create policy "Active members delete options for own polls"
  on public.community_poll_options for delete
  to authenticated
  using (
    exists (
      select 1
      from public.community_polls p
      where p.id = poll_id
        and p.created_by = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
  );

drop policy if exists "Active members insert own community live events" on public.community_live_events;
create policy "Active members insert own community live events"
  on public.community_live_events for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
    and (
      post_id is null
      or exists (
        select 1
        from public.community_posts p
        where p.id = post_id
          and p.author_profile_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Active members update own community live events" on public.community_live_events;
create policy "Active members update own community live events"
  on public.community_live_events for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  )
  with check (
    created_by = (select auth.uid())
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
  );

drop policy if exists "Active members delete own community live events" on public.community_live_events;
create policy "Active members delete own community live events"
  on public.community_live_events for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  );
