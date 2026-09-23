import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { markdownToTiptap, tiptapToMarkdown, youtubeEmbedUrl } from "@/server/mcp/markdown";
import { sniffImageType } from "@/server/mcp/media";
import { createStubSupabase, type StubFixtures, type StubWrite } from "./mcp-stub-supabase";

/**
 * Il modello deve poter mettere un media in ogni punto dell'articolo in cui lo
 * mette l'editor — copertina, corpo IT/EN, immagine della Instagram Story —
 * partendo da ciò che ha davvero in mano: un URL, i byte di un'immagine, o un
 * file su disco da caricare con un URL firmato.
 */

const ARTICLE_ID = "44444444-4444-4444-8444-000000000001";

/** Il più piccolo PNG valido: 1x1 trasparente. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(Buffer.from(PNG_BASE64, "base64"));

function fixtures(): StubFixtures {
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
          excerpt_it: null,
          excerpt_en: null,
          content_it: {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Partenza da Bari" }] },
              { type: "paragraph", content: [{ type: "text", text: "Ciao" }] },
            ],
          },
          content_en: {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Leaving Bari" }] },
              { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
            ],
          },
          status: "draft",
          editorial_type: null,
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
    },
    rpc: { consume_rate_limit: true, has_role: true },
  };
}

async function connect() {
  const stub = createStubSupabase(fixtures());
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
  return { ...stub, client };
}

function articleUpdate(writes: StubWrite[]) {
  return writes.find((write) => write.table === "logbook_articles" && write.op === "update")?.values ?? {};
}

type Doc = { content: { type: string; attrs?: Record<string, unknown> }[] };

afterEach(() => vi.unstubAllGlobals());

describe("article_upload_image con i byte dell'immagine", () => {
  it("carica un PNG base64 e lo imposta come copertina, con ritaglio centrato", async () => {
    const { client, uploads, writes } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: PNG_BASE64, article_id: ARTICLE_ID, attach_as: "cover" },
    });

    expect(result.isError).toBeFalsy();
    expect(uploads[0]).toMatchObject({ bucket: "logbook-media", contentType: "image/png" });
    expect(uploads[0].path).toMatch(/^covers\/.+\.png$/);
    expect(articleUpdate(writes)).toMatchObject({
      cover_image: expect.stringContaining("/logbook-media/covers/"),
      cover_focal_x: 50,
      cover_focal_y: 50,
      cover_zoom: 1,
    });
  });

  it("accetta anche un data URL", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: `data:image/png;base64,${PNG_BASE64}` },
    });
    expect(result.isError).toBeFalsy();
    expect(uploads[0].path).toMatch(/^articles\//);
  });

  it("rifiuta byte che non sono un'immagine, qualunque cosa dichiarino", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: Buffer.from("<script>alert(1)</script> not an image").toString("base64") },
    });
    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("rifiuta source_url e data_base64 insieme", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: PNG_BASE64, source_url: "https://cdn.example/x.png" },
    });
    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("inserisce la foto nel corpo IT ed EN dopo il titolo indicato, con didascalie per lingua e flag AI", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: {
        data_base64: PNG_BASE64,
        article_id: ARTICLE_ID,
        attach_as: "body",
        after_heading: "Partenza",
        after_heading_en: "Leaving",
        caption_it: "Il porto all'alba",
        caption_en: "The harbour at dawn",
        ai_generated: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const values = articleUpdate(writes);
    const it = values.content_it as Doc;
    const en = values.content_en as Doc;
    expect(it.content.map((node) => node.type)).toEqual(["heading", "mediaFigure", "paragraph"]);
    expect(it.content[1].attrs).toMatchObject({ kind: "image", caption: "Il porto all'alba", aiGenerated: true });
    expect(en.content[1].attrs).toMatchObject({ caption: "The harbour at dawn", alt: "The harbour at dawn" });
  });

  it("segnala la didascalia mancante in una lingua invece di copiare l'altra", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: PNG_BASE64, article_id: ARTICLE_ID, attach_as: "body", caption_it: "Solo italiano" },
    });
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain("didascalia EN mancante");
    expect(((articleUpdate(writes).content_en as Doc).content.at(-1)?.attrs as Record<string, unknown>).caption).toBe("");
  });

  it("un titolo inesistente è un errore, e l'immagine non viene caricata a vuoto", async () => {
    const { client, writes, uploads } = await connect();
    const result = await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: PNG_BASE64, article_id: ARTICLE_ID, attach_as: "body", after_heading: "Inesistente" },
    });
    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
    expect(writes.some((write) => write.table === "logbook_articles" && write.op === "update")).toBe(false);
  });

  it("imposta l'immagine della Instagram Story e spegne 'usa la cover'", async () => {
    const { client, uploads, writes } = await connect();
    await client.callTool({
      name: "article_upload_image",
      arguments: { data_base64: PNG_BASE64, article_id: ARTICLE_ID, attach_as: "instagram_story_en" },
    });
    expect(uploads[0].path).toMatch(/^instagram-stories\/en\//);
    expect(articleUpdate(writes)).toMatchObject({
      instagram_story_image_en: expect.stringContaining("instagram-stories/en/"),
      instagram_story_use_cover_en: false,
    });
  });
});

describe("upload firmato per file grandi", () => {
  it("rilascia un URL di PUT e poi verifica e collega il file caricato", async () => {
    const { client, signedUploads, storedFiles, writes } = await connect();
    const slotResult = await client.callTool({
      name: "article_media_upload_url",
      arguments: { content_type: "image/png", attach_as: "cover" },
    });
    expect(slotResult.isError).toBeFalsy();
    const path = signedUploads[0].path;
    expect(path).toMatch(/^covers\/.+\.png$/);

    // La PUT del client sull'URL firmato.
    storedFiles.set(`logbook-media/${path}`, PNG_BYTES);

    const attach = await client.callTool({
      name: "article_attach_media",
      arguments: { article_id: ARTICLE_ID, uploaded_path: path, attach_as: "cover", cover_focal_y: 30 },
    });
    expect(attach.isError).toBeFalsy();
    expect(articleUpdate(writes)).toMatchObject({ cover_image: expect.stringContaining(path), cover_focal_y: 30 });
  });

  it("rimuove dal bucket un file caricato che non è un'immagine", async () => {
    const { client, signedUploads, storedFiles, removed, writes } = await connect();
    await client.callTool({ name: "article_media_upload_url", arguments: { content_type: "image/jpeg" } });
    const path = signedUploads[0].path;
    storedFiles.set(`logbook-media/${path}`, new TextEncoder().encode("#!/bin/sh echo not an image"));

    const attach = await client.callTool({
      name: "article_attach_media",
      arguments: { article_id: ARTICLE_ID, uploaded_path: path, attach_as: "body" },
    });
    expect(attach.isError).toBe(true);
    expect(removed).toEqual([{ bucket: "logbook-media", path }]);
    expect(writes.some((write) => write.table === "logbook_articles" && write.op === "update")).toBe(false);
  });

  it("errore chiaro se la PUT non è mai arrivata", async () => {
    const { client } = await connect();
    const attach = await client.callTool({
      name: "article_attach_media",
      arguments: { article_id: ARTICLE_ID, uploaded_path: "covers/mai-caricato.png", attach_as: "cover" },
    });
    expect(attach.isError).toBe(true);
  });
});

describe("article_attach_media con URL", () => {
  it("incorpora un video YouTube nel corpo con URL di embed nocookie", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "article_attach_media",
      arguments: {
        article_id: ARTICLE_ID,
        media_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        attach_as: "body",
        body_language: "it",
        caption_it: "La partenza",
      },
    });
    expect(result.isError).toBeFalsy();
    const values = articleUpdate(writes);
    expect(values.content_en).toBeUndefined();
    expect((values.content_it as Doc).content.at(-1)?.attrs).toMatchObject({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      caption: "La partenza",
    });
  });

  it("non accetta un video come copertina", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "article_attach_media",
      arguments: { article_id: ARTICLE_ID, media_url: "https://youtu.be/dQw4w9WgXcQ", attach_as: "cover" },
    });
    expect(result.isError).toBe(true);
  });

  it("ripubblica nello storage BITE un'immagine esterna prima di collegarla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } })),
    );
    const { client, uploads, writes } = await connect();
    await client.callTool({
      name: "article_attach_media",
      arguments: { article_id: ARTICLE_ID, media_url: "https://cdn.example/cover.png", attach_as: "cover" },
    });
    expect(uploads[0].path).toMatch(/^covers\//);
    expect(articleUpdate(writes).cover_image).toContain("stub.supabase.co");
  });
});

describe("Markdown dei media", () => {
  it("un link YouTube da solo nel paragrafo diventa un video, dentro una frase resta un link", () => {
    const doc = markdownToTiptap("[video: In rada](https://youtu.be/dQw4w9WgXcQ)\n\nGuarda [qui](https://youtu.be/dQw4w9WgXcQ) il video.");
    expect(doc.content?.[0]).toMatchObject({
      type: "mediaFigure",
      attrs: { kind: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "In rada" },
    });
    expect(doc.content?.[1].type).toBe("paragraph");
  });

  it("il flag AI e la didascalia fanno andata e ritorno", () => {
    const markdown = '![vela](https://x.example/a.jpg "In rada {ai}")\n\n[video: Partenza](https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ)';
    const doc = markdownToTiptap(markdown);
    expect(doc.content?.[0].attrs).toMatchObject({ caption: "In rada", aiGenerated: true });
    expect(tiptapToMarkdown(doc)).toBe(markdown);
  });

  it("normalizza le varie forme di URL YouTube", () => {
    const embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe(embed);
    expect(youtubeEmbedUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe(embed);
    expect(youtubeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(embed);
    expect(youtubeEmbedUrl("https://vimeo.com/123")).toBeNull();
  });

  it("riconosce i formati dai byte", () => {
    expect(sniffImageType(PNG_BYTES)).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });
});
