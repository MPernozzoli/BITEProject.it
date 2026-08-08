/**
 * Tipi condivisi del server MCP admin.
 *
 * Il server vive dentro una function Vercel (`api/mcp/index.ts`) e non ha stato
 * fra un'invocazione e l'altra: tutto ciò che serve a un tool arriva da qui,
 * costruito per singola richiesta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpScope } from "../../lib/mcp-scopes.js";

/**
 * Gli scope sono volutamente pochi e per dominio: servono a limitare un token,
 * non a modellare permessi fini (quelli restano nelle RLS e nel ruolo admin).
 *
 * Elenco, tipo e default vivono in `lib/mcp-scopes.ts` — non qui — perché
 * quel modulo lo importano anche le due UI che li mostrano a un umano
 * (creazione token, consenso OAuth): un solo posto dove aggiungerne uno
 * nuovo, non tre elenchi da tenere allineati a mano.
 */
export { MCP_SCOPES, DEFAULT_MCP_SCOPES, isMcpScope, type McpScope } from "../../lib/mcp-scopes.js";

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
