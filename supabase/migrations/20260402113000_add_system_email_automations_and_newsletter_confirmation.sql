create table if not exists public.system_email_automations (
  key text primary key,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz null,
  last_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.newsletter_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  token text not null unique,
  profile_id uuid null references public.profiles(id) on delete set null,
  preferred_language text null,
  source text not null default 'homepage',
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  used_at timestamptz null
);

create index if not exists newsletter_confirmation_tokens_token_idx
  on public.newsletter_confirmation_tokens (token);

alter table public.system_email_automations enable row level security;
alter table public.newsletter_confirmation_tokens enable row level security;

create policy "Admins can view system email automations"
  on public.system_email_automations
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can update system email automations"
  on public.system_email_automations
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

insert into public.system_email_automations (key, enabled, config)
values
  ('newsletter-confirmation', true, '{"resend_cooldown_minutes":15,"token_ttl_hours":72}'::jsonb),
  ('newsletter-welcome', true, '{}'::jsonb),
  ('newsletter-weekly-digest', true, '{"timezone":"Europe/Rome","weekday":2,"hour_local":7,"minute_local":0}'::jsonb)
on conflict (key) do nothing;
