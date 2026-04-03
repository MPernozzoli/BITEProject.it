drop index if exists public.engagement_notifications_recipient_source_record_uidx;

alter table public.engagement_notifications
  drop constraint if exists engagement_notifications_event_type_check;

alter table public.engagement_notifications
  add constraint engagement_notifications_event_type_check
  check (event_type in ('article_liked', 'comment_liked', 'article_commented', 'comment_replied', 'article_published', 'story_article_published'));

alter table public.engagement_notifications
  drop constraint if exists engagement_notifications_notification_category_check;

alter table public.engagement_notifications
  add constraint engagement_notifications_notification_category_check
  check (notification_category in ('like', 'comment', 'publication'));

create unique index if not exists engagement_notifications_recipient_source_record_uidx
  on public.engagement_notifications (recipient_profile_id, source_record_id, event_type);

alter table public.email_notification_preferences
  add column if not exists article_notifications_enabled boolean not null default true,
  add column if not exists push_publication_enabled boolean not null default true;
