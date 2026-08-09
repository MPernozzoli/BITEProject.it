/**
 * Tool sulla casella mail admin.
 *
 * Tutta la logica — threading, ricerca, assegnazione, invio Resend — vive in
 * `@pynkstudio/mailapp/mailbox` (`AGENTS.md`: i domini mail e newsletter si
 * scrivono nel package). Questi tool chiamano direttamente le funzioni
 * esportate (`loadMailbox`, `applyMailMessageAction`, `sendMailboxMessage`),
 * la stessa libreria che usano gli handler HTTP in `api/email/*` — non li
 * duplicano né li reimplementano.
 *
 * Inviare, rispondere e inoltrare sono le uniche azioni di questo modulo con
 * un effetto che esce davvero dal sistema: dietro `confirm: true`, come gli
 * altri tool ⚠. Le azioni di sola gestione (letto, archivia, stella) restano
 * dirette perché reversibili e invisibili al mittente; solo `delete` — che
 * cancella la riga — richiede conferma.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyMailMessageAction,
  attachThreadMessages,
  hydrateMissingInboundBodies,
  loadMailbox,
  sendMailboxMessage,
  splitRecipients,
  type MailboxView,
} from "@pynkstudio/mailapp/mailbox/server";
import { mailboxConfig, mailContext } from "../../mail.js";
import { McpToolError, type McpContext } from "../context.js";
import { clientRequestIdShape, confirmShape, registerTool, type ToolOutcome } from "../registry.js";

/**
 * `SendMailboxResult` è un'unione discriminata corretta, ma questo progetto
 * compila senza `strictNullChecks` e il narrowing su `result.ok` non regge:
 * TypeScript continua a vedere entrambi i rami. Un cast esplicito qui, invece
 * di uno sparso in ogni chiamata.
 */
function sendFailureMessage(result: { ok: boolean }): string {
  const failure = result as { error?: string; details?: string };
  return `Invio fallito: ${failure.error ?? "errore sconosciuto"}${failure.details ? ` — ${failure.details}` : ""}`;
}

const VIEWS = ["inbox", "unread", "starred", "archived", "spam", "sent"] as const;
const ACTIONS = ["read", "unread", "star", "unstar", "archive", "restore", "spam", "not_spam", "delete"] as const;

function resendApiKey(ctx: McpContext): string | undefined {
  void ctx;
  return process.env.RESEND_API_KEY;
}

/** Solo i campi che un agente ha bisogno di leggere: niente header grezzi né payload Resend. */
function summarizeMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    source: row.source ?? "inbound",
    created_at: row.created_at,
    from_address: row.from_address,
    from_name: row.from_name ?? null,
    to_addresses: row.to_addresses ?? [],
    cc_addresses: row.cc_addresses ?? [],
    subject: row.subject ?? mailboxConfig.noSubjectLabel,
    text_preview: typeof row.text_body === "string" ? row.text_body.slice(0, 280) : null,
    read: row.read ?? true,
    starred: row.starred ?? false,
    archived: row.archived ?? false,
    spam: row.spam ?? false,
    has_attachments: Array.isArray(row.attachments) && row.attachments.length > 0,
  };
}

async function findMessageById(
  ctx: McpContext,
  id: string,
): Promise<{ row: Record<string, unknown>; source: "inbound" | "sent" } | null> {
  const { data: inbound, error: inboundError } = await ctx.service
    .from(mailboxConfig.tables.inbound)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (inboundError) throw new McpToolError("db_error", `Lettura mail fallita: ${inboundError.message}`);
  if (inbound) return { row: inbound as Record<string, unknown>, source: "inbound" };

  const { data: sent, error: sentError } = await ctx.service
    .from(mailboxConfig.tables.sent)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (sentError) throw new McpToolError("db_error", `Lettura mail fallita: ${sentError.message}`);
  if (sent) return { row: sent as Record<string, unknown>, source: "sent" };
  return null;
}

