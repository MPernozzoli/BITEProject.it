alter table public.email_notification_preferences
  add column if not exists like_notifications_frequency text not null default 'instant',
  add column if not exists comment_notifications_frequency text not null default 'instant';

alter table public.email_notification_preferences
  drop constraint if exists email_notification_preferences_like_notifications_frequency_check;

alter table public.email_notification_preferences
  add constraint email_notification_preferences_like_notifications_frequency_check
  check (like_notifications_frequency in ('instant', 'daily', 'weekly', 'monthly', 'none'));

alter table public.email_notification_preferences
  drop constraint if exists email_notification_preferences_comment_notifications_frequency_check;

alter table public.email_notification_preferences
  add constraint email_notification_preferences_comment_notifications_frequency_check
  check (comment_notifications_frequency in ('instant', 'daily', 'weekly', 'monthly', 'none'));

create table if not exists public.engagement_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  article_id uuid not null references public.logbook_articles(id) on delete cascade,
  comment_id uuid null references public.article_comments(id) on delete cascade,
  source_record_id uuid not null,
  event_type text not null check (event_type in ('article_liked', 'comment_liked', 'article_commented', 'comment_replied', 'article_published', 'story_article_published')),
  notification_category text not null check (notification_category in ('like', 'comment', 'publication')),
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  emailed_at timestamptz null,
  processing_note text null
);

create unique index if not exists engagement_notifications_recipient_source_record_uidx
  on public.engagement_notifications (recipient_profile_id, source_record_id, event_type);

create index if not exists engagement_notifications_pending_idx
  on public.engagement_notifications (processed_at, notification_category, created_at);

create index if not exists engagement_notifications_recipient_idx
  on public.engagement_notifications (recipient_profile_id, created_at desc);

alter table public.engagement_notifications enable row level security;

create or replace function public.notify_article_like_engagement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.engagement_notifications (
    recipient_profile_id,
    actor_profile_id,
    article_id,
    comment_id,
    source_record_id,
    event_type,
    notification_category
  )
  select
    article_authors.profile_id,
    new.profile_id,
    new.article_id,
    null,
    new.id,
    'article_liked',
    'like'
  from public.article_authors
  where article_authors.article_id = new.article_id
    and article_authors.profile_id is distinct from new.profile_id
  on conflict (recipient_profile_id, source_record_id, event_type) do nothing;

  return new;
end;
$$;

create or replace function public.notify_comment_like_engagement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.engagement_notifications (
    recipient_profile_id,
    actor_profile_id,
    article_id,
    comment_id,
    source_record_id,
    event_type,
    notification_category
  )
  select
    article_comments.profile_id,
    new.profile_id,
    article_comments.article_id,
    article_comments.id,
    new.id,
    'comment_liked',
    'like'
  from public.article_comments
  where article_comments.id = new.comment_id
    and article_comments.profile_id is distinct from new.profile_id
  on conflict (recipient_profile_id, source_record_id, event_type) do nothing;

  return new;
end;
$$;

create or replace function public.notify_article_comment_engagement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with comment_context as (
    select
      new.id as comment_id,
      new.article_id,
      new.profile_id as actor_profile_id,
      new.parent_id,
      parent.profile_id as parent_profile_id
    from public.article_comments as parent
    where parent.id = new.parent_id
    union all
    select
      new.id as comment_id,
      new.article_id,
      new.profile_id as actor_profile_id,
      new.parent_id,
      null::uuid as parent_profile_id
    where new.parent_id is null
  ),
  recipients as (
    select
      article_authors.profile_id as recipient_profile_id,
      false as is_reply_target
    from comment_context
    join public.article_authors
      on article_authors.article_id = comment_context.article_id
    where article_authors.profile_id is distinct from comment_context.actor_profile_id

    union all

    select
      comment_context.parent_profile_id as recipient_profile_id,
      true as is_reply_target
    from comment_context
    where comment_context.parent_profile_id is not null
      and comment_context.parent_profile_id is distinct from comment_context.actor_profile_id
  )
  insert into public.engagement_notifications (
    recipient_profile_id,
    actor_profile_id,
    article_id,
    comment_id,
    source_record_id,
    event_type,
    notification_category
  )
  select
    recipients.recipient_profile_id,
    comment_context.actor_profile_id,
    comment_context.article_id,
    comment_context.comment_id,
    comment_context.comment_id,
    case
      when bool_or(recipients.is_reply_target) then 'comment_replied'
      else 'article_commented'
    end,
    'comment'
  from recipients
  cross join comment_context
  group by
    recipients.recipient_profile_id,
    comment_context.actor_profile_id,
    comment_context.article_id,
    comment_context.comment_id
  on conflict (recipient_profile_id, source_record_id, event_type) do nothing;

  return new;
end;
$$;

drop trigger if exists on_article_like_engagement on public.article_likes;
create trigger on_article_like_engagement
after insert on public.article_likes
for each row execute function public.notify_article_like_engagement();

drop trigger if exists on_comment_like_engagement on public.comment_likes;
create trigger on_comment_like_engagement
after insert on public.comment_likes
for each row execute function public.notify_comment_like_engagement();

drop trigger if exists on_article_comment_engagement on public.article_comments;
create trigger on_article_comment_engagement
after insert on public.article_comments
for each row execute function public.notify_article_comment_engagement();
