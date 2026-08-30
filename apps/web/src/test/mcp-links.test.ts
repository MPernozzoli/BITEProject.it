/**
 * I tool sugli articoli espongono gli indirizzi pubblici.
 *
 * Un agente che legge un articolo deve poterlo anche linkare senza ricomporre
 * l'URL dagli slug: qui si verifica che il link ci sia, che segua la regola
 * bilingue (slug della lingua → slug dell'altra → slug legacy) e che arrivi
 * anche dove il dato di partenza non ha gli slug (le metriche).
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures } from "./mcp-stub-supabase";

const ARTICLE_ID = "33333333-3333-4333-8333-000000000001";
const SITE_URL = "https://biteproject.it";

function fixtures(article: Record<string, unknown>): StubFixtures {
  return {
    tables: {
      logbook_articles: [
        {
          id: ARTICLE_ID,
          slug: "rotta-sud",
          slug_it: null,
          slug_en: null,
          title_it: "Rotta verso sud",
          title_en: "Heading south",
          excerpt_it: "In partenza",
          excerpt_en: "Setting off",
          content_it: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ciao" }] }] },
          content_en: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
          status: "published",
          editorial_type: "support",
          category: "Notes from the Boat",
          cover_image: null,
          scheduled_at: null,
          published_at: "2026-08-10T09:00:00Z",
          created_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
          voyage_id: null,
          story_id: null,
          ...article,
        },
      ],
      article_tags: [],
      article_authors: [],
      admin_mcp_audit_log: [],
    },
    rpc: {
      consume_rate_limit: true,
      admin_article_view_insights: [
        {
          article_id: ARTICLE_ID,
          title_it: "Rotta verso sud",
          title_en: "Heading south",
          status: "published",
          published_at: "2026-08-10T09:00:00Z",
          view_count: 120,
          tracked_views: 120,
          distinct_visitors: 90,
          avg_dwell_ms: 42000,
          views_it: 80,
          views_en: 40,
          top_lang: "it",
          like_count: 4,
          comment_count: 1,
          last_view_at: "2026-08-20T09:00:00Z",
        },
      ],
    },
  };
}

async function connect(article: Record<string, unknown> = {}) {
  const stub = createStubSupabase(fixtures(article));
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

describe("link pubblici degli articoli", () => {
  it("article_search restituisce gli indirizzi delle due lingue", async () => {
    const client = await connect({ slug_it: "rotta-verso-sud", slug_en: "heading-south" });
    const rows = payloadOf(await client.callTool({ name: "article_search", arguments: {} })) as Record<string, unknown>[];

    expect(rows[0]).toMatchObject({
      url_it: `${SITE_URL}/it/logbook/rotta-verso-sud`,
      url_en: `${SITE_URL}/en/logbook/heading-south`,
    });
  });

  it("ripiega sullo slug legacy quando mancano quelli per lingua", async () => {
    const client = await connect();
    const rows = payloadOf(await client.callTool({ name: "article_search", arguments: {} })) as Record<string, unknown>[];

    expect(rows[0]).toMatchObject({
      url_it: `${SITE_URL}/it/logbook/rotta-sud`,
      url_en: `${SITE_URL}/en/logbook/rotta-sud`,
    });
  });

  it("article_get mette il link nei dati e nel riassunto", async () => {
    const client = await connect({ slug_it: "rotta-verso-sud", slug_en: "heading-south" });
    const result = await client.callTool({ name: "article_get", arguments: { article_id: ARTICLE_ID } });

    expect(payloadOf(result)).toMatchObject({ url_it: `${SITE_URL}/it/logbook/rotta-verso-sud` });
    expect(textOf(result)).toContain(`${SITE_URL}/it/logbook/rotta-verso-sud`);
  });

  it("avverte che il link di una bozza non risponde ancora", async () => {
    const client = await connect({ status: "draft", published_at: null });
    const text = textOf(await client.callTool({ name: "article_get", arguments: { article_id: ARTICLE_ID } }));

    expect(text).toContain("attivo solo dopo la pubblicazione");
  });

  it("article_metrics accosta il link alla metrica", async () => {
    const client = await connect({ slug_it: "rotta-verso-sud", slug_en: "heading-south" });
    const rows = payloadOf(await client.callTool({ name: "article_metrics", arguments: {} })) as Record<string, unknown>[];

    expect(rows[0]).toMatchObject({
      article_id: ARTICLE_ID,
      url_it: `${SITE_URL}/it/logbook/rotta-verso-sud`,
      url_en: `${SITE_URL}/en/logbook/heading-south`,
    });
  });

  it("la risorsa bite://article riporta gli indirizzi", async () => {
    const client = await connect({ slug_it: "rotta-verso-sud", slug_en: "heading-south" });
    const resource = await client.readResource({ uri: `bite://article/${ARTICLE_ID}` });
    const text = (resource.contents[0] as { text?: string }).text ?? "";

    expect(text).toContain(`${SITE_URL}/it/logbook/rotta-verso-sud`);
    expect(text).toContain(`${SITE_URL}/en/logbook/heading-south`);
  });
});
