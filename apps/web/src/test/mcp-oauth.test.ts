import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "@/server/mcp/auth";
import {
  authorizationServerMetadata,
  canonicalizeResource,
  parseRegistrationRequest,
  protectedResourceMetadata,
  resolveOrigin,
  verifyPkce,
} from "@/server/mcp/oauth";
import { createStubSupabase, type StubFixtures } from "./mcp-stub-supabase";

const PEPPER = "pepper-di-test-lungo-abbastanza-0123456789";
const ORIGIN = "https://admin.biteproject.it";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

/**
 * Uno stub condiviso fra gli handler: register → authorize → approve → token
 * devono vedere lo stesso database, altrimenti il flusso non prova niente.
 */
const fixtures: StubFixtures = { tables: {}, rpc: { has_role: true, consume_rate_limit: true } };
let stub = createStubSupabase(fixtures);

vi.mock("@/server/bunq/supabase", () => ({
  createServiceClient: () => stub.client,
  createAuthClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin-1" } }, error: null }) },
  }),
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
    json<T = Record<string, unknown>>(): T {
      return JSON.parse(body || "{}") as T;
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

function req(method: string, options: { url?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return {
    method,
    url: options.url ?? "/",
    headers: { host: "admin.biteproject.it", "x-forwarded-proto": "https", ...(options.headers ?? {}) },
    body: options.body,
  };
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

beforeEach(() => {
  process.env.MCP_TOKEN_PEPPER = PEPPER;
  fixtures.tables = {};
  fixtures.rpc = { has_role: true, consume_rate_limit: true };
  stub = createStubSupabase(fixtures);
});

afterEach(() => {
  delete process.env.MCP_TOKEN_PEPPER;
  vi.resetModules();
});

describe("metadata", () => {
  it("annuncia gli endpoint sull'origin da cui è stato interrogato", () => {
    const metadata = authorizationServerMetadata("https://preview-xyz.vercel.app");
    expect(metadata.issuer).toBe("https://preview-xyz.vercel.app");
    expect(metadata.authorization_endpoint).toBe("https://preview-xyz.vercel.app/api/mcp/oauth/authorize");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("dichiara la risorsa protetta e il suo authorization server", () => {
    const metadata = protectedResourceMetadata(ORIGIN);
    expect(metadata.resource).toBe(`${ORIGIN}/mcp`);
    expect(metadata.authorization_servers).toEqual([ORIGIN]);
  });

  it("ricava l'origin dagli header di forwarding", () => {
    expect(resolveOrigin({ "x-forwarded-host": "admin.biteproject.it", "x-forwarded-proto": "https" })).toBe(ORIGIN);
    expect(resolveOrigin({ host: "localhost:8080" })).toBe("http://localhost:8080");
  });

  it("tratta /mcp e /api/mcp come la stessa risorsa", () => {
    expect(canonicalizeResource(`${ORIGIN}/api/mcp`, ORIGIN)).toBe(`${ORIGIN}/mcp`);
    expect(canonicalizeResource(`${ORIGIN}/mcp/`, ORIGIN)).toBe(`${ORIGIN}/mcp`);
    expect(canonicalizeResource(null, ORIGIN)).toBeNull();
  });
});

describe("PKCE", () => {
  it("accetta il verifier corretto", () => {
    const { verifier, challenge } = pkce();
    expect(verifyPkce(verifier, challenge, "S256")).toBe(true);
  });

  it("rifiuta verifier sbagliato, metodo plain e verifier troppo corto", () => {
    const { challenge } = pkce();
    expect(verifyPkce(randomBytes(48).toString("base64url"), challenge, "S256")).toBe(false);
    const { verifier } = pkce();
    expect(verifyPkce(verifier, verifier, "plain")).toBe(false);
    expect(verifyPkce("corto", challenge, "S256")).toBe(false);
  });
});

describe("registrazione client", () => {
  it("rifiuta redirect_uri assenti o non https", () => {
    expect(parseRegistrationRequest({}).ok).toBe(false);
    expect(parseRegistrationRequest({ redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
  });

  it("accetta https e localhost", () => {
    expect(parseRegistrationRequest({ redirect_uris: [REDIRECT_URI] }).ok).toBe(true);
    expect(parseRegistrationRequest({ redirect_uris: ["http://localhost:3000/cb"] }).ok).toBe(true);
  });

  it("rifiuta i client confidenziali: qui si usa solo PKCE", () => {
    const parsed = parseRegistrationRequest({
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("flusso completo", () => {
  async function registerClient() {
    const { default: handler } = await import("../../api/mcp/oauth/register");
    const res = mockRes();
    await handler(
      req("POST", {
        body: { client_name: "Claude", redirect_uris: [REDIRECT_URI] },
        headers: { "content-type": "application/json" },
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(201);
    return res.json<{ client_id: string }>().client_id;
  }

  async function approve(clientId: string, challenge: string, scopes: string[]) {
    const { default: handler } = await import("../../api/mcp/oauth/approve");
    const res = mockRes();
    await handler(
      req("POST", {
        headers: { authorization: "Bearer supabase-jwt", "content-type": "application/json" },
        body: {
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz",
          scopes,
        },
      }) as never,
      res as never,
    );
    return res;
  }

  async function exchange(params: Record<string, string>) {
    const { default: handler } = await import("../../api/mcp/oauth/token");
    const res = mockRes();
    await handler(
      req("POST", { headers: { "content-type": "application/json" }, body: params }) as never,
      res as never,
    );
    return res;
  }

  it("porta da registrazione a token spendibile sul server MCP", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();

    const approved = await approve(clientId, challenge, ["articles:read", "plan:read"]);
    expect(approved.statusCode).toBe(200);
    const redirectTo = new URL(approved.json<{ redirect_to: string }>().redirect_to);
    expect(redirectTo.origin + redirectTo.pathname).toBe(REDIRECT_URI);
    expect(redirectTo.searchParams.get("state")).toBe("xyz");

    const code = redirectTo.searchParams.get("code")!;
    const tokenRes = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });

    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json<{ access_token: string; refresh_token: string; expires_in: number; scope: string }>();
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("articles:read plan:read");

    // La prova finale: l'access token apre davvero il server MCP.
    const auth = await authenticate(stub.client, tokens.access_token, `${ORIGIN}/mcp`);
    expect(auth.ok).toBe(true);
    expect(auth.auth?.scopes).toEqual(["articles:read", "plan:read"]);

    // ...e il refresh token no, anche se è dello stesso utente.
    const refreshAuth = await authenticate(stub.client, tokens.refresh_token, `${ORIGIN}/mcp`);
    expect(refreshAuth.ok).toBe(false);
  });

  it("rifiuta il verifier sbagliato", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const approved = await approve(clientId, challenge, ["articles:read"]);
    const code = new URL(approved.json<{ redirect_to: string }>().redirect_to).searchParams.get("code")!;

    const res = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: randomBytes(48).toString("base64url"),
      redirect_uri: REDIRECT_URI,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("invalid_grant");
  });

  it("al riuso di un codice revoca l'intera autorizzazione", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const approved = await approve(clientId, challenge, ["articles:read"]);
    const code = new URL(approved.json<{ redirect_to: string }>().redirect_to).searchParams.get("code")!;

    const first = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
    const accessToken = first.json<{ access_token: string }>().access_token;
    expect((await authenticate(stub.client, accessToken, `${ORIGIN}/mcp`)).ok).toBe(true);

    const replay = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });

    expect(replay.statusCode).toBe(400);
    // Il token emesso al primo scambio non deve sopravvivere al sospetto.
    expect((await authenticate(stub.client, accessToken, `${ORIGIN}/mcp`)).ok).toBe(false);
  });

  it("ruota il refresh token e invalida quello usato", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const approved = await approve(clientId, challenge, ["articles:read"]);
    const code = new URL(approved.json<{ redirect_to: string }>().redirect_to).searchParams.get("code")!;
    const first = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
    const refreshToken = first.json<{ refresh_token: string }>().refresh_token;

    const renewed = await exchange({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json<{ access_token: string }>().access_token).toBeTruthy();

    const reused = await exchange({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
    expect(reused.statusCode).toBe(400);
  });

  it("non emette token a chi non è più admin", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const approved = await approve(clientId, challenge, ["articles:read"]);
    const code = new URL(approved.json<{ redirect_to: string }>().redirect_to).searchParams.get("code")!;

    fixtures.rpc = { has_role: false, consume_rate_limit: true };
    const res = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error_description: string }>().error_description).toContain("admin");
  });

  it("non fa approvare un consenso a un non admin", async () => {
    const clientId = await registerClient();
    fixtures.rpc = { has_role: false, consume_rate_limit: true };
    const res = await approve(clientId, pkce().challenge, ["articles:read"]);
    expect(res.statusCode).toBe(403);
  });

  it("blocca un redirect_uri non registrato", async () => {
    const clientId = await registerClient();
    const { default: handler } = await import("../../api/mcp/oauth/approve");
    const res = mockRes();
    await handler(
      req("POST", {
        headers: { authorization: "Bearer supabase-jwt", "content-type": "application/json" },
        body: {
          client_id: clientId,
          redirect_uri: "https://evil.example/callback",
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
          scopes: ["articles:read"],
        },
      }) as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("invalid_request");
  });
});

describe("/authorize", () => {
  it("non redirige verso un redirect_uri non registrato", async () => {
    const { default: register } = await import("../../api/mcp/oauth/register");
    const registerRes = mockRes();
    await register(
      req("POST", {
        body: { client_name: "Claude", redirect_uris: [REDIRECT_URI] },
        headers: { "content-type": "application/json" },
      }) as never,
      registerRes as never,
    );
    const clientId = registerRes.json<{ client_id: string }>().client_id;

    const { default: handler } = await import("../../api/mcp/oauth/authorize");
    const res = mockRes();
    await handler(
      req("GET", {
        url: `/api/mcp/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge=abc`,
      }) as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it("manda alla pagina di consenso conservando i parametri", async () => {
    const { default: register } = await import("../../api/mcp/oauth/register");
    const registerRes = mockRes();
    await register(
      req("POST", {
        body: { client_name: "Claude", redirect_uris: [REDIRECT_URI] },
        headers: { "content-type": "application/json" },
      }) as never,
      registerRes as never,
    );
    const clientId = registerRes.json<{ client_id: string }>().client_id;
    const { challenge } = pkce();

    const { default: handler } = await import("../../api/mcp/oauth/authorize");
    const res = mockRes();
    await handler(
      req("GET", {
        url:
          `/api/mcp/oauth/authorize?response_type=code&client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${challenge}` +
          `&code_challenge_method=S256&state=abc&scope=articles%3Aread`,
      }) as never,
      res as never,
    );

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.pathname).toBe("/admin/mcp/authorize");
    expect(location.searchParams.get("client_id")).toBe(clientId);
    expect(location.searchParams.get("state")).toBe("abc");
    expect(location.searchParams.get("scope")).toBe("articles:read");
  });

  it("riporta l'errore al client quando il redirect_uri è valido ma la richiesta no", async () => {
    const { default: register } = await import("../../api/mcp/oauth/register");
    const registerRes = mockRes();
    await register(
      req("POST", {
        body: { client_name: "Claude", redirect_uris: [REDIRECT_URI] },
        headers: { "content-type": "application/json" },
      }) as never,
      registerRes as never,
    );
    const clientId = registerRes.json<{ client_id: string }>().client_id;

    const { default: handler } = await import("../../api/mcp/oauth/authorize");
    const res = mockRes();
    await handler(
      req("GET", {
        url:
          `/api/mcp/oauth/authorize?response_type=token&client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=abc`,
      }) as never,
      res as never,
    );

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get("error")).toBe("unsupported_response_type");
    expect(location.searchParams.get("state")).toBe("abc");
  });
});
