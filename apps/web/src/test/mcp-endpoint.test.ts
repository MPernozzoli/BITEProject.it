import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test dell'handler HTTP, non del protocollo (quello è in `mcp-server.test.ts`):
 * qui interessa che senza token non si arrivi mai al server MCP e che la
 * risposta sia pulita invece di uno stack trace.
 */
const { authenticateMock } = vi.hoisted(() => ({ authenticateMock: vi.fn() }));

vi.mock("@/server/bunq/supabase", () => ({
  createServiceClient: () => ({}),
  createAuthClient: () => ({}),
}));

vi.mock("@/server/mcp/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mcp/auth")>();
  return { ...actual, authenticate: authenticateMock };
});

const buildServerMock = vi.fn();
vi.mock("@/server/mcp/server", () => ({
  buildMcpServer: (...args: unknown[]) => {
    buildServerMock(...args);
    return { connect: vi.fn(), close: vi.fn() };
  },
}));

function mockRes() {
  const headers: Record<string, string> = {};
  let body = "";
  return {
    statusCode: 200,
    headersSent: false,
    headers,
    get body() {
      return body;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      body = chunk ?? "";
    },
    on() {},
  };
}

function mockReq(method: string, headers: Record<string, string> = {}) {
  return { method, headers, url: "/api/mcp", on: undefined };
}

describe("/api/mcp", () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    buildServerMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("rifiuta i metodi non previsti senza toccare l'autenticazione", async () => {
    const { default: handler } = await import("../../api/mcp/index");
    const res = mockRes();

    await handler(mockReq("PUT") as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("POST, GET, DELETE");
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("risponde 401 con WWW-Authenticate quando manca il token", async () => {
    authenticateMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const { default: handler } = await import("../../api/mcp/index");
    const res = mockRes();

    await handler(mockReq("POST") as never, res as never);

    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(JSON.parse(res.body).error).toBe("missing_token");
    // Il server MCP non deve nemmeno essere costruito per una richiesta non autenticata.
    expect(buildServerMock).not.toHaveBeenCalled();
  });

  it("risponde 403 a chi non è più admin", async () => {
    authenticateMock.mockResolvedValue({ ok: false, reason: "not_admin" });
    const { default: handler } = await import("../../api/mcp/index");
    const res = mockRes();

    await handler(mockReq("POST", { authorization: "Bearer bite_mcp_x" }) as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(res.headers["www-authenticate"]).toBeUndefined();
    expect(buildServerMock).not.toHaveBeenCalled();
  });

  it("segnala la configurazione mancante con un 500 esplicito", async () => {
    authenticateMock.mockResolvedValue({ ok: false, reason: "misconfigured" });
    const { default: handler } = await import("../../api/mcp/index");
    const res = mockRes();

    await handler(mockReq("POST", { authorization: "Bearer bite_mcp_x" }) as never, res as never);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toContain("MCP_TOKEN_PEPPER");
  });
});
