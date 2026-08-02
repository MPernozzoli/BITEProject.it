/**
 * GET/POST/DELETE /api/mcp/tokens — gestione dei token del server MCP admin.
 *
 * Autenticazione con il normale access token Supabase dell'admin loggato: la
 * UI (`/profile` → Accesso agenti) chiama questi endpoint, non la tabella,
 * perché l'hash del token non deve essere leggibile da nessun client e il
 * pepper vive solo qui.
 *
 * Il valore in chiaro del token esiste una sola volta, nella risposta alla
 * POST: non è recuperabile dopo.
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

const LIST_COLUMNS = "id,name,token_prefix,scopes,created_at,expires_at,last_used_at,revoked_at";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (!["GET", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
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
    const { data, error } = await service
      .from("admin_mcp_tokens")
      .select(LIST_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[mcp/tokens] list failed", error);
      sendJson(res, 500, { error: "list_failed" });
      return;
    }
    sendJson(res, 200, { tokens: data ?? [], availableScopes: MCP_SCOPES });
    return;
  }

  if (method === "DELETE") {
    const id = firstQueryParam(req, "id");
    if (!id) {
      sendJson(res, 400, { error: "missing_id" });
      return;
    }
    const { error } = await service
      .from("admin_mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      // Un admin revoca i propri token, non quelli di un collega.
      .eq("user_id", userId)
      .is("revoked_at", null);
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
