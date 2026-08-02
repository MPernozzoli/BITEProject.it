/**
 * POST /api/mcp/oauth/approve — l'admin concede l'accesso.
 *
 * Chiamato dalla pagina di consenso della SPA con l'access token Supabase
 * dell'admin loggato: è l'unico punto del flusso OAuth in cui si sa **chi** è
 * l'umano, e l'unico che può emettere un authorization code.
 *
 * Non è un endpoint pubblico: niente CORS, si aspetta di essere chiamato
 * same-origin dalla pagina admin.
 */
import { createAuthClient, createServiceClient } from "../../../src/server/bunq/supabase.js";
import {
  bearerToken,
  firstQueryParam,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http.js";
import { isMcpScope, type McpScope } from "../../../src/server/mcp/context.js";
import {
  canonicalizeResource,
  createAuthorizationCode,
  isRegisteredRedirectUri,
  loadClient,
  oauthError,
  resolveOrigin,
  resourceUrl,
} from "../../../src/server/mcp/oauth.js";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const accessToken = bearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, oauthError("unauthorized", "Sessione admin mancante."));
    return;
  }

  let service;
  let authClient;
  try {
    service = createServiceClient();
    authClient = createAuthClient();
  } catch (error) {
    console.error("[mcp/oauth/approve] supabase client unavailable", error);
    sendJson(res, 500, oauthError("server_error", "Server non configurato."));
    return;
  }

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const userId = userData?.user?.id;
  if (userError || !userId) {
    sendJson(res, 401, oauthError("unauthorized", "Sessione non valida."));
    return;
  }

  const { data: isAdmin, error: roleError } = await service.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (roleError || !isAdmin) {
    sendJson(res, 403, oauthError("forbidden", "Solo un admin può autorizzare un client MCP."));
    return;
  }

  // GET: la pagina di consenso chiede chi sta bussando, per non mostrare
  // all'admin un client_id opaco e basta.
  if (req.method === "GET") {
    const client = await loadClient(service, firstQueryParam(req, "client_id") ?? "");
    if (!client) {
      sendJson(res, 404, oauthError("invalid_client", "client_id sconosciuto."));
      return;
    }
    sendJson(res, 200, {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
    });
    return;
  }

  let body: {
    client_id?: unknown;
    redirect_uri?: unknown;
    code_challenge?: unknown;
    code_challenge_method?: unknown;
    state?: unknown;
    scopes?: unknown;
    resource?: unknown;
  };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, oauthError("invalid_request", "Corpo JSON non valido."));
    return;
  }

  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
  const codeChallenge = typeof body.code_challenge === "string" ? body.code_challenge : "";
  const codeChallengeMethod = typeof body.code_challenge_method === "string" ? body.code_challenge_method : "S256";

  const client = await loadClient(service, clientId);
  if (!client) {
    sendJson(res, 400, oauthError("invalid_client", "client_id sconosciuto."));
    return;
  }
  // Ricontrollato qui e non solo in /authorize: questa richiesta arriva dal
  // browser e i parametri potrebbero essere stati manomessi nel frattempo.
  if (!isRegisteredRedirectUri(client, redirectUri)) {
    sendJson(res, 400, oauthError("invalid_request", "redirect_uri non registrato."));
    return;
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    sendJson(res, 400, oauthError("invalid_request", "PKCE S256 obbligatorio."));
    return;
  }

  const scopes = (Array.isArray(body.scopes) ? body.scopes : [])
    .filter((scope): scope is string => typeof scope === "string")
    .filter(isMcpScope) as McpScope[];
  if (scopes.length === 0) {
    sendJson(res, 400, oauthError("invalid_scope", "Seleziona almeno un permesso."));
    return;
  }

  const origin = resolveOrigin(req.headers);
  const resource = canonicalizeResource(typeof body.resource === "string" ? body.resource : null, origin) ?? resourceUrl(origin);

  let code: string;
  try {
    code = await createAuthorizationCode(service, {
      clientId: client.client_id,
      userId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scopes,
      resource,
    });
  } catch (error) {
    console.error("[mcp/oauth/approve] code creation failed", error);
    sendJson(res, 500, oauthError("server_error", "Emissione del codice fallita."));
    return;
  }

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (typeof body.state === "string" && body.state) target.searchParams.set("state", body.state);

  sendJson(res, 200, { redirect_to: target.toString() });
}
