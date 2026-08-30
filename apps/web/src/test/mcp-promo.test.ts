import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext, type McpScope } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures } from "./mcp-stub-supabase";

const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const POST_A = "cccccccc-cccc-4ccc-8ccc-000000000001";
const POST_B = "cccccccc-cccc-4ccc-8ccc-000000000002";
const COMMENT_A = "dddddddd-dddd-4ddd-8ddd-000000000001";
const ARTICLE_ID = "22222222-2222-4222-8222-000000000001";

const OLD = "2026-08-01T09:00:00.000Z";
const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function baseFixtures(): StubFixtures {
  return {
    tables: {
      fb_promo_groups: [
        {
          id: GROUP_A,
          platform_group_id: "1234567890",
          name: "Vela lenta Mediterraneo",
          url: "https://facebook.com/groups/1234567890",
          language: "it",
          member_count: 12000,
          topic: "vela",
          posting_rules: "Un link a settimana, niente spam.",
          min_days_between_posts: 7,
          status: "active",
          joined_at: "2026-01-10",
          notes: null,
          created_at: OLD,
          updated_at: OLD,
        },
        {
          id: GROUP_B,
          platform_group_id: "9876543210",
          name: "Cani a bordo",
          url: null,
          language: "it",
          member_count: 3000,
          topic: "cani",
          posting_rules: null,
          min_days_between_posts: 7,
          status: "active",
          joined_at: null,
          notes: null,
          created_at: OLD,
          updated_at: OLD,
        },
      ],
      fb_promo_posts: [
        {
          id: POST_A,
          group_id: GROUP_A,
          article_id: ARTICLE_ID,
          language: "it",
          message: "Abbiamo attraversato le Bocche di Bonifacio col vento in poppa.",
          link_url: "https://biteproject.it/it/logbook/rotta-sud",
          angle: "aneddoto",
          status: "published",
          platform_post_id: "post-1",
          permalink: "https://facebook.com/post-1",
          posted_at: RECENT,
          failure_reason: null,
          notes: null,
          created_at: RECENT,
          updated_at: RECENT,
        },
        {
          id: POST_B,
          group_id: GROUP_B,
          article_id: ARTICLE_ID,
          language: "it",
          message: "Come tiene il cane durante una traversata notturna?",
          link_url: null,
          angle: "domanda",
          status: "published",
          platform_post_id: "post-2",
          permalink: null,
          posted_at: OLD,
          failure_reason: null,
          notes: null,
          created_at: OLD,
          updated_at: OLD,
        },
      ],
      fb_promo_comments: [
        {
          id: COMMENT_A,
          post_id: POST_A,
          platform_comment_id: "comment-1",
          direction: "received",
          author_name: "Marta",
          author_profile_url: null,
          message: "Che barca avete?",
          sentiment: "question",
          in_reply_to: null,
          commented_at: RECENT,
          needs_reply: true,
          handled: false,
          created_at: RECENT,
        },
      ],
      fb_promo_post_metrics: [
        // Due rilevazioni sullo stesso post: vale l'ultima, non la somma.
        {
          id: "metric-old",
          post_id: POST_A,
          captured_at: "2026-08-28T09:00:00.000Z",
          source: "manual",
          likes: 2,
          reactions: 3,
          comments: 1,
          shares: 0,
          clicks: 4,
          impressions: 100,
          reach: 90,
          notes: null,
          created_at: "2026-08-28T09:00:00.000Z",
        },
        {
          id: "metric-new",
          post_id: POST_A,
          captured_at: "2026-08-29T09:00:00.000Z",
          source: "manual",
          likes: 20,
          reactions: 24,
          comments: 6,
          shares: 3,
          clicks: 31,
          impressions: 900,
          reach: 700,
          notes: null,
          created_at: "2026-08-29T09:00:00.000Z",
        },
        {
          id: "metric-b",
          post_id: POST_B,
          captured_at: "2026-08-05T09:00:00.000Z",
          source: "manual",
          likes: 1,
          reactions: 1,
          comments: 0,
          shares: 0,
          clicks: 1,
          impressions: 50,
          reach: 40,
          notes: null,
          created_at: "2026-08-05T09:00:00.000Z",
        },
      ],
      logbook_articles: [
        {
          id: ARTICLE_ID,
          slug: "rotta-sud",
          slug_it: "rotta-sud",
          slug_en: "heading-south",
          title_it: "Rotta verso sud",
          title_en: "Heading south",
          status: "published",
        },
      ],
      admin_mcp_audit_log: [],
    },
    rpc: { consume_rate_limit: true, has_role: true },
  };
}

