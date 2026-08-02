/**
 * POST /api/mcp/oauth/register — registrazione dinamica dei client (RFC 7591).
 *
 * Aperta di proposito: senza, un connector claude.ai non può presentarsi da
 * solo e servirebbe configurare a mano un client_id per ogni installazione.
 * Registrarsi non dà accesso a niente — il client ottiene solo un identificativo;
 * la porta la apre un admin dalla pagina di consenso, e solo lui.
 *
 * Il rate limit sull'IP evita che la tabella diventi un raccoglitore di
 * registrazioni automatiche.
 */
import { createServiceClient } from "../../../src/server/bunq/supabase.js";
import {
  handlePreflight,
  readJsonBody,
  sendJson,
  setPublicCors,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http.js";
import { generateClientId, oauthError, parseRegistrationRequest } from "../../../src/server/mcp/oauth.js";

function clientIp(req: NodeRequest): string {
  const header = req.headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value || "").split(",")[0]?.trim() || "unknown";
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
    console.error("[mcp/oauth/register] service client unavailable", error);
    sendJson(res, 500, oauthError("server_error", "Server non configurato."));
    return;
  }

  const { data: allowed } = await service.rpc("consume_rate_limit", {
    p_bucket: "mcp:oauth_register",
    p_identifier: clientIp(req),
    p_max_requests: 20,
    p_window_seconds: 3600,
  });
  if (allowed === false) {
    sendJson(res, 429, oauthError("temporarily_unavailable", "Troppe registrazioni da questo indirizzo."));
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, oauthError("invalid_client_metadata", "Corpo JSON non valido."));
    return;
  }

  const parsed = parseRegistrationRequest(body);
  if (!parsed.ok) {
    sendJson(res, 400, oauthError(parsed.error, parsed.description));
    return;
  }

  const clientId = generateClientId();
  const { error } = await service.from("admin_mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: parsed.client_name,
    redirect_uris: parsed.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    client_uri: parsed.client_uri,
    software_id: parsed.software_id,
  });
  if (error) {
    console.error("[mcp/oauth/register] insert failed", error);
    sendJson(res, 500, oauthError("server_error", "Registrazione fallita."));
    return;
  }

  sendJson(res, 201, {
    client_id: clientId,
    client_name: parsed.client_name,
    redirect_uris: parsed.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  });
}
