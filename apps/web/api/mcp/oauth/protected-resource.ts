/**
 * GET /.well-known/oauth-protected-resource (via rewrite) — metadata RFC 9728.
 *
 * Dice al client quale risorsa sta cercando di usare e quale authorization
 * server la protegge. È il documento a cui punta l'header `WWW-Authenticate`
 * restituito da `/api/mcp` quando manca un token valido.
 */
import { handlePreflight, sendJson, setPublicCors, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import { protectedResourceMetadata, resolveOrigin } from "../../../src/server/mcp/oauth.js";

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
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(JSON.stringify(protectedResourceMetadata(resolveOrigin(req.headers))));
}
