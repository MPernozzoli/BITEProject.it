/**
 * Tool sugli articoli del logbook.
 *
 * Due vincoli danno forma a tutto il modulo:
 *
 * 1. **Bilinguismo.** Il sito è IT/EN su ogni superficie che raggiunge utenti
 *    reali (`AGENTS.md`): creare una bozza richiede il titolo in entrambe le
 *    lingue, e programmarla richiede corpo ed estratto in entrambe — o un
 *    `allow_translation_gaps` esplicito.
 * 2. **Nessuna pubblicazione immediata.** Non esiste un tool "pubblica ora":
 *    si programma uno slot e pubblica il cron `publish-scheduled-articles`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getArticleTranslationGaps } from "../../../lib/article-translation-gaps.js";
import { McpToolError, type McpContext } from "../context.js";
import { countWords, markdownToTiptap, tiptapToMarkdown } from "../markdown.js";
import { clientRequestIdShape, confirmShape, registerTool, type ToolOutcome } from "../registry.js";
import { assignArticleToSlot, findNextOpenSlot, todayIso } from "./plan.js";

const EDITORIAL_TYPES = ["pillar", "support", "utility_reflection"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const DEFAULT_CATEGORY = "Notes from the Boat";

/** Stessa regola dell'editor admin (`ArticleEditor.tsx`), replicata qui perché il server non importa codice React. */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function uniqueSlug(ctx: McpContext, base: string): Promise<string> {
  const start = base || `articolo-${Date.now()}`;
  let candidate = start;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data, error } = await ctx.service
      .from("logbook_articles")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw new McpToolError("db_error", `Verifica slug fallita: ${error.message}`);
    if (!data) return candidate;
    candidate = `${start}-${attempt + 1}`;
  }
  throw new McpToolError("slug_conflict", `Impossibile trovare uno slug libero a partire da "${start}".`);
}

const ARTICLE_COLUMNS =
  "id,slug,slug_it,slug_en,title_it,title_en,excerpt_it,excerpt_en,status,editorial_type,category,cover_image,scheduled_at,published_at,created_at,updated_at,voyage_id,story_id";

interface ArticleRow {
  id: string;
  slug: string;
  slug_it: string | null;
  slug_en: string | null;
  title_it: string;
  title_en: string;
  excerpt_it: string | null;
  excerpt_en: string | null;
  status: string;
  editorial_type: string | null;
  category: string;
  cover_image: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  voyage_id: string | null;
  story_id: string | null;
}

