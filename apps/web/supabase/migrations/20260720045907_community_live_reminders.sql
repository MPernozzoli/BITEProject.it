create table public.community_live_event_reminders (
  id uuid primary key default gen_random_uuid(),
  live_event_id uuid not null references public.community_live_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  remind_before_minutes integer not null default 10,
  advance_email_sent_at timestamptz,
  advance_push_sent_at timestamptz,
  start_email_sent_at timestamptz,
  start_push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_live_event_reminders_unique_profile unique (live_event_id, profile_id),
  constraint community_live_event_reminders_before_range
    check (remind_before_minutes between 1 and 120)
);

create index community_live_event_reminders_event_idx
  on public.community_live_event_reminders(live_event_id);

create index community_live_event_reminders_profile_idx
  on public.community_live_event_reminders(profile_id, created_at desc);

create index community_live_event_reminders_due_idx
  on public.community_live_event_reminders(live_event_id, remind_before_minutes)
  where advance_email_sent_at is null
     or advance_push_sent_at is null
     or start_email_sent_at is null
     or start_push_sent_at is null;

create trigger community_live_event_reminders_touch_updated_at
  before update on public.community_live_event_reminders
  for each row execute function public.touch_updated_at();

alter table public.community_live_event_reminders enable row level security;

create policy "Members read their live reminders"
  on public.community_live_event_reminders for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin')
  );

create policy "Members create their live reminders"
  on public.community_live_event_reminders for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.can_read_community_live_event(live_event_id, (select auth.uid()))
  );

create policy "Members update their live reminders"
  on public.community_live_event_reminders for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin')
  )
  with check (
    (
      profile_id = (select auth.uid())
      and public.can_read_community_live_event(live_event_id, (select auth.uid()))
    )
    or public.has_role((select auth.uid()), 'admin')
  );

create policy "Members delete their live reminders"
  on public.community_live_event_reminders for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'admin')
  );

grant select, insert, update, delete on public.community_live_event_reminders to authenticated;

create or replace function public.dispatch_community_live_event_email_reminders(_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  row record;
  sent_count integer := 0;
  live_url text := 'https://crew.biteproject.it/live';
  message_id text;
  starts_label text;
begin
  for row in
    select
      r.id,
      r.live_event_id,
      r.profile_id,
      r.remind_before_minutes,
      e.title,
      e.starts_at,
      p.email,
      coalesce(p.name, 'Crew') as profile_name
    from public.community_live_event_reminders r
    join public.community_live_events e on e.id = r.live_event_id
    join public.profiles p on p.id = r.profile_id
    where r.advance_email_sent_at is null
      and p.email is not null
      and e.starts_at between now() and now() + make_interval(mins => r.remind_before_minutes)
    order by e.starts_at asc
    limit greatest(_limit, 1)
  loop
    message_id := 'community-live-reminder-' || row.id || '-advance';
    starts_label := to_char(row.starts_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI');

    perform public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id', message_id,
      'to', row.email,
      'from', 'BITE Crew <noreply@mail.biteproject.it>',
      'sender_domain', 'mail.biteproject.it',
      'subject', 'La live BITE Crew sta per iniziare',
      'html',
        '<p>Ciao ' || row.profile_name || ',</p>' ||
        '<p>Ti avvisiamo come richiesto: la live <strong>' || row.title || '</strong> inizia alle ' || starts_label || '.</p>' ||
        '<p>Entra da qui: <a href="' || live_url || '">' || live_url || '</a></p>',
      'text',
        'Ciao ' || row.profile_name || E',\n\n' ||
        'Ti avvisiamo come richiesto: la live "' || row.title || '" inizia alle ' || starts_label || E'.\n\n' ||
        'Entra da qui: ' || live_url,
      'purpose', 'transactional',
      'label', 'community_live_advance_reminder',
      'idempotency_key', message_id,
      'metadata', jsonb_build_object(
        'live_event_id', row.live_event_id,
        'profile_id', row.profile_id,
        'starts_at', row.starts_at,
        'remind_before_minutes', row.remind_before_minutes
      ),
      'queued_at', now()
    ));

    update public.community_live_event_reminders
    set advance_email_sent_at = now(),
        updated_at = now()
    where id = row.id;
    sent_count := sent_count + 1;
  end loop;

  for row in
    select
      r.id,
      r.live_event_id,
      r.profile_id,
      e.title,
      e.starts_at,
      p.email,
      coalesce(p.name, 'Crew') as profile_name
    from public.community_live_event_reminders r
    join public.community_live_events e on e.id = r.live_event_id
    join public.profiles p on p.id = r.profile_id
    where r.start_email_sent_at is null
      and p.email is not null
      and e.starts_at <= now()
      and e.starts_at > now() - interval '30 minutes'
    order by e.starts_at asc
    limit greatest(_limit, 1)
  loop
    message_id := 'community-live-reminder-' || row.id || '-start';

    perform public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id', message_id,
      'to', row.email,
      'from', 'BITE Crew <noreply@mail.biteproject.it>',
      'sender_domain', 'mail.biteproject.it',
      'subject', 'La live BITE Crew è iniziata',
      'html',
        '<p>Ciao ' || row.profile_name || ',</p>' ||
        '<p>La live <strong>' || row.title || '</strong> è iniziata adesso.</p>' ||
        '<p>Guarda e partecipa alla chat da qui: <a href="' || live_url || '">' || live_url || '</a></p>',
      'text',
        'Ciao ' || row.profile_name || E',\n\n' ||
        'La live "' || row.title || E'" è iniziata adesso.\n\n' ||
        'Guarda e partecipa alla chat da qui: ' || live_url,
      'purpose', 'transactional',
      'label', 'community_live_start_reminder',
      'idempotency_key', message_id,
      'metadata', jsonb_build_object(
        'live_event_id', row.live_event_id,
        'profile_id', row.profile_id,
        'starts_at', row.starts_at
      ),
      'queued_at', now()
    ));

    update public.community_live_event_reminders
    set start_email_sent_at = now(),
        updated_at = now()
    where id = row.id;
    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

