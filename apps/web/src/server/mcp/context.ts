/**
 * Tipi condivisi del server MCP admin.
 *
 * Il server vive dentro una function Vercel (`api/mcp/index.ts`) e non ha stato
 * fra un'invocazione e l'altra: tutto ciò che serve a un tool arriva da qui,
 * costruito per singola richiesta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gli scope sono volutamente pochi e per dominio: servono a limitare un token,
 * non a modellare permessi fini (quelli restano nelle RLS e nel ruolo admin).
 */
export const MCP_SCOPES = [
  "articles:read",
  "articles:write",
  "plan:read",
  "plan:write",
  "newsletter:read",
  "newsletter:write",
  "mail:read",
  "mail:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** Scope proposti di default alla creazione di un token dalla UI admin. */
export const DEFAULT_MCP_SCOPES: McpScope[] = [
  "articles:read",
  "articles:write",
  "plan:read",
  "plan:write",
  "newsletter:read",
  "mail:read",
];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

export interface McpAuth {
  tokenId: string;
  tokenName: string;
  userId: string;
  email: string | null;
  scopes: McpScope[];
  expiresAt: string;
}

export interface McpContext {
  auth: McpAuth;
  /**
   * Client service role. Le RLS non si applicano: l'autorizzazione è già stata
   * fatta a monte (token valido + `has_role(user_id,'admin')` ancora vero) e i
   * tool leggono/scrivono solo le tabelle del backoffice.
   */
  service: SupabaseClient;
  supabaseUrl: string;
  serviceKey: string;
  siteUrl: string;
}

/** Errore che un tool può sollevare per rispondere con un messaggio pulito. */
export class McpToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export function requireScope(ctx: McpContext, scope: McpScope): void {
  if (!ctx.auth.scopes.includes(scope)) {
    throw new McpToolError(
      "missing_scope",
      `Il token "${ctx.auth.tokenName}" non ha lo scope ${scope}. Rigenera un token con quello scope da admin.biteproject.it → Profilo → Accesso agenti.`,
    );
  }
}
