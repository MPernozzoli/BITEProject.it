import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext, type McpScope } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures, type StubWrite } from "./mcp-stub-supabase";

const SLOT_ID = "11111111-1111-4111-8111-000000000001";
const ARTICLE_ID = "22222222-2222-4222-8222-000000000001";

const SITE_CHANNEL = {
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

function baseFixtures(): StubFixtures {
  return {
    tables: {
      editorial_plan_channels: [SITE_CHANNEL],
      editorial_plan_weekly_slots: [],
      editorial_plan_slots: [
        {
          id: SLOT_ID,
          channel_id: "channel-site",
          slot_date: "2026-09-01",
          slot_time: "09:00:00",
          status: "assigned",
          suggested_type: "support",
          override_type: null,
          assigned_article_id: ARTICLE_ID,
          template_id: null,
          content_format: null,
          counts_toward_mix: true,
          notes: null,
        },
      ],
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
          status: "draft",
          editorial_type: "support",
          category: "Notes from the Boat",
          cover_image: null,
          scheduled_at: null,
          published_at: null,
          created_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
          voyage_id: null,
          story_id: null,
        },
      ],
      admin_mcp_audit_log: [],
    },
    rpc: { consume_rate_limit: true, has_role: true },
  };
}

async function connect(options: { scopes?: McpScope[]; fixtures?: StubFixtures } = {}) {
  const stub = createStubSupabase(options.fixtures ?? baseFixtures());
  const ctx: McpContext = {
    auth: {
      tokenId: "token-1",
      tokenName: "test",
      userId: "user-1",
      email: "admin@biteproject.it",
      scopes: options.scopes ?? [...MCP_SCOPES],
      expiresAt: "2099-01-01T00:00:00Z",
    },
    service: stub.client,
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    siteUrl: "https://biteproject.it",
  };

  const server = buildMcpServer(ctx);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server, writes: stub.writes, rpcCalls: stub.rpcCalls };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

describe("server MCP admin", () => {
  it("espone i tool dei tre domini", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "plan_get_settings",
        "plan_list_slots",
        "plan_find_gaps",
        "plan_upsert_slot",
        "plan_assign_article",
        "plan_free_slot",
        "article_search",
        "article_get",
        "article_create_draft",
        "article_update",
        "article_translate",
        "article_schedule",
        "article_unschedule",
        "newsletter_list_messages",
        "newsletter_create_draft",
        "newsletter_schedule",
      ]),
    );
  });

  it("non espone nessun tool che pubblica o spedisce immediatamente", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain("article_publish");
    expect(names).not.toContain("newsletter_send");
    expect(names).not.toContain("newsletter_send_now");
  });

  it("marca i tool di lettura come readOnly e quelli di scrittura come distruttivi", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("article_search")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("plan_assign_article")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("newsletter_schedule")?.annotations?.destructiveHint).toBe(true);
  });

  it("legge il piano editoriale", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "plan_get_settings", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("site");
  });

  it("rifiuta un tool fuori dagli scope del token", async () => {
    const { client } = await connect({ scopes: ["articles:read"] });
    const result = await client.callTool({ name: "plan_get_settings", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("plan:read");
  });

  it("blocca la chiamata quando il rate limit è esaurito", async () => {
    const fixtures = baseFixtures();
    fixtures.rpc = { consume_rate_limit: false };
    const { client } = await connect({ fixtures });
    const result = await client.callTool({ name: "article_search", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Limite raggiunto");
  });

  it("senza confirm mostra l'anteprima e non scrive", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({ name: "plan_free_slot", arguments: { slot_id: SLOT_ID } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Anteprima");
    expect(writes.filter((write: StubWrite) => write.table === "editorial_plan_slots")).toHaveLength(0);
  });

  it("con confirm libera lo slot", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({ name: "plan_free_slot", arguments: { slot_id: SLOT_ID, confirm: true } });

    expect(result.isError).toBeFalsy();
    const slotWrites = writes.filter((write: StubWrite) => write.table === "editorial_plan_slots");
    expect(slotWrites).toHaveLength(1);
    expect(slotWrites[0]?.values).toMatchObject({ assigned_article_id: null, status: "open" });
  });

  it("restituisce il corpo dell'articolo in Markdown", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "article_get", arguments: { article_id: ARTICLE_ID } });
    const text = textOf(result);
    expect(text).toContain("Rotta verso sud");
    expect(text).toContain("body_markdown_it");
  });

  it("crea una bozza e la scrive con entrambe le lingue", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "article_create_draft",
      arguments: {
        title_it: "Nuova rotta",
        title_en: "New route",
        body_markdown_it: "# Ciao\n\nTesto.",
        body_markdown_en: "# Hi\n\nText.",
      },
    });

    expect(result.isError).toBeFalsy();
    const insert = writes.find((write: StubWrite) => write.table === "logbook_articles" && write.op === "insert");
    expect(insert?.values).toMatchObject({ title_it: "Nuova rotta", title_en: "New route", status: "draft" });
    expect((insert?.values as { content_it: { type: string } }).content_it.type).toBe("doc");
  });

  it("rifiuta una bozza senza titolo inglese", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "article_create_draft",
      arguments: { title_it: "Solo italiano" },
    });
    expect(result.isError).toBe(true);
  });

  it("non programma un articolo con lacune di traduzione", async () => {
    const fixtures = baseFixtures();
    fixtures.tables!.logbook_articles[0].content_en = { type: "doc", content: [] };
    const { client } = await connect({ fixtures });

    const result = await client.callTool({
      name: "plan_assign_article",
      arguments: { slot_id: SLOT_ID, article_id: ARTICLE_ID, confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("entrambe le lingue");
  });

  it("registra ogni chiamata nell'audit log", async () => {
    const { client, writes } = await connect();
    await client.callTool({ name: "article_search", arguments: {} });

    const audit = writes.filter((write: StubWrite) => write.table === "admin_mcp_audit_log");
    expect(audit.some((write: StubWrite) => write.op === "insert" && write.values?.tool === "article_search")).toBe(true);
    expect(audit.some((write: StubWrite) => write.op === "update" && write.values?.outcome === "ok")).toBe(true);
  });

  it("espone le risorse e i prompt del dominio", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    const { prompts } = await client.listPrompts();

    expect(resources.map((resource) => resource.uri)).toContain("bite://guide/editorial");
    expect(prompts.map((prompt) => prompt.name)).toEqual(
      expect.arrayContaining(["pianifica-mese", "bozza-da-appunti", "digest-newsletter"]),
    );
  });
});

describe("scope", () => {
  beforeEach(() => {
    // I test qui sopra non condividono stato: ogni connect crea uno stub nuovo.
  });

  it("copre tutti i domini dichiarati", () => {
    expect(MCP_SCOPES).toContain("articles:write");
    expect(MCP_SCOPES).toContain("plan:write");
    expect(MCP_SCOPES).toContain("newsletter:write");
  });
});
