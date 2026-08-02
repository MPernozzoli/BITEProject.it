import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { createStubSupabase } from "./mcp-stub-supabase";

/**
 * Il trasporto vero su HTTP vero.
 *
 * `mcp-server.test.ts` verifica il protocollo su transport in-memory: qui si
 * verifica il pezzo che quella prova non tocca, cioè che la modalità stateless
 * con risposta JSON funzioni davvero su una richiesta HTTP come quella che
 * arriva su Vercel.
 */
let server: Server;
let baseUrl: string;

const CHANNEL = {
  id: "channel-site",
  code: "site",
  label: "Sito",
  timezone: "Europe/Rome",
  horizon_weeks: 8,
  weekly_count: 1,
  mix_pillar: 15,
  mix_support: 55,
  mix_utility: 30,
};

beforeAll(async () => {
  const stub = createStubSupabase({
    tables: { editorial_plan_channels: [CHANNEL], editorial_plan_weekly_slots: [] },
    rpc: { consume_rate_limit: true },
  });

  const ctx: McpContext = {
    auth: {
      tokenId: "token-1",
      tokenName: "test",
      userId: "user-1",
      email: "admin@biteproject.it",
      scopes: [...MCP_SCOPES],
      expiresAt: "2099-01-01T00:00:00Z",
    },
    service: stub.client,
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    siteUrl: "https://biteproject.it",
  };

  server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;

      const mcp = buildMcpServer(ctx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function rpc(payload: unknown) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Il client MCP deve dichiarare entrambi: il transport rifiuta chi accetta solo JSON.
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

describe("trasporto HTTP", () => {
  it("completa l'handshake rispondendo in JSON, senza sessione", async () => {
    const { status, body } = await rpc(INITIALIZE);

    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("bite-admin");
    expect(body.result.instructions).toContain("bilingue");
  });

  it("elenca i tool su una richiesta indipendente", async () => {
    // Ogni richiesta è a sé: nessuno stato condiviso fra invocazioni serverless.
    await rpc(INITIALIZE);
    const { status, body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    expect(status).toBe(200);
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("plan_get_settings");
  });

  it("esegue un tool end-to-end sopra HTTP", async () => {
    const { status, body } = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "plan_get_settings", arguments: {} },
    });

    expect(status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    expect(JSON.stringify(body.result.content)).toContain("site");
  });

  it("rifiuta un corpo che non è JSON-RPC valido", async () => {
    const { status } = await rpc({ hello: "world" });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
