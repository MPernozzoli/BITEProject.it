/**
 * Generazione di link tracciati.
 *
 * Un agente che sta per promuovere un articolo — in un gruppo Facebook, in una
 * newsletter, in un commento su un forum — ha bisogno dell'indirizzo *e* di
 * dire da dove arriverà chi lo clicca. Comporre `?utm_source=...` a mano
 * significa, prima o poi, scrivere `Facebook` invece di `facebook` e spaccare
 * in due la stessa riga nei report: qui il vocabolario è quello di
 * `lib/utm.ts`, lo stesso del sito e del pannello admin.
 *
 * Sola lettura: nessun effetto esterno, produce una stringa.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolError, requireScope, type McpContext } from "../context.js";
import { articleLinks, storyLinks } from "../links.js";
import { registerTool, type ToolOutcome } from "../registry.js";
import {
  TRACKING_CHANNELS,
  buildTrackedUrl,
  campaignFromUrl,
  normalizeTracking,
  normalizeTrackingToken,
  stripTrackingFromUrl,
  type TrackingParams,
} from "../../../lib/utm.js";

const CHANNEL_IDS = TRACKING_CHANNELS.map((c) => c.id) as [string, ...string[]];

const CHANNEL_HELP = TRACKING_CHANNELS.map((c) => `${c.id} (${c.source}/${c.medium})`).join(", ");

interface SlugRecord {
  id: string;
  title_it: string | null;
  title_en: string | null;
  slug: string | null;
  slug_it: string | null;
  slug_en: string | null;
}

async function loadArticle(ctx: McpContext, id: string): Promise<SlugRecord> {
  const { data, error } = await ctx.service
    .from("logbook_articles")
    .select("id,title_it,title_en,slug,slug_it,slug_en")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura articolo fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Articolo ${id} inesistente.`);
  return data as unknown as SlugRecord;
}

async function loadStory(ctx: McpContext, id: string): Promise<SlugRecord> {
  const { data, error } = await ctx.service
    .from("stories")
    .select("id,title_it,title_en,slug,slug_it,slug_en")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura storia fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Storia ${id} inesistente.`);
  return data as unknown as SlugRecord;
}

/**
 * I tracker di un gruppo Facebook: sorgente e canale sono fissi, la campagna è
 * il nome del gruppo normalizzato — è ciò che rende confrontabile un gruppo
 * con l'altro invece di avere un unico calderone "facebook".
 */
export function trackingForGroup(groupName: string): TrackingParams {
  return { source: "facebook", medium: "group", campaign: normalizeTrackingToken(groupName) };
}

/**
 * Risolve i tracker da preset + campi espliciti. I campi espliciti vincono
 * sempre sul preset: il preset è un punto di partenza, non una gabbia.
 */
export function resolveTracking(args: {
  channel?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}): TrackingParams {
  const preset = args.channel ? TRACKING_CHANNELS.find((c) => c.id === args.channel) : undefined;
  return normalizeTracking({
    source: args.source || preset?.source,
    medium: args.medium || preset?.medium,
    campaign: args.campaign,
    content: args.content,
    term: args.term,
  });
}

