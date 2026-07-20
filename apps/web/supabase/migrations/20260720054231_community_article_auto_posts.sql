create table public.community_post_authors (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index community_post_authors_profile_idx
  on public.community_post_authors(profile_id, author_order);

create unique index community_posts_source_article_unique
  on public.community_posts ((metadata->>'source_article_id'))
  where metadata ? 'source_article_id';

insert into public.community_post_authors (post_id, profile_id, author_order)
select id, author_profile_id, 0
from public.community_posts
on conflict (post_id, profile_id) do nothing;

alter table public.community_post_authors enable row level security;

create policy "Readable community post authors"
  on public.community_post_authors for select
  to anon, authenticated
  using (
    public.can_read_community_post(post_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Post owners insert community post authors"
  on public.community_post_authors for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.author_profile_id = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Post owners update community post authors"
  on public.community_post_authors for update
  to authenticated
  using (
    exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.author_profile_id = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.author_profile_id = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "Post owners delete community post authors"
  on public.community_post_authors for delete
  to authenticated
  using (
    exists (
      select 1
      from public.community_posts p
      where p.id = post_id
        and p.author_profile_id = (select auth.uid())
        and public.has_active_membership((select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

grant select on public.community_post_authors to anon, authenticated;
grant insert, update, delete on public.community_post_authors to authenticated;
