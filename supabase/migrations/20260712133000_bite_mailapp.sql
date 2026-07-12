-- Mailbox tables for the BITE admin mail console.
-- The UI and Vercel APIs use these tables for ordinary @biteproject.it mail,
-- automatic @mail.biteproject.it mail, inbound messages, sent messages and
-- Resend delivery tracking.

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message_id text,
  resend_email_id text,
  from_address text not null,
  from_name text,
  to_addresses text[] not null default '{}',
  subject text not null default '',
  text_body text,
  html_body text,
  headers jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  brand text not null default 'bite_ordinary'
    check (brand in ('bite_ordinary', 'bite_automatic', 'newsletter', 'transactional')),
  assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  assignment_reason text,
  push_notified_at timestamptz,
  read boolean not null default false,
  starred boolean not null default false,
  archived boolean not null default false,
  spam boolean not null default false
);
create index if not exists inbound_emails_brand_idx on public.inbound_emails (brand);
create index if not exists inbound_emails_created_at_idx on public.inbound_emails (created_at desc);
create index if not exists inbound_emails_read_idx on public.inbound_emails (read);
create index if not exists inbound_emails_archived_idx on public.inbound_emails (archived);
create index if not exists inbound_emails_spam_idx on public.inbound_emails (spam) where spam;
create index if not exists inbound_emails_resend_email_id_idx on public.inbound_emails (resend_email_id) where resend_email_id is not null;
create index if not exists inbound_emails_assigned_to_profile_idx
  on public.inbound_emails (assigned_to_profile_id)
  where assigned_to_profile_id is not null;
alter table public.inbound_emails enable row level security;
drop policy if exists "admins read inbound emails" on public.inbound_emails;
create policy "admins read inbound emails"
  on public.inbound_emails
  for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
drop policy if exists "admins update inbound emails" on public.inbound_emails;
create policy "admins update inbound emails"
  on public.inbound_emails
  for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create table if not exists public.sent_emails (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resend_message_id text,
  from_address text not null,
  from_name text,
  to_addresses text[] not null default '{}',
  subject text not null default '',
  html_body text,
  text_body text,
  brand text not null default 'bite_ordinary'
    check (brand in ('bite_ordinary', 'bite_automatic', 'newsletter', 'transactional')),
  sent_by_user_id uuid references auth.users(id) on delete set null,
  sent_by_name text,
  status text not null default 'sent'
    check (status in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked'))
);
create index if not exists sent_emails_brand_idx on public.sent_emails (brand);
create index if not exists sent_emails_created_at_idx on public.sent_emails (created_at desc);
create index if not exists sent_emails_resend_msg_id_idx on public.sent_emails (resend_message_id) where resend_message_id is not null;
create index if not exists sent_emails_sent_by_idx on public.sent_emails (sent_by_user_id) where sent_by_user_id is not null;
alter table public.sent_emails enable row level security;
drop policy if exists "admins read sent emails" on public.sent_emails;
create policy "admins read sent emails"
  on public.sent_emails
  for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
drop policy if exists "admins insert sent emails" on public.sent_emails;
create policy "admins insert sent emails"
  on public.sent_emails
  for insert
  to authenticated
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
drop policy if exists "admins update sent emails" on public.sent_emails;
create policy "admins update sent emails"
  on public.sent_emails
  for update
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create table if not exists public.email_tracking_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resend_email_id text not null,
  event_type text not null,
  from_address text,
  to_address text,
  subject text,
  brand text check (brand in ('bite_ordinary', 'bite_automatic', 'newsletter', 'transactional')),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists email_tracking_events_msg_id_idx on public.email_tracking_events (resend_email_id);
create index if not exists email_tracking_events_type_idx on public.email_tracking_events (event_type);
create index if not exists email_tracking_events_created_idx on public.email_tracking_events (created_at desc);
alter table public.email_tracking_events enable row level security;
drop policy if exists "admins read email tracking events" on public.email_tracking_events;
create policy "admins read email tracking events"
  on public.email_tracking_events
  for select
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));
create table if not exists public.email_spam_senders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  address text not null unique
);
create index if not exists email_spam_senders_address_idx on public.email_spam_senders (address);
alter table public.email_spam_senders enable row level security;
drop policy if exists "admins manage email spam senders" on public.email_spam_senders;
create policy "admins manage email spam senders"
  on public.email_spam_senders
  for all
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create table if not exists public.admin_email_aliases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  alias text not null unique,
  source text not null default 'manual'
);
create index if not exists admin_email_aliases_profile_idx on public.admin_email_aliases (profile_id);
alter table public.admin_email_aliases enable row level security;
drop policy if exists "admins manage admin email aliases" on public.admin_email_aliases;
create policy "admins manage admin email aliases"
  on public.admin_email_aliases
  for all
  to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));
create or replace function public.refresh_admin_email_aliases()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  local_part text;
  cleaned_first text;
  cleaned_last text;
  name_parts text[];
begin
  for admin_profile in
    select p.id, p.email, p.name
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin'::public.app_role
  loop
    local_part := lower(split_part(admin_profile.email, '@', 1));
    if local_part <> '' then
      insert into public.admin_email_aliases (profile_id, alias, source)
      values (admin_profile.id, local_part, 'profile_email')
      on conflict (alias) do update set profile_id = excluded.profile_id, source = excluded.source;
    end if;

    name_parts := regexp_split_to_array(lower(coalesce(admin_profile.name, '')), '\s+');
    cleaned_first := regexp_replace(coalesce(name_parts[1], ''), '[^a-z0-9]', '', 'g');
    cleaned_last := regexp_replace(coalesce(name_parts[array_length(name_parts, 1)], ''), '[^a-z0-9]', '', 'g');

    if cleaned_first <> '' then
      insert into public.admin_email_aliases (profile_id, alias, source)
      values (admin_profile.id, cleaned_first, 'name_variant')
      on conflict (alias) do update set profile_id = excluded.profile_id, source = excluded.source;
    end if;

    if cleaned_first <> '' and cleaned_last <> '' and cleaned_first <> cleaned_last then
      insert into public.admin_email_aliases (profile_id, alias, source)
      values
        (admin_profile.id, cleaned_first || '.' || cleaned_last, 'name_variant'),
        (admin_profile.id, left(cleaned_first, 1) || cleaned_last, 'name_variant')
      on conflict (alias) do update set profile_id = excluded.profile_id, source = excluded.source;
    end if;
  end loop;
end;
$$;
revoke execute on function public.refresh_admin_email_aliases() from public, anon;
grant execute on function public.refresh_admin_email_aliases() to authenticated, service_role;
select public.refresh_admin_email_aliases();
