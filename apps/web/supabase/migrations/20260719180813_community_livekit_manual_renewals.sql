-- BITE Crew refinements:
-- - community moderation role using existing app_role = 'moderator'
-- - LiveKit room metadata on live events
-- - manual renewal membership model with monthly/yearly prices and 1-3 period purchases
-- - renewal reminder queueing through the existing transactional email queue

alter table public.membership_tiers
  add column if not exists tier_family text,
  add column if not exists renewal_policy text not null default 'manual',
  add column if not exists sort_label text;

update public.membership_tiers
set tier_family = coalesce(tier_family, slug),
    renewal_policy = 'manual',
    sort_label = coalesce(sort_label, name)
where tier_family is null;

alter table public.membership_tiers
  alter column tier_family set not null,
  add constraint membership_tiers_renewal_policy_check
    check (renewal_policy in ('manual')),
  add constraint membership_tiers_family_interval_unique
    unique (tier_family, billing_interval);

alter table public.membership_payments
  add column if not exists period_count smallint not null default 1
    check (period_count between 1 and 3);

alter table public.membership_subscriptions
  add column if not exists renewal_reminder_sent_at timestamptz,
  add column if not exists expired_reminder_sent_at timestamptz,
  add column if not exists grace_period_end timestamptz;

alter table public.community_live_events
  add column if not exists livekit_room_name text unique,
  add column if not exists livekit_mode text not null default 'video'
    check (livekit_mode in ('video', 'audio', 'stage', 'off'));

create or replace function public.has_community_moderation_role(_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.has_role(_user_id, 'admin'::public.app_role), false)
    or coalesce(public.has_role(_user_id, 'moderator'::public.app_role), false);
$$;

update public.membership_tiers
set
  name = 'Deck',
  description = 'Feed riservato, commenti, poll e aggiornamenti live testuali.',
  price_cents = 300,
  currency = 'EUR',
  billing_interval = 'month',
  tier_order = 10,
  tier_family = 'deck',
  sort_label = 'Base',
  benefits = '{"community_feed": true, "comments": true, "polls": true, "early_access_hours": 24}'::jsonb,
  is_active = true
where slug = 'deck';

update public.membership_tiers
set
  name = 'Wake',
  description = 'Tutto Deck, piu live chat, Q&A e contenuti lunghi.',
  price_cents = 500,
  currency = 'EUR',
  billing_interval = 'month',
  tier_order = 20,
  tier_family = 'wake',
  sort_label = 'Intermedio',
  benefits = '{"community_feed": true, "comments": true, "polls": true, "live_chat": true, "early_access_hours": 72}'::jsonb,
  is_active = true
where slug = 'wake';

update public.membership_tiers
set
  name = 'Harbor',
  description = 'Tutto Wake, live room prioritarie, briefing privati e benefit accessori sui viaggi.',
  price_cents = 1000,
  currency = 'EUR',
  billing_interval = 'month',
  tier_order = 30,
  tier_family = 'harbor',
  sort_label = 'Top',
  benefits = '{"community_feed": true, "comments": true, "polls": true, "live_chat": true, "livekit_publish": true, "private_briefings": true, "early_access_hours": 168, "waive_fixed_minimum_cents": 2000}'::jsonb,
  is_active = true
where slug = 'harbor';

insert into public.membership_tiers (slug, name, description, price_cents, currency, billing_interval, tier_order, tier_family, sort_label, renewal_policy, benefits, is_active)
values
  ('deck-year', 'Deck annuale', 'Un anno di Deck con rinnovo manuale e promemoria prima della scadenza.', 3000, 'EUR', 'year', 11, 'deck', 'Base', 'manual', '{"community_feed": true, "comments": true, "polls": true, "early_access_hours": 24}'::jsonb, true),
  ('wake-year', 'Wake annuale', 'Un anno di Wake con rinnovo manuale e promemoria prima della scadenza.', 5000, 'EUR', 'year', 21, 'wake', 'Intermedio', 'manual', '{"community_feed": true, "comments": true, "polls": true, "live_chat": true, "early_access_hours": 72}'::jsonb, true),
  ('harbor-year', 'Harbor annuale', 'Un anno di Harbor con rinnovo manuale e promemoria prima della scadenza.', 10000, 'EUR', 'year', 31, 'harbor', 'Top', 'manual', '{"community_feed": true, "comments": true, "polls": true, "live_chat": true, "livekit_publish": true, "private_briefings": true, "early_access_hours": 168, "waive_fixed_minimum_cents": 2000}'::jsonb, true)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    billing_interval = excluded.billing_interval,
    tier_order = excluded.tier_order,
    tier_family = excluded.tier_family,
    sort_label = excluded.sort_label,
    renewal_policy = excluded.renewal_policy,
    benefits = excluded.benefits,
    is_active = excluded.is_active;

create or replace function public.membership_period_end(_start timestamptz, _billing_interval text, _period_count integer)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  if _period_count < 1 or _period_count > 3 then
    raise exception 'period_count must be between 1 and 3';
  end if;

  if _billing_interval = 'year' then
    return _start + make_interval(years => _period_count);
  elsif _billing_interval = 'month' then
    return _start + make_interval(months => _period_count);
  elsif _billing_interval = 'one_time' then
    return null;
  end if;

  raise exception 'Unsupported billing interval: %', _billing_interval;
