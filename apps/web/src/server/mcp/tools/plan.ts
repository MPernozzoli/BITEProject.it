/**
 * Tool del piano editoriale.
 *
 * Il calendario è la fonte della schedulazione: per il canale sito, assegnare
 * un articolo a uno slot fa scattare il trigger
 * `sync_site_article_schedule_from_editorial_slot`, che porta l'articolo a
 * `scheduled` con `scheduled_at` alla data/ora dello slot. Nessun tool scrive
 * `scheduled_at` a mano: si passa sempre dallo slot, come fa la UI admin.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  EDITORIAL_TYPE_ORDER,
  computeTypeDistribution,
  effectiveSlotType,
  normalizeTime,
  pickSuggestedType,
  type ArticleForPlan,
  type EditorialArticleType,
  type SlotForPlan,
} from "../../../lib/editorial-plan.js";
import { getArticleTranslationGaps } from "../../../lib/article-translation-gaps.js";
import { McpToolError, type McpContext } from "../context.js";
import { clientRequestIdShape, confirmShape, registerTool, type ToolOutcome } from "../registry.js";

const CHANNEL_CODES = ["site", "youtube", "tiktok", "instagram_bite", "instagram_dogs"] as const;
const EDITORIAL_TYPES = ["pillar", "support", "utility_reflection"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

interface ChannelRow {
  id: string;
  code: string;
  label: string;
  timezone: string;
  horizon_weeks: number;
  weekly_count: number;
  mix_pillar: number;
  mix_support: number;
  mix_utility: number;
}

async function loadChannels(ctx: McpContext): Promise<ChannelRow[]> {
  const { data, error } = await ctx.service
    .from("editorial_plan_channels")
    .select("id,code,label,timezone,horizon_weeks,weekly_count,mix_pillar,mix_support,mix_utility");
  if (error) throw new McpToolError("db_error", `Lettura canali fallita: ${error.message}`);
  return (data ?? []) as ChannelRow[];
}

async function resolveChannel(ctx: McpContext, code: string): Promise<ChannelRow> {
  const channels = await loadChannels(ctx);
  const channel = channels.find((row) => row.code === code);
  if (!channel) throw new McpToolError("unknown_channel", `Canale "${code}" non configurato nel piano editoriale.`);
  return channel;
}

async function loadArticlesForPlan(ctx: McpContext): Promise<ArticleForPlan[]> {
  const { data, error } = await ctx.service.from("logbook_articles").select("id,status,editorial_type");
  if (error) throw new McpToolError("db_error", `Lettura articoli fallita: ${error.message}`);
  return (data ?? []) as ArticleForPlan[];
}

const SLOT_COLUMNS =
  "id,channel_id,slot_date,slot_time,status,suggested_type,override_type,assigned_article_id,template_id,content_format,counts_toward_mix,notes";

async function loadSlots(ctx: McpContext, channelId?: string): Promise<SlotForPlan[]> {
  let query = ctx.service.from("editorial_plan_slots").select(SLOT_COLUMNS);
  if (channelId) query = query.eq("channel_id", channelId);
  const { data, error } = await query;
  if (error) throw new McpToolError("db_error", `Lettura slot fallita: ${error.message}`);
  return (data ?? []) as SlotForPlan[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Distribuzione osservata vs target, in punti percentuali. */
function mixReport(counts: Record<EditorialArticleType, number>, channel: ChannelRow) {
  const total = counts.pillar + counts.support + counts.utility_reflection;
  const target: Record<EditorialArticleType, number> = {
    pillar: Number(channel.mix_pillar),
    support: Number(channel.mix_support),
    utility_reflection: Number(channel.mix_utility),
  };
  return EDITORIAL_TYPE_ORDER.map((type) => {
    const share = total > 0 ? (counts[type] / total) * 100 : 0;
    return {
      type,
      count: counts[type],
      share_percent: Math.round(share * 10) / 10,
      target_percent: target[type],
      delta_percent: Math.round((share - target[type]) * 10) / 10,
    };
  });
}

/**
 * Assegnazione articolo → slot. Vive fuori dal tool perché la usano in due:
 * `plan_assign_article` (parte dallo slot) e `article_schedule` (parte
 * dall'articolo e lo slot lo trova o lo crea). Duplicarla significherebbe due
 * definizioni diverse di "programmato".
 */
