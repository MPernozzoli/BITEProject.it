-- Editorial channels (site + social), per-channel slots, media assets, publish targets, OAuth stub, storage bucket.

-- Fixed channel UUIDs (app constants must match src/lib/editorial-plan.ts)
-- site, youtube, tiktok, instagram_bite, instagram_dogs

create table if not exists public.editorial_plan_channels (
  id uuid primary key,
  code text not null unique,
  label text not null,
  timezone text not null default 'Europe/Rome',
  horizon_weeks integer not null default 8
    constraint editorial_plan_channels_horizon_check check (horizon_weeks >= 1 and horizon_weeks <= 52),
  weekly_count integer not null default 1
    constraint editorial_plan_channels_weekly_count_check check (weekly_count >= 1 and weekly_count <= 21),
  mix_pillar numeric(5, 2) not null default 15,
  mix_support numeric(5, 2) not null default 55,
  mix_utility numeric(5, 2) not null default 30,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint editorial_plan_channels_mix_sum_check check (
    abs((mix_pillar + mix_support + mix_utility) - 100) < 0.02
  )
);

comment on table public.editorial_plan_channels is
  'Per-channel editorial cadence and mix; replaces singleton settings for new codepaths.';

insert into public.editorial_plan_channels (id, code, label, timezone, horizon_weeks, weekly_count, mix_pillar, mix_support, mix_utility)
values
  ('11111111-1111-4111-8111-111111110001', 'site', 'Logbook (sito)', 'Europe/Rome', 8, 1, 15, 55, 30),
  ('11111111-1111-4111-8111-111111110002', 'youtube', 'YouTube', 'Europe/Rome', 8, 1, 15, 55, 30),
  ('11111111-1111-4111-8111-111111110003', 'tiktok', 'TikTok', 'Europe/Rome', 8, 1, 15, 55, 30),
  ('11111111-1111-4111-8111-111111110004', 'instagram_bite', 'Instagram BITE', 'Europe/Rome', 8, 1, 15, 55, 30),
  ('11111111-1111-4111-8111-111111110005', 'instagram_dogs', 'Instagram cani', 'Europe/Rome', 8, 1, 15, 55, 30)
on conflict (code) do nothing;

-- Migrate legacy singleton into site channel row
update public.editorial_plan_channels c
set
  timezone = coalesce(s.timezone, c.timezone),
  horizon_weeks = coalesce(s.horizon_weeks, c.horizon_weeks),
  weekly_count = coalesce(s.weekly_count, c.weekly_count),
  mix_pillar = coalesce(s.mix_pillar, c.mix_pillar),
  mix_support = coalesce(s.mix_support, c.mix_support),
  mix_utility = coalesce(s.mix_utility, c.mix_utility),
  updated_at = timezone('utc', now())
from public.editorial_plan_settings s
where c.code = 'site' and s.id = 'a0000000-0000-4000-8000-000000000001'::uuid;

-- Weekly slots: add channel_id + optional content_format from template
alter table public.editorial_plan_weekly_slots
  add column if not exists channel_id uuid references public.editorial_plan_channels (id) on delete restrict,
  add column if not exists content_format text;

update public.editorial_plan_weekly_slots
set channel_id = '11111111-1111-4111-8111-111111110001'::uuid
where channel_id is null;

alter table public.editorial_plan_weekly_slots
  alter column channel_id set not null;

create unique index if not exists editorial_plan_weekly_slots_channel_dow_time_sort_idx
  on public.editorial_plan_weekly_slots (channel_id, day_of_week, time_of_day, sort_order);

-- Slots: add channel_id, format, counts_toward_mix; replace global unique
alter table public.editorial_plan_slots
  add column if not exists channel_id uuid references public.editorial_plan_channels (id) on delete restrict,
  add column if not exists content_format text,
  add column if not exists counts_toward_mix boolean not null default true;

update public.editorial_plan_slots
set
  channel_id = '11111111-1111-4111-8111-111111110001'::uuid,
  counts_toward_mix = case
    when content_format = 'ig_story' then false
    else coalesce(counts_toward_mix, true)
  end
where channel_id is null;

alter table public.editorial_plan_slots
  alter column channel_id set not null;

alter table public.editorial_plan_slots
  drop constraint if exists editorial_plan_slots_date_time_unique;

create unique index if not exists editorial_plan_slots_channel_date_time_uidx
  on public.editorial_plan_slots (channel_id, slot_date, slot_time);

-- Media assets (shared video/photo)
create table if not exists public.editorial_media_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  synopsis text,
  storage_main_path text,
  editorial_type public.article_editorial_type,
  status text not null default 'draft'
    constraint editorial_media_assets_status_check check (status in ('draft', 'ready')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.editorial_media_assets is
  'Reusable media for social; one asset, many publish_targets.';

-- Publish targets (one row per platform/format/time)
create table if not exists public.editorial_publish_targets (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.editorial_media_assets (id) on delete set null,
  channel_id uuid not null references public.editorial_plan_channels (id) on delete cascade,
  editorial_plan_slot_id uuid references public.editorial_plan_slots (id) on delete set null,
  publish_at timestamptz,
  content_format text not null,
  caption text,
  title_override text,
  syndication_batch_id uuid,
  status text not null default 'pending'
    constraint editorial_publish_targets_status_check check (status in ('pending', 'publishing', 'published', 'failed', 'cancelled')),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint editorial_publish_targets_slot_or_time check (
    editorial_plan_slot_id is not null or publish_at is not null
  )
);

create index if not exists editorial_publish_targets_slot_idx on public.editorial_publish_targets (editorial_plan_slot_id);
create index if not exists editorial_publish_targets_publish_at_idx on public.editorial_publish_targets (publish_at);
create index if not exists editorial_publish_targets_batch_idx on public.editorial_publish_targets (syndication_batch_id);

comment on table public.editorial_publish_targets is
  'Per-platform publish event; same asset_id for cross-post; syndication_batch_id groups simultaneous publishes.';

-- OAuth connections (one row per channel that needs its own token)
create table if not exists public.social_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels (id) on delete cascade,
  provider text not null,
  account_label text,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_oauth_connections_channel_unique unique (channel_id)
);

comment on table public.social_oauth_connections is
  'OAuth tokens per editorial channel; fill via Edge Function callback (admin-only).';

-- RLS
alter table public.editorial_plan_channels enable row level security;
alter table public.editorial_media_assets enable row level security;
alter table public.editorial_publish_targets enable row level security;
alter table public.social_oauth_connections enable row level security;

grant select, insert, update, delete on public.editorial_plan_channels to authenticated;
grant select, insert, update, delete on public.editorial_media_assets to authenticated;
grant select, insert, update, delete on public.editorial_publish_targets to authenticated;
grant select, insert, update, delete on public.social_oauth_connections to authenticated;

drop policy if exists "Admins manage editorial_plan_channels" on public.editorial_plan_channels;
create policy "Admins manage editorial_plan_channels"
  on public.editorial_plan_channels for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_media_assets" on public.editorial_media_assets;
create policy "Admins manage editorial_media_assets"
  on public.editorial_media_assets for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_publish_targets" on public.editorial_publish_targets;
create policy "Admins manage editorial_publish_targets"
  on public.editorial_publish_targets for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage social_oauth_connections" on public.social_oauth_connections;
create policy "Admins manage social_oauth_connections"
  on public.social_oauth_connections for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Storage bucket for editorial media (private; signed URLs from Edge/admin)
insert into storage.buckets (id, name, public)
values ('editorial-media', 'editorial-media', false)
on conflict (id) do nothing;

-- Admin-only upload/select policies on bucket editorial-media
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
