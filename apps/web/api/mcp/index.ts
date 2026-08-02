/**
 * POST/GET/DELETE /api/mcp — server MCP del backoffice BITE.
 *
 * Trasporto Streamable HTTP in modalità **stateless**: niente sessioni da
 * conservare fra invocazioni serverless, una risposta JSON per richiesta.
 * Server e transport nascono e muoiono con la singola richiesta.
 *
 * Auth: `Authorization: Bearer bite_mcp_...`, token emesso da /api/mcp/tokens e
 * legato a un utente con ruolo admin. Vedi `src/server/mcp/auth.ts`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServiceClient } from "../../src/server/bunq/supabase.js";
import { bearerToken, readJsonBody, sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { authFailureMessage, authFailureStatus, authenticate } from "../../src/server/mcp/auth.js";
import { buildMcpServer } from "../../src/server/mcp/server.js";
import type { McpContext } from "../../src/server/mcp/context.js";

function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL || process.env.VITE_SITE_URL || "https://biteproject.it").replace(/\/$/, "");
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nodeReq = req as unknown as NodeRequest;
  const nodeRes = res as unknown as NodeResponse;

  if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, GET, DELETE");
    sendJson(nodeRes, 405, { error: "method_not_allowed" });
    return;
  }

  let service;
  try {
    service = createServiceClient();
  } catch (error) {
    console.error("[mcp] service client unavailable", error);
    sendJson(nodeRes, 500, { error: "server_misconfigured" });
    return;
  }

  const auth = await authenticate(service, bearerToken(nodeReq));
  if (!auth.ok) {
    const status = authFailureStatus(auth.reason);
    if (status === 401) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="bite-admin", error="invalid_token"');
    }
    sendJson(nodeRes, status, { error: auth.reason, message: authFailureMessage(auth.reason) });
    return;
  }

  const context: McpContext = {
    auth: auth.auth,
    service,
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    siteUrl: siteUrl(),
  };

  // Il corpo va letto qui: su Vercel può arrivare già deserializzato, e in quel
  // caso lo stream è vuoto e il transport aspetterebbe dati che non arrivano.
  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJsonBody(nodeReq);
    } catch {
      sendJson(nodeRes, 400, { error: "invalid_json" });
      return;
    }
  }

  const server = buildMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("[mcp] request failed", error);
    if (!res.headersSent) {
      sendJson(nodeRes, 500, { error: "internal_error" });
    }
  }
}
