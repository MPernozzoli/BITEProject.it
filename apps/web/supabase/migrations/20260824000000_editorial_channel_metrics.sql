-- Cached profile-level metrics per editorial channel.
-- Post-level aggregates are computed live from editorial_post_insights.

create table if not exists public.editorial_channel_metrics (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.editorial_plan_channels(id) on delete cascade,
  captured_at timestamptz not null default timezone('utc', now()),
  -- Profile-level metrics (from platform API)
  followers integer,
  following integer,
  media_count integer,
  -- Engagement sample (from recent N posts)
  avg_engagement_rate numeric(8,4) default 0,
  sample_post_count integer default 0,
  -- Platform-specific extras (JSONB for flexibility)
  extras jsonb default '{}',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists editorial_channel_metrics_channel_captured_idx
  on public.editorial_channel_metrics (channel_id, captured_at desc);

comment on table public.editorial_channel_metrics is
  'Cached profile-level metrics snapshots for editorial channels (followers, subscribers, engagement rate).';
comment on column public.editorial_channel_metrics.followers is
  'Instagram followers or YouTube subscribers at capture time.';
comment on column public.editorial_channel_metrics.avg_engagement_rate is
  'Average engagement rate computed from the most recent sample of posts.';

grant select, insert on public.editorial_channel_metrics to authenticated;

create policy "Admins read editorial_channel_metrics"
  on public.editorial_channel_metrics for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins insert editorial_channel_metrics"
  on public.editorial_channel_metrics for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
