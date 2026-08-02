/**
 * Authorization server minimale per il server MCP admin.
 *
 * Esiste per un motivo solo: i connector di claude.ai non sanno mandare un
 * header custom, e la specifica MCP prevede che in quel caso il server si
 * comporti da OAuth 2.1 resource server con un AS che supporta metadata
 * (RFC 8414 / RFC 9728), registrazione dinamica (RFC 7591), PKCE e resource
 * indicators (RFC 8707).
 *
 * Cosa **non** fa: autenticare l'umano. Quello resta a Supabase — la pagina di
 * consenso gira nella SPA admin, con la sessione che l'admin ha già. Qui si
 * verifica solo che chi approva sia admin e si scambiano i token.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateToken, hashToken } from "./auth.js";
import { MCP_SCOPES, isMcpScope, type McpScope } from "./context.js";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

/** Percorso della pagina di consenso nella SPA admin. */
export const CONSENT_PATH = "/admin/mcp/authorize";

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  disabled_at: string | null;
}

/**
 * Origin da cui il server è stato raggiunto. Non è cablato: le preview Vercel
 * hanno un hostname diverso e l'issuer deve combaciare con l'URL che il client
 * ha davvero interrogato, altrimenti la validazione dei metadata fallisce.
 */
export function resolveOrigin(headers: Record<string, string | string[] | undefined>): string {
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const host = pick(headers["x-forwarded-host"]) || pick(headers["host"]) || "";
  const proto = pick(headers["x-forwarded-proto"]) || (host.startsWith("localhost") ? "http" : "https");
  if (!host) return (process.env.PUBLIC_ADMIN_URL || "https://admin.biteproject.it").replace(/\/$/, "");
  return `${proto}://${host}`.replace(/\/$/, "");
}

/** Identificatore canonico della risorsa protetta. */
export function resourceUrl(origin: string): string {
  return `${origin}/mcp`;
}

/**
 * `/mcp` e `/api/mcp` sono lo stesso endpoint (il primo è un rewrite): un
 * client che indica l'uno o l'altro come `resource` sta parlando della stessa
 * risorsa, e trattarli come diversi romperebbe il binding senza guadagnare
 * nulla in sicurezza.
 */
export function canonicalizeResource(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/\/$/, "");
  if (normalized === `${origin}/api/mcp`) return resourceUrl(origin);
  return normalized;
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Client pubblici: il segreto sarebbe comunque leggibile da chi usa il client.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: "https://biteproject.it",
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

// ============================================================================
// Client
// ============================================================================

function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    // Solo https, o localhost per lo sviluppo di un client.
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/**
 * Entrambe le chiavi dichiarate su entrambi i rami: il progetto compila senza
 * `strictNullChecks`, quindi il narrowing sull'unione discriminata non regge
 * e il chiamante deve poter leggere ok/error senza restringere prima.
 */
export function parseRegistrationRequest(body: Record<string, unknown>):
  | { ok: true; client_name: string; redirect_uris: string[]; client_uri: string | null; software_id: string | null; error?: undefined; description?: undefined }
  | { ok: false; error: string; description: string; client_name?: undefined; redirect_uris?: undefined; client_uri?: undefined; software_id?: undefined } {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris è obbligatorio." };
  }
  if (redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "redirect_uris deve contenere fino a 10 URL https (o http su localhost).",
    };
  }

  const authMethod = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (authMethod !== "none") {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Sono ammessi solo client pubblici con PKCE (token_endpoint_auth_method: none).",
    };
  }

  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types.map(String) : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "È supportato solo il grant authorization_code (più refresh_token).",
    };
  }

  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : "Client MCP";

  return {
    ok: true,
    client_name: name.slice(0, 120),
    redirect_uris: redirectUris as string[],
    client_uri: typeof body.client_uri === "string" ? body.client_uri.slice(0, 500) : null,
    software_id: typeof body.software_id === "string" ? body.software_id.slice(0, 120) : null,
  };
}

export function generateClientId(): string {
  return `bite_mcp_client_${randomBytes(16).toString("base64url")}`;
}

export async function loadClient(service: SupabaseClient, clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const { data, error } = await service
    .from("admin_mcp_oauth_clients")
    .select("client_id,client_name,redirect_uris,grant_types,token_endpoint_auth_method,disabled_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[mcp/oauth] client lookup failed", error);
    return null;
  }
  const client = data as OAuthClient | null;
  if (!client || client.disabled_at) return null;
  return client;
}

/** Confronto esatto: un redirect_uri "che comincia per" è un redirect aperto. */
export function isRegisteredRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

// ============================================================================
// Scope
// ============================================================================