end;
$$;

create or replace function public.dispatch_membership_renewal_reminders(_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  queued_count integer := 0;
  row record;
  renew_url text := 'https://crew.biteproject.it/account';
  message_id text;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  for row in
    select
      s.id,
      s.profile_id,
      s.current_period_end,
      s.renewal_reminder_sent_at,
      s.expired_reminder_sent_at,
      p.email,
      coalesce(p.name, 'Crew') as profile_name,
      t.name as tier_name,
      t.slug as tier_slug
    from public.membership_subscriptions s
    join public.profiles p on p.id = s.profile_id
    join public.membership_tiers t on t.id = s.tier_id
    where s.status in ('trialing', 'active', 'past_due')
      and s.current_period_end is not null
      and p.email is not null
      and (
        (
          s.current_period_end between now() and now() + interval '7 days'
          and s.renewal_reminder_sent_at is null
        )
        or (
          s.current_period_end < now()
          and s.expired_reminder_sent_at is null
        )
      )
    order by s.current_period_end asc
    limit greatest(_limit, 1)
  loop
    message_id := 'membership-renewal-' || row.id || '-' ||
      case when row.current_period_end < now() then 'expired' else 'upcoming' end;

    perform public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id', message_id,
      'to', row.email,
      'from', 'BITE Project <noreply@mail.biteproject.it>',
      'sender_domain', 'mail.biteproject.it',
      'subject',
        case
          when row.current_period_end < now()
            then 'Il tuo Crew Pass è scaduto: rinnovi solo se vuoi'
          else 'Promemoria Crew Pass: rinnovo manuale in scadenza'
        end,
      'html',
        '<p>Ciao ' || row.profile_name || ',</p>' ||
        '<p>Il tuo Crew Pass ' || row.tier_name || ' ' ||
        case
          when row.current_period_end < now() then 'è scaduto.'
          else 'scade il ' || to_char(row.current_period_end at time zone 'Europe/Rome', 'DD/MM/YYYY') || '.'
        end ||
        '</p><p>Non facciamo rinnovi automatici: preferiamo che l’equipaggio partecipi per scelta, non perché parte l’ennesimo abbonamento dimenticato.</p>' ||
        '<p>Puoi rinnovare da qui: <a href="' || renew_url || '">' || renew_url || '</a></p>',
      'text',
        'Ciao ' || row.profile_name || E',\n\n' ||
        'Il tuo Crew Pass ' || row.tier_name || ' ' ||
        case
          when row.current_period_end < now() then 'è scaduto.'
          else 'scade il ' || to_char(row.current_period_end at time zone 'Europe/Rome', 'DD/MM/YYYY') || '.'
        end ||
        E'\n\nNon facciamo rinnovi automatici: preferiamo che l’equipaggio partecipi per scelta, non perché parte l’ennesimo abbonamento dimenticato.\n\n' ||
        'Puoi rinnovare da qui: ' || renew_url,
      'purpose', 'transactional',
      'label', 'membership_renewal_reminder',
      'idempotency_key', message_id,
      'metadata', jsonb_build_object(
        'subscription_id', row.id,
        'tier_slug', row.tier_slug,
        'period_end', row.current_period_end
      ),
      'queued_at', now()
    ));

    if row.current_period_end < now() then
      update public.membership_subscriptions
      set expired_reminder_sent_at = now(),
          status = case when status = 'active' then 'past_due'::public.membership_subscription_status else status end,
          updated_at = now()
      where id = row.id;
    else
      update public.membership_subscriptions
      set renewal_reminder_sent_at = now(),
          updated_at = now()
      where id = row.id;
    end if;

    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

revoke execute on function public.dispatch_membership_renewal_reminders(integer) from public, anon, authenticated;
grant execute on function public.dispatch_membership_renewal_reminders(integer) to service_role, postgres;

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

drop policy if exists "Members update their comments and admins moderate" on public.community_comments;
drop policy if exists "Members delete their comments and admins moderate" on public.community_comments;
drop policy if exists "Members update their live messages and admins moderate" on public.community_live_messages;
drop policy if exists "Members delete their live messages and admins moderate" on public.community_live_messages;

create policy "Members update their comments and community moderators moderate"
  on public.community_comments for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  )
  with check (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  );

create policy "Members delete their comments and community moderators moderate"
  on public.community_comments for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  );

create policy "Members update their live messages and community moderators moderate"
  on public.community_live_messages for update
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  )
  with check (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  );

create policy "Members delete their live messages and community moderators moderate"
  on public.community_live_messages for delete
  to authenticated
  using (
    profile_id = (select auth.uid())
    or public.has_community_moderation_role((select auth.uid()))
  );

grant execute on function public.has_community_moderation_role(uuid) to authenticated;
grant execute on function public.membership_period_end(timestamptz, text, integer) to anon, authenticated;
