/**
 * POST /api/mcp/oauth/token — scambio del codice e rinnovo.
 *
 * Client pubblici: nessun secret, l'unica prova di possesso è PKCE. Per questo
 * il `code_verifier` va confrontato a tempo costante e il codice è monouso —
 * un codice ripresentato significa che qualcuno l'ha intercettato, e la
 * reazione prevista dalla specifica è revocare tutto ciò che quel client ha
 * ottenuto per quell'utente.
 */
import { createServiceClient } from "../../../src/server/bunq/supabase.js";
import {
  handlePreflight,
  readJsonBody,
  readTextBody,
  sendJson,
  setPublicCors,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http.js";
import { isMcpScope, type McpScope } from "../../../src/server/mcp/context.js";
import {
  issueTokenPair,
  loadAuthorizationCode,
  loadClient,
  loadRefreshToken,
  markCodeConsumed,
  oauthError,
  purgeExpiredCodes,
  revokeClientGrant,
  revokeToken,
  verifyPkce,
} from "../../../src/server/mcp/oauth.js";

async function readParams(req: NodeRequest): Promise<Record<string, string>> {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.includes("application/json")) {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  const raw = await readTextBody(req);
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (handlePreflight(req, res, "POST")) return;
  setPublicCors(res, "POST");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let service;
  try {
    service = createServiceClient();
  } catch (error) {
    console.error("[mcp/oauth/token] service client unavailable", error);
    sendJson(res, 500, oauthError("server_error", "Server non configurato."));
    return;
  }

  let params: Record<string, string>;
  try {
    params = await readParams(req);
  } catch {
    sendJson(res, 400, oauthError("invalid_request", "Corpo non leggibile."));
    return;
  }

  const grantType = params.grant_type ?? "";
  const clientId = params.client_id ?? "";
  const client = await loadClient(service, clientId);
  if (!client) {
    sendJson(res, 401, oauthError("invalid_client", "client_id sconosciuto o disabilitato."));
    return;
  }

  if (grantType === "authorization_code") {
    const code = params.code ?? "";
    const verifier = params.code_verifier ?? "";
    if (!code || !verifier) {
      sendJson(res, 400, oauthError("invalid_request", "Servono code e code_verifier."));
      return;
    }

    const stored = await loadAuthorizationCode(service, code);
    if (!stored) {
      sendJson(res, 400, oauthError("invalid_grant", "Codice non valido."));
      return;
    }

    if (stored.consumed_at) {
      // Riuso: il codice è già stato speso. Chi lo ripresenta o è un client
      // rotto o è qualcuno che l'ha rubato; in entrambi i casi si chiude.
      await revokeClientGrant(service, stored.client_id, stored.user_id);
      sendJson(res, 400, oauthError("invalid_grant", "Codice già utilizzato: l'autorizzazione è stata revocata."));
      return;
    }
    if (new Date(stored.expires_at).getTime() <= Date.now()) {
      sendJson(res, 400, oauthError("invalid_grant", "Codice scaduto."));
      return;
    }
    if (stored.client_id !== client.client_id) {
      sendJson(res, 400, oauthError("invalid_grant", "Il codice appartiene a un altro client."));
      return;
    }
    if (params.redirect_uri && params.redirect_uri !== stored.redirect_uri) {
      sendJson(res, 400, oauthError("invalid_grant", "redirect_uri diverso da quello dell'autorizzazione."));
      return;
    }
    if (!verifyPkce(verifier, stored.code_challenge, stored.code_challenge_method)) {
      sendJson(res, 400, oauthError("invalid_grant", "code_verifier non corrisponde."));
      return;
    }

    // Il ruolo si ricontrolla adesso: fra consenso e scambio può essere passato
    // del tempo, e un admin decaduto non deve ottenere un token.
    const { data: isAdmin } = await service.rpc("has_role", { _user_id: stored.user_id, _role: "admin" });
    if (!isAdmin) {
      sendJson(res, 400, oauthError("invalid_grant", "L'utente non ha più il ruolo admin."));
      return;
    }

    await markCodeConsumed(service, stored.id);
    void purgeExpiredCodes(service);

    const scopes = (stored.scopes ?? []).filter(isMcpScope) as McpScope[];
    try {
      const tokens = await issueTokenPair(service, {
        clientId: client.client_id,
        clientName: client.client_name,
        userId: stored.user_id,
        scopes,
        resource: stored.resource,
      });
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scopes.join(" "),
      });
    } catch (error) {
      console.error("[mcp/oauth/token] issue failed", error);
      sendJson(res, 500, oauthError("server_error", "Emissione token fallita."));
    }
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.refresh_token ?? "";
    if (!refreshToken) {
      sendJson(res, 400, oauthError("invalid_request", "Manca refresh_token."));
      return;
    }

    const row = await loadRefreshToken(service, refreshToken);
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      sendJson(res, 400, oauthError("invalid_grant", "Refresh token non valido o scaduto."));
      return;
    }
    if (row.client_id !== client.client_id) {
      sendJson(res, 400, oauthError("invalid_grant", "Il refresh token appartiene a un altro client."));
      return;
    }

    const { data: isAdmin } = await service.rpc("has_role", { _user_id: row.user_id, _role: "admin" });
    if (!isAdmin) {
      await revokeClientGrant(service, client.client_id, row.user_id);
      sendJson(res, 400, oauthError("invalid_grant", "L'utente non ha più il ruolo admin."));
      return;
    }

    // Rotazione: il refresh usato muore qui. Gli access token già emessi restano
    // validi fino alla loro scadenza, che è un'ora.
    await revokeToken(service, row.id);

    const scopes = (row.scopes ?? []).filter(isMcpScope) as McpScope[];
    try {
      const tokens = await issueTokenPair(service, {
        clientId: client.client_id,
        clientName: row.name || client.client_name,
        userId: row.user_id,
        scopes,
        resource: row.resource,
      });
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scopes.join(" "),
      });
    } catch (error) {
      console.error("[mcp/oauth/token] refresh issue failed", error);
      sendJson(res, 500, oauthError("server_error", "Rinnovo fallito."));
    }
    return;
  }

  sendJson(res, 400, oauthError("unsupported_grant_type", "Grant non supportato."));
}
