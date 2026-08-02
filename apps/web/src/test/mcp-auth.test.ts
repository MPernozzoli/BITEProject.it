import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticate, generateToken, hashToken, looksLikeMcpToken } from "@/server/mcp/auth";
import { createStubSupabase } from "./mcp-stub-supabase";

const PEPPER = "pepper-di-test-lungo-abbastanza-0123456789";

function tokenRow(overrides: Record<string, unknown> = {}) {
  const created = generateToken();
  return {
    token: created.token,
    row: {
      id: "token-1",
      user_id: "user-1",
      name: "MacBook",
      scopes: ["articles:read", "plan:read"],
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      revoked_at: null,
      token_hash: created.hash,
      ...overrides,
    },
  };
}

describe("token MCP", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_PEPPER = PEPPER;
  });

  afterEach(() => {
    delete process.env.MCP_TOKEN_PEPPER;
  });

  it("genera token riconoscibili e non indovinabili", () => {
    const first = generateToken();
    const second = generateToken();

    expect(looksLikeMcpToken(first.token)).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThan(40);
    expect(first.prefix.length).toBeLessThan(first.token.length);
    expect(first.token).not.toContain(first.hash);
  });

  it("hasha in modo deterministico ma dipendente dal pepper", () => {
    const value = "bite_mcp_abc";
    const withFirstPepper = hashToken(value);
    expect(hashToken(value)).toBe(withFirstPepper);

    process.env.MCP_TOKEN_PEPPER = `${PEPPER}-diverso`;
    expect(hashToken(value)).not.toBe(withFirstPepper);
  });

  it("rifiuta di hashare senza un pepper degno del nome", () => {
    process.env.MCP_TOKEN_PEPPER = "corto";
    expect(() => hashToken("bite_mcp_abc")).toThrow("mcp_token_pepper_unset");
  });

  it("accetta un token valido di un admin", async () => {
    const { token, row } = tokenRow();
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] }, rpc: { has_role: true } });

    const result = await authenticate(client, token);

    expect(result.ok).toBe(true);
    expect(result.auth?.userId).toBe("user-1");
    expect(result.auth?.scopes).toEqual(["articles:read", "plan:read"]);
  });

  it("scarta gli scope non riconosciuti invece di fidarsi della riga", async () => {
    const { token, row } = tokenRow({ scopes: ["articles:read", "tutto:quanto"] });
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] }, rpc: { has_role: true } });

    const result = await authenticate(client, token);

    expect(result.auth?.scopes).toEqual(["articles:read"]);
  });

  it("rifiuta un token sconosciuto", async () => {
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [] } });
    const result = await authenticate(client, "bite_mcp_inventato");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_token");
  });

  it("rifiuta un token revocato", async () => {
    const { token, row } = tokenRow({ revoked_at: new Date().toISOString() });
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] }, rpc: { has_role: true } });
    const result = await authenticate(client, token);
    expect(result.reason).toBe("revoked_token");
  });

  it("rifiuta un token scaduto", async () => {
    const { token, row } = tokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] }, rpc: { has_role: true } });
    const result = await authenticate(client, token);
    expect(result.reason).toBe("expired_token");
  });

  it("rifiuta chi ha perso il ruolo admin, anche col token ancora valido", async () => {
    const { token, row } = tokenRow();
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] }, rpc: { has_role: false } });
    const result = await authenticate(client, token);
    expect(result.reason).toBe("not_admin");
  });

  it("rifiuta header assenti o di altro formato", async () => {
    const { client } = createStubSupabase({});
    expect((await authenticate(client, null)).reason).toBe("missing_token");
    expect((await authenticate(client, "sb_secret_qualcosa")).reason).toBe("missing_token");
  });

  it("segnala la configurazione mancante invece di accettare tutto", async () => {
    const { token, row } = tokenRow();
    delete process.env.MCP_TOKEN_PEPPER;
    const { client } = createStubSupabase({ tables: { admin_mcp_tokens: [row] } });
    const result = await authenticate(client, token);
    expect(result.reason).toBe("misconfigured");
  });
});
