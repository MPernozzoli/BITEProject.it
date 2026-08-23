-- =============================================================================
-- Migration: Content backlog, share/click/scroll tracking, article scoring
-- =============================================================================

-- 1. Content notes (idea backlog)
create type public.content_note_status as enum ('note', 'selected', 'draft', 'archived');

create table public.content_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  body text,
  pillar text not null default 'experience',
  author_id uuid references auth.users(id) on delete set null,
  status public.content_note_status not null default 'note',
  promoted_to_article_id uuid references public.logbook_articles(id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.content_notes is 'Idea backlog for editorial content — notes, selected ideas, and promotion to articles.';

alter table public.content_notes enable row level security;

create policy "Admins manage content_notes"
  on public.content_notes for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index content_notes_status_idx on public.content_notes (status);
create index content_notes_pinned_idx on public.content_notes (pinned desc, created_at desc);

create trigger content_notes_updated_at
  before update on public.content_notes
  for each row execute function public.touch_updated_at();

-- 2. Share events
create table public.article_share_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles(id) on delete cascade,
  profile_id uuid references auth.users(id) on delete set null,
  visitor_key text,
  method text not null default 'link',
  created_at timestamptz not null default now()
);

comment on table public.article_share_events is 'Tracks each share action on an article (link copy, native share, instagram story).';

alter table public.article_share_events enable row level security;

create policy "Anyone can insert share events"
  on public.article_share_events for insert
  with check (true);

create policy "Admins read share events"
  on public.article_share_events for select
  using (public.has_role(auth.uid(), 'admin'));

create index article_share_events_article_idx on public.article_share_events (article_id);
create index article_share_events_created_idx on public.article_share_events (created_at desc);

-- 3. CTA / link click events
create table public.article_click_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles(id) on delete cascade,
  profile_id uuid references auth.users(id) on delete set null,
  visitor_key text,
  click_type text not null default 'link',
  href text,
  created_at timestamptz not null default now()
);

comment on table public.article_click_events is 'Tracks outbound link clicks and CTA clicks within articles.';

alter table public.article_click_events enable row level security;

create policy "Anyone can insert click events"
  on public.article_click_events for insert
  with check (true);

create policy "Admins read click events"
  on public.article_click_events for select
  using (public.has_role(auth.uid(), 'admin'));

create index article_click_events_article_idx on public.article_click_events (article_id);
create index article_click_events_created_idx on public.article_click_events (created_at desc);

-- 4. Scroll depth events (sampled, not every pixel)
create table public.article_scroll_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.logbook_articles(id) on delete cascade,
  profile_id uuid references auth.users(id) on delete set null,
  visitor_key text,
  max_scroll_pct smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.article_scroll_events is 'Max scroll depth per article visit (sampled: 25/50/75/90/100%).';

alter table public.article_scroll_events enable row level security;

create policy "Anyone can insert scroll events"
  on public.article_scroll_events for insert
  with check (true);

create policy "Admins read scroll events"
  on public.article_scroll_events for select
  using (public.has_role(auth.uid(), 'admin'));

create index article_scroll_events_article_idx on public.article_scroll_events (article_id);
create index article_scroll_events_created_idx on public.article_scroll_events (created_at desc);

