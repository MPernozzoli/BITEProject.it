import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures, type StubWrite } from "./mcp-stub-supabase";

const VOYAGE_ID = "77777777-7777-4777-8777-000000000001";
const WAYPOINT_ID = "88888888-8888-4888-8888-000000000001";

function baseFixtures(): StubFixtures {
  return {
    tables: {
      voyages: [
        {
          id: VOYAGE_ID,
          name: "Corsica Loop",
          name_it: "Giro della Corsica",
          name_en: "Corsica Loop",
          description: "Corsica",
          description_it: "Giro della Corsica",
          description_en: "Corsica Loop",
          type: "water",
          status: "planned",
          is_published: true,
          start_date: "2026-09-01",
          end_date: "2026-09-10",
          sort_order: 0,
        },
      ],
      voyage_waypoints: [
        {
          id: WAYPOINT_ID,
          voyage_id: VOYAGE_ID,
          sort_order: 0,
          lat: 41.39,
          lng: 9.16,
          name: "Bonifacio",
          name_it: "Bonifacio",
          name_en: "Bonifacio",
          description_it: null,
          description_en: null,
          waypoint_type: "narrative",
          visibility_mode: "auto",
          media: [],
          poi: [],
          activities: [],
          nearby_airports: [],
          event_date: null,
          event_time: null,
          date_start: null,
          date_end: null,
        },
      ],
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

describe("voyage_search e voyage_get", () => {
  it("trova la rotta e restituisce le tappe ordinate", async () => {
    const { client } = await connect();
    const searchResult = await client.callTool({ name: "voyage_search", arguments: { query: "Corsica" } });
    expect(searchResult.isError).toBeFalsy();
    expect(textOf(searchResult)).toContain("1 rotte trovate");

    const getResult = await client.callTool({ name: "voyage_get", arguments: { voyage_id: VOYAGE_ID } });
    expect(getResult.isError).toBeFalsy();
    const data = jsonOf<{ waypoints: { id: string; name_it: string }[] }>(getResult);
    expect(data.waypoints).toHaveLength(1);
    expect(data.waypoints[0]).toMatchObject({ id: WAYPOINT_ID, name_it: "Bonifacio" });
  });

  it("segnala una rotta inesistente", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "voyage_get",
      arguments: { voyage_id: "99999999-9999-4999-8999-000000000009" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("voyage_waypoint_update: patch parziale, poi/activities/media sostituiscono", () => {
  it("aggiorna descrizione, POI e attività senza toccare gli altri campi", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "voyage_waypoint_update",
      arguments: {
        waypoint_id: WAYPOINT_ID,
        description_it: "Città vecchia sulla scogliera.",
        poi: [{ name: "Cittadella", description: "Fortezza genovese" }],
        activities: [{ name: "Trekking sulle falesie" }],
      },
    });

    expect(result.isError).toBeFalsy();
    const update = writes.find((write: StubWrite) => write.table === "voyage_waypoints" && write.op === "update");
    expect(update?.values).toMatchObject({
      description_it: "Città vecchia sulla scogliera.",
      poi: [{ name: "Cittadella", description: "Fortezza genovese" }],
      activities: [{ name: "Trekking sulle falesie", description: null }],
    });
    expect(update?.values).not.toHaveProperty("name_it");
  });

  it("senza campi non scrive nulla", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({ name: "voyage_waypoint_update", arguments: { waypoint_id: WAYPOINT_ID } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Nessun campo");
    expect(writes.filter((write: StubWrite) => write.table === "voyage_waypoints")).toHaveLength(0);
  });

  it("segnala una tappa inesistente", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "voyage_waypoint_update",
      arguments: { waypoint_id: "99999999-9999-4999-8999-000000000009", description_it: "x" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("voyage_waypoint_upload_image", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("bonifacio")) {
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

  it("senza waypoint_id restituisce solo l'URL caricato", async () => {
    const { client, uploads, writes } = await connect();
    const result = await client.callTool({
      name: "voyage_waypoint_upload_image",
      arguments: { source_url: "https://cdn.example/bonifacio.jpg" },
    });

    expect(result.isError).toBeFalsy();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path.startsWith("voyages/")).toBe(true);
    expect(writes.filter((write: StubWrite) => write.table === "voyage_waypoints")).toHaveLength(0);
  });

  it("con un waypoint_id inesistente non carica l'immagine (niente file orfani nel bucket)", async () => {
    const { client, uploads } = await connect();
    const result = await client.callTool({
      name: "voyage_waypoint_upload_image",
      arguments: {
        source_url: "https://cdn.example/bonifacio.jpg",
        waypoint_id: "99999999-9999-4999-8999-000000000009",
      },
    });

    expect(result.isError).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("con waypoint_id aggiunge la foto alla galleria della tappa senza sostituire quelle esistenti", async () => {
    const fixtures = baseFixtures();
    fixtures.tables!.voyage_waypoints[0].media = [{ kind: "image", url: "https://existing/1.jpg", name: null, mime_type: null, path: null }];
    const { client, writes } = await connect(fixtures);

    const result = await client.callTool({
      name: "voyage_waypoint_upload_image",
      arguments: { source_url: "https://cdn.example/bonifacio.jpg", waypoint_id: WAYPOINT_ID, caption: "Bonifacio" },
    });

    expect(result.isError).toBeFalsy();
    const update = writes.find((write: StubWrite) => write.table === "voyage_waypoints" && write.op === "update");
    const media = update?.values?.media as { url: string; name: string | null }[];
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({ url: "https://existing/1.jpg" });
    expect(media[1]).toMatchObject({ name: "Bonifacio" });
    expect(media[1].url).toContain("stub.supabase.co");
  });
});