function bodyOf(row: Record<string, unknown>): string {
  if (typeof row.text_body === "string" && row.text_body.trim()) return row.text_body.trim();
  const html = typeof row.html_body === "string" ? row.html_body : "";
  // Estrazione minima per la citazione in un forward: non serve fedeltà,
  // solo leggibilità di ciò che si sta inoltrando.
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function quoteBlock(row: Record<string, unknown>): string {
  const from = typeof row.from_address === "string" ? row.from_address : "?";
  const when = typeof row.created_at === "string" ? row.created_at : "";
  const body = bodyOf(row);
  return `\n\n---------- Messaggio inoltrato ----------\nDa: ${from}\nData: ${when}\nOggetto: ${row.subject ?? mailboxConfig.noSubjectLabel}\n\n${body}`;
}

export function registerMailTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "mail_list_messages",
    title: "Elenca la posta",
    description:
      "Elenca i messaggi di una vista della casella (inbox, non letti, con stella, archiviati, spam, inviati), con ricerca testuale opzionale.",
    scope: "mail:read",
    kind: "read",
    inputSchema: {
      view: z.enum(VIEWS).default("inbox"),
      page: z.number().int().min(1).default(1),
      search: z.string().max(200).optional(),
    },
    handler: async (args, context) => {
      const payload = await loadMailbox(context.service, mailboxConfig, {
        view: args.view as MailboxView,
        page: args.page ?? 1,
        search: args.search,
        resendApiKey: resendApiKey(context),
      });

      return {
        text: `${payload.messages.length} messaggi in "${payload.view}" (pagina ${payload.page} di ${Math.max(1, Math.ceil(payload.total / payload.pageSize))}), ${payload.counts.unread} non letti nella inbox.`,
        data: {
          view: payload.view,
          page: payload.page,
          total: payload.total,
          counts: payload.counts,
          messages: payload.messages.map((message) => summarizeMessage(message as Record<string, unknown>)),
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "mail_get_message",
    title: "Leggi una mail e il suo thread",
    description:
      "Restituisce un messaggio per intero — corpo incluso — con l'intera conversazione a cui appartiene, inbound e inviate unite in ordine cronologico.",
    scope: "mail:read",
    kind: "read",
    inputSchema: { message_id: z.string().uuid() },
    handler: async (args, context) => {
      const found = await findMessageById(context, args.message_id);
      if (!found) throw new McpToolError("not_found", `Mail ${args.message_id} inesistente.`);

      const [hydrated] = await hydrateMissingInboundBodies(
        context.service,
        mailboxConfig,
        [found.row] as never,
        resendApiKey(context),
      );
      const [withThread] = await attachThreadMessages(context.service, mailboxConfig, [
        { ...hydrated, source: found.source },
      ] as never);

      const row = withThread as unknown as Record<string, unknown>;
      const thread = (Array.isArray(row.thread_messages) ? row.thread_messages : [row]) as Record<string, unknown>[];

      return {
        text: `"${row.subject ?? mailboxConfig.noSubjectLabel}" — thread di ${thread.length} messaggio${thread.length === 1 ? "" : "i"}.`,
        targetId: args.message_id,
        data: {
          id: row.id,
          subject: row.subject ?? mailboxConfig.noSubjectLabel,
          thread: thread.map((entry) => ({
            id: entry.id,
            source: entry.source ?? "inbound",
            created_at: entry.created_at,
            from_address: entry.from_address,
            to_addresses: entry.to_addresses ?? [],
            cc_addresses: entry.cc_addresses ?? [],
            body: bodyOf(entry),
            has_attachments: Array.isArray(entry.attachments) && entry.attachments.length > 0,
          })),
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "mail_mark",
    title: "Gestisci una mail (letta, stella, archivio, spam, elimina)",
    description:
      "Applica un'azione di gestione a un messaggio in arrivo: read, unread, star, unstar, archive, restore, spam, not_spam, delete. Solo delete richiede confirm: true, perché cancella la riga.",
    scope: "mail:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      action: z.enum(ACTIONS),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (args, context) => {
      if (args.action === "delete" && args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — la mail ${args.message_id} verrebbe eliminata definitivamente. Ripeti con confirm: true.`,
          targetId: args.message_id,
        } satisfies ToolOutcome;
      }

      try {
        await applyMailMessageAction(context.service, mailboxConfig, args.message_id, args.action, {
          push: mailContext.push ? { send: mailContext.push.send } : undefined,
        });
      } catch (error) {
        throw new McpToolError("db_error", `Azione fallita: ${error instanceof Error ? error.message : String(error)}`);
      }

      return {
        text: `Mail ${args.message_id}: applicata l'azione "${args.action}".`,
        targetId: args.message_id,
        data: { message_id: args.message_id, action: args.action },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "mail_reply",
    title: "Rispondi a una mail",
    description:
      "Risponde a un messaggio in arrivo, mantenendo il thread (In-Reply-To/References) come fa la console admin. Il corpo è testo semplice: gli a-capo diventano ritorni a capo nell'email. Richiede confirm: true.",
    scope: "mail:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      body: z.string().min(1).max(50_000),
      reply_all: z.boolean().optional().describe("Aggiunge in CC gli altri destinatari originali, come 'Rispondi a tutti'."),
      from_option_id: z.string().optional().describe("Identità mittente da usare (hello, massimo, sami, pack, viaggi, support). Default: hello."),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) => {
      const found = await findMessageById(context, args.message_id);
      if (!found) throw new McpToolError("not_found", `Mail ${args.message_id} inesistente.`);
      if (found.source !== "inbound") {
        // `findMessageById` cerca anche fra le mail inviate (così mail_get_message può
        // mostrarle nel thread): rispondervi manderebbe la mail a from_address, cioè al
        // nostro stesso mittente, non al corrispondente — un invio "riuscito" ma sbagliato,
        // senza errore visibile. mail_get_message espone `source` per ogni messaggio del
        // thread: va usato l'id di uno con source "inbound".
        throw new McpToolError(
          "not_inbound",
          `Mail ${args.message_id} è un messaggio inviato da noi, non ricevuto: rispondere manderebbe la mail al nostro stesso mittente. Usa l'id di un messaggio del thread con source "inbound" (vedi mail_get_message).`,
        );
      }
      const original = found.row;

      const subject = String(original.subject ?? mailboxConfig.noSubjectLabel);
      const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
      const to = String(original.from_address ?? "");
      const cc = args.reply_all
        ? [...(Array.isArray(original.to_addresses) ? original.to_addresses : []), ...(Array.isArray(original.cc_addresses) ? original.cc_addresses : [])].filter(
            (address): address is string => typeof address === "string",
          )
        : [];

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — risposta a ${to} con oggetto "${replySubject}"${cc.length ? `, in CC: ${cc.join(", ")}` : ""}. Ripeti con confirm: true per inviare davvero.`,
          targetId: args.message_id,
          data: { to, cc, subject: replySubject },
        } satisfies ToolOutcome;
      }

      const result = await sendMailboxMessage(context.service, mailboxConfig, resendApiKey(context), {
        fromOptionId: args.from_option_id,
        to: [to],
        cc,
        subject: replySubject,
        text: args.body,
        replyToMessageId: args.message_id,
        sentByUserId: context.auth.userId,
        sentByName: context.auth.tokenName,
      });

      if (!result.ok) {
        throw new McpToolError("send_failed", sendFailureMessage(result));
      }

      return {
        text: `Risposta inviata a ${to}.`,
        targetId: args.message_id,
        data: { to, subject: replySubject, thread_key: result.threadKey },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "mail_forward",
    title: "Inoltra una mail",
    description:
      "Inoltra un messaggio a nuovi destinatari, citando mittente, data, oggetto e corpo dell'originale. Non porta gli allegati. Non prosegue il thread originale — è un messaggio nuovo, con oggetto 'Fwd: ...'. Richiede confirm: true.",
    scope: "mail:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      to: z.string().min(3).describe("Destinatari separati da virgola, punto e virgola o a capo."),
      note: z.string().max(5000).optional().describe("Testo aggiunto sopra il messaggio citato."),
      from_option_id: z.string().optional(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) => {
      const found = await findMessageById(context, args.message_id);
      if (!found) throw new McpToolError("not_found", `Mail ${args.message_id} inesistente.`);
      const original = found.row;

      const recipients = splitRecipients(args.to);
      if (recipients.length === 0) throw new McpToolError("bad_request", "Nessun destinatario valido in 'to'.");

      const subject = String(original.subject ?? mailboxConfig.noSubjectLabel);
      const forwardSubject = subject.toLowerCase().startsWith("fwd:") ? subject : `Fwd: ${subject}`;
      const body = `${args.note ? `${args.note.trim()}\n` : ""}${quoteBlock(original)}`;

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — inoltro a ${recipients.join(", ")} con oggetto "${forwardSubject}". Ripeti con confirm: true per inviare davvero.`,
          targetId: args.message_id,
          data: { to: recipients, subject: forwardSubject },
        } satisfies ToolOutcome;
      }

      const result = await sendMailboxMessage(context.service, mailboxConfig, resendApiKey(context), {
        fromOptionId: args.from_option_id,
        to: recipients,
        subject: forwardSubject,
        text: body,
        sentByUserId: context.auth.userId,
        sentByName: context.auth.tokenName,
      });

      if (!result.ok) {
        throw new McpToolError("send_failed", sendFailureMessage(result));
      }

      return {
        text: `Mail inoltrata a ${recipients.join(", ")}.`,
        targetId: args.message_id,
        data: { to: recipients, subject: forwardSubject, thread_key: result.threadKey },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "mail_compose",
    title: "Scrivi una mail nuova",
    description:
      "Scrive e invia una mail da zero, non legata a nessun thread esistente. Corpo in testo semplice. Richiede confirm: true.",
    scope: "mail:write",
    kind: "write",
    inputSchema: {
      to: z.string().min(3).describe("Destinatari separati da virgola, punto e virgola o a capo."),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(50_000),
      from_option_id: z.string().optional().describe("Identità mittente (hello, massimo, sami, pack, viaggi, support). Default: hello."),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) => {
      const to = splitRecipients(args.to);
      if (to.length === 0) throw new McpToolError("bad_request", "Nessun destinatario valido in 'to'.");
      const cc = splitRecipients(args.cc ?? "");
      const bcc = splitRecipients(args.bcc ?? "");

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — mail a ${to.join(", ")} con oggetto "${args.subject}"${cc.length ? `, CC: ${cc.join(", ")}` : ""}. Ripeti con confirm: true per inviare davvero.`,
          data: { to, cc, bcc, subject: args.subject },
        } satisfies ToolOutcome;
      }

      const result = await sendMailboxMessage(context.service, mailboxConfig, resendApiKey(context), {
        fromOptionId: args.from_option_id,
        to,
        cc,
        bcc,
        subject: args.subject,
        text: args.body,
        sentByUserId: context.auth.userId,
        sentByName: context.auth.tokenName,
      });

      if (!result.ok) {
        throw new McpToolError("send_failed", sendFailureMessage(result));
      }

      return {
        text: `Mail inviata a ${to.join(", ")}.`,
        targetId: result.messageId,
        data: { to, cc, bcc, subject: args.subject, thread_key: result.threadKey },
      } satisfies ToolOutcome;
    },
  });
}
