alter table public.email_notification_preferences
  add column if not exists push_mail_enabled boolean not null default true,
  add column if not exists push_voyage_admin_enabled boolean not null default true,
  add column if not exists push_voyage_user_enabled boolean not null default true;
