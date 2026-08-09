import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/server/mcp/server";
import { MCP_SCOPES, type McpContext, type McpScope } from "@/server/mcp/context";
import { createStubSupabase, type StubFixtures, type StubWrite } from "./mcp-stub-supabase";

/**
 * I tool mail chiamano `@pynkstudio/mailapp/mailbox/server` direttamente: qui
 * si prova che il ponte funzioni, non che il package sia corretto (quello è
 * testato lì). Lo stub riusa le stesse fixture Supabase degli altri test MCP.
 */

const INBOUND_ID = "33333333-3333-4333-8333-000000000001";

vi.mock("@/server/mail", async () => {
  const actual = await vi.importActual<typeof import("@/server/mail")>("@/server/mail");
  return actual;
});

function baseFixtures(): StubFixtures {
  return {
    tables: {
      inbound_emails: [
        {
          id: INBOUND_ID,
          created_at: "2026-08-01T09:00:00Z",
          message_id: "<abc@mail.biteproject.it>",
          thread_key: "thread-1",
          from_address: "socio@example.com",
          from_name: "Socio Curioso",
          to_addresses: ["hello@biteproject.it"],
          cc_addresses: [],
          subject: "Domanda sul prossimo viaggio",
          text_body: "Ciao, quando parte la prossima tratta?",
          html_body: "<p>Ciao, quando parte la prossima tratta?</p>",
          read: false,
          starred: false,
          archived: false,
          spam: false,
          attachments: [],
        },
      ],
      sent_emails: [],
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
  return { client, writes: stub.writes };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  // `sendMailboxMessage` chiama Resend via `fetch` reale: qui si prova il
  // ponte fra il tool e il package, non un servizio esterno vero.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("api.resend.com")) {
        return new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 });
      }
      throw new Error(`fetch non atteso in test: ${url}`);
    }),
  );
});

describe("tool mail", () => {
  it("compaiono nell'elenco dei tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["mail_list_messages", "mail_get_message", "mail_mark", "mail_reply", "mail_forward", "mail_compose"]),
    );
  });

  it("elenca i messaggi della inbox", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "mail_list_messages", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Domanda sul prossimo viaggio");
  });

  it("legge un messaggio con il corpo", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "mail_get_message", arguments: { message_id: INBOUND_ID } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("quando parte la prossima tratta");
  });

  it("rifiuta i tool mail fuori scope", async () => {
    const { client } = await connect({ scopes: ["articles:read"] });
    const result = await client.callTool({ name: "mail_list_messages", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("mail:read");
  });

  it("mail_mark applica l'azione senza bisogno di confirm, salvo delete", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({ name: "mail_mark", arguments: { message_id: INBOUND_ID, action: "star" } });
    expect(result.isError).toBeFalsy();
    const update = writes.find((write: StubWrite) => write.table === "inbound_emails" && write.op === "update");
    expect(update?.values).toMatchObject({ starred: true });
  });

  it("mail_mark su delete senza confirm resta un'anteprima", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({ name: "mail_mark", arguments: { message_id: INBOUND_ID, action: "delete" } });
    expect(textOf(result)).toContain("Anteprima");
    expect(writes.filter((write: StubWrite) => write.op === "delete")).toHaveLength(0);
  });

  it("mail_mark su delete con confirm elimina la riga", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "mail_mark",
      arguments: { message_id: INBOUND_ID, action: "delete", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    expect(writes.some((write: StubWrite) => write.table === "inbound_emails" && write.op === "delete")).toBe(true);
  });

  it("mail_reply senza confirm mostra l'anteprima e non invia", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "mail_reply",
      arguments: { message_id: INBOUND_ID, body: "Grazie per la domanda!" },
    });
    expect(textOf(result)).toContain("Anteprima");
    expect(writes.some((write: StubWrite) => write.table === "sent_emails")).toBe(false);
  });

  it("mail_reply con confirm invia e resta nel thread originale", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "mail_reply",
      arguments: { message_id: INBOUND_ID, body: "Grazie per la domanda!", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    const sent = writes.find((write: StubWrite) => write.table === "sent_emails" && write.op === "insert");
    expect(sent?.values).toMatchObject({ to_addresses: ["socio@example.com"], subject: "Re: Domanda sul prossimo viaggio" });
  });

  it("rifiuta mail_reply su un id di un messaggio che abbiamo inviato noi (manderebbe a noi stessi)", async () => {
    const fixtures = baseFixtures();
    const SENT_ID = "44444444-4444-4444-8444-000000000009";
    fixtures.tables!.sent_emails = [
      {
        id: SENT_ID,
        created_at: "2026-08-01T10:00:00Z",
        message_id: "<reply-1@mail.biteproject.it>",
        thread_key: "thread-1",
        from_address: "hello@biteproject.it",
        to_addresses: ["socio@example.com"],
        cc_addresses: [],
        subject: "Re: Domanda sul prossimo viaggio",
        text_body: "Parte la settimana prossima!",
        html_body: "<p>Parte la settimana prossima!</p>",
      },
    ];
    const { client, writes } = await connect({ fixtures });

    const result = await client.callTool({
      name: "mail_reply",
      arguments: { message_id: SENT_ID, body: "Altro giro", confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("inviato da noi");
    expect(writes.some((write: StubWrite) => write.table === "sent_emails" && write.op === "insert")).toBe(false);
  });

  it("mail_forward cita l'originale e non aggancia il thread", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "mail_forward",
      arguments: { message_id: INBOUND_ID, to: "collega@biteproject.it", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    const sent = writes.find((write: StubWrite) => write.table === "sent_emails" && write.op === "insert");
    expect(sent?.values).toMatchObject({ to_addresses: ["collega@biteproject.it"], subject: "Fwd: Domanda sul prossimo viaggio" });
    expect(String((sent?.values as { text_body?: string })?.text_body ?? "")).toContain("Messaggio inoltrato");
  });

  it("mail_compose scrive un messaggio nuovo senza legami di thread", async () => {
    const { client, writes } = await connect();
    const result = await client.callTool({
      name: "mail_compose",
      arguments: { to: "nuovo@example.com", subject: "Benvenuto", body: "Ciao!", confirm: true },
    });
    expect(result.isError).toBeFalsy();
    const sent = writes.find((write: StubWrite) => write.table === "sent_emails" && write.op === "insert");
    expect(sent?.values).toMatchObject({ to_addresses: ["nuovo@example.com"], subject: "Benvenuto" });
  });

  it("rifiuta compose senza destinatari validi", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "mail_compose",
      arguments: { to: "", subject: "Vuoto", body: "Ciao", confirm: true },
    });
    expect(result.isError).toBe(true);
  });
});
