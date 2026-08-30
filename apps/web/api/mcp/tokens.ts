/**
 * GET/POST/PATCH/DELETE /api/mcp/tokens — gestione delle sessioni MCP admin.
 *
 * Autenticazione con il normale access token Supabase dell'admin loggato: la
 * UI (`/profile` → Accesso agenti) chiama questi endpoint, non la tabella,
 * perché l'hash del token non deve essere leggibile da nessun client e il
 * pepper vive solo qui.
 *
 * Il valore in chiaro del token esiste una sola volta, nella risposta alla
 * POST: non è recuperabile dopo.
 *
 * La GET elenca **sessioni**, non righe: un accesso OAuth vive come coppia
 * access + refresh e si rinnova ruotando, quindi la stessa connessione
 * lascerebbe in lista decine di righe morte. Qui si vede una riga per sessione
 * viva, e revocarla o cambiarne i permessi agisce su tutte le sue righe — così
 * un client già configurato guadagna uno scope nuovo senza rifare il consenso.
 */
import { createAuthClient, createServiceClient } from "../../src/server/bunq/supabase.js";
import {
  bearerToken,
  firstQueryParam,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";
import { generateToken } from "../../src/server/mcp/auth.js";
import { DEFAULT_MCP_SCOPES, MCP_SCOPES, isMcpScope } from "../../src/server/mcp/context.js";

const MAX_ACTIVE_TOKENS = 20;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;

const LIST_COLUMNS = "id,name,token_prefix,scopes,created_at,expires_at,last_used_at,revoked_at,kind,client_id";

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[] | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  kind: string | null;
  client_id: string | null;
}

interface McpSession {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  /** `manual` = token generato qui; `oauth` = client autorizzato col consenso. */
  kind: "manual" | "oauth";
  client_id: string | null;
  /** Quante righe token compongono la sessione: revoca e PATCH le toccano tutte. */
  token_count: number;
}

function maxDate(values: (string | null)[]): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
}

/**
 * Da righe token a sessioni. Le righe OAuth dello stesso client sono una sola
 * sessione: il refresh (30 giorni) la rappresenta, perché è lui a dire fino a
 * quando la connessione resta viva; l'access token dura un'ora e si rinnova.
 */
