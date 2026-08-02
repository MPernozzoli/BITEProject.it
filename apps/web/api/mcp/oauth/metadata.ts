/**
 * GET /.well-known/oauth-authorization-server (via rewrite) — metadata RFC 8414.
 *
 * È il primo documento che un client MCP legge per capire dove autorizzarsi.
 * L'issuer non è cablato: viene dall'host della richiesta, così le preview
 * Vercel non annunciano gli endpoint di produzione.
 */
import { handlePreflight, sendJson, setPublicCors, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import { authorizationServerMetadata, resolveOrigin } from "../../../src/server/mcp/oauth.js";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (handlePreflight(req, res, "GET")) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  setPublicCors(res, "GET");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // I metadata cambiano solo con un deploy: un'ora di cache evita un round-trip
  // a ogni riconnessione senza rendere difficile correggere un errore.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(JSON.stringify(authorizationServerMetadata(resolveOrigin(req.headers))));
}
