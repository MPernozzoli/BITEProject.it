-- Editorial readiness checks and proactive alert system.
-- 1. check_article_readiness() – verifies all required fields for publishing
-- 2. editorial_alert_log – tracks sent alerts to avoid spam
-- 3. push_editorial_alerts_enabled – admin opt-in for editorial push notifications

-- ──────────────────────────────────────────────────────────────────────
-- 1. Article readiness function
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.check_article_readiness(_article_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _article record;
  _missing jsonb := '[]'::jsonb;
  _ready boolean;
begin
  select
    id,
    title_it,
    title_en,
    excerpt_it,
    excerpt_en,
    content_it,
    content_en,
    cover_image,
    editorial_type,
    category
  into _article
  from public.logbook_articles
  where id = _article_id;

  if not found then
    return jsonb_build_object(
      'ready', false,
      'missing', jsonb_build_array('article_not_found'),
      'article_id', _article_id
    );
  end if;

  if _article.title_it is null or trim(_article.title_it) = '' then
    _missing := _missing || '"title_it"';
  end if;
  if _article.title_en is null or trim(_article.title_en) = '' then
    _missing := _missing || '"title_en"';
  end if;
  if _article.excerpt_it is null or trim(_article.excerpt_it) = '' then
    _missing := _missing || '"excerpt_it"';
  end if;
  if _article.excerpt_en is null or trim(_article.excerpt_en) = '' then
    _missing := _missing || '"excerpt_en"';
  end if;
  if _article.content_it is null or _article.content_it = 'null'::jsonb or
     (jsonb_typeof(_article.content_it) = 'object' and _article.content_it->'content' is null) then
    _missing := _missing || '"content_it"';
  end if;
  if _article.content_en is null or _article.content_en = 'null'::jsonb or
     (jsonb_typeof(_article.content_en) = 'object' and _article.content_en->'content' is null) then
    _missing := _missing || '"content_en"';
  end if;
  if _article.cover_image is null or trim(_article.cover_image) = '' then
    _missing := _missing || '"cover_image"';
  end if;
  if _article.editorial_type is null then
    _missing := _missing || '"editorial_type"';
  end if;

  _ready := jsonb_array_length(_missing) = 0;

  return jsonb_build_object(
    'ready', _ready,
    'missing', _missing,
    'article_id', _article_id
  );
end;
$$;

comment on function public.check_article_readiness(uuid) is
  'Checks whether an article has all required fields for publishing. Returns { ready, missing[], article_id }.';

revoke execute on function public.check_article_readiness(uuid) from public, anon, authenticated;
grant execute on function public.check_article_readiness(uuid) to postgres, service_role;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Alert log table – prevents duplicate notifications
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.editorial_alert_log (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.editorial_plan_slots (id) on delete cascade,
  article_id uuid not null references public.logbook_articles (id) on delete cascade,
  alert_type text not null
    constraint editorial_alert_log_type_check check (alert_type in ('readiness_warning', 'readiness_critical', 'readiness_ok')),
  missing_fields jsonb not null default '[]'::jsonb,
  hours_until_publish numeric(8, 2),
  sent_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.editorial_alert_log is
  'Tracks editorial readiness alerts sent to admins to prevent duplicate notifications.';

create index if not exists editorial_alert_log_slot_idx on public.editorial_alert_log (slot_id);
create index if not exists editorial_alert_log_sent_at_idx on public.editorial_alert_log (sent_at);

alter table public.editorial_alert_log enable row level security;

drop policy if exists "Admins manage editorial_alert_log" on public.editorial_alert_log;
create policy "Admins manage editorial_alert_log"
  on public.editorial_alert_log
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ──────────────────────────────────────────────────────────────────────
-- 3. Push preference for editorial alerts
-- ──────────────────────────────────────────────────────────────────────

alter table public.email_notification_preferences
  add column if not exists push_editorial_alerts_enabled boolean not null default true;