export async function assignArticleToSlot(
  ctx: McpContext,
  params: { slotId: string; articleId: string; confirm: boolean; allowTranslationGaps: boolean },
): Promise<ToolOutcome> {
  const { data: slotRow, error: slotError } = await ctx.service
    .from("editorial_plan_slots")
    .select(SLOT_COLUMNS)
    .eq("id", params.slotId)
    .maybeSingle();
  if (slotError) throw new McpToolError("db_error", `Lettura slot fallita: ${slotError.message}`);
  if (!slotRow) throw new McpToolError("not_found", "Slot inesistente.");
  const slot = slotRow as SlotForPlan;

  if (slot.status === "assigned" && slot.assigned_article_id && slot.assigned_article_id !== params.articleId) {
    throw new McpToolError(
      "slot_busy",
      `Lo slot ha già l'articolo ${slot.assigned_article_id}. Libera lo slot con plan_free_slot prima di riassegnarlo.`,
    );
  }
  if (slot.status === "skipped") {
    throw new McpToolError("slot_skipped", "Lo slot è marcato come saltato: riportalo a open con plan_upsert_slot.");
  }

  const channels = await loadChannels(ctx);
  const channel = channels.find((row) => row.id === slot.channel_id);
  if (!channel) throw new McpToolError("unknown_channel", "Canale dello slot non configurato.");

  const { data: articleRow, error: articleError } = await ctx.service
    .from("logbook_articles")
    .select("id,title_it,title_en,excerpt_it,excerpt_en,content_it,content_en,status,editorial_type")
    .eq("id", params.articleId)
    .maybeSingle();
  if (articleError) throw new McpToolError("db_error", `Lettura articolo fallita: ${articleError.message}`);
  if (!articleRow) throw new McpToolError("not_found", "Articolo inesistente.");
  const article = articleRow as {
    id: string;
    title_it: string;
    title_en: string;
    excerpt_it: string | null;
    excerpt_en: string | null;
    content_it: unknown;
    content_en: unknown;
    status: string;
    editorial_type: EditorialArticleType | null;
  };

  if (article.status === "published") {
    throw new McpToolError("already_published", "L'articolo è già pubblicato: non ha senso riprogrammarlo.");
  }

  const gaps = getArticleTranslationGaps({
    titleIt: article.title_it ?? "",
    titleEn: article.title_en ?? "",
    excerptIt: article.excerpt_it ?? "",
    excerptEn: article.excerpt_en ?? "",
    contentIt: article.content_it,
    contentEn: article.content_en,
  });
  if (gaps.hasGaps && !params.allowTranslationGaps) {
    throw new McpToolError(
      "translation_gaps",
      `L'articolo non è completo in entrambe le lingue (${gaps.labels.join("; ")}). Usa article_translate, oppure ripeti con allow_translation_gaps: true se è voluto.`,
    );
  }

  const effectiveType = article.editorial_type ?? slot.override_type ?? slot.suggested_type ?? "support";
  const when = `${slot.slot_date} ${normalizeTime(slot.slot_time)} (${channel.timezone})`;

  if (!params.confirm) {
    return {
      preview: true,
      text:
        `Anteprima — "${article.title_it || article.title_en}" verrebbe assegnato allo slot ${when} su ${channel.label}` +
        `${channel.code === "site" ? ", passando a scheduled e venendo pubblicato dal cron a quell'ora" : ""}. ` +
        `Tipo editoriale: ${effectiveType}${article.editorial_type ? "" : " (assegnato ora)"}. ` +
        `${gaps.hasGaps ? `Attenzione: ${gaps.labels.join("; ")}. ` : ""}` +
        "Ripeti con confirm: true per eseguire.",
      targetId: slot.id,
      data: { slot_id: slot.id, article_id: article.id, when, channel: channel.code, editorial_type: effectiveType },
    };
  }

  if (!article.editorial_type) {
    const { error } = await ctx.service
      .from("logbook_articles")
      .update({ editorial_type: effectiveType })
      .eq("id", article.id);
    if (error) throw new McpToolError("db_error", `Aggiornamento tipo editoriale fallito: ${error.message}`);
  }

  const { error } = await ctx.service
    .from("editorial_plan_slots")
    .update({ assigned_article_id: article.id, status: "assigned", updated_at: new Date().toISOString() })
    .eq("id", slot.id);
  if (error) throw new McpToolError("db_error", `Assegnazione slot fallita: ${error.message}`);

  // Rilettura: lo stato e `scheduled_at` li scrive il trigger, non noi.
  const { data: after } = await ctx.service
    .from("logbook_articles")
    .select("status,scheduled_at")
    .eq("id", article.id)
    .maybeSingle();
  const scheduled = after as { status: string; scheduled_at: string | null } | null;

  return {
    text: `"${article.title_it || article.title_en}" assegnato allo slot ${when} su ${channel.label}. Stato articolo: ${scheduled?.status ?? "?"}${scheduled?.scheduled_at ? `, pubblicazione ${scheduled.scheduled_at}` : ""}.`,
    targetId: slot.id,
    data: {
      slot_id: slot.id,
      article_id: article.id,
      channel: channel.code,
      article_status: scheduled?.status ?? null,
      scheduled_at: scheduled?.scheduled_at ?? null,
    },
  };
}

