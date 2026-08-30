/**
 * `link_build`: l'unico modo previsto perché un agente produca un link da
 * pubblicare fuori dal sito.
 *
 * Quello che va tenuto fermo qui è che il tool *rifiuti* di produrre un link
 * non tracciato — è la garanzia che nessun post finisca là fuori con un URL
 * anonimo — e che i tracker di un gruppo Facebook si compilino da soli, senza
 * che l'agente inventi ogni volta il nome della campagna.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures } from "./mcp-stub-supabase";

const ARTICLE_ID = "44444444-4444-4444-8444-000000000001";
const STORY_ID = "44444444-4444-4444-8444-000000000002";
const GROUP_ID = "44444444-4444-4444-8444-000000000003";
const SITE_URL = "https://biteproject.it";

const fixtures: StubFixtures = {
  tables: {
    logbook_articles: [
      {
        id: ARTICLE_ID,
        slug: "rotta-sud",
        slug_it: "rotta-verso-sud",
        slug_en: "heading-south",
        title_it: "Rotta verso sud",
        title_en: "Heading south",
        status: "published",
      },
    ],
    stories: [
      {
        id: STORY_ID,
        slug: "cronache-di-refit",
        slug_it: "cronache-di-refit",
        slug_en: "refit-chronicles",
        title_it: "Cronache di refit",
        title_en: "Refit chronicles",
      },
    ],
    fb_promo_groups: [{ id: GROUP_ID, name: "Vela Lenta Mediterraneo" }],
    admin_mcp_audit_log: [],
  },
  rpc: { consume_rate_limit: true },
};

async function connect(scopes = [...MCP_SCOPES]) {
  const stub = createStubSupabase(fixtures);
  const ctx: McpContext = {
    auth: {
      tokenId: "token-1",
      tokenName: "test",
      userId: "user-1",
      email: "admin@biteproject.it",
      scopes,
      expiresAt: "2099-01-01T00:00:00Z",
    },
    service: stub.client,
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    siteUrl: SITE_URL,
  };

  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), buildMcpServer(ctx).connect(serverTransport)]);
  return client;
}

function payloadOf(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { text?: string }[] }).content ?? [];
  return JSON.parse(content[content.length - 1]?.text ?? "null");
}

function textOf(result: unknown): string {
  const content = (result as { content?: { text?: string }[] }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

describe("link_build", () => {
  it("tagga un articolo con il preset del canale e lo slug come campagna", async () => {
    const client = await connect();
    const data = payloadOf(
      await client.callTool({ name: "link_build", arguments: { article_id: ARTICLE_ID, channel: "newsletter" } }),
    );

    expect(data).toMatchObject({
      url_it: `${SITE_URL}/it/logbook/rotta-verso-sud?utm_source=newsletter&utm_medium=email&utm_campaign=rotta-verso-sud`,
      url_en: `${SITE_URL}/en/logbook/heading-south?utm_source=newsletter&utm_medium=email&utm_campaign=rotta-verso-sud`,
      canonical_url_it: `${SITE_URL}/it/logbook/rotta-verso-sud`,
    });
  });

  it("compila da solo i tracker di un gruppo Facebook", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "link_build",
      arguments: { article_id: ARTICLE_ID, fb_group_id: GROUP_ID },
    });

    expect(payloadOf(result)).toMatchObject({
      url_it: `${SITE_URL}/it/logbook/rotta-verso-sud?utm_source=facebook&utm_medium=group&utm_campaign=vela-lenta-mediterraneo`,
    });
    expect(textOf(result)).toContain("Vela Lenta Mediterraneo");
  });

  it("i campi espliciti hanno la meglio sul preset", async () => {
    const client = await connect();
    const data = payloadOf(
      await client.callTool({
        name: "link_build",
        arguments: { article_id: ARTICLE_ID, channel: "newsletter", medium: "Digest", campaign: "Agosto 2026" },
      }),
    );

    expect(data.url_it).toBe(
      `${SITE_URL}/it/logbook/rotta-verso-sud?utm_source=newsletter&utm_medium=digest&utm_campaign=agosto-2026`,
    );
  });

  it("tagga anche una storia e una pagina qualsiasi", async () => {
    const client = await connect();
    const story = payloadOf(
      await client.callTool({ name: "link_build", arguments: { story_id: STORY_ID, channel: "instagram-bio" } }),
    );
    expect(story.url_it).toBe(
      `${SITE_URL}/it/logbook/story/cronache-di-refit?utm_source=instagram&utm_medium=bio&utm_campaign=cronache-di-refit`,
    );

    const page = payloadOf(
      await client.callTool({
        name: "link_build",
        arguments: { url: `${SITE_URL}/it/voyages`, channel: "facebook-page" },
      }),
    );
    expect(page.url).toBe(`${SITE_URL}/it/voyages?utm_source=facebook&utm_medium=page&utm_campaign=voyages`);
  });

  it("rifiuta di produrre un link senza sorgente", async () => {
    const client = await connect();
    const text = textOf(await client.callTool({ name: "link_build", arguments: { article_id: ARTICLE_ID } }));

    expect(text).toContain("Manca la sorgente");
  });

  it("rifiuta più di un bersaglio alla volta", async () => {
    const client = await connect();
    const text = textOf(
      await client.callTool({
        name: "link_build",
        arguments: { article_id: ARTICLE_ID, story_id: STORY_ID, channel: "newsletter" },
      }),
    );

    expect(text).toContain("un solo bersaglio");
  });

  it("il gruppo Facebook richiede lo scope della promozione", async () => {
    const client = await connect(MCP_SCOPES.filter((s) => s !== "promo:read"));
    const text = textOf(
      await client.callTool({ name: "link_build", arguments: { article_id: ARTICLE_ID, fb_group_id: GROUP_ID } }),
    );

    expect(text).toContain("promo:read");
  });
});
