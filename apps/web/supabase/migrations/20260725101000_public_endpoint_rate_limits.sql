-- Rate limit per endpoint pubblici non autenticati.
--
-- newsletter-subscribe aveva solo un honeypot e un cooldown per indirizzo:
-- niente impediva di iterare su migliaia di indirizzi diversi usando il nostro
-- dominio per spedire mail di conferma non richieste. Il contatore è per
-- (bucket, identificatore) con finestra scorrevole, così lo stesso meccanismo è
-- riusabile da altri endpoint pubblici.

create table if not exists public.request_rate_limits (
  bucket text not null,
  identifier text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, identifier)
);

create index if not exists request_rate_limits_updated_at_idx
  on public.request_rate_limits (updated_at);

alter table public.request_rate_limits enable row level security;

-- Nessuna policy: la tabella è scritta esclusivamente dalla funzione
-- security definer qui sotto, invocata dalle edge function con service role.
revoke all on table public.request_rate_limits from public, anon, authenticated;

/**
 * Registra una richiesta e dice se è consentita.
 * Ritorna true quando il chiamante è entro la soglia, false quando va respinto.
 */
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_identifier text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_expired boolean;
begin
  if p_identifier is null or length(trim(p_identifier)) = 0 then
    -- Senza un identificatore attendibile non si può limitare nulla:
    -- meglio lasciar passare che bloccare tutti dietro lo stesso valore vuoto.
    return true;
  end if;

  insert into public.request_rate_limits as r (
    bucket, identifier, window_started_at, request_count, updated_at
  )
  values (p_bucket, p_identifier, now(), 1, now())
  on conflict (bucket, identifier) do update
    set request_count = case
          when r.window_started_at < now() - make_interval(secs => p_window_seconds)
            then 1
          else r.request_count + 1
        end,
        window_started_at = case
          when r.window_started_at < now() - make_interval(secs => p_window_seconds)
            then now()
          else r.window_started_at
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Contatore a finestra scorrevole per endpoint pubblici. Ritorna true se la richiesta è entro la soglia.';

revoke execute on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role, postgres;

/** Elimina le finestre esaurite: la tabella non deve crescere all'infinito. */
create or replace function public.purge_expired_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.request_rate_limits
   where updated_at < now() - interval '2 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_expired_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_expired_rate_limits() to service_role, postgres;

select cron.schedule(
  'purge-expired-rate-limits',
  '30 3 * * *',
  $$select public.purge_expired_rate_limits();$$
);
