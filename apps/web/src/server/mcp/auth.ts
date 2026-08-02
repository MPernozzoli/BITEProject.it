/**
 * Autenticazione del server MCP admin.
 *
 * Il client MCP manda `Authorization: Bearer bite_mcp_...`. Qui si risale al
 * token, si controlla che sia vivo e che l'utente sia **ancora** admin: così
 * togliere il ruolo dalla tabella `user_roles` invalida immediatamente tutti i
 * suoi token, senza doverli revocare uno per uno.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMcpScope, type McpAuth, type McpScope } from "./context.js";

const TOKEN_PREFIX = "bite_mcp_";
/** Caratteri del token in chiaro conservati per riconoscerlo in lista. */
const VISIBLE_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

export type AuthFailure =
  | "missing_token"
  | "invalid_token"
  | "revoked_token"
  | "expired_token"
  | "not_admin"
  | "misconfigured";

/**
 * Entrambe le chiavi sono dichiarate su entrambi i rami: il progetto compila
 * senza `strictNullChecks` e il narrowing sull'unione discriminata non è
 * affidabile, quindi il chiamante deve poter leggere `reason` senza restringere.
 */
export type AuthResult =
  | { ok: true; auth: McpAuth; reason?: undefined }
  | { ok: false; auth?: undefined; reason: AuthFailure };

function pepper(): string {
  const value = process.env.MCP_TOKEN_PEPPER ?? "";
  if (value.length < 32) {
    // Meglio rifiutare tutto che accettare token hashati con un pepper vuoto:
    // sarebbe un hash pubblicamente riproducibile.
    throw new Error("mcp_token_pepper_unset");
  }
  return value;
}

/** HMAC-SHA256 del token in chiaro. Deterministico: serve per la lookup su indice. */
export function hashToken(token: string): string {
  return createHmac("sha256", pepper()).update(token).digest("hex");
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, VISIBLE_PREFIX_LENGTH),
  };
}

export function looksLikeMcpToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  scopes: string[] | null;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Risolve il token in un contesto autenticato. Non tocca le RLS: gira già con
 * service role perché la tabella dei token non è leggibile da nessun altro.
 */
export async function authenticate(service: SupabaseClient, rawToken: string | null): Promise<AuthResult> {
  if (!rawToken || !looksLikeMcpToken(rawToken)) return { ok: false, reason: "missing_token" };

  let hash: string;
  try {
    hash = hashToken(rawToken);
  } catch {
    return { ok: false, reason: "misconfigured" };
  }

  const { data, error } = await service
    .from("admin_mcp_tokens")
    .select("id,user_id,name,scopes,expires_at,revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error) {
    console.error("[mcp/auth] token lookup failed", error);
    return { ok: false, reason: "invalid_token" };
  }
  const row = data as TokenRow | null;
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.revoked_at) return { ok: false, reason: "revoked_token" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired_token" };

  const { data: isAdmin, error: roleError } = await service.rpc("has_role", {
    _user_id: row.user_id,
    _role: "admin",
  });
  if (roleError) {
    console.error("[mcp/auth] has_role failed", roleError);
    return { ok: false, reason: "not_admin" };
  }
  if (!isAdmin) return { ok: false, reason: "not_admin" };

  // Non blocca la risposta: serve solo a far vedere in UI quali token sono vivi.
  void service
    .from("admin_mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(({ error: updateError }) => {
      if (updateError) console.error("[mcp/auth] last_used_at update failed", updateError);
    });

  let email: string | null = null;
  try {
    const { data: userData } = await service.auth.admin.getUserById(row.user_id);
    email = userData?.user?.email ?? null;
  } catch (userError) {
    console.error("[mcp/auth] getUserById failed", userError);
  }

  const scopes = (row.scopes ?? []).filter(isMcpScope) as McpScope[];

  return {
    ok: true,
    auth: {
      tokenId: row.id,
      tokenName: row.name,
      userId: row.user_id,
      email,
      scopes,
      expiresAt: row.expires_at,
    },
  };
}

export function authFailureStatus(reason: AuthFailure): number {
  if (reason === "misconfigured") return 500;
  if (reason === "not_admin") return 403;
  return 401;
}

export function authFailureMessage(reason: AuthFailure): string {
  switch (reason) {
    case "missing_token":
      return "Manca l'header Authorization: Bearer con un token MCP.";
    case "revoked_token":
      return "Questo token è stato revocato.";
    case "expired_token":
      return "Questo token è scaduto: generane uno nuovo dal profilo admin.";
    case "not_admin":
      return "L'utente del token non ha più il ruolo admin.";
    case "misconfigured":
      return "Server MCP non configurato (MCP_TOKEN_PEPPER assente).";
    default:
      return "Token MCP non valido.";
  }
}
