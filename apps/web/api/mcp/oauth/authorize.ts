/**
 * GET /api/mcp/oauth/authorize — inizio del flusso di autorizzazione.
 *
 * Qui non si autentica nessuno: si valida la richiesta e si manda l'umano alla
 * pagina di consenso della SPA admin, dove c'è già la sua sessione Supabase.
 * Il codice viene emesso solo dopo, da `/api/mcp/oauth/approve`.
 *
 * Regola OAuth su cui vale la pena essere precisi: se `client_id` o
 * `redirect_uri` non sono validi **non si redirige**, si mostra l'errore. Un
 * redirect verso un URI non verificato è esattamente il modo in cui si regala
 * un authorization code a un attaccante.
 */
import { createServiceClient } from "../../../src/server/bunq/supabase.js";
import { firstQueryParam, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import {
  CONSENT_PATH,
  canonicalizeResource,
  isRegisteredRedirectUri,
  loadClient,
  resolveOrigin,
} from "../../../src/server/mcp/oauth.js";

function redirect(res: NodeResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function errorRedirect(res: NodeResponse, redirectUri: string, error: string, description: string, state: string | null): void {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  redirect(res, url.toString());
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const origin = resolveOrigin(req.headers);
  const clientId = firstQueryParam(req, "client_id") ?? "";
  const state = firstQueryParam(req, "state");
  const requestedRedirect = firstQueryParam(req, "redirect_uri");

  let service;
  try {
    service = createServiceClient();
  } catch (error) {
    console.error("[mcp/oauth/authorize] service client unavailable", error);
    sendJson(res, 500, { error: "server_error" });
    return;
  }

  const client = await loadClient(service, clientId);
  if (!client) {
    sendJson(res, 400, {
      error: "invalid_client",
      error_description: "client_id sconosciuto o disabilitato. Registralo su /api/mcp/oauth/register.",
    });
    return;
  }

  const redirectUri = requestedRedirect ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null);
  if (!redirectUri || !isRegisteredRedirectUri(client, redirectUri)) {
    sendJson(res, 400, {
      error: "invalid_request",
      error_description: "redirect_uri non registrato per questo client.",
    });
    return;
  }

  // Da qui in poi il redirect_uri è verificato: gli errori tornano al client,
  // come prevede lo standard.
  if (firstQueryParam(req, "response_type") !== "code") {
    errorRedirect(res, redirectUri, "unsupported_response_type", "È supportato solo response_type=code.", state);
    return;
  }

  const codeChallenge = firstQueryParam(req, "code_challenge");
  const codeChallengeMethod = firstQueryParam(req, "code_challenge_method") ?? "S256";
  if (!codeChallenge) {
    errorRedirect(res, redirectUri, "invalid_request", "PKCE obbligatorio: manca code_challenge.", state);
    return;
  }
  if (codeChallengeMethod !== "S256") {
    errorRedirect(res, redirectUri, "invalid_request", "È supportato solo code_challenge_method=S256.", state);
    return;
  }

  const consent = new URL(`${origin}${CONSENT_PATH}`);
  consent.searchParams.set("client_id", client.client_id);
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("code_challenge", codeChallenge);
  consent.searchParams.set("code_challenge_method", codeChallengeMethod);
  if (state) consent.searchParams.set("state", state);
  const scope = firstQueryParam(req, "scope");
  if (scope) consent.searchParams.set("scope", scope);
  const resource = canonicalizeResource(firstQueryParam(req, "resource"), origin);
  if (resource) consent.searchParams.set("resource", resource);

  redirect(res, consent.toString());
}