-- 5. RPC: record a share event
create or replace function public.record_article_share(
  _article_id uuid,
  _visitor_key text default null,
  _method text default 'link'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.article_share_events (article_id, profile_id, visitor_key, method)
  values (
    _article_id,
    auth.uid(),
    coalesce(_visitor_key, null),
    coalesce(_method, 'link')
  );
end;
$$;

grant execute on function public.record_article_share(uuid, text, text) to anon, authenticated;

-- 6. RPC: record a click event
create or replace function public.record_article_click(
  _article_id uuid,
  _visitor_key text default null,
  _click_type text default 'link',
  _href text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.article_click_events (article_id, profile_id, visitor_key, click_type, href)
  values (
    _article_id,
    auth.uid(),
    coalesce(_visitor_key, null),
    coalesce(_click_type, 'link'),
    _href
  );
end;
$$;

grant execute on function public.record_article_click(uuid, text, text, text) to anon, authenticated;

-- 7. RPC: record a scroll depth event (max per visitor per article per session is handled client-side by only sending milestones)
create or replace function public.record_article_scroll(
  _article_id uuid,
  _visitor_key text default null,
  _max_scroll_pct smallint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.article_scroll_events (article_id, profile_id, visitor_key, max_scroll_pct)
  values (
    _article_id,
    auth.uid(),
    coalesce(_visitor_key, null),
    greatest(0, least(100, coalesce(_max_scroll_pct, 0)))
  );
end;
$$;

grant execute on function public.record_article_scroll(uuid, text, smallint) to anon, authenticated;

-- 8. RPC: compute article score (5-point rubric)
-- Returns: { reach, read, react, retain, revenue, total }
-- Each axis is 0-2. Total is out of 10.
create or replace function public.compute_article_score(_article_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_view_count int;
  v_unique_readers_30d int;
  v_avg_dwell_ms numeric;
  v_scroll_50pct_pct numeric;
  v_like_count int;
  v_comment_count int;
  v_share_count int;
  v_read_count int;
  v_unique_readers int;
  v_score jsonb;
  v_reach smallint;
  v_read_score smallint;
  v_react smallint;
  v_retain smallint;
  v_revenue smallint;
begin
  -- Reach: unique readers in last 30 days
  select count(distinct coalesce(profile_id::text, visitor_key))
  into v_unique_readers_30d
  from public.article_read_events
  where article_id = _article_id
    and counted_at >= now() - interval '30 days';

  -- Reach score: 0 (<50), 1 (50-500), 2 (>500)
  v_reach := case
    when v_unique_readers_30d > 500 then 2
    when v_unique_readers_30d >= 50 then 1
    else 0
  end;

  -- Read: avg dwell time + scroll depth
  select avg(dwell_ms) into v_avg_dwell_ms
  from public.article_read_events
  where article_id = _article_id
    and dwell_ms > 0
    and counted_at >= now() - interval '30 days';

  select coalesce(avg(max_scroll_pct), 0) into v_scroll_50pct_pct
  from public.article_scroll_events
  where article_id = _article_id
    and created_at >= now() - interval '30 days';

  -- Read score: dwell >= 90s AND scroll >= 50% = 2, either >= 1, else 0
  v_read_score := case
    when coalesce(v_avg_dwell_ms, 0) >= 90000 and v_scroll_50pct_pct >= 50 then 2
    when coalesce(v_avg_dwell_ms, 0) >= 30000 or v_scroll_50pct_pct >= 30 then 1
    else 0
  end;

  -- React: likes + comments + shares per 100 readers
  select count(*) into v_like_count
  from public.article_likes
  where article_id = _article_id;

  select count(*) into v_comment_count
  from public.article_comments
  where article_id = _article_id;

  select count(*) into v_share_count
  from public.article_share_events
  where article_id = _article_id;

  -- React score: >= 5 reactions/100 readers = 2, >= 1/100 = 1, else 0
  v_react := case
    when v_unique_readers_30d > 0 and ((v_like_count + v_comment_count + v_share_count)::numeric / v_unique_readers_30d * 100) >= 5 then 2
    when v_unique_readers_30d > 0 and ((v_like_count + v_comment_count + v_share_count)::numeric / v_unique_readers_30d * 100) >= 1 then 1
    else 0
  end;

  -- Retain: unique readers (all time) as proxy for returning audience
  select count(distinct coalesce(profile_id::text, visitor_key))
  into v_unique_readers
  from public.article_read_events
  where article_id = _article_id;

  -- Retain score: >200 unique = 2, >50 = 1, else 0
  v_retain := case
    when v_unique_readers > 200 then 2
    when v_unique_readers > 50 then 1
    else 0
  end;

  -- Revenue/Lead: clicks on links/CTAs
  select count(*) into v_share_count
  from public.article_click_events
  where article_id = _article_id
    and created_at >= now() - interval '30 days';

  v_revenue := case
    when v_share_count >= 10 then 2
    when v_share_count >= 3 then 1
    else 0
  end;

  v_score := jsonb_build_object(
    'reach', v_reach,
    'read', v_read_score,
    'react', v_react,
    'retain', v_retain,
    'revenue', v_revenue,
    'total', (v_reach + v_read_score + v_react + v_retain + v_revenue)::int,
    'reach_count', v_unique_readers_30d,
    'avg_dwell_ms', coalesce(v_avg_dwell_ms, 0)::int,
    'scroll_pct', v_scroll_50pct_pct::int,
    'like_count', v_like_count,
    'comment_count', v_comment_count,
    'share_count', v_share_count,
    'click_count', v_share_count,
    'unique_readers', v_unique_readers
  );

  return v_score;
end;
$$;

grant execute on function public.compute_article_score(uuid) to anon, authenticated;

-- 9. RPC: get all articles with their 5-point scores (admin dashboard)
create or replace function public.admin_article_scores()
returns table (
  article_id uuid,
  title_en text,
  title_it text,
  slug text,
  status text,
  published_at timestamptz,
  view_count bigint,
  score jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Unauthorized';
  end if;

  return query
  select
    a.id as article_id,
    a.title_en,
    a.title_it,
    a.slug,
    a.status::text,
    a.published_at,
    a.view_count,
    public.compute_article_score(a.id) as score
  from public.logbook_articles a
  where a.status = 'published'
  order by a.published_at desc nulls last;
end;
$$;

grant execute on function public.admin_article_scores() to service_role, authenticated;