/** Primo slot libero del canale a partire da una data, se esiste. */
export async function findNextOpenSlot(
  ctx: McpContext,
  channelCode: string,
  fromDate: string,
): Promise<SlotForPlan | null> {
  const channel = await resolveChannel(ctx, channelCode);
  const { data, error } = await ctx.service
    .from("editorial_plan_slots")
    .select(SLOT_COLUMNS)
    .eq("channel_id", channel.id)
    .eq("status", "open")
    .gte("slot_date", fromDate)
    .order("slot_date", { ascending: true })
    .order("slot_time", { ascending: true })
    .limit(1);
  if (error) throw new McpToolError("db_error", `Ricerca slot libero fallita: ${error.message}`);
  const rows = (data ?? []) as SlotForPlan[];
  return rows[0] ?? null;
}

export { resolveChannel, loadArticlesForPlan, loadSlots, todayIso, SLOT_COLUMNS };

export function registerPlanTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "plan_get_settings",
    title: "Impostazioni piano editoriale",
    description:
      "Canali del piano editoriale con mix target (pillar/support/utility), timezone, orizzonte di pianificazione e slot settimanali ricorrenti.",
    scope: "plan:read",
    kind: "read",
    inputSchema: {},
    handler: async (_args, context) => {
      const channels = await loadChannels(context);
      const { data: templates, error } = await context.service
        .from("editorial_plan_weekly_slots")
        .select("id,channel_id,day_of_week,time_of_day,content_format,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw new McpToolError("db_error", `Lettura template settimanali fallita: ${error.message}`);

      const data = channels.map((channel) => ({
        code: channel.code,
        label: channel.label,
        timezone: channel.timezone,
        horizon_weeks: channel.horizon_weeks,
        weekly_count: channel.weekly_count,
        mix_target: {
          pillar: Number(channel.mix_pillar),
          support: Number(channel.mix_support),
          utility_reflection: Number(channel.mix_utility),
        },
        weekly_slots: (templates ?? [])
          .filter((row) => (row as { channel_id: string }).channel_id === channel.id)
          .map((row) => {
            const template = row as { day_of_week: number; time_of_day: string; content_format: string | null };
            return {
              day_of_week: template.day_of_week,
              time: normalizeTime(template.time_of_day),
              content_format: template.content_format,
            };
          }),
      }));

      return {
        text: `${data.length} canali configurati: ${data.map((row) => row.code).join(", ")}.`,
        data,
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "plan_list_slots",
    title: "Slot del piano editoriale",
    description:
      "Elenca gli slot del calendario in un intervallo di date, con articolo assegnato, stato e tipo editoriale effettivo.",
    scope: "plan:read",
    kind: "read",
    inputSchema: {
      from: z.string().regex(DATE_RE).optional().describe("Data iniziale inclusa (YYYY-MM-DD). Default: oggi."),
      to: z.string().regex(DATE_RE).optional().describe("Data finale inclusa (YYYY-MM-DD). Default: fra 8 settimane."),
      channel: z.enum(CHANNEL_CODES).optional().describe("Limita a un canale. Default: tutti."),
      status: z.enum(["open", "assigned", "skipped"]).optional(),
    },
    handler: async (args, context) => {
      const from = args.from ?? todayIso();
      const to = args.to ?? addDaysIso(from, 56);
      const channels = await loadChannels(context);
      const channelById = new Map(channels.map((row) => [row.id, row]));
      const channel = args.channel ? channels.find((row) => row.code === args.channel) : undefined;
      if (args.channel && !channel) throw new McpToolError("unknown_channel", `Canale "${args.channel}" inesistente.`);

      let query = context.service
        .from("editorial_plan_slots")
        .select(SLOT_COLUMNS)
        .gte("slot_date", from)
        .lte("slot_date", to)
        .order("slot_date", { ascending: true })
        .order("slot_time", { ascending: true });
      if (channel) query = query.eq("channel_id", channel.id);
      if (args.status) query = query.eq("status", args.status);

      const { data, error } = await query;
      if (error) throw new McpToolError("db_error", `Lettura slot fallita: ${error.message}`);
      const slots = (data ?? []) as (SlotForPlan & { notes: string | null })[];

      const articleIds = slots.map((slot) => slot.assigned_article_id).filter((id): id is string => Boolean(id));
      const articlesById = new Map<string, { title_it: string; title_en: string; status: string; editorial_type: EditorialArticleType | null }>();
      if (articleIds.length > 0) {
        const { data: articles, error: articlesError } = await context.service
          .from("logbook_articles")
          .select("id,title_it,title_en,status,editorial_type")
          .in("id", articleIds);
        if (articlesError) throw new McpToolError("db_error", `Lettura articoli fallita: ${articlesError.message}`);
        for (const row of articles ?? []) {
          const article = row as { id: string; title_it: string; title_en: string; status: string; editorial_type: EditorialArticleType | null };
          articlesById.set(article.id, article);
        }
      }

      const payload = slots.map((slot) => {
        const article = slot.assigned_article_id ? articlesById.get(slot.assigned_article_id) : undefined;
        return {
          slot_id: slot.id,
          channel: channelById.get(slot.channel_id)?.code ?? slot.channel_id,
          date: slot.slot_date,
          time: normalizeTime(slot.slot_time),
          status: slot.status,
          editorial_type: effectiveSlotType(slot, article ? { id: slot.assigned_article_id!, status: article.status as ArticleForPlan["status"], editorial_type: article.editorial_type } : null),
          content_format: slot.content_format,
          counts_toward_mix: slot.counts_toward_mix,
          notes: slot.notes,
          article: article
            ? {
                id: slot.assigned_article_id,
                title_it: article.title_it,
                title_en: article.title_en,
                status: article.status,
              }
            : null,
        };
      });

      const open = payload.filter((row) => row.status === "open").length;
      return {
        text: `${payload.length} slot fra ${from} e ${to} (${open} liberi).`,
        data: payload,
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "plan_find_gaps",
    title: "Buchi di calendario e scostamento dal mix",
    description:
      "Slot ancora liberi nell'orizzonte di pianificazione, più il confronto fra distribuzione reale dei tipi editoriali e mix target del canale. È il punto di partenza per pianificare un mese.",
    scope: "plan:read",
    kind: "read",
    inputSchema: {
      channel: z.enum(CHANNEL_CODES).default("site").describe("Canale da analizzare."),
      weeks: z.number().int().min(1).max(26).optional().describe("Settimane da oggi. Default: orizzonte del canale."),
    },
    handler: async (args, context) => {
      const channel = await resolveChannel(context, args.channel ?? "site");
      const weeks = args.weeks ?? channel.horizon_weeks;
      const from = todayIso();
      const to = addDaysIso(from, weeks * 7 - 1);

      const slots = (await loadSlots(context, channel.id)).filter(
        (slot) => slot.slot_date >= from && slot.slot_date <= to,
      );
      const articles = await loadArticlesForPlan(context);
      const counts = computeTypeDistribution(articles, await loadSlots(context, channel.id));

      const openSlots = slots
        .filter((slot) => slot.status === "open")
        .sort((a, b) => `${a.slot_date}T${normalizeTime(a.slot_time)}`.localeCompare(`${b.slot_date}T${normalizeTime(b.slot_time)}`))
        .map((slot) => ({
          slot_id: slot.id,
          date: slot.slot_date,
          time: normalizeTime(slot.slot_time),
          content_format: slot.content_format,
          suggested_type: slot.override_type ?? slot.suggested_type ?? pickSuggestedType(counts, {
            mix_pillar: Number(channel.mix_pillar),
            mix_support: Number(channel.mix_support),
            mix_utility: Number(channel.mix_utility),
          }),
        }));

      const draftsWithoutSlot = articles.filter((article) => article.status === "draft").length;

      return {
        text: `${channel.label}: ${openSlots.length} slot liberi entro ${to}, ${draftsWithoutSlot} bozze in archivio. Mix osservato vs target nei dati allegati.`,
        data: {
          channel: channel.code,
          timezone: channel.timezone,
          window: { from, to, weeks },
          open_slots: openSlots,
          mix: mixReport(counts, channel),
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "plan_upsert_slot",
    title: "Crea o aggiorna uno slot",
    description:
      "Crea uno slot di calendario alla data/ora indicata, o aggiorna quello esistente (formato contenuto, tipo forzato, note, stato open/skipped). Non assegna articoli: per quello serve plan_assign_article.",
    scope: "plan:write",
    kind: "write",
    inputSchema: {
      channel: z.enum(CHANNEL_CODES).describe("Canale dello slot."),
      date: z.string().regex(DATE_RE).describe("Data dello slot (YYYY-MM-DD)."),
      time: z.string().regex(TIME_RE).describe("Ora locale del canale (HH:MM)."),
      override_type: z.enum(EDITORIAL_TYPES).nullable().optional().describe("Forza il tipo editoriale dello slot."),
      content_format: z.string().max(40).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      status: z.enum(["open", "skipped"]).optional().describe("Usa skipped per togliere lo slot dalla pianificazione."),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const channel = await resolveChannel(context, args.channel);
      const time = normalizeTime(args.time);

      const { data: existing, error: existingError } = await context.service
        .from("editorial_plan_slots")
        .select(SLOT_COLUMNS)
        .eq("channel_id", channel.id)
        .eq("slot_date", args.date)
        .eq("slot_time", time)
        .maybeSingle();
      if (existingError) throw new McpToolError("db_error", `Lettura slot fallita: ${existingError.message}`);

      const patch: Record<string, unknown> = {};
      if (args.override_type !== undefined) patch.override_type = args.override_type;
      if (args.content_format !== undefined) patch.content_format = args.content_format;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.status !== undefined) patch.status = args.status;

      if (existing) {
        const slot = existing as SlotForPlan;
        if (args.status === "skipped" && slot.status === "assigned") {
          throw new McpToolError(
            "slot_assigned",
            "Lo slot ha un articolo assegnato: liberalo con plan_free_slot prima di saltarlo.",
          );
        }
        if (Object.keys(patch).length === 0) {
          return { text: `Slot già esistente il ${args.date} alle ${time} su ${channel.label}, nessun campo da aggiornare.`, targetId: slot.id, data: { slot_id: slot.id, created: false } };
        }
        const { error } = await context.service.from("editorial_plan_slots").update(patch).eq("id", slot.id);
        if (error) throw new McpToolError("db_error", `Aggiornamento slot fallito: ${error.message}`);
        return {
          text: `Slot aggiornato: ${args.date} ${time} su ${channel.label}.`,
          targetId: slot.id,
          data: { slot_id: slot.id, created: false, ...patch },
        } satisfies ToolOutcome;
      }

      const articles = await loadArticlesForPlan(context);
      const counts = computeTypeDistribution(articles, await loadSlots(context, channel.id));
      const suggested =
        args.override_type ??
        pickSuggestedType(counts, {
          mix_pillar: Number(channel.mix_pillar),
          mix_support: Number(channel.mix_support),
          mix_utility: Number(channel.mix_utility),
        });

      const { data: inserted, error } = await context.service
        .from("editorial_plan_slots")
        .insert({
          channel_id: channel.id,
          slot_date: args.date,
          slot_time: time,
          status: args.status ?? "open",
          suggested_type: suggested,
          override_type: args.override_type ?? null,
          content_format: args.content_format ?? null,
          notes: args.notes ?? null,
        })
        .select("id")
        .maybeSingle();
      if (error) throw new McpToolError("db_error", `Creazione slot fallita: ${error.message}`);

      const slotId = (inserted as { id: string } | null)?.id ?? null;
      return {
        text: `Slot creato: ${args.date} ${time} su ${channel.label}, tipo suggerito ${suggested}.`,
        targetId: slotId,
        data: { slot_id: slotId, created: true, suggested_type: suggested },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "plan_assign_article",
    title: "Assegna un articolo a uno slot (lo programma)",
    description:
      "Assegna una bozza a uno slot del calendario. Per il canale sito questo **programma la pubblicazione**: il trigger porta l'articolo a scheduled con scheduled_at alla data/ora dello slot, e il cron publish-scheduled-articles lo pubblicherà. Richiede confirm: true; senza, restituisce solo l'anteprima.",
    scope: "plan:write",
    kind: "write",
    inputSchema: {
      slot_id: z.string().uuid(),
      article_id: z.string().uuid(),
      allow_translation_gaps: z
        .boolean()
        .optional()
        .describe("Consente di programmare un articolo incompleto in IT o EN. Default false: il sito è bilingue."),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) =>
      assignArticleToSlot(context, {
        slotId: args.slot_id,
        articleId: args.article_id,
        confirm: args.confirm === true,
        allowTranslationGaps: args.allow_translation_gaps === true,
      }),
  });

  registerTool(server, ctx, {
    name: "plan_free_slot",
    title: "Libera uno slot",
    description:
      "Toglie l'articolo assegnato da uno slot e lo riporta a open. Per il canale sito questo deprogramma l'articolo se non è ancora stato pubblicato. Richiede confirm: true.",
    scope: "plan:write",
    kind: "write",
    inputSchema: {
      slot_id: z.string().uuid(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (args, context) => {
      const { data: slotRow, error } = await context.service
        .from("editorial_plan_slots")
        .select(SLOT_COLUMNS)
        .eq("id", args.slot_id)
        .maybeSingle();
      if (error) throw new McpToolError("db_error", `Lettura slot fallita: ${error.message}`);
      if (!slotRow) throw new McpToolError("not_found", "Slot inesistente.");
      const slot = slotRow as SlotForPlan;

      const channels = await loadChannels(context);
      const channel = channels.find((row) => row.id === slot.channel_id);
      const when = `${slot.slot_date} ${normalizeTime(slot.slot_time)}`;

      if (slot.status !== "assigned") {
        return { text: `Lo slot ${when} è già libero (stato ${slot.status}).`, targetId: slot.id, data: { slot_id: slot.id, changed: false } };
      }

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — lo slot ${when} su ${channel?.label ?? "?"} verrebbe liberato dall'articolo ${slot.assigned_article_id}${channel?.code === "site" ? ", deprogrammando l'articolo se non ancora pubblicato" : ""}. Ripeti con confirm: true.`,
          targetId: slot.id,
          data: { slot_id: slot.id, article_id: slot.assigned_article_id },
        } satisfies ToolOutcome;
      }

      // Sui canali social lo slot porta con sé i target di pubblicazione: la UI
      // admin li elimina insieme allo slot, qui si fa lo stesso.
      if (channel && channel.code !== "site") {
        const { error: targetsError } = await context.service
          .from("editorial_publish_targets")
          .delete()
          .eq("editorial_plan_slot_id", slot.id);
        if (targetsError) throw new McpToolError("db_error", `Rimozione target social fallita: ${targetsError.message}`);
      }

      const { error: updateError } = await context.service
        .from("editorial_plan_slots")
        .update({ assigned_article_id: null, status: "open" })
        .eq("id", slot.id);
      if (updateError) throw new McpToolError("db_error", `Liberazione slot fallita: ${updateError.message}`);

      return {
        text: `Slot ${when} liberato.`,
        targetId: slot.id,
        data: { slot_id: slot.id, changed: true, previous_article_id: slot.assigned_article_id },
      } satisfies ToolOutcome;
    },
  });
}
