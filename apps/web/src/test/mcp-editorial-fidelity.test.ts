import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures, type StubWrite } from "./mcp-stub-supabase";

/**
 * Copre ciò che l'utente ha chiesto esplicitamente: che i tool arrivino a
 * tutto ciò che offre l'editor, non solo al testo — foto (con e senza
 * didascalia), cover con punto focale/zoom, tag, autori, collegamento voyage —
 * e che il caricamento immagini finisca davvero nel bucket giusto.
 */

const ARTICLE_ID = "44444444-4444-4444-8444-000000000001";
const AUTHOR_PROFILE_ID = "55555555-5555-4555-8555-000000000001";

function baseFixtures(): StubFixtures {
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
      tags: [{ id: "tag-esistente", name: "Vela" }],
      article_tags: [],
      article_authors: [],
    },
    rpc: { consume_rate_limit: true, has_role: true },
  };
}

async function connect(fixtures: StubFixtures = baseFixtures()) {
  const stub = createStubSupabase(fixtures);
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

  const server = buildMcpServer(ctx);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, writes: stub.writes, uploads: stub.uploads };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

function jsonOf<T>(result: unknown): T {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return JSON.parse(content[1]?.text ?? content[0]?.text ?? "{}") as T;
}

describe("caricamento immagini", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("rotta")) {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        throw new Error(`URL non atteso: ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("article_upload_image scarica e ripubblica nel bucket logbook-media", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { source_url: "https://cdn.example/rotta.jpg" },
    });

    expect(result.isError).toBeFalsy();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ bucket: "logbook-media", contentType: "image/jpeg", bytes: 4 });
    expect(uploads[0].path.startsWith("articles/")).toBe(true);
    expect(textOf(result)).toContain("stub.supabase.co");
  });

  it("accetta una cartella diversa, es. covers", async () => {
    const { client, uploads } = await connect();
    await client.callTool({
      name: "article_upload_image",
      arguments: { source_url: "https://cdn.example/rotta.jpg", folder: "covers" },
    });
    expect(uploads[0].path.startsWith("covers/")).toBe(true);
  });

  it("rifiuta un formato non immagine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not an image", { status: 200, headers: { "content-type": "text/plain" } })),
    );
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { source_url: "https://cdn.example/rotta.txt" },
    });
    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("rifiuta una cartella con caratteri non ammessi", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { source_url: "https://cdn.example/rotta.jpg", folder: "../secrets" },
    });
    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("newsletter_upload_image usa lo stesso bucket con cartella newsletter di default", async () => {
    const { client, uploads } = await connect();
    await client.callTool({ name: "newsletter_upload_image", arguments: { source_url: "https://cdn.example/rotta.jpg" } });
    expect(uploads[0]).toMatchObject({ bucket: "logbook-media" });
    expect(uploads[0].path.startsWith("newsletter/")).toBe(true);
  });
});

describe("bozza articolo con tutte le impostazioni dell'editor", () => {
  it("salva cover con punto focale/zoom, slug bilingui, tag e autori", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "article_create_draft",
      arguments: {
        title_it: "Bocche di Bonifacio",
        title_en: "Strait of Bonifacio",
        body_markdown_it: '# Rotta\n\nTesto con **grassetto** e una foto:\n\n![vela](https://cdn.example/vela.jpg "In rada")',
        body_markdown_en: "# Route\n\nText.",
        cover_image: "https://stub.supabase.co/storage/v1/object/public/logbook-media/covers/1.jpg",
        cover_focal_x: 0.3,
        cover_focal_y: 0.7,
        cover_zoom: 1.5,
        slug_it: "bocche-di-bonifacio",
        slug_en: "strait-of-bonifacio",
        tags: ["Vela", "Corsica"],
        authors: [{ profile_id: AUTHOR_PROFILE_ID }],
      },
    });

    expect(result.isError).toBeFalsy();

    const insert = writes.find((write: StubWrite) => write.table === "logbook_articles" && write.op === "insert");
    expect(insert?.values).toMatchObject({
      cover_focal_x: 0.3,
      cover_focal_y: 0.7,
      cover_zoom: 1.5,
      slug_it: "bocche-di-bonifacio",
      slug_en: "strait-of-bonifacio",
    });

    const tagInsert = writes.find((write: StubWrite) => write.table === "article_tags" && write.op === "insert");
    expect(tagInsert).toBeTruthy();

    const authorInsert = writes.find((write: StubWrite) => write.table === "article_authors" && write.op === "insert");
    expect(authorInsert?.values).toMatchObject([{ article_id: expect.any(String), profile_id: AUTHOR_PROFILE_ID }]);
  });

  it("il corpo con foto e didascalia produce un nodo mediaFigure, non testo perso", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "article_create_draft",
      arguments: {
        title_it: "Prova foto",
        title_en: "Photo test",
        body_markdown_it: '![vela](https://cdn.example/vela.jpg "In rada a Bonifacio")',
      },
    });
    expect(result.isError).toBeFalsy();
  });
});

describe("aggiornamento articolo: tag e autori sostituiscono, non sommano", () => {
  it("article_update con tags:[] svuota i tag esistenti", async () => {
    const fixtures = baseFixtures();
    fixtures.tables!.article_tags = [{ id: "link-1", article_id: ARTICLE_ID, tag_id: "tag-esistente" }];
    const { client, writes } = await connect(fixtures);

    const result = await client.callTool({ name: "article_update", arguments: { article_id: ARTICLE_ID, tags: [] } });

    expect(result.isError).toBeFalsy();
    expect(writes.some((write: StubWrite) => write.table === "article_tags" && write.op === "delete")).toBe(true);
    expect(writes.some((write: StubWrite) => write.table === "article_tags" && write.op === "insert")).toBe(false);
  });

  it("article_update con un nuovo elenco di tag riusa quelli esistenti e crea i mancanti", async () => {
    const fixtures = baseFixtures();
    const { client, writes } = await connect(fixtures);

    const result = await client.callTool({
      name: "article_update",
      arguments: { article_id: ARTICLE_ID, tags: ["Vela", "Nuovo tag"] },
    });

    expect(result.isError).toBeFalsy();
    const tagCreate = writes.find((write: StubWrite) => write.table === "tags" && write.op === "insert");
    expect(tagCreate?.values).toMatchObject({ name: "Nuovo tag" });
  });

  it("aggiorna il collegamento voyage e la posizione", async () => {
    const { client, writes } = await connect();
    const voyageId = "66666666-6666-4666-8666-000000000001";
    const result = await client.callTool({
      name: "article_update",
      arguments: { article_id: ARTICLE_ID, voyage_id: voyageId, location_name: "Bonifacio", latitude: 41.39, longitude: 9.16 },
    });

    expect(result.isError).toBeFalsy();
    const update = writes.find((write: StubWrite) => write.table === "logbook_articles" && write.op === "update");
    expect(update?.values).toMatchObject({ voyage_id: voyageId, location_name: "Bonifacio", latitude: 41.39, longitude: 9.16 });
  });
});

describe("article_get espone tag, autori e impostazioni cover", () => {
  it("restituisce i nomi dei tag collegati, non gli id", async () => {
    const fixtures = baseFixtures();
    fixtures.tables!.article_tags = [{ id: "link-1", article_id: ARTICLE_ID, tag_id: "tag-esistente", tags: { name: "Vela" } }];
    const { client } = await connect(fixtures);

    const result = await client.callTool({ name: "article_get", arguments: { article_id: ARTICLE_ID, include_body: false } });
    const data = jsonOf<{ tags: string[] }>(result);
    expect(data.tags).toContain("Vela");
  });
});
