-- Let the email queue cron authenticate with a dedicated revocable secret.

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

comment on function public.invoke_email_queue_worker() is
  'Invokes process-email-queue from pg_cron using a dedicated Vault cron secret, falling back to service-role key when configured.';

revoke execute on function public.invoke_email_queue_worker() from public, anon, authenticated;
grant execute on function public.invoke_email_queue_worker() to service_role, postgres;
