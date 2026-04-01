create table if not exists public.email_notification_preferences (
  email text primary key,
  newsletter_enabled boolean not null default true,
  digest_enabled boolean not null default true,
  story_notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.newsletter_unsubscribe_feedback (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  profile_id uuid null references public.profiles(id) on delete set null,
  source text not null default 'preferences_page',
  reason_code text null,
  reason_text text null,
  unsubscribe_scope jsonb not null default '{}'::jsonb,
  message_context jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists newsletter_unsubscribe_feedback_email_idx
  on public.newsletter_unsubscribe_feedback (email, created_at desc);

create index if not exists newsletter_unsubscribe_feedback_reason_idx
  on public.newsletter_unsubscribe_feedback (reason_code);

alter table public.email_notification_preferences enable row level security;
alter table public.newsletter_unsubscribe_feedback enable row level security;

create policy "Admins can view email notification preferences"
  on public.email_notification_preferences
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can view newsletter unsubscribe feedback"
  on public.newsletter_unsubscribe_feedback
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));