export function parseScopes(raw: string | null | undefined): McpScope[] {
  if (!raw) return [];
  return raw
    .split(/[\s+]+/)
    .map((scope) => scope.trim())
    .filter((scope): scope is McpScope => isMcpScope(scope));
}

// ============================================================================
// PKCE
// ============================================================================

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ============================================================================
// Authorization code
// ============================================================================

export interface AuthorizationCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: McpScope[];
  resource: string | null;
}

export async function createAuthorizationCode(
  service: SupabaseClient,
  input: AuthorizationCodeInput,
): Promise<string> {
  const code = `bite_mcp_code_${randomBytes(32).toString("base64url")}`;
  const { error } = await service.from("admin_mcp_oauth_codes").insert({
    code_hash: hashToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    scopes: input.scopes,
    resource: input.resource,
    expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(`authorization_code_insert_failed: ${error.message}`);
  return code;
}

export interface StoredCode {
  id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scopes: string[];
  resource: string | null;
  expires_at: string;
  consumed_at: string | null;
}

export async function loadAuthorizationCode(service: SupabaseClient, code: string): Promise<StoredCode | null> {
  const { data, error } = await service
    .from("admin_mcp_oauth_codes")
    .select("id,client_id,user_id,redirect_uri,code_challenge,code_challenge_method,scopes,resource,expires_at,consumed_at")
    .eq("code_hash", hashToken(code))
    .maybeSingle();
  if (error) {
    console.error("[mcp/oauth] code lookup failed", error);
    return null;
  }
  return (data as StoredCode | null) ?? null;
}

export async function markCodeConsumed(service: SupabaseClient, id: string): Promise<void> {
  const { error } = await service
    .from("admin_mcp_oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[mcp/oauth] code consume failed", error);
}

/** Pulizia opportunistica: i code vivono cinque minuti, non serve un cron. */
export async function purgeExpiredCodes(service: SupabaseClient): Promise<void> {
  const { error } = await service
    .from("admin_mcp_oauth_codes")
    .delete()
    .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (error) console.error("[mcp/oauth] code purge failed", error);
}

// ============================================================================
// Token
// ============================================================================

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: McpScope[];
}

export async function issueTokenPair(
  service: SupabaseClient,
  params: { clientId: string; clientName: string; userId: string; scopes: McpScope[]; resource: string | null },
): Promise<IssuedTokens> {
  const access = generateToken("oauth_access");
  const refresh = generateToken("oauth_refresh");
  const now = Date.now();

  const { error } = await service.from("admin_mcp_tokens").insert([
    {
      user_id: params.userId,
      name: params.clientName,
      token_hash: access.hash,
      token_prefix: access.prefix,
      scopes: params.scopes,
      expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      kind: "oauth_access",
      client_id: params.clientId,
      resource: params.resource,
    },
    {
      user_id: params.userId,
      name: params.clientName,
      token_hash: refresh.hash,
      token_prefix: refresh.prefix,
      scopes: params.scopes,
      expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      kind: "oauth_refresh",
      client_id: params.clientId,
      resource: params.resource,
    },
  ]);
  if (error) throw new Error(`token_insert_failed: ${error.message}`);

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scopes: params.scopes,
  };
}

export interface RefreshRow {
  id: string;
  user_id: string;
  name: string;
  client_id: string | null;
  scopes: string[] | null;
  resource: string | null;
  expires_at: string;
  revoked_at: string | null;
  kind: string;
}

export async function loadRefreshToken(service: SupabaseClient, token: string): Promise<RefreshRow | null> {
  const { data, error } = await service
    .from("admin_mcp_tokens")
    .select("id,user_id,name,client_id,scopes,resource,expires_at,revoked_at,kind")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) {
    console.error("[mcp/oauth] refresh lookup failed", error);
    return null;
  }
  const row = data as RefreshRow | null;
  if (!row || row.kind !== "oauth_refresh") return null;
  return row;
}

export async function revokeToken(service: SupabaseClient, id: string): Promise<void> {
  const { error } = await service
    .from("admin_mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) console.error("[mcp/oauth] revoke failed", error);
}

/**
 * Revoca tutto ciò che un client possiede per un utente. Serve sia alla
 * disconnessione volontaria sia alla reazione al riuso di un authorization
 * code, che è il segnale che qualcuno lo ha intercettato.
 */
export async function revokeClientGrant(service: SupabaseClient, clientId: string, userId: string): Promise<void> {
  const { error } = await service
    .from("admin_mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) console.error("[mcp/oauth] grant revoke failed", error);
}

export function oauthError(error: string, description: string) {
  return { error, error_description: description };
}