revoke execute on function public.dispatch_community_live_event_email_reminders(integer) from public, anon, authenticated;
grant execute on function public.dispatch_community_live_event_email_reminders(integer) to service_role, postgres;

create or replace function public.list_due_community_live_event_push_reminders(_limit integer default 100)
returns table (
  reminder_id uuid,
  live_event_id uuid,
  profile_id uuid,
  title text,
  starts_at timestamptz,
  remind_before_minutes integer,
  advance_push_due boolean,
  start_push_due boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    r.id as reminder_id,
    r.live_event_id,
    r.profile_id,
    e.title,
    e.starts_at,
    r.remind_before_minutes,
    (
      r.advance_push_sent_at is null
      and e.starts_at between now() and now() + make_interval(mins => r.remind_before_minutes)
    ) as advance_push_due,
    (
      r.start_push_sent_at is null
      and e.starts_at <= now()
      and e.starts_at > now() - interval '30 minutes'
    ) as start_push_due
  from public.community_live_event_reminders r
  join public.community_live_events e on e.id = r.live_event_id
  where (
      r.advance_push_sent_at is null
      and e.starts_at between now() and now() + make_interval(mins => r.remind_before_minutes)
    )
    or (
      r.start_push_sent_at is null
      and e.starts_at <= now()
      and e.starts_at > now() - interval '30 minutes'
    )
  order by e.starts_at asc
  limit greatest(_limit, 1)
$$;

revoke execute on function public.list_due_community_live_event_push_reminders(integer) from public, anon, authenticated;
grant execute on function public.list_due_community_live_event_push_reminders(integer) to service_role, postgres;

create or replace function public.invoke_email_queue_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  project_url text := coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1),
    'https://ekwloweuicrqjjgabfdp.supabase.co'
  );
  cron_secret text := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'email_queue_cron_secret'
    limit 1
  );
  service_role_key text := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'supabase_service_role_key'
    limit 1
  );
  request_headers jsonb;
  request_id bigint;
begin
  perform public.dispatch_membership_renewal_reminders(100);
  perform public.dispatch_community_live_event_email_reminders(100);

  if cron_secret is not null and length(cron_secret) > 0 then
    request_headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    );
  elsif service_role_key is not null and length(service_role_key) > 0 then
    request_headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
    );
  else
    raise exception 'Missing Vault secret email_queue_cron_secret or supabase_service_role_key for email queue cron';
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/dispatch-community-live-notifications',
    headers := request_headers,
    body := jsonb_build_object(
      'source', 'pg_cron',
      'function', 'dispatch-community-live-notifications',
      'invoked_at', timezone('utc', now())
    )
  );

  select net.http_post(
    url := project_url || '/functions/v1/process-email-queue',
    headers := request_headers,
    body := jsonb_build_object(
      'source', 'pg_cron',
      'function', 'process-email-queue',
      'invoked_at', timezone('utc', now())
    )
  )
  into request_id;

  return request_id;
end;
$$;

revoke execute on function public.invoke_email_queue_worker() from public, anon, authenticated;
grant execute on function public.invoke_email_queue_worker() to service_role, postgres;
