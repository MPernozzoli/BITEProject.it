-- Accesso MCP admin: token revocabili + audit log.
--
-- Il server MCP (`/api/mcp`, function Vercel) non usa la service key come
-- credenziale del client: ogni admin emette dai propri strumenti un token
-- opaco, con scope e scadenza, revocabile singolarmente. Qui vivono la tabella
-- dei token e il registro delle chiamate.
--
-- Entrambe le tabelle sono scritte **solo** dal service role: RLS attiva senza
-- policy, quindi anon/authenticated non leggono nulla nemmeno per sbaglio.
-- La UI admin passa dagli endpoint `/api/mcp/tokens`, che non restituiscono mai
-- l'hash.

-- ============================================================================
-- Token
-- ============================================================================

create table if not exists public.admin_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Etichetta scelta dall'admin ("MacBook Claude Code"): serve solo a
  -- riconoscere quale token revocare.
  name text not null,
  -- HMAC-SHA256 del token con `MCP_TOKEN_PEPPER`. Il valore in chiaro esiste
  -- una sola volta, nella risposta alla creazione.
  token_hash text not null unique,
  -- Primi caratteri del token in chiaro, per riconoscerlo in lista senza
  -- poterlo ricostruire.
  token_prefix text not null,
  scopes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists admin_mcp_tokens_user_idx
  on public.admin_mcp_tokens (user_id, created_at desc);

alter table public.admin_mcp_tokens enable row level security;
revoke all on table public.admin_mcp_tokens from public, anon, authenticated;

-- ============================================================================
-- Audit log
-- ============================================================================
--
-- Una riga per chiamata di tool. Scritta prima dell'effetto (`outcome =
-- 'pending'`) e aggiornata dopo: se una function serverless muore a metà, la
-- riga pending resta come traccia del tentativo.
--
-- `client_request_id` è anche la chiave di idempotenza: i client MCP ritentano
-- sulle timeout, e ripetere una `article_create_draft` significherebbe due
-- bozze. Con l'indice unico più sotto, il secondo tentativo trova la riga già
-- scritta e restituisce `result` invece di rieseguire.

create table if not exists public.admin_mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references public.admin_mcp_tokens(id) on delete set null,
  user_id uuid,
  tool text not null,
  -- Argomenti con i corpi lunghi troncati lato applicativo: qui serve capire
  -- cosa è stato chiesto, non riprodurre l'articolo.
  arguments jsonb not null default '{}'::jsonb,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'ok', 'error', 'denied')),
  error text,
  -- Id della risorsa toccata (articolo, slot, campagna) quando esiste.
  target_id text,
  result jsonb,
  client_request_id text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists admin_mcp_audit_log_recent_idx
  on public.admin_mcp_audit_log (created_at desc);

create index if not exists admin_mcp_audit_log_user_idx
  on public.admin_mcp_audit_log (user_id, created_at desc);

-- Solo le righe riuscite entrano nell'indice: un tentativo fallito non brucia
-- l'id per sempre, e il client può ritentare con lo stesso valore.
create unique index if not exists admin_mcp_audit_log_idempotency_idx
  on public.admin_mcp_audit_log (token_id, tool, client_request_id)
  where client_request_id is not null and outcome = 'ok';

alter table public.admin_mcp_audit_log enable row level security;
revoke all on table public.admin_mcp_audit_log from public, anon, authenticated;

comment on table public.admin_mcp_tokens is
  'Token opachi per il server MCP admin (/api/mcp). Hash HMAC con pepper lato Vercel, mai leggibili dal client.';
comment on table public.admin_mcp_audit_log is
  'Registro delle chiamate ai tool MCP admin. client_request_id fa anche da chiave di idempotenza.';