function toSessions(rows: TokenRow[]): McpSession[] {
  const sessions: McpSession[] = [];
  const byClient = new Map<string, TokenRow[]>();

  for (const row of rows) {
    if (row.kind === "oauth_access" || row.kind === "oauth_refresh") {
      const key = row.client_id ?? `orphan:${row.id}`;
      const group = byClient.get(key) ?? [];
      group.push(row);
      byClient.set(key, group);
      continue;
    }
    sessions.push({
      id: row.id,
      name: row.name,
      token_prefix: row.token_prefix,
      scopes: row.scopes ?? [],
      created_at: row.created_at,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      kind: "manual",
      client_id: null,
      token_count: 1,
    });
  }

  for (const group of byClient.values()) {
    const representative = group.find((row) => row.kind === "oauth_refresh") ?? group[0];
    sessions.push({
      id: representative.id,
      name: representative.name,
      token_prefix: representative.token_prefix,
      scopes: representative.scopes ?? [],
      created_at: group.reduce((oldest, row) => (row.created_at < oldest ? row.created_at : oldest), representative.created_at),
      expires_at: representative.expires_at,
      last_used_at: maxDate(group.map((row) => row.last_used_at)),
      kind: "oauth",
      client_id: representative.client_id,
      token_count: group.length,
    });
  }

  return sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const accessToken = bearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  let service;
  let authClient;
  try {
    service = createServiceClient();
    authClient = createAuthClient();
  } catch (error) {
    console.error("[mcp/tokens] supabase client unavailable", error);
    sendJson(res, 500, { error: "server_misconfigured" });
    return;
  }

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const userId = userData?.user?.id;
  if (userError || !userId) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  const { data: isAdmin, error: roleError } = await service.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (roleError || !isAdmin) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  if (method === "GET") {
    // Solo ciò che è ancora valido: un token revocato o scaduto non è una
    // sessione, è un rifiuto che il client riceverà comunque. Tenerlo in lista
    // faceva sembrare attivo un accesso che non lo è.
    const { data, error } = await service
      .from("admin_mcp_tokens")
      .select(LIST_COLUMNS)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[mcp/tokens] list failed", error);
      sendJson(res, 500, { error: "list_failed" });
      return;
    }
    sendJson(res, 200, { tokens: toSessions((data ?? []) as TokenRow[]), availableScopes: MCP_SCOPES });
    return;
  }

  if (method === "PATCH") {
    // Aggiungere uno scope a una sessione già viva: l'alternativa sarebbe
    // rigenerare il token o rifare il consenso su ogni client configurato.
    let patchBody: { id?: unknown; scopes?: unknown };
    try {
      patchBody = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    const id = typeof patchBody.id === "string" ? patchBody.id : firstQueryParam(req, "id");
    if (!id) {
      sendJson(res, 400, { error: "missing_id" });
      return;
    }

    const scopes = Array.isArray(patchBody.scopes)
      ? patchBody.scopes.filter((scope): scope is string => typeof scope === "string").filter(isMcpScope)
      : [];
    if (scopes.length === 0) {
      sendJson(res, 400, { error: "invalid_scopes", message: `Scope validi: ${MCP_SCOPES.join(", ")}.` });
      return;
    }

    const { data: targetData, error: targetError } = await service
      .from("admin_mcp_tokens")
      .select(LIST_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (targetError) {
      console.error("[mcp/tokens] patch lookup failed", targetError);
      sendJson(res, 500, { error: "update_failed" });
      return;
    }
    const target = targetData as TokenRow | null;
    if (!target) {
      sendJson(res, 404, { error: "not_found", message: "Sessione inesistente, revocata o scaduta." });
      return;
    }

    // Una sessione OAuth è access + refresh: cambiare solo il refresh
    // lascerebbe l'access token in giro per un'ora con i vecchi permessi.
    let update = service.from("admin_mcp_tokens").update({ scopes }).eq("user_id", userId).is("revoked_at", null);
    update = target.client_id ? update.eq("client_id", target.client_id) : update.eq("id", target.id);

    const { error: updateError } = await update;
    if (updateError) {
      console.error("[mcp/tokens] patch failed", updateError);
      sendJson(res, 500, { error: "update_failed" });
      return;
    }

    const { data: refreshed } = await service
      .from("admin_mcp_tokens")
      .select(LIST_COLUMNS)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    sendJson(res, 200, { updated: true, tokens: toSessions((refreshed ?? []) as TokenRow[]) });
    return;
  }

  if (method === "DELETE") {
    const id = firstQueryParam(req, "id");
    if (!id) {
      sendJson(res, 400, { error: "missing_id" });
      return;
    }
    const { data: rowData } = await service
      .from("admin_mcp_tokens")
      .select("id,client_id")
      // Un admin revoca i propri token, non quelli di un collega.
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    const row = rowData as { id: string; client_id: string | null } | null;

    // Revocare solo il refresh di una sessione OAuth lascerebbe vivo il suo
    // access token fino a un'ora: si revoca l'intera concessione al client.
    let revoke = service
      .from("admin_mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);
    revoke = row?.client_id ? revoke.eq("client_id", row.client_id) : revoke.eq("id", id);

    const { error } = await revoke;
    if (error) {
      console.error("[mcp/tokens] revoke failed", error);
      sendJson(res, 500, { error: "revoke_failed" });
      return;
    }
    sendJson(res, 200, { revoked: true });
    return;
  }

  let body: { name?: unknown; scopes?: unknown; expiresInDays?: unknown };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    sendJson(res, 400, { error: "invalid_name", message: "Il nome deve avere fra 2 e 80 caratteri." });
    return;
  }

  const requestedScopes = Array.isArray(body.scopes)
    ? body.scopes.filter((scope): scope is string => typeof scope === "string")
    : DEFAULT_MCP_SCOPES;
  const scopes = requestedScopes.filter(isMcpScope);
  if (scopes.length === 0) {
    sendJson(res, 400, { error: "invalid_scopes", message: `Scope validi: ${MCP_SCOPES.join(", ")}.` });
    return;
  }

  const requestedDays = Number(body.expiresInDays);
  const days = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, MAX_EXPIRY_DAYS) : DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { count } = await service
    .from("admin_mcp_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
    sendJson(res, 409, {
      error: "too_many_tokens",
      message: `Hai già ${count} token attivi: revocane uno prima di crearne un altro.`,
    });
    return;
  }

  let created;
  try {
    created = generateToken();
  } catch (error) {
    console.error("[mcp/tokens] pepper unset", error);
    sendJson(res, 500, { error: "server_misconfigured", message: "MCP_TOKEN_PEPPER non configurato." });
    return;
  }

  const { data, error } = await service
    .from("admin_mcp_tokens")
    .insert({
      user_id: userId,
      name,
      token_hash: created.hash,
      token_prefix: created.prefix,
      scopes,
      expires_at: expiresAt,
    })
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("[mcp/tokens] create failed", error);
    sendJson(res, 500, { error: "create_failed" });
    return;
  }

  sendJson(res, 201, {
    // Unica occasione in cui il valore in chiaro lascia il server.
    token: created.token,
    record: data,
  });
}
