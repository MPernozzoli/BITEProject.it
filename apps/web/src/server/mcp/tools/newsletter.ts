/**
 * Tool newsletter.
 *
 * Vincolo di `AGENTS.md`: la semantica della newsletter vive in
 * `@pynkstudio/newsletterapp` e non va riscritta qui. Quindi questi tool non
 * decidono nulla — quali lingue sono obbligatorie, cosa conta come corpo, quale
 * stato assume un messaggio, come si aggregano le consegne lo dice il package,
 * esattamente come fa la console admin. Qui restano solo lo schema dei
 * parametri e le frasi in italiano.
 *
 * Un tool "invia ora a tutta la lista" **non esiste** ed è deliberato:
 * schedulare arma il cron `newsletter-dispatch`, che è già il percorso normale,
 * ed è annullabile finché non parte.
 */
import { z } from "zod";
import { marked } from "marked";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  aggregateDeliveryMetrics,
  buildMessagePayload,
  collectMissingFields,
  createEmptyFormState,
  getMessageReadiness,
  metricsForMessage,
  parseBodyModes,
  parseJsonTranslations,
  parseStringTranslations,
  type ComposerLanguages,
  type MissingField,
  type NewsletterFormState,
} from "@pynkstudio/newsletterapp/admin";
import { newsletterConfig } from "../../../lib/newsletter-config.js";
import { McpToolError, type McpContext } from "../context.js";
import { uploadImageFromUrl } from "../media.js";
import { clientRequestIdShape, confirmShape, registerTool, type ToolOutcome } from "../registry.js";

/** Stesse lingue della console admin: tutte quelle supportate, IT ed EN obbligatorie. */
const composerLanguages: ComposerLanguages = {
  all: newsletterConfig.supportedLanguages,
  required: newsletterConfig.siteLanguages,
};

const LANGUAGE_CODES = newsletterConfig.supportedLanguages;

const translationRecord = z
  .record(z.string().min(1), z.string().max(60_000))
  .describe(`Mappa lingua → valore. Lingue disponibili: ${LANGUAGE_CODES.join(", ")}. Obbligatorie: ${composerLanguages.required.join(", ")}.`);

function describeMissing(missing: MissingField[]): string {
  return missing
    .map((item) => {
      if (item.field === "name") return "nome della campagna";
      if (item.field === "subject") return `oggetto in ${item.language}`;
      return `corpo in ${item.language}`;
    })
    .join(", ");
}

const MESSAGE_COLUMNS =
  "id,name,kind,status,automation_trigger,automation_delay_minutes,scheduled_at,sent_at,last_queued_at,from_name,subject_translations,preheader_translations,body_html_translations,body_json_translations,body_mode_translations,created_by,created_at,updated_at";

interface MessageRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  last_queued_at: string | null;
  from_name: string | null;
  subject_translations: unknown;
  preheader_translations: unknown;
  body_html_translations: unknown;
  body_json_translations: unknown;
  body_mode_translations: unknown;
  automation_trigger: string | null;
  automation_delay_minutes: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

