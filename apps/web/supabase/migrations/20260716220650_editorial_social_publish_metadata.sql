-- Metadata returned by social platforms after an editorial target is published.

alter table public.editorial_publish_targets
  add column if not exists platform_post_id text,
  add column if not exists platform_permalink text,
  add column if not exists published_at timestamptz,
  add column if not exists metrics_synced_at timestamptz;

create index if not exists editorial_publish_targets_platform_post_idx
  on public.editorial_publish_targets (channel_id, platform_post_id)
  where platform_post_id is not null;

comment on column public.editorial_publish_targets.platform_post_id is
  'Provider-side post/media/video id returned by Instagram, YouTube or TikTok.';
comment on column public.editorial_publish_targets.platform_permalink is
  'Canonical public URL when returned or derivable after publishing.';
comment on column public.editorial_publish_targets.published_at is
  'Actual provider publish timestamp, distinct from planned publish_at.';
comment on column public.editorial_publish_targets.metrics_synced_at is
  'Last time provider metrics were read into editorial_post_insights.';

-- Version the scheduled autopublishing jobs. Supabase recommends pg_cron + pg_net
-- for Edge Function schedules, with the auth token read from Vault.
create or replace function public.invoke_editorial_edge_function(_function_name text)
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
  service_role_key text := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'supabase_service_role_key'
    limit 1
  );
  request_id bigint;
begin
  if _function_name not in ('publish-scheduled-articles', 'publish-social-queue') then
    raise exception 'Unsupported editorial edge function: %', _function_name;
  end if;

  if service_role_key is null or length(service_role_key) = 0 then
    raise exception 'Missing Vault secret supabase_service_role_key for editorial autopublishing cron';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/' || _function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'function', _function_name,
      'invoked_at', timezone('utc', now())
    )
  )
  into request_id;

  return request_id;
end;
$$;

revoke execute on function public.invoke_editorial_edge_function(text) from public, anon, authenticated;
grant execute on function public.invoke_editorial_edge_function(text) to service_role, postgres;

select cron.schedule(
  'publish-scheduled-articles',
  '* * * * *',
  $$select public.invoke_editorial_edge_function('publish-scheduled-articles');$$
)
where not exists (
  select 1 from cron.job where jobname = 'publish-scheduled-articles'
);

select cron.schedule(
  'publish-social-queue',
  '*/5 * * * *',
  $$select public.invoke_editorial_edge_function('publish-social-queue');$$
)
where not exists (
  select 1 from cron.job where jobname = 'publish-social-queue'
);