async function loadArticle(ctx: McpContext, id: string, withBody: boolean): Promise<ArticleRow & { content_it?: unknown; content_en?: unknown }> {
  const columns = withBody ? `${ARTICLE_COLUMNS},content_it,content_en` : ARTICLE_COLUMNS;
  const { data, error } = await ctx.service.from("logbook_articles").select(columns).eq("id", id).maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura articolo fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Articolo ${id} inesistente.`);
  return data as unknown as ArticleRow & { content_it?: unknown; content_en?: unknown };
}

export function registerArticleTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "article_search",
    title: "Cerca articoli",
    description:
      "Elenca gli articoli del logbook con filtri per stato, categoria, tipo editoriale e testo nel titolo. Non restituisce il corpo: per quello serve article_get.",
    scope: "articles:read",
    kind: "read",
    inputSchema: {
      status: z.enum(["draft", "scheduled", "published"]).optional(),
      editorial_type: z.enum(EDITORIAL_TYPES).optional(),
      category: z.string().max(120).optional(),
      query: z.string().max(200).optional().describe("Testo cercato nei titoli IT ed EN."),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async (args, context) => {
      let query = context.service
        .from("logbook_articles")
        .select(ARTICLE_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(args.limit ?? 25);

      if (args.status) query = query.eq("status", args.status);
      if (args.editorial_type) query = query.eq("editorial_type", args.editorial_type);
      if (args.category) query = query.eq("category", args.category);
      if (args.query) {
        const safe = args.query.replace(/[,%]/g, " ").trim();
        if (safe) query = query.or(`title_it.ilike.%${safe}%,title_en.ilike.%${safe}%`);
      }

      const { data, error } = await query;
      if (error) throw new McpToolError("db_error", `Ricerca fallita: ${error.message}`);
      const rows = (data ?? []) as ArticleRow[];

      return {
        text: `${rows.length} articoli trovati.`,
        data: rows.map((row) => ({
          id: row.id,
          title_it: row.title_it,
          title_en: row.title_en,
          status: row.status,
          editorial_type: row.editorial_type,
          category: row.category,
          slug: row.slug,
          scheduled_at: row.scheduled_at,
          published_at: row.published_at,
          updated_at: row.updated_at,
        })),
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_get",
    title: "Leggi un articolo",
    description:
      "Restituisce un articolo completo, con il corpo convertito in Markdown per entrambe le lingue e le eventuali lacune di traduzione.",
    scope: "articles:read",
    kind: "read",
    inputSchema: {
      article_id: z.string().uuid().optional(),
      slug: z.string().max(120).optional().describe("Alternativa a article_id: cerca su slug, slug_it e slug_en."),
      include_body: z.boolean().default(true),
    },
    handler: async (args, context) => {
      let id = args.article_id ?? null;
      if (!id) {
        if (!args.slug) throw new McpToolError("bad_request", "Serve article_id oppure slug.");
        const safe = args.slug.replace(/,/g, "");
        const { data, error } = await context.service
          .from("logbook_articles")
          .select("id")
          .or(`slug.eq.${safe},slug_it.eq.${safe},slug_en.eq.${safe}`)
          .maybeSingle();
        if (error) throw new McpToolError("db_error", `Ricerca per slug fallita: ${error.message}`);
        if (!data) throw new McpToolError("not_found", `Nessun articolo con slug "${args.slug}".`);
        id = (data as { id: string }).id;
      }

      const includeBody = args.include_body !== false;
      const article = await loadArticle(context, id, includeBody);

      const gaps = getArticleTranslationGaps({
        titleIt: article.title_it ?? "",
        titleEn: article.title_en ?? "",
        excerptIt: article.excerpt_it ?? "",
        excerptEn: article.excerpt_en ?? "",
        contentIt: article.content_it ?? null,
        contentEn: article.content_en ?? null,
      });

      return {
        text: `"${article.title_it || article.title_en}" — stato ${article.status}${article.scheduled_at ? `, programmato ${article.scheduled_at}` : ""}${gaps.hasGaps ? `. Lacune: ${gaps.labels.join("; ")}` : ""}.`,
        targetId: article.id,
        data: {
          ...article,
          content_it: undefined,
          content_en: undefined,
          body_markdown_it: includeBody ? tiptapToMarkdown(article.content_it) : undefined,
          body_markdown_en: includeBody ? tiptapToMarkdown(article.content_en) : undefined,
          word_count_it: includeBody ? countWords(article.content_it) : undefined,
          word_count_en: includeBody ? countWords(article.content_en) : undefined,
          translation_gaps: gaps.labels,
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_create_draft",
    title: "Crea una bozza",
    description:
      "Crea un nuovo articolo in stato draft. Titolo obbligatorio in italiano e inglese: il sito è bilingue e una bozza monolingue non è programmabile. Il corpo si passa in Markdown e viene convertito nel formato dell'editor.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      title_it: z.string().min(3).max(300),
      title_en: z.string().min(3).max(300),
      excerpt_it: z.string().max(1000).optional(),
      excerpt_en: z.string().max(1000).optional(),
      body_markdown_it: z.string().max(120_000).optional(),
      body_markdown_en: z.string().max(120_000).optional(),
      category: z.string().max(120).optional().describe(`Default: "${DEFAULT_CATEGORY}".`),
      editorial_type: z.enum(EDITORIAL_TYPES).optional(),
      cover_image: z.string().url().optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      const slug = await uniqueSlug(context, generateSlug(args.title_en || args.title_it));

      const { data, error } = await context.service
        .from("logbook_articles")
        .insert({
          slug,
          title_it: args.title_it.trim(),
          title_en: args.title_en.trim(),
          excerpt_it: args.excerpt_it?.trim() || null,
          excerpt_en: args.excerpt_en?.trim() || null,
          content_it: markdownToTiptap(args.body_markdown_it ?? ""),
          content_en: markdownToTiptap(args.body_markdown_en ?? ""),
          category: args.category?.trim() || DEFAULT_CATEGORY,
          status: "draft",
          editorial_type: args.editorial_type ?? null,
          cover_image: args.cover_image ?? null,
        })
        .select("id,slug")
        .maybeSingle();
      if (error) throw new McpToolError("db_error", `Creazione bozza fallita: ${error.message}`);

      const created = data as { id: string; slug: string } | null;
      return {
        text: `Bozza creata: "${args.title_it}" (slug ${created?.slug}). Modificabile in admin su /admin/article/${created?.id}.`,
        targetId: created?.id ?? null,
        data: { article_id: created?.id, slug: created?.slug, status: "draft" },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_update",
    title: "Aggiorna un articolo",
    description:
      "Modifica i campi indicati di un articolo esistente (patch parziale: i campi non passati restano invariati). Il corpo passato in Markdown sostituisce quello della lingua corrispondente.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      title_it: z.string().min(3).max(300).optional(),
      title_en: z.string().min(3).max(300).optional(),
      excerpt_it: z.string().max(1000).nullable().optional(),
      excerpt_en: z.string().max(1000).nullable().optional(),
      body_markdown_it: z.string().max(120_000).optional(),
      body_markdown_en: z.string().max(120_000).optional(),
      category: z.string().max(120).optional(),
      editorial_type: z.enum(EDITORIAL_TYPES).nullable().optional(),
      cover_image: z.string().url().nullable().optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const article = await loadArticle(context, args.article_id, false);

      const patch: Record<string, unknown> = {};
      if (args.title_it !== undefined) patch.title_it = args.title_it.trim();
      if (args.title_en !== undefined) patch.title_en = args.title_en.trim();
      if (args.excerpt_it !== undefined) patch.excerpt_it = args.excerpt_it?.trim() || null;
      if (args.excerpt_en !== undefined) patch.excerpt_en = args.excerpt_en?.trim() || null;
      if (args.body_markdown_it !== undefined) patch.content_it = markdownToTiptap(args.body_markdown_it);
      if (args.body_markdown_en !== undefined) patch.content_en = markdownToTiptap(args.body_markdown_en);
      if (args.category !== undefined) patch.category = args.category.trim();
      if (args.editorial_type !== undefined) patch.editorial_type = args.editorial_type;
      if (args.cover_image !== undefined) patch.cover_image = args.cover_image;

      if (Object.keys(patch).length === 0) {
        return { text: "Nessun campo da aggiornare.", targetId: article.id, data: { article_id: article.id, changed: false } };
      }

      patch.updated_at = new Date().toISOString();
      const { error } = await context.service.from("logbook_articles").update(patch).eq("id", article.id);
      if (error) throw new McpToolError("db_error", `Aggiornamento fallito: ${error.message}`);

      const note =
        article.status === "published"
          ? " L'articolo è già pubblicato: la modifica è online da subito e fa ripartire l'ottimizzazione SEO."
          : "";
      return {
        text: `Articolo aggiornato (${Object.keys(patch).filter((key) => key !== "updated_at").join(", ")}).${note}`,
        targetId: article.id,
        data: { article_id: article.id, changed: true, fields: Object.keys(patch).filter((key) => key !== "updated_at") },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_translate",
    title: "Colma le lacune di traduzione IT↔EN",
    description:
      "Invoca la traduzione automatica (edge function translate-editor-content) per riempire i campi presenti in una lingua e mancanti nell'altra, e salva il risultato. Non ritraduce ciò che è già presente in entrambe.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const article = await loadArticle(context, args.article_id, true);

      const response = await fetch(`${context.supabaseUrl}/functions/v1/translate-editor-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.serviceKey}` },
        body: JSON.stringify({
          kind: "article",
          title_it: article.title_it ?? "",
          title_en: article.title_en ?? "",
          excerpt_it: article.excerpt_it ?? "",
          excerpt_en: article.excerpt_en ?? "",
          content_it: article.content_it ?? null,
          content_en: article.content_en ?? null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; fields?: Record<string, unknown>; skipped?: string; error?: string }
        | null;

      if (!response.ok || payload?.error) {
        throw new McpToolError("translation_failed", `Traduzione fallita: ${payload?.error ?? response.status}`);
      }
      if (payload?.skipped === "nothing_to_translate") {
        return { text: "Niente da tradurre: i campi sono già presenti in entrambe le lingue.", targetId: article.id, data: { article_id: article.id, changed: false } };
      }

      const fields = payload?.fields ?? {};
      const allowed = ["title_it", "title_en", "excerpt_it", "excerpt_en", "content_it", "content_en"];
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (allowed.includes(key)) patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        return { text: "La traduzione non ha restituito campi utilizzabili.", targetId: article.id, data: { article_id: article.id, changed: false } };
      }

      patch.updated_at = new Date().toISOString();
      const { error } = await context.service.from("logbook_articles").update(patch).eq("id", article.id);
      if (error) throw new McpToolError("db_error", `Salvataggio traduzione fallito: ${error.message}`);

      const updated = Object.keys(patch).filter((key) => key !== "updated_at");
      return {
        text: `Tradotti e salvati: ${updated.join(", ")}.`,
        targetId: article.id,
        data: { article_id: article.id, changed: true, fields: updated },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_seo_optimize",
    title: "Rigenera i metadati SEO",
    description:
      "Invoca optimize-article-seo per rigenerare meta title/description bilingue, keyword e raccomandazioni. Restituisce il record SEO salvato.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      force: z.boolean().optional().describe("Rigenera anche se il contenuto non è cambiato dall'ultimo tentativo."),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const response = await fetch(`${context.supabaseUrl}/functions/v1/optimize-article-seo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.serviceKey}` },
        body: JSON.stringify({ articleId: args.article_id, force: args.force === true }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new McpToolError("seo_failed", `Ottimizzazione SEO fallita: ${String(payload?.error ?? response.status)}`);
      }

      const { data } = await context.service
        .from("article_seo_optimizations")
        .select("status,updated_at,meta_title_it,meta_title_en,meta_description_it,meta_description_en")
        .eq("article_id", args.article_id)
        .maybeSingle();

      return {
        text: `SEO rigenerata per ${args.article_id} (stato ${String((data as { status?: string } | null)?.status ?? payload?.status ?? "?")}).`,
        targetId: args.article_id,
        data: { article_id: args.article_id, seo: data ?? payload },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_schedule",
    title: "Programma un articolo sul sito",
    description:
      "Programma un articolo assegnandolo a uno slot del canale sito: quello indicato per data/ora, oppure il primo slot libero da una data in poi. La pubblicazione effettiva resta al cron publish-scheduled-articles. Richiede confirm: true.",
    scope: "plan:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      date: z.string().regex(DATE_RE).optional().describe("Data desiderata. Senza time, cerca il primo slot libero da qui."),
      time: z.string().regex(TIME_RE).optional().describe("Ora dello slot: richiede anche date e che lo slot esista."),
      allow_translation_gaps: z.boolean().optional(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) => {
      const fromDate = args.date ?? todayIso();
      let slotId: string | null = null;

      if (args.time) {
        if (!args.date) throw new McpToolError("bad_request", "Con time serve anche date.");
        const { data, error } = await context.service
          .from("editorial_plan_slots")
          .select("id,status")
          .eq("slot_date", args.date)
          .eq("slot_time", args.time.length === 5 ? `${args.time}:00` : args.time)
          .maybeSingle();
        if (error) throw new McpToolError("db_error", `Ricerca slot fallita: ${error.message}`);
        if (!data) {
          throw new McpToolError(
            "slot_missing",
            `Nessuno slot il ${args.date} alle ${args.time}. Crealo con plan_upsert_slot, oppure ometti time per usare il primo libero.`,
          );
        }
        slotId = (data as { id: string }).id;
      } else {
        const slot = await findNextOpenSlot(context, "site", fromDate);
        if (!slot) {
          throw new McpToolError(
            "no_open_slot",
            `Nessuno slot libero sul sito da ${fromDate} in poi. Creane uno con plan_upsert_slot.`,
          );
        }
        slotId = slot.id;
      }

      return assignArticleToSlot(context, {
        slotId,
        articleId: args.article_id,
        confirm: args.confirm === true,
        allowTranslationGaps: args.allow_translation_gaps === true,
      });
    },
  });

  registerTool(server, ctx, {
    name: "article_unschedule",
    title: "Riporta un articolo a bozza",
    description:
      "Libera lo slot assegnato all'articolo e lo riporta in bozza. Funziona solo su articoli non ancora pubblicati. Richiede confirm: true.",
    scope: "plan:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (args, context) => {
      const article = await loadArticle(context, args.article_id, false);
      if (article.status === "published") {
        throw new McpToolError(
          "already_published",
          "L'articolo è già pubblicato: depubblicarlo è una decisione da prendere nell'admin, non da qui.",
        );
      }

      const { data: slots, error } = await context.service
        .from("editorial_plan_slots")
        .select("id,slot_date,slot_time")
        .eq("assigned_article_id", article.id);
      if (error) throw new McpToolError("db_error", `Ricerca slot fallita: ${error.message}`);
      const assigned = (slots ?? []) as { id: string; slot_date: string; slot_time: string }[];

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — "${article.title_it || article.title_en}" verrebbe riportato a bozza${assigned.length > 0 ? `, liberando ${assigned.length} slot (${assigned.map((slot) => `${slot.slot_date} ${slot.slot_time}`).join(", ")})` : ""}. Ripeti con confirm: true.`,
          targetId: article.id,
          data: { article_id: article.id, slots: assigned },
        } satisfies ToolOutcome;
      }

      for (const slot of assigned) {
        const { error: freeError } = await context.service
          .from("editorial_plan_slots")
          .update({ assigned_article_id: null, status: "open" })
          .eq("id", slot.id);
        if (freeError) throw new McpToolError("db_error", `Liberazione slot fallita: ${freeError.message}`);
      }

      // Se l'articolo era programmato senza slot (o il trigger non lo ha
      // riportato indietro), lo si riallinea qui.
      const { data: after } = await context.service
        .from("logbook_articles")
        .select("status")
        .eq("id", article.id)
        .maybeSingle();
      if ((after as { status: string } | null)?.status === "scheduled") {
        const { error: resetError } = await context.service
          .from("logbook_articles")
          .update({ status: "draft", scheduled_at: null })
          .eq("id", article.id);
        if (resetError) throw new McpToolError("db_error", `Ripristino bozza fallito: ${resetError.message}`);
      }

      return {
        text: `"${article.title_it || article.title_en}" riportato a bozza${assigned.length > 0 ? `, ${assigned.length} slot liberati` : ""}.`,
        targetId: article.id,
        data: { article_id: article.id, freed_slots: assigned.map((slot) => slot.id) },
      } satisfies ToolOutcome;
    },
  });
}
