-- OAuth 2.1 per il server MCP admin.
--
-- Serve ai client che non sanno mandare un header custom — i connector di
-- claude.ai, che vogliono il flusso "Connect" — e che secondo la specifica MCP
-- si aspettano un authorization server con metadata, registrazione dinamica e
-- PKCE.
--
-- Supabase Auth non può fare da AS per client terzi (niente dynamic client
-- registration, niente audience binding), quindi l'AS è minimale e vive nelle
-- function Vercel: **il login dell'umano resta di Supabase**, qui si aggiunge
-- solo il consenso e lo scambio di token.
--
-- I token emessi non sono una seconda specie: sono righe di
-- `admin_mcp_tokens` con `kind` diverso, così validazione, audit, rate limit e
-- revoca restano un solo percorso.

-- ============================================================================
-- Client registrati
-- ============================================================================

create table if not exists public.admin_mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  -- Confronto esatto in fase di /authorize e /token: niente wildcard, niente
  -- prefissi. Un redirect_uri non registrato è un tentativo di dirottamento.
  redirect_uris text[] not null,
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  -- Client pubblici con PKCE: nessun secret da custodire in un'app che gira
  -- sul browser di qualcun altro.
  token_endpoint_auth_method text not null default 'none',
  client_uri text,
  software_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  disabled_at timestamptz
);

alter table public.admin_mcp_oauth_clients enable row level security;
revoke all on table public.admin_mcp_oauth_clients from public, anon, authenticated;

-- ============================================================================
-- Authorization code
-- ============================================================================
--
-- Vita brevissima e uso singolo. `consumed_at` non serve a fare pulizia ma a
-- riconoscere il riuso: un code presentato due volte è il sintomo classico di
-- un code intercettato, e la reazione prevista è revocare quanto emesso.

create table if not exists public.admin_mcp_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.admin_mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scopes text[] not null default '{}'::text[],
  resource text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_mcp_oauth_codes_expiry_idx
  on public.admin_mcp_oauth_codes (expires_at);

alter table public.admin_mcp_oauth_codes enable row level security;
revoke all on table public.admin_mcp_oauth_codes from public, anon, authenticated;

-- ============================================================================
-- Token: stessa tabella, tre specie
-- ============================================================================

alter table public.admin_mcp_tokens
  add column if not exists kind text not null default 'manual',
  add column if not exists client_id text references public.admin_mcp_oauth_clients(client_id) on delete cascade,
  -- RFC 8707: il token vale per *questa* risorsa. Un access token emesso per
  -- un altro server MCP non deve essere spendibile qui.
  add column if not exists resource text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_mcp_tokens_kind_check'
  ) then
    alter table public.admin_mcp_tokens
      add constraint admin_mcp_tokens_kind_check
      check (kind in ('manual', 'oauth_access', 'oauth_refresh'));
  end if;
end $$;

create index if not exists admin_mcp_tokens_client_idx
  on public.admin_mcp_tokens (client_id, user_id)
  where client_id is not null;

comment on table public.admin_mcp_oauth_clients is
  'Client OAuth registrati dinamicamente (RFC 7591) per il server MCP admin.';
comment on table public.admin_mcp_oauth_codes is
  'Authorization code monouso con PKCE per il server MCP admin.';
comment on column public.admin_mcp_tokens.kind is
  'manual = token generato dal profilo admin; oauth_access/oauth_refresh = emessi dal flusso OAuth.';