async function loadMessage(ctx: McpContext, id: string): Promise<MessageRow> {
  const { data, error } = await ctx.service.from("newsletter_messages").select(MESSAGE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura messaggio fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Messaggio ${id} inesistente.`);
  return data as unknown as MessageRow;
}

/**
 * Ricostruisce lo stato del composer da una riga esistente, così le patch
 * passano dallo stesso `buildMessagePayload` che usa la console.
 */
function formStateFromRow(row: MessageRow): NewsletterFormState {
  const base = createEmptyFormState(composerLanguages, { fromName: row.from_name ?? "BITE" });
  const bodyHtml = parseStringTranslations(row.body_html_translations, composerLanguages);
  const bodyJson = parseJsonTranslations(row.body_json_translations, composerLanguages);
  return {
    ...base,
    id: row.id,
    name: row.name,
    kind: row.kind as NewsletterFormState["kind"],
    fromName: row.from_name ?? "BITE",
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString().slice(0, 16) : "",
    automationTrigger: (row.automation_trigger ?? base.automationTrigger) as NewsletterFormState["automationTrigger"],
    automationDelayMinutes: row.automation_delay_minutes ?? 0,
    automationActive: row.status === "active",
    subjectTranslations: parseStringTranslations(row.subject_translations, composerLanguages),
    preheaderTranslations: parseStringTranslations(row.preheader_translations, composerLanguages),
    bodyHtmlTranslations: bodyHtml,
    // Il corpo rich text va conservato: sovrascriverlo con una mappa vuota
    // cancellerebbe il documento dell'editor su ogni patch fatta da qui.
    bodyJsonTranslations: bodyJson,
    bodyModeTranslations: parseBodyModes(row.body_mode_translations, bodyJson, bodyHtml, composerLanguages),
  };
}

/** Le lingue scritte da qui sono HTML, non documenti dell'editor rich text. */
function markHtmlModes(form: NewsletterFormState, languages: string[]): void {
  for (const language of languages) {
    form.bodyModeTranslations = { ...form.bodyModeTranslations, [language]: "html" };
    // Un corpo HTML e un documento rich text sulla stessa lingua sono due
    // sorgenti in conflitto: vince quello appena scritto.
    if (form.bodyJsonTranslations[language]) {
      form.bodyJsonTranslations = { ...form.bodyJsonTranslations, [language]: null };
    }
  }
}

/**
 * Il corpo scritto da un agente arriva in Markdown e viene salvato come HTML,
 * cioè nella stessa modalità "html" che la console già gestisce per i corpi
 * scritti fuori dall'editor rich text.
 */
function bodiesToHtml(bodies: Record<string, string> | undefined, alreadyHtml: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [language, value] of Object.entries(bodies ?? {})) {
    if (!value?.trim()) continue;
    out[language] = alreadyHtml ? value : (marked.parse(value, { async: false }) as string);
  }
  return out;
}

function assertLanguages(map: Record<string, string> | undefined, label: string): void {
  for (const language of Object.keys(map ?? {})) {
    if (!LANGUAGE_CODES.includes(language)) {
      throw new McpToolError("unknown_language", `Lingua "${language}" non supportata in ${label}: usa ${LANGUAGE_CODES.join(", ")}.`);
    }
  }
}

export function registerNewsletterTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "newsletter_list_messages",
    title: "Campagne e automazioni",
    description: "Elenca i messaggi newsletter con stato, schedulazione, lingue compilate e metriche di consegna.",
    scope: "newsletter:read",
    kind: "read",
    inputSchema: {
      kind: z.enum(["campaign", "automation"]).optional(),
      status: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async (args, context) => {
      let query = context.service
        .from("newsletter_messages")
        .select(MESSAGE_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(args.limit ?? 25);
      if (args.kind) query = query.eq("kind", args.kind);
      if (args.status) query = query.eq("status", args.status);

      const { data, error } = await query;
      if (error) throw new McpToolError("db_error", `Lettura messaggi fallita: ${error.message}`);
      const rows = (data ?? []) as unknown as MessageRow[];

      const { data: deliveries } = await context.service
        .from("newsletter_deliveries")
        .select("newsletter_message_id,status,open_count,click_count");
      const deliveryRows = (deliveries ?? []) as { newsletter_message_id: string; status: string; open_count: number | null; click_count: number | null }[];

      return {
        text: `${rows.length} messaggi.`,
        data: rows.map((row) => {
          const readiness = getMessageReadiness(row, composerLanguages);
          return {
            id: row.id,
            name: row.name,
            kind: row.kind,
            status: row.status,
            scheduled_at: row.scheduled_at,
            sent_at: row.sent_at,
            ready_to_send: readiness.ready,
            missing: readiness.ready ? [] : describeMissing(readiness.missing).split(", "),
            metrics: metricsForMessage(deliveryRows, row.id),
          };
        }),
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_get_message",
    title: "Leggi una campagna",
    description: "Restituisce oggetto, preheader e corpo per ogni lingua compilata, più lo stato di completezza.",
    scope: "newsletter:read",
    kind: "read",
    inputSchema: { message_id: z.string().uuid() },
    handler: async (args, context) => {
      const row = await loadMessage(context, args.message_id);
      const readiness = getMessageReadiness(row, composerLanguages);
      const subjects = parseStringTranslations(row.subject_translations, composerLanguages);
      const preheaders = parseStringTranslations(row.preheader_translations, composerLanguages);
      const bodies = parseStringTranslations(row.body_html_translations, composerLanguages);

      return {
        text: `"${row.name}" — ${row.kind}, stato ${row.status}${row.scheduled_at ? `, schedulata ${row.scheduled_at}` : ""}. ${readiness.ready ? "Pronta all'invio." : `Mancano: ${describeMissing(readiness.missing)}.`}`,
        targetId: row.id,
        data: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          status: row.status,
          scheduled_at: row.scheduled_at,
          from_name: row.from_name,
          subject: subjects,
          preheader: preheaders,
          body_html: bodies,
          ready_to_send: readiness.ready,
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_stats",
    title: "Metriche newsletter",
    description: "Iscritti attivi, disiscritti e aggregato consegne/aperture/click su tutte le campagne o su una sola.",
    scope: "newsletter:read",
    kind: "read",
    inputSchema: { message_id: z.string().uuid().optional() },
    handler: async (args, context) => {
      let deliveryQuery = context.service
        .from("newsletter_deliveries")
        .select("newsletter_message_id,status,open_count,click_count");
      if (args.message_id) deliveryQuery = deliveryQuery.eq("newsletter_message_id", args.message_id);
      const { data: deliveries, error } = await deliveryQuery;
      if (error) throw new McpToolError("db_error", `Lettura consegne fallita: ${error.message}`);

      const metrics = aggregateDeliveryMetrics(
        (deliveries ?? []) as { status: string; open_count: number | null; click_count: number | null }[],
      );

      const { count: subscribers } = await context.service
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .is("unsubscribed_at", null);
      const { count: unsubscribed } = await context.service
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .not("unsubscribed_at", "is", null);

      return {
        text: `${subscribers ?? 0} iscritti attivi, ${unsubscribed ?? 0} disiscritti. Consegne: ${metrics.sent} inviate, ${metrics.opened} aperture, ${metrics.clicked} click, ${metrics.failed} errori.`,
        data: { subscribers_active: subscribers ?? 0, subscribers_unsubscribed: unsubscribed ?? 0, deliveries: metrics },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_create_draft",
    title: "Crea una bozza di campagna",
    description:
      "Crea una campagna in bozza. Oggetto e corpo vanno forniti almeno nelle lingue obbligatorie; il corpo si passa in Markdown — grassetto, corsivo, titoli, liste, citazioni, link e immagini (![alt](url), carica prima l'immagine con newsletter_upload_image) diventano HTML vero — o in HTML già pronto con body_is_html: true. Non schedula nulla.",
    scope: "newsletter:write",
    kind: "write",
    inputSchema: {
      name: z.string().min(3).max(200).describe("Nome interno della campagna, non visibile agli iscritti."),
      subject: translationRecord,
      preheader: translationRecord.optional(),
      body: translationRecord.describe("Corpo per lingua, in Markdown salvo body_is_html."),
      body_is_html: z.boolean().optional(),
      from_name: z.string().max(80).optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      assertLanguages(args.subject, "subject");
      assertLanguages(args.body, "body");
      assertLanguages(args.preheader, "preheader");

      const form: NewsletterFormState = {
        ...createEmptyFormState(composerLanguages, { fromName: args.from_name ?? "BITE" }),
        name: args.name.trim(),
        kind: "campaign",
        subjectTranslations: { ...args.subject },
        preheaderTranslations: { ...(args.preheader ?? {}) },
        bodyHtmlTranslations: bodiesToHtml(args.body, args.body_is_html === true),
      };
      markHtmlModes(form, Object.keys(form.bodyHtmlTranslations));

      const missing = collectMissingFields(form, composerLanguages);
      if (missing.length > 0) {
        throw new McpToolError("incomplete", `Campagna incompleta: mancano ${describeMissing(missing)}.`);
      }

      const payload = buildMessagePayload(form, { createdBy: context.auth.userId, fallbackFromName: "BITE" });
      const { data, error } = await context.service.from("newsletter_messages").insert(payload).select("id").maybeSingle();
      if (error) throw new McpToolError("db_error", `Creazione campagna fallita: ${error.message}`);

      const id = (data as { id: string } | null)?.id ?? null;
      return {
        text: `Campagna "${args.name}" creata in bozza. Programmala con newsletter_schedule quando è pronta.`,
        targetId: id,
        data: { message_id: id, status: "draft", languages: Object.keys(form.bodyHtmlTranslations) },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_update_draft",
    title: "Aggiorna una campagna",
    description:
      "Modifica nome, oggetto, preheader o corpo di una campagna non ancora inviata. Le lingue passate sostituiscono quelle esistenti, le altre restano.",
    scope: "newsletter:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      name: z.string().min(3).max(200).optional(),
      subject: translationRecord.optional(),
      preheader: translationRecord.optional(),
      body: translationRecord.optional(),
      body_is_html: z.boolean().optional(),
      from_name: z.string().max(80).optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const row = await loadMessage(context, args.message_id);
      if (row.sent_at) throw new McpToolError("already_sent", "La campagna è già stata inviata: non è più modificabile.");

      assertLanguages(args.subject, "subject");
      assertLanguages(args.body, "body");
      assertLanguages(args.preheader, "preheader");

      const form = formStateFromRow(row);
      if (args.name) form.name = args.name.trim();
      if (args.from_name) form.fromName = args.from_name;
      if (args.subject) form.subjectTranslations = { ...form.subjectTranslations, ...args.subject };
      if (args.preheader) form.preheaderTranslations = { ...form.preheaderTranslations, ...args.preheader };
      if (args.body) {
        const converted = bodiesToHtml(args.body, args.body_is_html === true);
        form.bodyHtmlTranslations = { ...form.bodyHtmlTranslations, ...converted };
        markHtmlModes(form, Object.keys(converted));
      }

      // `created_by` va riportato invariato: `buildMessagePayload` lo scrive
      // sempre, e passarlo vuoto azzererebbe l'autore originale.
      const payload = buildMessagePayload(form, { createdBy: row.created_by, fallbackFromName: "BITE" });
      const { error } = await context.service.from("newsletter_messages").update(payload).eq("id", row.id);
      if (error) throw new McpToolError("db_error", `Aggiornamento fallito: ${error.message}`);

      const readiness = getMessageReadiness(
        { subject_translations: form.subjectTranslations, body_html_translations: form.bodyHtmlTranslations, body_json_translations: {} },
        composerLanguages,
      );
      return {
        text: `Campagna "${form.name}" aggiornata. ${readiness.ready ? "Pronta all'invio." : `Mancano ancora: ${describeMissing(readiness.missing)}.`}`,
        targetId: row.id,
        data: { message_id: row.id, ready_to_send: readiness.ready },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_schedule",
    title: "Programma l'invio di una campagna",
    description:
      "Imposta la data di invio: da lì in poi è il cron newsletter-dispatch a spedire, entro cinque minuti dall'orario indicato. Richiede confirm: true e una campagna completa nelle lingue obbligatorie.",
    scope: "newsletter:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      scheduled_at: z.string().datetime({ offset: true }).describe("Istante di invio in ISO 8601 con fuso, es. 2026-09-01T09:00:00+02:00."),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (args, context) => {
      const row = await loadMessage(context, args.message_id);
      if (row.sent_at) throw new McpToolError("already_sent", "La campagna è già stata inviata.");
      if (row.kind !== "campaign") throw new McpToolError("not_a_campaign", "Solo le campagne si schedulano; le automazioni si attivano dalla console.");

      const readiness = getMessageReadiness(row, composerLanguages);
      if (!readiness.ready) {
        throw new McpToolError("incomplete", `Campagna incompleta: mancano ${describeMissing(readiness.missing)}.`);
      }

      const when = new Date(args.scheduled_at);
      if (Number.isNaN(when.getTime())) throw new McpToolError("bad_request", "Data di invio non valida.");
      if (when.getTime() < Date.now() - 60_000) {
        throw new McpToolError("past_date", "La data di invio è nel passato: indica un istante futuro.");
      }

      const { count: recipients } = await context.service
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .is("unsubscribed_at", null);

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — "${row.name}" verrebbe schedulata per ${when.toISOString()} e spedita dal cron a circa ${recipients ?? 0} iscritti attivi. Ripeti con confirm: true.`,
          targetId: row.id,
          data: { message_id: row.id, scheduled_at: when.toISOString(), estimated_recipients: recipients ?? 0 },
        } satisfies ToolOutcome;
      }

      const { error } = await context.service
        .from("newsletter_messages")
        .update({ status: "scheduled", scheduled_at: when.toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw new McpToolError("db_error", `Schedulazione fallita: ${error.message}`);

      return {
        text: `"${row.name}" schedulata per ${when.toISOString()}: partirà con il primo giro utile del cron. Annullabile con newsletter_cancel_schedule finché non parte.`,
        targetId: row.id,
        data: { message_id: row.id, scheduled_at: when.toISOString(), estimated_recipients: recipients ?? 0 },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_cancel_schedule",
    title: "Annulla la schedulazione",
    description: "Riporta una campagna schedulata in bozza, se non è ancora stata accodata dal dispatcher.",
    scope: "newsletter:write",
    kind: "write",
    inputSchema: {
      message_id: z.string().uuid(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (args, context) => {
      const row = await loadMessage(context, args.message_id);
      if (row.sent_at || row.last_queued_at) {
        throw new McpToolError(
          "already_queued",
          "La campagna è già stata accodata o inviata: non si annulla da qui. Le consegne si gestiscono dalla console admin.",
        );
      }
      if (row.status !== "scheduled") {
        return { text: `"${row.name}" non è schedulata (stato ${row.status}), niente da annullare.`, targetId: row.id, data: { message_id: row.id, changed: false } };
      }

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — "${row.name}", schedulata ${row.scheduled_at}, tornerebbe in bozza. Ripeti con confirm: true.`,
          targetId: row.id,
          data: { message_id: row.id, scheduled_at: row.scheduled_at },
        } satisfies ToolOutcome;
      }

      const { error } = await context.service
        .from("newsletter_messages")
        .update({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw new McpToolError("db_error", `Annullamento fallito: ${error.message}`);

      return {
        text: `"${row.name}" riportata in bozza.`,
        targetId: row.id,
        data: { message_id: row.id, changed: true },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "newsletter_upload_image",
    title: "Carica una foto per una newsletter",
    description:
      "Scarica un'immagine da un URL https e la ripubblica nello storage BITE (stesso bucket usato dal composer). Restituisce l'URL pubblico da inserire nel corpo con la sintassi Markdown ![alt](url): il body delle campagne è già convertito in HTML, quindi diventa un'immagine vera nell'email.",
    scope: "newsletter:write",
    kind: "write",
    inputSchema: {
      source_url: z.string().url().describe("URL https dell'immagine sorgente."),
      folder: z.string().max(60).optional().describe('Cartella nel bucket. Default "newsletter".'),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      const uploaded = await uploadImageFromUrl(context, { sourceUrl: args.source_url, folder: args.folder ?? "newsletter" });
      return {
        text: `Immagine caricata (${Math.round(uploaded.bytes / 1024)} KB): ${uploaded.url}`,
        data: uploaded,
      } satisfies ToolOutcome;
    },
  });
}
