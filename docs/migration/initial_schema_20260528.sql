-- ============================================================================
-- Consolidated initial schema for the freyja-collective monorepo
-- Targets a fresh empty Supabase project.
-- Three logical schemas:
--   public  -> web app (logbook + editorial + email + voyages)
--   pack    -> pack app (external metrics cache)
--   data    -> data app (independent voyages mirror for data ingestion)
-- ============================================================================

-- ============ extensions ============
create extension if not exists "pgcrypto";
create extension if not exists "pg_net" with schema extensions;
create extension if not exists "pg_cron";
-- TODO: enable pgmq extension if email queue functionality is needed
--   create extension if not exists "pgmq" with schema extensions;

-- ============ schemas ============
create schema if not exists pack;
create schema if not exists data;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema pack to anon, authenticated, service_role;
grant usage on schema data to anon, authenticated, service_role;

-- ============ enums (public) ============
do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.article_editorial_type as enum ('pillar', 'support', 'utility_reflection');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.article_status as enum ('draft', 'scheduled', 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.voyage_status as enum ('planned', 'active', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.voyage_type as enum ('water', 'land');
exception when duplicate_object then null; end $$;

-- ============ enums (data) ============
do $$ begin
  create type data.voyage_status as enum ('planned', 'active', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type data.voyage_type as enum ('water', 'land');
exception when duplicate_object then null; end $$;

-- ============ shared trigger function ============
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.update_updated_at_column() from public, anon, authenticated;

-- ============ public.profiles ============
create table if not exists public.profiles (
  id uuid primary key,
  email text not null default '',
  name text not null default '',
  avatar_url text,
  bio text,
  preferred_language text not null default 'it',
  secondary_language text,
  social_facebook text,
  social_instagram text,
  social_linkedin text,
  social_seapeople text,
  social_tiktok text,
  social_website text,
  social_x text,
  social_youtube text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- ============ public.user_roles ============
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  constraint user_roles_user_role_unique unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

-- ============ has_role (public) — must come after user_roles ============
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
end;
$$;

grant execute on function public.has_role(uuid, public.app_role) to anon, authenticated, service_role;

-- ============ public.tags ============
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ============ public.stories ============
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_it text not null default '',
  title_en text not null default '',
  description_it text,
  description_en text,
  cover_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stories_slug_idx on public.stories (slug);

-- ============ public.voyages ============
create table if not exists public.voyages (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  name_en text,
  name_it text,
  description text,
  description_en text,
  description_it text,
  start_date text,
  start_time text,
  end_date text,
  end_time text,
  start_date_flex_days integer check (start_date_flex_days is null or start_date_flex_days >= 0),
  end_date_flex_days integer check (end_date_flex_days is null or end_date_flex_days >= 0),
  status public.voyage_status not null default 'planned',
  type public.voyage_type not null default 'water',
  cached_geometry jsonb,
  waterway_autoroute boolean not null default false,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voyages_status_idx on public.voyages (status);
create index if not exists voyages_is_published_idx on public.voyages (is_published);

-- ============ public.voyage_waypoints ============
create table if not exists public.voyage_waypoints (
  id uuid primary key default gen_random_uuid(),
  voyage_id uuid not null references public.voyages (id) on delete cascade,
  lat double precision not null default 0,
  lng double precision not null default 0,
  name text,
  name_en text,
  name_it text,
  description_en text,
  description_it text,
  waypoint_type text not null default 'stop',
  sort_order integer not null default 0,
  visibility_mode text not null default 'visible',
  media jsonb not null default '[]'::jsonb,
  date_start text,
  date_end text,
  event_date text,
  event_time text,
  created_at timestamptz not null default now()
);

create index if not exists voyage_waypoints_voyage_id_idx on public.voyage_waypoints (voyage_id);

-- ============ public.route_legs ============
create table if not exists public.route_legs (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  description text,
  lat_start double precision,
  lng_start double precision,
  lat_end double precision,
  lng_end double precision,
  nautical_miles double precision,
  status text not null default 'planned',
  sort_order integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ public.logbook_articles ============
create table if not exists public.logbook_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_it text not null default '',
  title_en text not null default '',
  excerpt_it text,
  excerpt_en text,
  content_it jsonb,
  content_en jsonb,
  category text not null default 'general',
  status public.article_status not null default 'draft',
  editorial_type public.article_editorial_type,
  cover_image text,
  cover_focal_x double precision not null default 0.5,
  cover_focal_y double precision not null default 0.5,
  cover_zoom double precision not null default 1,
  instagram_story_image_it text,
  instagram_story_image_en text,
  instagram_story_use_cover_it boolean not null default true,
  instagram_story_use_cover_en boolean not null default true,
  latitude double precision,
  longitude double precision,
  location_name text,
  published_at timestamptz,
  scheduled_at timestamptz,
  view_count bigint not null default 0,
  article_map_scenes jsonb,
  story_id uuid references public.stories (id) on delete set null,
  voyage_id uuid references public.voyages (id) on delete set null,
  voyage_segment_start integer,
  voyage_segment_end integer,
  voyage_waypoint_start_id uuid references public.voyage_waypoints (id) on delete set null,
  voyage_waypoint_end_id uuid references public.voyage_waypoints (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists logbook_articles_slug_idx on public.logbook_articles (slug);
create index if not exists logbook_articles_status_idx on public.logbook_articles (status);
create index if not exists logbook_articles_story_id_idx on public.logbook_articles (story_id);
create index if not exists logbook_articles_voyage_id_idx on public.logbook_articles (voyage_id);
create index if not exists logbook_articles_published_at_idx on public.logbook_articles (published_at desc);

-- ============ public.article_authors ============
create table if not exists public.article_authors (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'author',
  constraint article_authors_article_profile_unique unique (article_id, profile_id, role)
);

create index if not exists article_authors_article_id_idx on public.article_authors (article_id);
create index if not exists article_authors_profile_id_idx on public.article_authors (profile_id);

-- ============ public.article_tags ============
create table if not exists public.article_tags (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  constraint article_tags_article_tag_unique unique (article_id, tag_id)
);

create index if not exists article_tags_article_id_idx on public.article_tags (article_id);
create index if not exists article_tags_tag_id_idx on public.article_tags (tag_id);

-- ============ public.article_comments ============
create table if not exists public.article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.article_comments (id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists article_comments_article_id_idx on public.article_comments (article_id);
create index if not exists article_comments_profile_id_idx on public.article_comments (profile_id);
create index if not exists article_comments_parent_id_idx on public.article_comments (parent_id);

-- ============ public.article_likes ============
create table if not exists public.article_likes (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint article_likes_article_profile_unique unique (article_id, profile_id)
);

create index if not exists article_likes_article_id_idx on public.article_likes (article_id);
create index if not exists article_likes_profile_id_idx on public.article_likes (profile_id);

-- ============ public.article_reads ============
create table if not exists public.article_reads (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint article_reads_article_profile_unique unique (article_id, profile_id)
);

create index if not exists article_reads_article_id_idx on public.article_reads (article_id);

-- ============ public.article_read_events ============
create table if not exists public.article_read_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  visitor_key text,
  counted_at timestamptz not null default now()
);

create index if not exists article_read_events_article_id_idx on public.article_read_events (article_id);
create index if not exists article_read_events_visitor_key_idx on public.article_read_events (visitor_key);

-- ============ public.comment_likes ============
create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.article_comments (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint comment_likes_comment_profile_unique unique (comment_id, profile_id)
);

create index if not exists comment_likes_comment_id_idx on public.comment_likes (comment_id);

-- ============ public.comment_mentions ============
create table if not exists public.comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.article_comments (id) on delete cascade,
  mentioned_profile_id uuid references public.profiles (id) on delete cascade,
  mentioned_article_id uuid references public.logbook_articles (id) on delete cascade
);

create index if not exists comment_mentions_comment_id_idx on public.comment_mentions (comment_id);

-- ============ public.engagement_notifications ============
create table if not exists public.engagement_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  comment_id uuid references public.article_comments (id) on delete cascade,
  event_type text not null,
  notification_category text not null,
  source_record_id uuid not null,
  read_at timestamptz,
  emailed_at timestamptz,
  push_sent_at timestamptz,
  processed_at timestamptz,
  processing_note text,
  created_at timestamptz not null default now()
);

create index if not exists engagement_notifications_recipient_idx on public.engagement_notifications (recipient_profile_id, created_at desc);
create index if not exists engagement_notifications_article_idx on public.engagement_notifications (article_id);

alter table public.engagement_notifications replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.engagement_notifications;
exception when others then null; end $$;

-- ============ public.profile_badges ============
create table if not exists public.profile_badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_name text not null,
  badge_icon text,
  awarded_at timestamptz not null default now()
);

create index if not exists profile_badges_profile_id_idx on public.profile_badges (profile_id);

-- ============ public.push_subscriptions ============
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);

-- ============ public.newsletter_subscribers ============
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  email text not null,
  subscribed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists newsletter_subscribers_email_idx on public.newsletter_subscribers (email);

-- ============ public.newsletter_confirmation_tokens ============
create table if not exists public.newsletter_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique,
  profile_id uuid references public.profiles (id) on delete set null,
  preferred_language text,
  source text not null default 'web',
  used_at timestamptz,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists newsletter_confirmation_tokens_email_idx on public.newsletter_confirmation_tokens (email);

-- ============ public.newsletter_unsubscribe_feedback ============
create table if not exists public.newsletter_unsubscribe_feedback (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  reason_code text,
  reason_text text,
  message_context jsonb,
  unsubscribe_scope jsonb not null default '{}'::jsonb,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

-- ============ public.email_unsubscribe_tokens ============
create table if not exists public.email_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ public.email_notification_preferences ============
create table if not exists public.email_notification_preferences (
  email text primary key,
  newsletter_enabled boolean not null default true,
  article_notifications_enabled boolean not null default true,
  story_notifications_enabled boolean not null default true,
  digest_enabled boolean not null default true,
  push_publication_enabled boolean not null default true,
  push_engagement_enabled boolean not null default true,
  comment_notifications_frequency text not null default 'instant',
  like_notifications_frequency text not null default 'daily',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ public.email_send_log ============
create table if not exists public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  template_name text not null,
  status text not null,
  message_id text,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_send_log_recipient_idx on public.email_send_log (recipient_email);
create index if not exists email_send_log_created_at_idx on public.email_send_log (created_at desc);

-- ============ public.email_send_state ============
create table if not exists public.email_send_state (
  id bigint primary key default 1,
  batch_size integer not null default 10,
  send_delay_ms integer not null default 1000,
  auth_email_ttl_minutes integer not null default 60,
  transactional_email_ttl_minutes integer not null default 60,
  retry_after_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_send_state_singleton check (id = 1)
);

-- ============ public.suppressed_emails ============
create table if not exists public.suppressed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============ public.system_email_automations ============
create table if not exists public.system_email_automations (
  key text primary key,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ public.story_subscriptions ============
create table if not exists public.story_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  story_id uuid not null references public.stories (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint story_subscriptions_profile_story_unique unique (profile_id, story_id)
);

create index if not exists story_subscriptions_story_idx on public.story_subscriptions (story_id);

-- ============ public.logbook_map_markers ============
create table if not exists public.logbook_map_markers (
  id text primary key,
  label_it text not null,
  label_en text not null,
  description_it text,
  description_en text,
  latitude double precision,
  longitude double precision,
  is_visible boolean not null default true,
  is_onboard boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint logbook_map_markers_id_check check (id in ('boat', 'crew')),
  constraint logbook_map_markers_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

-- ============ public.editorial_plan_settings (legacy singleton) ============
create table if not exists public.editorial_plan_settings (
  id uuid primary key default 'a0000000-0000-4000-8000-000000000001'::uuid,
  weekly_count integer not null default 1
    constraint editorial_plan_settings_weekly_count_check check (weekly_count >= 1 and weekly_count <= 21),
  mix_pillar numeric(5, 2) not null default 15,
  mix_support numeric(5, 2) not null default 55,
  mix_utility numeric(5, 2) not null default 30,
  timezone text not null default 'Europe/Rome',
  horizon_weeks integer not null default 8
    constraint editorial_plan_settings_horizon_check check (horizon_weeks >= 1 and horizon_weeks <= 52),
  updated_at timestamptz not null default now(),
  constraint editorial_plan_settings_mix_sum_check check (
    abs((mix_pillar + mix_support + mix_utility) - 100) < 0.02
  )
);

-- ============ public.editorial_plan_channels ============
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
  updated_at timestamptz not null default now(),
  constraint editorial_plan_channels_mix_sum_check check (
    abs((mix_pillar + mix_support + mix_utility) - 100) < 0.02
  )
);

-- ============ public.editorial_plan_weekly_slots ============
create table if not exists public.editorial_plan_weekly_slots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels (id) on delete restrict,
  day_of_week smallint not null
    constraint editorial_plan_weekly_slots_dow_check check (day_of_week >= 0 and day_of_week <= 6),
  time_of_day time not null,
  content_format text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists editorial_plan_weekly_slots_channel_dow_time_sort_idx
  on public.editorial_plan_weekly_slots (channel_id, day_of_week, time_of_day, sort_order);

-- ============ public.editorial_plan_slots ============
create table if not exists public.editorial_plan_slots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels (id) on delete restrict,
  slot_date date not null,
  slot_time time not null,
  template_id uuid references public.editorial_plan_weekly_slots (id) on delete set null,
  suggested_type public.article_editorial_type,
  override_type public.article_editorial_type,
  assigned_article_id uuid references public.logbook_articles (id) on delete set null,
  content_format text,
  counts_toward_mix boolean not null default true,
  status text not null default 'open'
    constraint editorial_plan_slots_status_check check (status in ('open', 'assigned', 'skipped')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists editorial_plan_slots_channel_date_time_uidx
  on public.editorial_plan_slots (channel_id, slot_date, slot_time);
create index if not exists editorial_plan_slots_slot_date_idx on public.editorial_plan_slots (slot_date);
create index if not exists editorial_plan_slots_assigned_article_idx on public.editorial_plan_slots (assigned_article_id);

-- ============ public.editorial_media_assets ============
create table if not exists public.editorial_media_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  synopsis text,
  storage_main_path text,
  editorial_type public.article_editorial_type,
  status text not null default 'draft'
    constraint editorial_media_assets_status_check check (status in ('draft', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ public.editorial_publish_targets ============
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint editorial_publish_targets_slot_or_time check (
    editorial_plan_slot_id is not null or publish_at is not null
  )
);

create index if not exists editorial_publish_targets_slot_idx on public.editorial_publish_targets (editorial_plan_slot_id);
create index if not exists editorial_publish_targets_publish_at_idx on public.editorial_publish_targets (publish_at);
create index if not exists editorial_publish_targets_batch_idx on public.editorial_publish_targets (syndication_batch_id);

-- ============ public.social_oauth_connections ============
create table if not exists public.social_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels (id) on delete cascade,
  provider text not null,
  account_label text,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_oauth_connections_channel_unique unique (channel_id)
);

-- ============ public.public_profiles (view) ============
drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = true)
as
select
  id,
  name,
  avatar_url,
  bio,
  created_at,
  preferred_language,
  secondary_language,
  social_instagram,
  social_youtube,
  social_tiktok,
  social_facebook,
  social_x,
  social_linkedin,
  social_website,
  social_seapeople
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

-- ============ public.increment_article_view_count ============
create or replace function public.increment_article_view_count(_article_id uuid, _visitor_key text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  -- Best-effort dedup record (ignore failures, idempotent table may not exist yet at first call)
  if _visitor_key is not null then
    begin
      insert into public.article_read_events (article_id, visitor_key)
      values (_article_id, _visitor_key);
    exception when others then
      null;
    end;
  end if;

  update public.logbook_articles
  set view_count = coalesce(view_count, 0) + 1
  where id = _article_id
    and status = 'published'
    and (published_at is null or published_at <= now())
  returning view_count into v_count;

  if v_count is null then
    select coalesce(view_count, 0) into v_count
    from public.logbook_articles
    where id = _article_id;
  end if;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.increment_article_view_count(uuid, text) from public;
grant execute on function public.increment_article_view_count(uuid, text) to anon, authenticated;

-- ============ email queue helpers (pgmq wrappers; stubbed) ============
-- TODO: enable pgmq extension if queue functionality is needed; these wrappers are
-- intentionally stubbed so the DB shape matches what the edge functions expect.

create or replace function public.enqueue_email(queue_name text, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO: replace with `return pgmq.send(queue_name, payload);` once pgmq enabled
  return null;
end;
$$;

create or replace function public.delete_email(queue_name text, message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO: replace with `return pgmq.delete(queue_name, message_id);` once pgmq enabled
  return false;
end;
$$;

create or replace function public.read_email_batch(queue_name text, vt integer, batch_size integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO: replace with `return query select msg_id, read_ct, message from pgmq.read(queue_name, vt, batch_size);` once pgmq enabled
  return;
end;
$$;

create or replace function public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO: send payload to dlq and delete from source_queue once pgmq enabled
  return null;
end;
$$;

revoke execute on function public.enqueue_email(text, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_email(text, bigint) from public, anon, authenticated;
revoke execute on function public.read_email_batch(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.move_to_dlq(text, text, bigint, jsonb) from public, anon, authenticated;

-- ============ updated_at triggers (public) ============
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'stories', 'voyages', 'route_legs', 'logbook_articles',
    'article_comments', 'push_subscriptions', 'newsletter_subscribers',
    'email_notification_preferences', 'email_send_state',
    'system_email_automations', 'logbook_map_markers',
    'editorial_plan_settings', 'editorial_plan_channels',
    'editorial_plan_slots', 'editorial_media_assets',
    'editorial_publish_targets', 'social_oauth_connections'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
         for each row execute function public.update_updated_at_column();',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- pack schema
-- ============================================================================

-- ============ pack.external_metrics_cache ============
create table if not exists pack.external_metrics_cache (
  slug text primary key,
  source_url text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on pack.external_metrics_cache;
create trigger set_updated_at before update on pack.external_metrics_cache
  for each row execute function public.update_updated_at_column();

-- ============================================================================
-- data schema
-- ============================================================================

-- ============ data.voyages ============
create table if not exists data.voyages (
  id uuid primary key,
  name text not null default '',
  name_en text,
  name_it text,
  description text,
  description_en text,
  description_it text,
  start_date text,
  start_time text,
  end_date text,
  end_time text,
  status data.voyage_status not null default 'planned',
  type data.voyage_type not null default 'water',
  cached_geometry jsonb,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create index if not exists data_voyages_status_idx on data.voyages (status);
create index if not exists data_voyages_is_published_idx on data.voyages (is_published);

-- ============ data.voyage_waypoints ============
create table if not exists data.voyage_waypoints (
  id uuid primary key,
  voyage_id uuid not null references data.voyages (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  name text,
  name_en text,
  name_it text,
  description_en text,
  description_it text,
  waypoint_type text not null default 'stop',
  sort_order integer not null default 0,
  visibility_mode text not null default 'visible',
  media jsonb not null default '[]'::jsonb,
  date_start text,
  date_end text,
  event_date text,
  event_time text,
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create index if not exists data_voyage_waypoints_voyage_id_idx on data.voyage_waypoints (voyage_id);

-- ============ data.route_legs ============
create table if not exists data.route_legs (
  id uuid primary key,
  name text not null default '',
  description text,
  lat_start double precision,
  lng_start double precision,
  lat_end double precision,
  lng_end double precision,
  nautical_miles double precision,
  status text not null default 'planned',
  sort_order integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on data.voyages;
create trigger set_updated_at before update on data.voyages
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on data.route_legs;
create trigger set_updated_at before update on data.route_legs
  for each row execute function public.update_updated_at_column();

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- ---- enable RLS on public tables
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.tags enable row level security;
alter table public.stories enable row level security;
alter table public.voyages enable row level security;
alter table public.voyage_waypoints enable row level security;
alter table public.route_legs enable row level security;
alter table public.logbook_articles enable row level security;
alter table public.article_authors enable row level security;
alter table public.article_tags enable row level security;
alter table public.article_comments enable row level security;
alter table public.article_likes enable row level security;
alter table public.article_reads enable row level security;
alter table public.article_read_events enable row level security;
alter table public.comment_likes enable row level security;
alter table public.comment_mentions enable row level security;
alter table public.engagement_notifications enable row level security;
alter table public.profile_badges enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_confirmation_tokens enable row level security;
alter table public.newsletter_unsubscribe_feedback enable row level security;
alter table public.email_unsubscribe_tokens enable row level security;
alter table public.email_notification_preferences enable row level security;
alter table public.email_send_log enable row level security;
alter table public.email_send_state enable row level security;
alter table public.suppressed_emails enable row level security;
alter table public.system_email_automations enable row level security;
alter table public.story_subscriptions enable row level security;
alter table public.logbook_map_markers enable row level security;
alter table public.editorial_plan_settings enable row level security;
alter table public.editorial_plan_channels enable row level security;
alter table public.editorial_plan_weekly_slots enable row level security;
alter table public.editorial_plan_slots enable row level security;
alter table public.editorial_media_assets enable row level security;
alter table public.editorial_publish_targets enable row level security;
alter table public.social_oauth_connections enable row level security;

-- ---- enable RLS on pack tables
alter table pack.external_metrics_cache enable row level security;

-- ---- enable RLS on data tables
alter table data.voyages enable row level security;
alter table data.voyage_waypoints enable row level security;
alter table data.route_legs enable row level security;

-- ============ policies: profiles ============
drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select to anon, authenticated using (true);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

-- ============ policies: user_roles ============
drop policy if exists "Users view own roles" on public.user_roles;
create policy "Users view own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins manage user_roles" on public.user_roles;
create policy "Admins manage user_roles"
  on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: tags ============
drop policy if exists "Tags are publicly readable" on public.tags;
create policy "Tags are publicly readable"
  on public.tags for select to anon, authenticated using (true);

drop policy if exists "Admins manage tags" on public.tags;
create policy "Admins manage tags"
  on public.tags for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: stories ============
drop policy if exists "Stories are publicly readable" on public.stories;
create policy "Stories are publicly readable"
  on public.stories for select to anon, authenticated using (true);

drop policy if exists "Admins manage stories" on public.stories;
create policy "Admins manage stories"
  on public.stories for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: voyages ============
drop policy if exists "Anyone can view published voyages" on public.voyages;
create policy "Anyone can view published voyages"
  on public.voyages for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Admins manage voyages" on public.voyages;
create policy "Admins manage voyages"
  on public.voyages for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: voyage_waypoints ============
drop policy if exists "Anyone can view published voyage waypoints" on public.voyage_waypoints;
create policy "Anyone can view published voyage waypoints"
  on public.voyage_waypoints for select to anon, authenticated
  using (
    exists (
      select 1 from public.voyages
      where voyages.id = voyage_waypoints.voyage_id and voyages.is_published = true
    )
  );

drop policy if exists "Admins manage voyage_waypoints" on public.voyage_waypoints;
create policy "Admins manage voyage_waypoints"
  on public.voyage_waypoints for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: route_legs ============
drop policy if exists "Route legs are publicly readable" on public.route_legs;
create policy "Route legs are publicly readable"
  on public.route_legs for select to anon, authenticated using (true);

drop policy if exists "Admins manage route_legs" on public.route_legs;
create policy "Admins manage route_legs"
  on public.route_legs for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: logbook_articles ============
drop policy if exists "Published articles are publicly readable" on public.logbook_articles;
create policy "Published articles are publicly readable"
  on public.logbook_articles for select to anon, authenticated
  using (status = 'published' and (published_at is null or published_at <= now()));

drop policy if exists "Admins manage logbook_articles" on public.logbook_articles;
create policy "Admins manage logbook_articles"
  on public.logbook_articles for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: article_authors / article_tags ============
drop policy if exists "Article authors are publicly readable" on public.article_authors;
create policy "Article authors are publicly readable"
  on public.article_authors for select to anon, authenticated using (true);

drop policy if exists "Admins manage article_authors" on public.article_authors;
create policy "Admins manage article_authors"
  on public.article_authors for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Article tags are publicly readable" on public.article_tags;
create policy "Article tags are publicly readable"
  on public.article_tags for select to anon, authenticated using (true);

drop policy if exists "Admins manage article_tags" on public.article_tags;
create policy "Admins manage article_tags"
  on public.article_tags for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: article_comments ============
drop policy if exists "Comments are publicly readable" on public.article_comments;
create policy "Comments are publicly readable"
  on public.article_comments for select to anon, authenticated using (true);

drop policy if exists "Users insert own comments" on public.article_comments;
create policy "Users insert own comments"
  on public.article_comments for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "Users update own comments" on public.article_comments;
create policy "Users update own comments"
  on public.article_comments for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "Users delete own comments" on public.article_comments;
create policy "Users delete own comments"
  on public.article_comments for delete to authenticated
  using (profile_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'moderator'));

-- ============ policies: article_likes ============
drop policy if exists "Likes are publicly readable" on public.article_likes;
create policy "Likes are publicly readable"
  on public.article_likes for select to anon, authenticated using (true);

drop policy if exists "Users insert own likes" on public.article_likes;
create policy "Users insert own likes"
  on public.article_likes for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "Users delete own likes" on public.article_likes;
create policy "Users delete own likes"
  on public.article_likes for delete to authenticated
  using (profile_id = auth.uid());

-- ============ policies: article_reads / article_read_events ============
drop policy if exists "Users view own reads" on public.article_reads;
create policy "Users view own reads"
  on public.article_reads for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "Users insert own reads" on public.article_reads;
create policy "Users insert own reads"
  on public.article_reads for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "Service role manages article_read_events" on public.article_read_events;
create policy "Service role manages article_read_events"
  on public.article_read_events for all to service_role using (true) with check (true);

-- ============ policies: comment_likes ============
drop policy if exists "Comment likes are publicly readable" on public.comment_likes;
create policy "Comment likes are publicly readable"
  on public.comment_likes for select to anon, authenticated using (true);

drop policy if exists "Users insert own comment_likes" on public.comment_likes;
create policy "Users insert own comment_likes"
  on public.comment_likes for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "Users delete own comment_likes" on public.comment_likes;
create policy "Users delete own comment_likes"
  on public.comment_likes for delete to authenticated
  using (profile_id = auth.uid());

-- ============ policies: comment_mentions ============
drop policy if exists "Comment mentions are publicly readable" on public.comment_mentions;
create policy "Comment mentions are publicly readable"
  on public.comment_mentions for select to anon, authenticated using (true);

drop policy if exists "Users can create mentions for own comments" on public.comment_mentions;
create policy "Users can create mentions for own comments"
  on public.comment_mentions for insert to authenticated
  with check (
    exists (
      select 1 from public.article_comments
      where article_comments.id = comment_mentions.comment_id
        and article_comments.profile_id = auth.uid()
    )
  );

-- ============ policies: engagement_notifications ============
drop policy if exists "Users view own engagement notifications" on public.engagement_notifications;
create policy "Users view own engagement notifications"
  on public.engagement_notifications for select to authenticated
  using (recipient_profile_id = auth.uid());

drop policy if exists "Users update own engagement notifications" on public.engagement_notifications;
create policy "Users update own engagement notifications"
  on public.engagement_notifications for update to authenticated
  using (recipient_profile_id = auth.uid()) with check (recipient_profile_id = auth.uid());

drop policy if exists "Service role manages engagement_notifications" on public.engagement_notifications;
create policy "Service role manages engagement_notifications"
  on public.engagement_notifications for all to service_role using (true) with check (true);

-- ============ policies: profile_badges ============
drop policy if exists "Profile badges are publicly readable" on public.profile_badges;
create policy "Profile badges are publicly readable"
  on public.profile_badges for select to anon, authenticated using (true);

drop policy if exists "Admins manage profile_badges" on public.profile_badges;
create policy "Admins manage profile_badges"
  on public.profile_badges for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: push_subscriptions ============
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "Service role manages push_subscriptions" on public.push_subscriptions;
create policy "Service role manages push_subscriptions"
  on public.push_subscriptions for all to service_role using (true) with check (true);

-- ============ policies: newsletter_* / email_* / suppressed / system_email ============
drop policy if exists "Service role manages newsletter_subscribers" on public.newsletter_subscribers;
create policy "Service role manages newsletter_subscribers"
  on public.newsletter_subscribers for all to service_role using (true) with check (true);

drop policy if exists "Users view own newsletter subscription" on public.newsletter_subscribers;
create policy "Users view own newsletter subscription"
  on public.newsletter_subscribers for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "Service role manages newsletter_confirmation_tokens" on public.newsletter_confirmation_tokens;
create policy "Service role manages newsletter_confirmation_tokens"
  on public.newsletter_confirmation_tokens for all to service_role using (true) with check (true);

drop policy if exists "Service role manages newsletter_unsubscribe_feedback" on public.newsletter_unsubscribe_feedback;
create policy "Service role manages newsletter_unsubscribe_feedback"
  on public.newsletter_unsubscribe_feedback for all to service_role using (true) with check (true);

drop policy if exists "Service role manages email_unsubscribe_tokens" on public.email_unsubscribe_tokens;
create policy "Service role manages email_unsubscribe_tokens"
  on public.email_unsubscribe_tokens for all to service_role using (true) with check (true);

drop policy if exists "Service role manages email_notification_preferences" on public.email_notification_preferences;
create policy "Service role manages email_notification_preferences"
  on public.email_notification_preferences for all to service_role using (true) with check (true);

drop policy if exists "Service role manages email_send_log" on public.email_send_log;
create policy "Service role manages email_send_log"
  on public.email_send_log for all to service_role using (true) with check (true);

drop policy if exists "Service role manages email_send_state" on public.email_send_state;
create policy "Service role manages email_send_state"
  on public.email_send_state for all to service_role using (true) with check (true);

drop policy if exists "Admins read email_send_state" on public.email_send_state;
create policy "Admins read email_send_state"
  on public.email_send_state for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Service role manages suppressed_emails" on public.suppressed_emails;
create policy "Service role manages suppressed_emails"
  on public.suppressed_emails for all to service_role using (true) with check (true);

drop policy if exists "Service role manages system_email_automations" on public.system_email_automations;
create policy "Service role manages system_email_automations"
  on public.system_email_automations for all to service_role using (true) with check (true);

drop policy if exists "Admins manage system_email_automations" on public.system_email_automations;
create policy "Admins manage system_email_automations"
  on public.system_email_automations for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: story_subscriptions ============
drop policy if exists "Users manage own story subscriptions" on public.story_subscriptions;
create policy "Users manage own story subscriptions"
  on public.story_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============ policies: logbook_map_markers ============
drop policy if exists "Logbook map markers are publicly readable" on public.logbook_map_markers;
create policy "Logbook map markers are publicly readable"
  on public.logbook_map_markers for select to anon, authenticated using (true);

drop policy if exists "Admins manage logbook map markers" on public.logbook_map_markers;
create policy "Admins manage logbook map markers"
  on public.logbook_map_markers for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ============ policies: editorial_* admin-only ============
drop policy if exists "Admins manage editorial_plan_settings" on public.editorial_plan_settings;
create policy "Admins manage editorial_plan_settings"
  on public.editorial_plan_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_plan_channels" on public.editorial_plan_channels;
create policy "Admins manage editorial_plan_channels"
  on public.editorial_plan_channels for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_plan_weekly_slots" on public.editorial_plan_weekly_slots;
create policy "Admins manage editorial_plan_weekly_slots"
  on public.editorial_plan_weekly_slots for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins manage editorial_plan_slots" on public.editorial_plan_slots;
create policy "Admins manage editorial_plan_slots"
  on public.editorial_plan_slots for all to authenticated
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

-- ============ policies: pack ============
grant select on pack.external_metrics_cache to anon, authenticated;
grant insert, update, delete on pack.external_metrics_cache to service_role;

drop policy if exists "External metrics cache publicly readable" on pack.external_metrics_cache;
create policy "External metrics cache publicly readable"
  on pack.external_metrics_cache for select to anon, authenticated using (true);

drop policy if exists "Service role manages external_metrics_cache" on pack.external_metrics_cache;
create policy "Service role manages external_metrics_cache"
  on pack.external_metrics_cache for all to service_role using (true) with check (true);

-- ============ policies: data (public read, service_role write) ============
grant select on data.voyages, data.voyage_waypoints, data.route_legs to anon, authenticated;
grant insert, update, delete on data.voyages, data.voyage_waypoints, data.route_legs to service_role;

drop policy if exists "Public read data.voyages" on data.voyages;
create policy "Public read data.voyages"
  on data.voyages for select to anon, authenticated using (true);

drop policy if exists "Service role manages data.voyages" on data.voyages;
create policy "Service role manages data.voyages"
  on data.voyages for all to service_role using (true) with check (true);

drop policy if exists "Public read data.voyage_waypoints" on data.voyage_waypoints;
create policy "Public read data.voyage_waypoints"
  on data.voyage_waypoints for select to anon, authenticated using (true);

drop policy if exists "Service role manages data.voyage_waypoints" on data.voyage_waypoints;
create policy "Service role manages data.voyage_waypoints"
  on data.voyage_waypoints for all to service_role using (true) with check (true);

drop policy if exists "Public read data.route_legs" on data.route_legs;
create policy "Public read data.route_legs"
  on data.route_legs for select to anon, authenticated using (true);

drop policy if exists "Service role manages data.route_legs" on data.route_legs;
create policy "Service role manages data.route_legs"
  on data.route_legs for all to service_role using (true) with check (true);

-- ============ done ============
