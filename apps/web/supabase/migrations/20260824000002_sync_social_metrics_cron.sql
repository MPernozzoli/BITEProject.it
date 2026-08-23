-- Wire sync-social-metrics into the existing pg_cron invocation pattern.

-- 1. Extend invoke_editorial_edge_function to support sync-social-metrics
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
  cron_secret_name text;
  cron_secret text;
  service_role_key text := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'supabase_service_role_key'
    limit 1
  );
  request_headers jsonb;
  request_id bigint;
begin
  if _function_name = 'publish-scheduled-articles' then
    cron_secret_name := 'scheduled_articles_cron_secret';
  elsif _function_name = 'publish-social-queue' then
    cron_secret_name := 'social_publish_cron_secret';
  elsif _function_name = 'editorial-readiness-alert' then
    cron_secret_name := 'editorial_alert_cron_secret';
  elsif _function_name = 'sync-social-metrics' then
    cron_secret_name := 'social_metrics_cron_secret';
  else
    raise exception 'Unsupported editorial edge function: %', _function_name;
  end if;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = cron_secret_name
  limit 1;

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
    raise exception 'Missing Vault secret % or supabase_service_role_key for editorial autopublishing cron', cron_secret_name;
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/' || _function_name,
    headers := request_headers,
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

comment on function public.invoke_editorial_edge_function(text) is
  'Invokes editorial Edge Functions from pg_cron using per-function Vault cron secrets, falling back to service-role key when configured.';

-- 2. Schedule daily cron for sync-social-metrics (runs at 06:00 UTC every day)
select cron.schedule(
  'sync-social-metrics-daily',
  '0 6 * * *',
  $$select public.invoke_editorial_edge_function('sync-social-metrics');$$
)
where not exists (
  select 1 from cron.job where jobname = 'sync-social-metrics-daily'
);
