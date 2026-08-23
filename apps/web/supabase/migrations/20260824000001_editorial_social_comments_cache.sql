-- Cache for social media comments fetched from platform APIs.
-- Used by the /admin/comments page.

create table if not exists public.social_comments_cache (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels(id) on delete cascade,
  platform_comment_id text not null,
  platform_media_id text,
  platform_media_permalink text,
  author_name text,
  author_avatar_url text,
  text text,
  timestamp timestamptz,
  reply_count integer default 0,
  hidden boolean default false,
  local_status text not null default 'new'
    check (local_status in ('new', 'replied', 'hidden', 'dismissed')),
  local_reply text,
  last_synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique(channel_id, platform_comment_id)
);

create index if not exists social_comments_cache_channel_status_idx
  on public.social_comments_cache (channel_id, local_status, timestamp desc);

create index if not exists social_comments_cache_channel_media_idx
  on public.social_comments_cache (channel_id, platform_media_id);

comment on table public.social_comments_cache is
  'Cached social media comments with local status tracking for the admin comments page.';

grant select, insert, update, delete on public.social_comments_cache to authenticated;

create policy "Admins manage social_comments_cache"
  on public.social_comments_cache for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
