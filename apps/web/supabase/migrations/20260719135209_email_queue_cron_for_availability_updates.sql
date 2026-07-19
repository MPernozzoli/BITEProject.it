-- Periodic email queue worker.
--
-- This also drains voyage availability updates because process-email-queue invokes
-- dispatch-voyage-availability-updates before sending queued transactional mail.

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
  service_role_key text := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'supabase_service_role_key'
    limit 1
  );
  request_id bigint;
begin
  if service_role_key is null or length(service_role_key) = 0 then
    raise exception 'Missing Vault secret supabase_service_role_key for email queue cron';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
    ),
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
  'Invokes process-email-queue from pg_cron using the service-role key stored in Vault.';

revoke execute on function public.invoke_email_queue_worker() from public, anon, authenticated;
grant execute on function public.invoke_email_queue_worker() to service_role, postgres;

select cron.schedule(
  'process-email-queue',
  '*/5 * * * *',
  $$select public.invoke_email_queue_worker();$$
)
where not exists (
  select 1 from cron.job where jobname = 'process-email-queue'
);