export function registerLinkTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "link_build",
    title: "Genera un link tracciato",
    description:
      "Costruisce l'indirizzo pubblico di un articolo, di una storia o di una pagina qualsiasi del sito con i parametri di tracciamento (utm_*) del canale su cui verrà pubblicato. Serve per sapere, poi, quanto traffico ha portato davvero quel post: senza tracker quelle visite finiscono indistinguibili nel mucchio. " +
      `Canali predefiniti: ${CHANNEL_HELP}. Con fb_group_id i tracker del gruppo Facebook sono compilati da soli (facebook/group/<nome gruppo>).`,
    scope: "articles:read",
    kind: "read",
    inputSchema: {
      article_id: z.string().uuid().optional().describe("Articolo da linkare: restituisce sia url_it sia url_en."),
      story_id: z.string().uuid().optional().describe("Storia da linkare, in alternativa all'articolo."),
      url: z
        .string()
        .url()
        .optional()
        .describe("URL già pronto da taggare, per le pagine che non sono articoli o storie (home, contatti, viaggi)."),
      fb_group_id: z
        .string()
        .uuid()
        .optional()
        .describe("Gruppo Facebook di destinazione: compila source, medium e campaign con i valori del gruppo. Richiede lo scope promo:read."),
      channel: z.enum(CHANNEL_IDS).optional().describe("Preset di canale: compila source e medium."),
      source: z.string().max(60).optional().describe("Chi manda il traffico. Sovrascrive il preset."),
      medium: z.string().max(60).optional().describe("Attraverso quale canale. Sovrascrive il preset."),
      campaign: z
        .string()
        .max(60)
        .optional()
        .describe("Quale iniziativa. Default: lo slug del contenuto linkato (o il nome del gruppo con fb_group_id)."),
      content: z.string().max(60).optional().describe("Quale variante del link, quando lo stesso link esiste in più punti."),
      term: z.string().max(60).optional().describe("Keyword, solo per campagne a pagamento."),
    },
    annotations: { readOnlyHint: true },
    handler: async (args, context) => {
      const targets = [args.article_id, args.story_id, args.url].filter(Boolean);
      if (targets.length === 0) {
        throw new McpToolError("invalid_input", "Serve almeno uno fra article_id, story_id e url.");
      }
      if (targets.length > 1) {
        throw new McpToolError("invalid_input", "Passa un solo bersaglio: article_id, story_id oppure url.");
      }

      let tracking = resolveTracking(args);
      let groupName: string | null = null;

      if (args.fb_group_id) {
        requireScope(context, "promo:read");
        const { data, error } = await context.service
          .from("fb_promo_groups")
          .select("id,name")
          .eq("id", args.fb_group_id)
          .maybeSingle();
        if (error) throw new McpToolError("db_error", `Lettura gruppo fallita: ${error.message}`);
        if (!data) throw new McpToolError("not_found", `Gruppo ${args.fb_group_id} inesistente.`);
        groupName = (data as { name: string }).name;
        const fromGroup = trackingForGroup(groupName);
        tracking = {
          source: tracking.source || fromGroup.source,
          medium: tracking.medium || fromGroup.medium,
          campaign: tracking.campaign || fromGroup.campaign,
          content: tracking.content,
          term: tracking.term,
        };
      }

      if (!tracking.source) {
        throw new McpToolError(
          "invalid_input",
          "Manca la sorgente: passa channel, oppure source, oppure fb_group_id. Un link senza utm_source non è tracciato.",
        );
      }

      if (args.url) {
        const clean = stripTrackingFromUrl(args.url);
        const trackingWithCampaign = { ...tracking, campaign: tracking.campaign || campaignFromUrl(clean) };
        const tracked = buildTrackedUrl(clean, trackingWithCampaign);
        return {
          text: `Link tracciato (${trackingWithCampaign.source}/${trackingWithCampaign.medium ?? "-"}): ${tracked}`,
          data: { url: tracked, canonical_url: clean, tracking: trackingWithCampaign },
        } satisfies ToolOutcome;
      }

      const record = args.article_id
        ? await loadArticle(context, args.article_id)
        : await loadStory(context, args.story_id!);

      const canonical = args.article_id
        ? articleLinks(context.siteUrl, record)
        : storyLinks(context.siteUrl, record);

      const campaign =
        tracking.campaign ||
        normalizeTrackingToken(record.slug_it || record.slug || record.slug_en || "") ||
        campaignFromUrl(canonical.url_it || canonical.url_en || "");

      const finalTracking = { ...tracking, campaign };
      const tracked = args.article_id
        ? articleLinks(context.siteUrl, record, finalTracking)
        : storyLinks(context.siteUrl, record, finalTracking);

      const title = record.title_it || record.title_en || "senza titolo";
      return {
        text:
          `Link tracciati per "${title}" (${finalTracking.source}/${finalTracking.medium ?? "-"}` +
          `${finalTracking.campaign ? `/${finalTracking.campaign}` : ""}${groupName ? `, gruppo "${groupName}"` : ""}):\n` +
          `IT: ${tracked.url_it ?? "—"}\nEN: ${tracked.url_en ?? "—"}`,
        targetId: record.id,
        data: {
          url_it: tracked.url_it,
          url_en: tracked.url_en,
          canonical_url_it: canonical.url_it,
          canonical_url_en: canonical.url_en,
          tracking: finalTracking,
          group: groupName ? { id: args.fb_group_id, name: groupName } : null,
        },
      } satisfies ToolOutcome;
    },
  });
}