async function connect(options: { scopes?: McpScope[]; fixtures?: StubFixtures } = {}) {
  const fixtures = options.fixtures ?? baseFixtures();
  const stub = createStubSupabase(fixtures);
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
  return { client, writes: stub.writes, fixtures };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

function jsonOf<T>(result: unknown): T {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return JSON.parse(content[1]?.text ?? content[0]?.text ?? "{}") as T;
}

describe("scope", () => {
  it("rifiuta i tool promo senza lo scope", async () => {
    const { client } = await connect({ scopes: ["articles:read"] });
    const result = await client.callTool({ name: "promo_group_list", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("promo:read");
  });
});

describe("promo_group_list", () => {
  it("dice quando un gruppo è di nuovo disponibile", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_group_list", arguments: {} });
    expect(result.isError).toBeFalsy();

    const groups = jsonOf<{ id: string; available: boolean; published_posts: number; last_post_at: string | null }[]>(result);
    const recent = groups.find((group) => group.id === GROUP_A);
    const stale = groups.find((group) => group.id === GROUP_B);

    // Pubblicato ieri, cooldown di 7 giorni: non si ripubblica lì.
    expect(recent).toMatchObject({ available: false, published_posts: 1 });
    // Ultimo post di inizio agosto: cooldown scaduto.
    expect(stale?.available).toBe(true);
  });

  it("only_available lascia fuori i gruppi ancora in cooldown", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_group_list", arguments: { only_available: true } });
    const groups = jsonOf<{ id: string }[]>(result);
    expect(groups.map((group) => group.id)).toEqual([GROUP_B]);
  });
});

describe("promo_group_upsert", () => {
  it("aggiorna invece di duplicare quando il gruppo è già noto per platform_group_id", async () => {
    const { client, writes, fixtures } = await connect();
    const result = await client.callTool({
      name: "promo_group_upsert",
      arguments: { platform_group_id: "1234567890", notes: "Il moderatore chiede di non postare la domenica.", member_count: 12500 },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("aggiornato");

    const groupWrites = writes.filter((write) => write.table === "fb_promo_groups");
    expect(groupWrites).toHaveLength(1);
    expect(groupWrites[0].op).toBe("update");
    expect(fixtures.tables?.fb_promo_groups).toHaveLength(2);
  });

  it("crea un gruppo nuovo e pretende il nome", async () => {
    const { client } = await connect();
    const missingName = await client.callTool({
      name: "promo_group_upsert",
      arguments: { platform_group_id: "5555555555" },
    });
    expect(missingName.isError).toBe(true);

    const created = await client.callTool({
      name: "promo_group_upsert",
      arguments: { platform_group_id: "5555555555", name: "Viaggio lento", language: "it", min_days_between_posts: 14 },
    });
    expect(created.isError).toBeFalsy();
    expect(textOf(created)).toContain("registrato");
  });
});

describe("promo_post_log", () => {
  it("registra il post e calcola quando si potrà ripubblicare nel gruppo", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "promo_post_log",
      arguments: {
        group_id: GROUP_A,
        article_id: ARTICLE_ID,
        message: "Tre notti in rada e un temporale.",
        angle: "aneddoto",
        posted_at: "2026-08-30T08:00:00.000Z",
        platform_post_id: "post-3",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Prossimo post lecito lì dal 2026-09-06");

    const insert = writes.find((write) => write.table === "fb_promo_posts" && write.op === "insert");
    expect(insert?.values).toMatchObject({ group_id: GROUP_A, article_id: ARTICLE_ID, status: "published" });

    // L'articolo promosso torna con i suoi indirizzi pubblici, pronti da linkare.
    const data = jsonOf<{ article: { url_it: string; url_en: string } }>(result);
    expect(data.article.url_it).toBe("https://biteproject.it/it/logbook/rotta-sud");
    expect(data.article.url_en).toBe("https://biteproject.it/en/logbook/heading-south");
  });

  it("rifiuta un gruppo inesistente", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "promo_post_log",
      arguments: { group_id: "99999999-9999-4999-8999-000000000009", message: "ciao" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("promo_comment_log", () => {
  it("una risposta chiude il commento a cui risponde", async () => {
    const { client, writes, fixtures } = await connect();
    const result = await client.callTool({
      name: "promo_comment_log",
      arguments: {
        post_id: POST_A,
        direction: "sent",
        message: "Un Bavaria 38 del 2005.",
        in_reply_to: COMMENT_A,
      },
    });
    expect(result.isError).toBeFalsy();

    const update = writes.find((write) => write.table === "fb_promo_comments" && write.op === "update");
    expect(update?.values).toMatchObject({ handled: true, needs_reply: false });

    const original = fixtures.tables?.fb_promo_comments?.find((row) => row.id === COMMENT_A);
    expect(original).toMatchObject({ handled: true, needs_reply: false });
  });

  it("una domanda ricevuta resta in attesa di risposta", async () => {
    const { client, writes } = await connect();
    await client.callTool({
      name: "promo_comment_log",
      arguments: { post_id: POST_B, direction: "received", message: "Quanto costa?", sentiment: "question" },
    });
    const insert = writes.find((write) => write.table === "fb_promo_comments" && write.op === "insert");
    expect(insert?.values).toMatchObject({ needs_reply: true, handled: false });
  });

  it("rifiuta in_reply_to di un altro post", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "promo_comment_log",
      arguments: { post_id: POST_B, direction: "sent", message: "…", in_reply_to: COMMENT_A },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("un altro post");
  });
});

describe("promo_comment_list", () => {
  it("pending_only restituisce solo ciò che è rimasto senza risposta", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_comment_list", arguments: { pending_only: true } });
    const comments = jsonOf<{ id: string }[]>(result);
    expect(comments.map((comment) => comment.id)).toEqual([COMMENT_A]);
  });
});

describe("promo_report", () => {
  it("classifica i gruppi sull'ultima rilevazione di ogni post", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_report", arguments: { group_by: "group" } });
    expect(result.isError).toBeFalsy();

    const rows = jsonOf<{ key: string; label: string; engagement: number; comments_received: number }[]>(result);
    expect(rows[0]).toMatchObject({ key: GROUP_A, label: "Vela lenta Mediterraneo", comments_received: 1 });
    // Ultima rilevazione: 24 reazioni + 6 commenti + 3 condivisioni. Non la somma con quella vecchia.
    expect(rows[0].engagement).toBe(33);
    expect(rows[1]).toMatchObject({ key: GROUP_B, engagement: 1 });
  });

  it("raggruppa anche per articolo", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_report", arguments: { group_by: "article" } });
    const rows = jsonOf<{ key: string; label: string; posts: number }[]>(result);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: ARTICLE_ID, label: "Rotta verso sud", posts: 2 });
  });
});

describe("promo_post_get", () => {
  it("riunisce post, gruppo, articolo, commenti e storia delle metriche", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "promo_post_get", arguments: { post_id: POST_A } });
    expect(result.isError).toBeFalsy();

    const data = jsonOf<{
      group: { name: string };
      article: { title_it: string };
      comments: { id: string }[];
      metrics: { id: string }[];
      latest_metrics: { id: string };
      engagement: number;
    }>(result);

    expect(data.group.name).toBe("Vela lenta Mediterraneo");
    expect(data.article.title_it).toBe("Rotta verso sud");
    expect(data.comments).toHaveLength(1);
    expect(data.metrics.map((metric) => metric.id)).toEqual(["metric-new", "metric-old"]);
    expect(data.latest_metrics.id).toBe("metric-new");
    expect(data.engagement).toBe(33);
  });
});
