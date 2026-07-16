-- Social post insights captured per publish target.

create table if not exists public.editorial_post_insights (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.editorial_publish_targets (id) on delete cascade,
  captured_at timestamptz not null default timezone('utc', now()),
  source text not null default 'manual'
    constraint editorial_post_insights_source_check check (source in ('manual', 'instagram', 'youtube', 'tiktok', 'import')),
  impressions integer not null default 0 constraint editorial_post_insights_impressions_check check (impressions >= 0),
  reach integer not null default 0 constraint editorial_post_insights_reach_check check (reach >= 0),
  views integer not null default 0 constraint editorial_post_insights_views_check check (views >= 0),
  likes integer not null default 0 constraint editorial_post_insights_likes_check check (likes >= 0),
  comments integer not null default 0 constraint editorial_post_insights_comments_check check (comments >= 0),
  shares integer not null default 0 constraint editorial_post_insights_shares_check check (shares >= 0),
  saves integer not null default 0 constraint editorial_post_insights_saves_check check (saves >= 0),
  clicks integer not null default 0 constraint editorial_post_insights_clicks_check check (clicks >= 0),
  follows integer not null default 0 constraint editorial_post_insights_follows_check check (follows >= 0),
  sentiment text constraint editorial_post_insights_sentiment_check check (sentiment in ('positive', 'neutral', 'negative')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists editorial_post_insights_target_captured_idx
  on public.editorial_post_insights (target_id, captured_at desc);

comment on table public.editorial_post_insights is
  'Manual/imported performance snapshots and qualitative notes for social publish targets.';

alter table public.editorial_post_insights enable row level security;

grant select, insert, update, delete on public.editorial_post_insights to authenticated;

drop policy if exists "Admins manage editorial_post_insights" on public.editorial_post_insights;
create policy "Admins manage editorial_post_insights"
  on public.editorial_post_insights for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
