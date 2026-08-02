/**
 * Audit, rate limit e idempotenza dei tool MCP.
 *
 * Tre problemi diversi, una tabella sola (`admin_mcp_audit_log`), perché sono
 * la stessa informazione vista da tre angoli: cosa è stato chiesto, quanto
 * spesso, ed era già stato fatto?
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpAuth } from "./context.js";

/** Oltre questa lunghezza un valore stringa viene troncato prima di finire in audit. */
const MAX_ARG_CHARS = 400;

export interface AuditHandle {
  id: string | null;
  startedAt: number;
}

/**
 * Gli argomenti finiscono in chiaro nell'audit: il corpo di un articolo no.
 * Serve sapere *cosa* è stato chiesto, non riprodurne il contenuto.
 */
export function redactArguments(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value.length > MAX_ARG_CHARS ? `${value.slice(0, MAX_ARG_CHARS)}… (${value.length} char)` : value;
    } else if (Array.isArray(value)) {
      out[key] = value.length > 20 ? `[${value.length} elementi]` : value;
    } else if (value && typeof value === "object") {
      const json = JSON.stringify(value);
      out[key] = json.length > MAX_ARG_CHARS ? `{oggetto, ${json.length} char}` : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Se lo stesso `client_request_id` è già stato eseguito con esito ok, restituisce
 * il risultato di allora. I client MCP ritentano sulle timeout e un retry di
 * `article_create_draft` altrimenti crea una seconda bozza.
 */
export async function findIdempotentResult(
  service: SupabaseClient,
  auth: McpAuth,
  tool: string,
  clientRequestId: string | null | undefined,
): Promise<{ result: unknown; targetId: string | null } | null> {
  if (!clientRequestId) return null;
  const { data, error } = await service
    .from("admin_mcp_audit_log")
    .select("result,target_id,outcome")
    .eq("token_id", auth.tokenId)
    .eq("tool", tool)
    .eq("client_request_id", clientRequestId)
    .eq("outcome", "ok")
    .maybeSingle();
  if (error) {
    console.error("[mcp/audit] idempotency lookup failed", error);
    return null;
  }
  if (!data) return null;
  return { result: (data as { result: unknown }).result, targetId: (data as { target_id: string | null }).target_id };
}

export async function beginAudit(
  service: SupabaseClient,
  auth: McpAuth,
  tool: string,
  args: unknown,
  clientRequestId?: string | null,
): Promise<AuditHandle> {
  const startedAt = Date.now();
  const { data, error } = await service
    .from("admin_mcp_audit_log")
    .insert({
      token_id: auth.tokenId,
      user_id: auth.userId,
      tool,
      arguments: redactArguments(args),
      outcome: "pending",
      client_request_id: clientRequestId ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // L'audit non deve impedire il lavoro, ma va rumoroso nei log: una chiamata
    // non tracciata è comunque un buco.
    console.error("[mcp/audit] insert failed", error);
    return { id: null, startedAt };
  }
  return { id: (data as { id: string } | null)?.id ?? null, startedAt };
}

export async function finishAudit(
  service: SupabaseClient,
  handle: AuditHandle,
  patch: {
    outcome: "ok" | "error" | "denied";
    error?: string;
    targetId?: string | null;
    result?: unknown;
    /**
     * Da usare quando la chiamata non ha prodotto effetti (anteprima): senza
     * questo, la successiva chiamata con lo stesso `client_request_id` e
     * `confirm: true` verrebbe servita dalla cache di idempotenza e non
     * eseguirebbe mai.
     */
    clearIdempotency?: boolean;
  },
): Promise<void> {
  if (!handle.id) return;
  const { error } = await service
    .from("admin_mcp_audit_log")
    .update({
      outcome: patch.outcome,
      error: patch.error ?? null,
      target_id: patch.targetId ?? null,
      result: patch.result ?? null,
      duration_ms: Date.now() - handle.startedAt,
      completed_at: new Date().toISOString(),
      ...(patch.clearIdempotency ? { client_request_id: null } : {}),
    })
    .eq("id", handle.id);
  if (error) console.error("[mcp/audit] update failed", error);
}

export type RateLimitKind = "read" | "write" | "email";

const RATE_LIMITS: Record<RateLimitKind, { max: number; windowSeconds: number }> = {
  read: { max: 240, windowSeconds: 3600 },
  write: { max: 60, windowSeconds: 3600 },
  // Un invio di prova è comunque un'email che parte davvero.
  email: { max: 5, windowSeconds: 3600 },
};

/** True se la chiamata è entro soglia. Riusa `consume_rate_limit` degli endpoint pubblici. */
export async function consumeRateLimit(
  service: SupabaseClient,
  auth: McpAuth,
  kind: RateLimitKind,
): Promise<boolean> {
  const { max, windowSeconds } = RATE_LIMITS[kind];
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_bucket: `mcp:${kind}`,
    p_identifier: auth.tokenId,
    p_max_requests: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[mcp/audit] rate limit rpc failed", error);
    // Un guasto del contatore non deve bloccare l'operatività admin.
    return true;
  }
  return data !== false;
}

export function rateLimitMessage(kind: RateLimitKind): string {
  const { max, windowSeconds } = RATE_LIMITS[kind];
  return `Limite raggiunto: ${max} chiamate ${kind} per ${Math.round(windowSeconds / 60)} minuti su questo token.`;
}
