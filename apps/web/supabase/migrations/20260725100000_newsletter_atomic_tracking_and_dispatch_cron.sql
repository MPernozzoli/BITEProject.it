-- Newsletter: contatori di tracking atomici + cron di dispatch.
--
-- 1. newsletter_register_open / newsletter_register_click sostituiscono il
--    read-modify-write delle edge function di tracking: le aperture concorrenti
--    (proxy immagini, client multipli) si perdevano perche' il conteggio veniva
--    letto e riscritto in due istruzioni separate.
--
-- 2. invoke_newsletter_dispatch + job pg_cron: nessuno invocava
--    newsletter-dispatch su base periodica, quindi campagne schedulate,
--    automazioni su iscrizione/disiscrizione e digest settimanale non
--    partivano mai da soli. L'unico trigger era il bottone "Invia ora".

-- ============ contatori atomici ============

create or replace function public.newsletter_register_open(
  p_delivery_id uuid,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.newsletter_deliveries
     set open_count = coalesce(open_count, 0) + 1,
         first_opened_at = coalesce(first_opened_at, now()),
         last_opened_at = now(),
         -- un click gia' registrato e' uno stato piu' avanzato di un'apertura
         status = case when status = 'clicked' then 'clicked' else 'opened' end
   where id = p_delivery_id
     and tracker_token = p_token;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.newsletter_register_open(uuid, text) is
  'Incrementa atomicamente il contatore aperture di una delivery newsletter. Ritorna false se delivery/token non corrispondono.';

create or replace function public.newsletter_register_click(
  p_delivery_id uuid,
  p_token text,
  p_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.newsletter_deliveries
     set click_count = coalesce(click_count, 0) + 1,
         first_clicked_at = coalesce(first_clicked_at, now()),
         last_clicked_at = now(),
         last_clicked_url = p_url,
         status = 'clicked'
   where id = p_delivery_id
     and tracker_token = p_token;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.newsletter_register_click(uuid, text, text) is
  'Incrementa atomicamente il contatore click di una delivery newsletter. Ritorna false se delivery/token non corrispondono: il chiamante deve rifiutare il redirect.';

revoke execute on function public.newsletter_register_open(uuid, text) from public, anon, authenticated;
revoke execute on function public.newsletter_register_click(uuid, text, text) from public, anon, authenticated;
grant execute on function public.newsletter_register_open(uuid, text) to service_role, postgres;
grant execute on function public.newsletter_register_click(uuid, text, text) to service_role, postgres;

-- ============ cron di dispatch newsletter ============

-- Stesso schema di invoke_email_queue_worker(): autenticazione con il secret
-- dedicato in Vault, fallback su service-role key. Riusa volutamente
-- `email_queue_cron_secret` cosi' non serve configurare un nuovo segreto:
-- newsletter-dispatch accetta lo stesso header x-cron-secret.
create or replace function public.invoke_newsletter_dispatch()
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
    raise exception 'Missing Vault secret email_queue_cron_secret or supabase_service_role_key for newsletter dispatch cron';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/newsletter-dispatch',
    headers := request_headers,
    body := jsonb_build_object(
      'source', 'pg_cron',
      'function', 'newsletter-dispatch',
      'processEvents', true,
      'invoked_at', timezone('utc', now())
    )
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.invoke_newsletter_dispatch() is
  'Invoca newsletter-dispatch da pg_cron: campagne schedulate in scadenza, automazioni iscrizione/disiscrizione e digest settimanale.';

revoke execute on function public.invoke_newsletter_dispatch() from public, anon, authenticated;
grant execute on function public.invoke_newsletter_dispatch() to service_role, postgres;

-- cron.schedule fa upsert sul nome del job, quindi e' idempotente.
select cron.schedule(
  'newsletter-dispatch',
  '*/5 * * * *',
  $$select public.invoke_newsletter_dispatch();$$
);
