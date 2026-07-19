create table public.community_channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  icon text not null default '#',
  visibility public.community_post_visibility not null default 'members',
  min_tier_id uuid references public.membership_tiers(id) on delete set null,
  channel_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_channels_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint community_channels_tier_visibility_has_tier
    check (visibility <> 'tier' or min_tier_id is not null)
);

alter table public.community_posts
  add column if not exists channel_id uuid references public.community_channels(id) on delete set null,
  add column if not exists post_type text not null default 'text'
    check (post_type in ('text', 'media', 'poll', 'live', 'link')),
  add column if not exists media_urls jsonb not null default '[]'::jsonb,
  add column if not exists external_url text;

create index community_channels_order_idx on public.community_channels(is_active, channel_order, name);
create index community_posts_channel_published_idx on public.community_posts(channel_id, status, published_at desc);

create trigger community_channels_touch_updated_at
  before update on public.community_channels
  for each row execute function public.touch_updated_at();

insert into public.community_channels (slug, name, description, icon, visibility, channel_order)
values
  ('main', 'Main deck', 'Feed principale della community.', '#', 'members', 0),
  ('boat-tips', 'Boat tips', 'Consigli pratici su barca, navigazione, manutenzione e vita a bordo.', 'anchor', 'members', 10),
  ('ricette', 'Ricette', 'Cucina di bordo, cambusa, idee veloci e pasti da traversata.', 'pot', 'members', 20)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  visibility = excluded.visibility,
  channel_order = excluded.channel_order;

update public.community_posts
set channel_id = (select id from public.community_channels where slug = 'main')
where channel_id is null;

create or replace function public.can_read_community_channel(_channel_id uuid, _profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.community_channels c
    left join public.membership_tiers min_tier on min_tier.id = c.min_tier_id
    where c.id = _channel_id
      and c.is_active
      and (
        c.visibility = 'public'
        or (
          _profile_id is not null
          and public.active_membership_tier_order(_profile_id) is not null
          and (
            c.visibility = 'members'
            or (
              c.visibility = 'tier'
              and public.active_membership_tier_order(_profile_id) >= coalesce(min_tier.tier_order, 2147483647)
            )
          )
        )
      )
  );
$$;

create or replace function public.can_read_community_post(_post_id uuid, _profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.community_posts p
    left join public.membership_tiers min_tier on min_tier.id = p.min_tier_id
    where p.id = _post_id
      and p.status = 'published'
      and (
        p.channel_id is null
        or public.can_read_community_channel(p.channel_id, _profile_id)
        or public.has_role(_profile_id, 'admin'::public.app_role)
      )
      and (
        p.visibility = 'public'
        or (
          _profile_id is not null
          and public.active_membership_tier_order(_profile_id) is not null
          and (
            p.visibility = 'members'
            or (
              p.visibility = 'tier'
              and public.active_membership_tier_order(_profile_id) >= coalesce(min_tier.tier_order, 2147483647)
            )
          )
        )
        or public.has_role(_profile_id, 'admin'::public.app_role)
      )
  );
$$;

alter table public.community_channels enable row level security;

create policy "Readable community channels"
  on public.community_channels for select
  to anon, authenticated
  using (
    is_active
    and (
      visibility = 'public'
      or public.can_read_community_channel(id, (select auth.uid()))
      or public.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );

create policy "Admins insert community channels"
  on public.community_channels for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins update community channels"
  on public.community_channels for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Admins delete community channels"
  on public.community_channels for delete
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

create policy "Active members insert own community posts"
  on public.community_posts for insert
  to authenticated
  with check (
    author_profile_id = (select auth.uid())
    and status = 'published'
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
    and (
      channel_id is null
      or public.can_read_community_channel(channel_id, (select auth.uid()))
    )
  );

create policy "Active members update own community posts"
  on public.community_posts for update
  to authenticated
  using (
    author_profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  )
  with check (
    author_profile_id = (select auth.uid())
    and status = 'published'
    and visibility in ('members', 'tier')
    and public.has_active_membership((select auth.uid()))
    and (
      channel_id is null
      or public.can_read_community_channel(channel_id, (select auth.uid()))
    )
  );

create policy "Active members delete own community posts"
  on public.community_posts for delete
  to authenticated
  using (
    author_profile_id = (select auth.uid())
    and public.has_active_membership((select auth.uid()))
  );

grant select on public.community_channels to anon, authenticated;
grant insert, update, delete on public.community_channels to authenticated;

alter publication supabase_realtime add table public.community_channels;
