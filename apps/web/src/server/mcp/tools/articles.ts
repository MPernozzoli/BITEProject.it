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
import { articleLinks, type BilingualSlugs } from "../links.js";
import { countWords, markdownToTiptap, tiptapToMarkdown, youtubeEmbedUrl, type JSONContent } from "../markdown.js";
import {
  bucketPathFromUrl,
  createImageUploadSlot,
  INLINE_MAX_BYTES,
  uploadImageFromInput,
  verifyUploadedImage,
  type UploadedImage,
} from "../media.js";
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

/**
 * Slug degli articoli indicati, in una sola query.
 *
 * Serve ai tool delle metriche: la RPC che li alimenta restituisce titoli e
 * numeri ma non gli slug, e senza quelli non si può costruire il link pubblico
 * che rende la metrica azionabile (condividere, rilanciare, ripubblicare).
 */
async function loadSlugsByArticleId(ctx: McpContext, ids: (string | null)[]): Promise<Map<string, BilingualSlugs>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data, error } = await ctx.service.from("logbook_articles").select("id,slug,slug_it,slug_en").in("id", unique);
  if (error) throw new McpToolError("db_error", `Lettura slug fallita: ${error.message}`);
  return new Map(
    ((data ?? []) as (BilingualSlugs & { id: string })[]).map((row) => [row.id, row] as const),
  );
}

export type AuthorInput = { profile_id: string; role?: string };

/**
 * `authorsShape` è un letterale non `as const`, e la propagazione del tipo
 * attraverso `z.objectOutputType<Shape, …>` in `registry.ts` finisce per
 * allargare `profile_id` a opzionale. Zod lo valida comunque a runtime — qui
 * serve solo a TypeScript, non a un controllo in più.
 */
function typedAuthors(value: unknown): AuthorInput[] | undefined {
  return value as AuthorInput[] | undefined;
}

async function loadArticle(ctx: McpContext, id: string, withBody: boolean): Promise<ArticleRow & { content_it?: unknown; content_en?: unknown }> {
  const columns = withBody ? `${ARTICLE_COLUMNS},content_it,content_en` : ARTICLE_COLUMNS;
  const { data, error } = await ctx.service.from("logbook_articles").select(columns).eq("id", id).maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura articolo fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Articolo ${id} inesistente.`);
  return data as unknown as ArticleRow & { content_it?: unknown; content_en?: unknown };
}

/**
 * Trova o crea i tag per nome (case-insensitive: `tags.name` è unico). Uno per
 * chiamata invece di un batch upsert: con le poche decine di tag di un
 * articolo il costo è trascurabile, e l'ordine dei risultati resta quello
 * dell'input, cosa che un upsert multiplo non garantisce.
 */
async function resolveTagIds(ctx: McpContext, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const { data: existing, error: findError } = await ctx.service
      .from("tags")
      .select("id")
      .ilike("name", name)
      .maybeSingle();
    if (findError) throw new McpToolError("db_error", `Ricerca tag "${name}" fallita: ${findError.message}`);
    if (existing) {
      ids.push((existing as { id: string }).id);
      continue;
    }
    const { data: created, error: createError } = await ctx.service
      .from("tags")
      .insert({ name })
      .select("id")
      .maybeSingle();
    if (createError) throw new McpToolError("db_error", `Creazione tag "${name}" fallita: ${createError.message}`);
    if (created) ids.push((created as { id: string }).id);
  }
  return ids;
}

/**
 * Sostituisce interamente tag e autori di un articolo — stessa semantica
 * "cancella e riscrivi" dell'editor admin (`ArticleEditor.tsx`), non un merge:
 * chi passa `tags` intende l'elenco finale, non un'aggiunta.
 */
async function replaceTagsAndAuthors(
  ctx: McpContext,
  articleId: string,
  tags: string[] | undefined,
  authors: { profile_id: string; role?: string }[] | undefined,
): Promise<void> {
  if (tags !== undefined) {
    const { error: deleteError } = await ctx.service.from("article_tags").delete().eq("article_id", articleId);
    if (deleteError) throw new McpToolError("db_error", `Pulizia tag fallita: ${deleteError.message}`);
    const tagIds = await resolveTagIds(ctx, tags);
    if (tagIds.length > 0) {
      const { error: insertError } = await ctx.service
        .from("article_tags")
        .insert(tagIds.map((tagId) => ({ article_id: articleId, tag_id: tagId })));
      if (insertError) throw new McpToolError("db_error", `Salvataggio tag fallito: ${insertError.message}`);
    }
  }

  if (authors !== undefined) {
    const { error: deleteError } = await ctx.service.from("article_authors").delete().eq("article_id", articleId);
    if (deleteError) throw new McpToolError("db_error", `Pulizia autori fallita: ${deleteError.message}`);
    if (authors.length > 0) {
      const { error: insertError } = await ctx.service.from("article_authors").insert(
        authors.map((author) => ({
          article_id: articleId,
          profile_id: author.profile_id,
          ...(author.role ? { role: author.role } : {}),
        })),
      );
      if (insertError) throw new McpToolError("db_error", `Salvataggio autori fallito: ${insertError.message}`);
    }
  }
}

const tagsShape = {
  tags: z
    .array(z.string().min(1).max(60))
    .max(20)
    .optional()
    .describe("Elenco finale dei tag (per nome, creati se mancanti). Sostituisce quelli esistenti, non li somma."),
};

const authorsShape = {
  authors: z
    .array(
      z.object({
        profile_id: z.string().uuid().describe("Profilo già esistente: qui non si creano profili nuovi."),
        role: z.string().max(40).optional().describe('Default "author".'),
      }),
    )
    .max(10)
    .optional()
    .describe("Elenco finale degli autori collegati. Sostituisce quelli esistenti, non li somma."),
};

/**
 * Stessa scala dell'editor (`src/lib/article-cover.ts`): il punto focale è una
 * percentuale 0-100 (50/50 = centro) e lo zoom va da 1 a 2.5. Valori fuori
 * scala verrebbero tagliati da `clampCoverFocal` in pagina, spostando il
 * ritaglio in un angolo senza che nessuno se ne accorga.
 */
const coverShape = {
  cover_focal_x: z.number().min(0).max(100).optional().describe("Punto focale orizzontale della cover in percentuale, 0-100 (50 = centro)."),
  cover_focal_y: z.number().min(0).max(100).optional().describe("Punto focale verticale della cover in percentuale, 0-100 (50 = centro)."),
  cover_zoom: z.number().min(1).max(2.5).optional().describe("Zoom della cover, da 1 (nessuno) a 2.5."),
};

const instagramShape = {
  instagram_story_image_it: z.string().url().nullable().optional().describe("Immagine verticale (9:16) per la Instagram Story IT. null = nessuna."),
  instagram_story_image_en: z.string().url().nullable().optional().describe("Immagine verticale (9:16) per la Instagram Story EN. null = nessuna."),
  instagram_story_use_cover_it: z.boolean().optional().describe("true = la Story IT usa la cover invece di un'immagine dedicata."),
  instagram_story_use_cover_en: z.boolean().optional().describe("true = la Story EN usa la cover invece di un'immagine dedicata."),
};

const INSTAGRAM_FIELDS = [
  "instagram_story_image_it",
  "instagram_story_image_en",
  "instagram_story_use_cover_it",
  "instagram_story_use_cover_en",
] as const;

const DEFAULT_COVER_FOCAL = { cover_focal_x: 50, cover_focal_y: 50, cover_zoom: 1 };

// ============================================================================
// Media: collegare un'immagine o un video a una delle superfici dell'articolo
// ============================================================================

const ATTACH_TARGETS = ["cover", "body", "instagram_story_it", "instagram_story_en"] as const;
type AttachTarget = (typeof ATTACH_TARGETS)[number];

/** Cartella di default per superficie: la stessa che usa l'editor manuale. */
const FOLDER_BY_TARGET: Record<AttachTarget, string> = {
  cover: "covers",
  body: "articles",
  instagram_story_it: "instagram-stories/it",
  instagram_story_en: "instagram-stories/en",
};

const attachShape = {
  attach_as: z
    .enum(ATTACH_TARGETS)
    .optional()
    .describe(
      'Dove collegare il media: "cover" (copertina), "body" (foto nel corpo), "instagram_story_it"/"instagram_story_en" (immagine verticale della Story). Richiede article_id.',
    ),
  body_language: z
    .enum(["it", "en", "both"])
    .optional()
    .describe('Solo per attach_as "body": in quale corpo inserirla. Default "both", con didascalia e alt nella lingua di ciascun corpo.'),
  position: z
    .enum(["end", "start"])
    .optional()
    .describe('Solo per "body": dove inserirla se after_heading non è indicato. Default "end".'),
  after_heading: z
    .string()
    .max(200)
    .optional()
    .describe('Solo per "body": inserisce subito dopo il primo titolo (#, ##, ###) che contiene questo testo, in ciascuna lingua. Per l\'EN serve after_heading_en se il titolo è tradotto.'),
  after_heading_en: z.string().max(200).optional().describe("Come after_heading, ma cercato nel corpo EN. Se assente si usa after_heading."),
  caption_it: z.string().max(500).optional().describe("Didascalia IT sotto la foto nel corpo."),
  caption_en: z.string().max(500).optional().describe("Didascalia EN sotto la foto nel corpo."),
  alt_it: z.string().max(300).optional().describe("Testo alternativo IT (accessibilità/SEO)."),
  alt_en: z.string().max(300).optional().describe("Testo alternativo EN (accessibilità/SEO)."),
  ai_generated: z.boolean().optional().describe("Mostra l'etichetta \"AI\" sulla foto nel corpo, come il flag dell'editor."),
  ...coverShape,
};

type AttachArgs = {
  attach_as?: AttachTarget;
  body_language?: "it" | "en" | "both";
  position?: "end" | "start";
  after_heading?: string;
  after_heading_en?: string;
  caption_it?: string;
  caption_en?: string;
  alt_it?: string;
  alt_en?: string;
  ai_generated?: boolean;
  cover_focal_x?: number;
  cover_focal_y?: number;
  cover_zoom?: number;
};

function plainText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(plainText).join("");
}

/**
 * Inserisce un blocco nel documento senza toccare il resto: dopo un titolo,
 * in testa o in coda. Un documento vuoto (il solo paragrafo vuoto che crea
 * `markdownToTiptap("")`) viene sostituito invece di lasciare una riga bianca
 * prima della foto.
 */
function insertBlock(doc: unknown, block: JSONContent, placement: { position: "end" | "start"; afterHeading?: string }, language: string): JSONContent {
  const source = doc && typeof doc === "object" && Array.isArray((doc as JSONContent).content) ? (doc as JSONContent) : { type: "doc", content: [] };
  const content = [...(source.content ?? [])];
  const isEmpty = content.length === 0 || (content.length === 1 && content[0].type === "paragraph" && !content[0].content?.length);
  if (isEmpty) return { ...source, type: "doc", content: [block] };

  if (placement.afterHeading) {
    const needle = placement.afterHeading.trim().toLowerCase();
    const index = content.findIndex((node) => node.type === "heading" && plainText(node).toLowerCase().includes(needle));
    if (index === -1) {
      throw new McpToolError(
        "bad_request",
        `Nessun titolo contenente "${placement.afterHeading}" nel corpo ${language.toUpperCase()}. Leggi i titoli con article_get, oppure usa position.`,
      );
    }
    content.splice(index + 1, 0, block);
  } else if (placement.position === "start") {
    content.unshift(block);
  } else {
    content.push(block);
  }
  return { ...source, content };
}

/**
 * Controlli che non richiedono il file: vanno fatti *prima* di caricarlo, così
 * un titolo sbagliato o un video come cover non lasciano nel bucket pubblico
 * un'immagine orfana che nessuno ripulirà.
 */
function assertAttachable(
  article: ArticleRow & { content_it?: unknown; content_en?: unknown },
  args: AttachArgs,
  kind: "image" | "youtube",
): void {
  if (kind === "youtube" && args.attach_as !== "body") {
    throw new McpToolError("bad_request", "Un video YouTube può stare solo nel corpo (attach_as \"body\"): cover e Story vogliono un'immagine.");
  }
  if (args.attach_as !== "body") return;
  const probe: JSONContent = { type: "paragraph" };
  for (const lang of bodyLanguages(args)) {
    insertBlock(lang === "it" ? article.content_it : article.content_en, probe, placementFor(args, lang), lang);
  }
}

function bodyLanguages(args: AttachArgs): ("it" | "en")[] {
  return args.body_language === "it" ? ["it"] : args.body_language === "en" ? ["en"] : ["it", "en"];
}

function placementFor(args: AttachArgs, lang: "it" | "en") {
  return {
    position: args.position ?? "end",
    afterHeading: lang === "en" ? args.after_heading_en ?? args.after_heading : args.after_heading,
  } as const;
}

type MediaInput = { kind: "image"; image: UploadedImage | { url: string } } | { kind: "youtube"; src: string };

/**
 * Collega un media già nello storage (o un video YouTube) alla superficie
 * indicata. Stessa semantica dell'editor: una nuova cover riporta il ritaglio
 * al centro, un'immagine Story dedicata spegne "usa la cover", una foto nel
 * corpo è un `mediaFigure` come quelle trascinate a mano.
 */
async function attachMediaToArticle(
  context: McpContext,
  article: ArticleRow & { content_it?: unknown; content_en?: unknown },
  media: MediaInput,
  args: AttachArgs,
): Promise<{ fields: string[]; warnings: string[] }> {
  const target = args.attach_as as AttachTarget;
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];

  assertAttachable(article, args, media.kind);
  const src = media.kind === "youtube" ? media.src : media.image.url;

  if (target === "cover") {
    patch.cover_image = src;
    patch.cover_focal_x = args.cover_focal_x ?? DEFAULT_COVER_FOCAL.cover_focal_x;
    patch.cover_focal_y = args.cover_focal_y ?? DEFAULT_COVER_FOCAL.cover_focal_y;
    patch.cover_zoom = args.cover_zoom ?? DEFAULT_COVER_FOCAL.cover_zoom;
  } else if (target === "instagram_story_it" || target === "instagram_story_en") {
    const lang = target.slice(-2);
    patch[`instagram_story_image_${lang}`] = src;
    patch[`instagram_story_use_cover_${lang}`] = false;
  } else {
    for (const lang of bodyLanguages(args)) {
      const caption = (lang === "it" ? args.caption_it : args.caption_en)?.trim() ?? "";
      const alt = (lang === "it" ? args.alt_it : args.alt_en)?.trim() ?? "";
      const otherCaption = (lang === "it" ? args.caption_en : args.caption_it)?.trim();
      if (!caption && otherCaption) warnings.push(`didascalia ${lang.toUpperCase()} mancante`);
      const block: JSONContent = {
        type: "mediaFigure",
        attrs: {
          kind: media.kind,
          src,
          caption,
          alt: media.kind === "image" ? alt || caption : "",
          aiGenerated: media.kind === "image" && args.ai_generated === true,
          title: "",
        },
      };
      patch[`content_${lang}`] = insertBlock(lang === "it" ? article.content_it : article.content_en, block, placementFor(args, lang), lang);
    }
  }

  patch.updated_at = new Date().toISOString();
  const { error } = await context.service.from("logbook_articles").update(patch).eq("id", article.id);
  if (error) throw new McpToolError("db_error", `Collegamento del media all'articolo fallito: ${error.message}`);
  return { fields: Object.keys(patch).filter((key) => key !== "updated_at"), warnings };
}

function attachSummary(article: ArticleRow, target: AttachTarget, result: { fields: string[]; warnings: string[] }): string {
  const where =
    target === "cover"
      ? "come copertina (ritaglio centrato: regolabile con cover_focal_x/y e cover_zoom)"
      : target === "body"
        ? `nel corpo (${result.fields.map((field) => field.replace("content_", "").toUpperCase()).join(" + ")})`
        : `come immagine della Instagram Story ${target.slice(-2).toUpperCase()}`;
  const live = article.status === "published" ? " L'articolo è già pubblicato: la modifica è online da subito." : "";
  const warn = result.warnings.length > 0 ? ` Attenzione: ${result.warnings.join("; ")}.` : "";
  return `Collegata a "${article.title_it || article.title_en}" ${where}.${warn}${live}`;
}

const tripShape = {
  voyage_id: z.string().uuid().nullable().optional().describe("Voyage a cui collegare l'articolo."),
  voyage_segment_start: z.number().int().nullable().optional(),
  voyage_segment_end: z.number().int().nullable().optional(),
  voyage_waypoint_start_id: z.string().uuid().nullable().optional(),
  voyage_waypoint_end_id: z.string().uuid().nullable().optional(),
  location_name: z.string().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
};

export function registerArticleTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "article_search",
    title: "Cerca articoli",
    description:
      "Elenca gli articoli del logbook con filtri per stato, categoria, tipo editoriale e testo nel titolo. Ogni risultato include url_it e url_en, gli indirizzi pubblici dell'articolo sul sito: sono quelli definitivi, ma rispondono solo dopo la pubblicazione. Non restituisce il corpo: per quello serve article_get.",
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
          ...articleLinks(context.siteUrl, row),
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
      "Restituisce un articolo completo, con il corpo convertito in Markdown per entrambe le lingue, gli indirizzi pubblici url_it e url_en e le eventuali lacune di traduzione.",
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

      const [{ data: tagLinks }, { data: authorLinks }, { data: settings }] = await Promise.all([
        context.service.from("article_tags").select("tags(name)").eq("article_id", id),
        context.service.from("article_authors").select("profile_id,role").eq("article_id", id),
        context.service
          .from("logbook_articles")
          .select("cover_focal_x,cover_focal_y,cover_zoom,instagram_story_image_it,instagram_story_image_en,instagram_story_use_cover_it,instagram_story_use_cover_en,voyage_id,voyage_segment_start,voyage_segment_end,voyage_waypoint_start_id,voyage_waypoint_end_id,location_name,latitude,longitude")
          .eq("id", id)
          .maybeSingle(),
      ]);

      const links = articleLinks(context.siteUrl, article);

      return {
        text: `"${article.title_it || article.title_en}" — stato ${article.status}${article.scheduled_at ? `, programmato ${article.scheduled_at}` : ""}${gaps.hasGaps ? `. Lacune: ${gaps.labels.join("; ")}` : ""}.${links.url_it ? ` Link: ${links.url_it}${links.url_en && links.url_en !== links.url_it ? ` · ${links.url_en}` : ""}${article.status === "published" ? "" : " (attivo solo dopo la pubblicazione)"}` : ""}`,
        targetId: article.id,
        data: {
          ...article,
          ...links,
          content_it: undefined,
          content_en: undefined,
          body_markdown_it: includeBody ? tiptapToMarkdown(article.content_it) : undefined,
          body_markdown_en: includeBody ? tiptapToMarkdown(article.content_en) : undefined,
          word_count_it: includeBody ? countWords(article.content_it) : undefined,
          word_count_en: includeBody ? countWords(article.content_en) : undefined,
          translation_gaps: gaps.labels,
          tags: (tagLinks ?? [])
            .map((row) => (row as unknown as { tags: { name: string } | null }).tags?.name)
            .filter(Boolean),
          authors: authorLinks ?? [],
          ...(settings ?? {}),
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_create_draft",
    title: "Crea una bozza",
    description:
      "Crea un nuovo articolo in stato draft, con tutte le impostazioni dell'editor: corpo in Markdown (grassetto, corsivo, titoli, liste, citazioni, codice, tabelle, foto — anche con didascalia via ![alt](url \"didascalia\") e flag AI via ![alt](url \"didascalia {ai}\") — e video YouTube scrivendo [video: didascalia](url YouTube) da solo in un paragrafo), cover con punto focale e zoom, immagini delle Instagram Story, tag, autori, collegamento a un voyage/waypoint. Le foto vanno prima caricate nello storage BITE con article_upload_image. Titolo obbligatorio in italiano e inglese: il sito è bilingue e una bozza monolingue non è programmabile.",
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
      cover_image: z.string().url().optional().describe("URL della copertina. Per caricarla direttamente usa article_upload_image con attach_as \"cover\"."),
      slug_it: z.string().max(160).optional(),
      slug_en: z.string().max(160).optional(),
      ...coverShape,
      ...instagramShape,
      ...tripShape,
      ...tagsShape,
      ...authorsShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      const slug = await uniqueSlug(context, generateSlug(args.title_en || args.title_it));

      const { data, error } = await context.service
        .from("logbook_articles")
        .insert({
          slug,
          slug_it: args.slug_it?.trim() || null,
          slug_en: args.slug_en?.trim() || null,
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
          ...(args.cover_focal_x !== undefined ? { cover_focal_x: args.cover_focal_x } : {}),
          ...(args.cover_focal_y !== undefined ? { cover_focal_y: args.cover_focal_y } : {}),
          ...(args.cover_zoom !== undefined ? { cover_zoom: args.cover_zoom } : {}),
          ...Object.fromEntries(INSTAGRAM_FIELDS.filter((field) => args[field] !== undefined).map((field) => [field, args[field]])),
          voyage_id: args.voyage_id ?? null,
          voyage_segment_start: args.voyage_segment_start ?? null,
          voyage_segment_end: args.voyage_segment_end ?? null,
          voyage_waypoint_start_id: args.voyage_waypoint_start_id ?? null,
          voyage_waypoint_end_id: args.voyage_waypoint_end_id ?? null,
          location_name: args.location_name ?? null,
          latitude: args.latitude ?? null,
          longitude: args.longitude ?? null,
        })
        .select("id,slug,slug_it,slug_en")
        .maybeSingle();
      if (error) {
        const unique = /slug_it|slug_en/.test(error.message) ? " (slug_it/slug_en già in uso da un altro articolo)" : "";
        throw new McpToolError("db_error", `Creazione bozza fallita: ${error.message}${unique}`);
      }

      const created = data as { id: string; slug: string; slug_it: string | null; slug_en: string | null } | null;
      if (created && (args.tags !== undefined || args.authors !== undefined)) {
        await replaceTagsAndAuthors(context, created.id, args.tags, typedAuthors(args.authors));
      }

      return {
        text: `Bozza creata: "${args.title_it}" (slug ${created?.slug}). Modificabile in admin su /admin/article/${created?.id}.`,
        targetId: created?.id ?? null,
        data: {
          article_id: created?.id,
          slug: created?.slug,
          status: "draft",
          // Indirizzi che l'articolo avrà una volta pubblicato: cambiano se in
          // seguito si cambiano gli slug.
          ...articleLinks(context.siteUrl, created),
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_upload_image",
    title: "Carica una foto per un articolo",
    description:
      `Carica un'immagine nello storage BITE (stesso bucket dell'upload manuale nell'editor) e, se indichi article_id e attach_as, la collega subito all'articolo: come copertina, come foto nel corpo IT/EN (con didascalia, alt e flag AI per lingua, in coda, in testa o dopo un titolo) o come immagine della Instagram Story. La sorgente è una fra source_url (URL https, scaricato e ripubblicato) e data_base64 (i byte dell'immagine, base64 puro o data URL, max ${Math.round(INLINE_MAX_BYTES / 1024 / 1024)}MB — per file più grandi usa article_media_upload_url). Formati: JPG, PNG, WEBP, GIF, AVIF, riconosciuti dai byte. Senza attach_as restituisce solo l'URL pubblico, da usare in cover_image o nel Markdown.`,
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      source_url: z.string().url().optional().describe("URL https dell'immagine sorgente. Alternativo a data_base64."),
      data_base64: z
        .string()
        .max(Math.ceil((INLINE_MAX_BYTES * 4) / 3) + 200)
        .optional()
        .describe("Byte dell'immagine in base64 (o data URL data:image/...;base64,...). Alternativo a source_url."),
      article_id: z.string().uuid().optional().describe("Articolo a cui collegare l'immagine. Serve insieme ad attach_as."),
      ...attachShape,
      folder: z
        .string()
        .max(60)
        .optional()
        .describe('Cartella nel bucket. Default in base ad attach_as ("covers", "articles", "instagram-stories/it|en"), altrimenti "articles".'),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      if (Boolean(args.article_id) !== Boolean(args.attach_as)) {
        throw new McpToolError("bad_request", "article_id e attach_as vanno passati insieme (o nessuno dei due, per caricare soltanto).");
      }
      // L'articolo si verifica *prima* del caricamento: un id sbagliato non
      // deve lasciare nel bucket un file orfano.
      const article = args.article_id ? await loadArticle(context, args.article_id, args.attach_as === "body") : null;
      if (article) assertAttachable(article, args as AttachArgs, "image");
      const folder = args.folder ?? (args.attach_as ? FOLDER_BY_TARGET[args.attach_as] : "articles");
      const uploaded = await uploadImageFromInput(context, { source_url: args.source_url, data_base64: args.data_base64 }, folder);

      if (!article || !args.attach_as) {
        return {
          text: `Immagine caricata (${Math.round(uploaded.bytes / 1024)} KB): ${uploaded.url}`,
          data: uploaded,
        } satisfies ToolOutcome;
      }

      const result = await attachMediaToArticle(context, article, { kind: "image", image: uploaded }, args as AttachArgs);
      return {
        text: `Immagine caricata (${Math.round(uploaded.bytes / 1024)} KB). ${attachSummary(article, args.attach_as, result)}`,
        targetId: article.id,
        data: { ...uploaded, article_id: article.id, attached_as: args.attach_as, fields: result.fields, warnings: result.warnings },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_media_upload_url",
    title: "Ottieni un URL per caricare un file grande",
    description:
      "Rilascia un URL di upload firmato (valido 2 ore) nello storage BITE, per immagini oltre il limite inline di article_upload_image o quando hai il file su disco: carica i byte con una PUT (es. curl -X PUT -H \"Content-Type: image/jpeg\" --data-binary @foto.jpg \"<upload_url>\"), poi chiama article_attach_media con uploaded_path per verificarlo e collegarlo all'articolo. Il file non è utilizzabile finché article_attach_media non lo ha verificato.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      content_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]).describe("Formato del file che caricherai."),
      attach_as: z.enum(ATTACH_TARGETS).optional().describe("Solo per scegliere la cartella di default, come in article_upload_image."),
      folder: z.string().max(60).optional().describe("Cartella nel bucket. Default in base ad attach_as, altrimenti \"articles\"."),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      const folder = args.folder ?? (args.attach_as ? FOLDER_BY_TARGET[args.attach_as] : "articles");
      const slot = await createImageUploadSlot(context, { folder, contentType: args.content_type });
      return {
        text: `URL di upload pronto per ${slot.path} (scade fra ${slot.expires_in_seconds / 3600} ore). Esegui: curl -X PUT -H "Content-Type: ${args.content_type}" --data-binary @<file> "${slot.upload_url}" — poi article_attach_media con uploaded_path "${slot.path}".`,
        data: {
          ...slot,
          method: "PUT",
          headers: { "Content-Type": args.content_type },
          curl: `curl -X PUT -H "Content-Type: ${args.content_type}" --data-binary @<file> "${slot.upload_url}"`,
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_attach_media",
    title: "Collega un media a un articolo",
    description:
      "Collega a un articolo un media già disponibile: un file caricato con article_media_upload_url (uploaded_path, viene verificato che sia davvero un'immagine), un'immagine già nello storage BITE o su un altro sito https (media_url, ripubblicata nello storage BITE se esterna), oppure un video YouTube (media_url youtube.com/youtu.be, solo nel corpo). Superfici: copertina, corpo IT/EN (con didascalia, alt e flag AI per lingua, in coda, in testa o dopo un titolo), immagine della Instagram Story IT/EN.",
    scope: "articles:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      uploaded_path: z.string().max(200).optional().describe("Percorso restituito da article_media_upload_url, dopo la PUT."),
      media_url: z.string().url().optional().describe("URL https di un'immagine o di un video YouTube. Alternativo a uploaded_path."),
      ...attachShape,
      attach_as: z.enum(ATTACH_TARGETS).describe(attachShape.attach_as.description ?? ""),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      if (Boolean(args.uploaded_path) === Boolean(args.media_url)) {
        throw new McpToolError("bad_request", "Passa esattamente uno fra uploaded_path e media_url.");
      }
      const article = await loadArticle(context, args.article_id, args.attach_as === "body");

      let media: MediaInput;
      const youtube = args.media_url ? youtubeEmbedUrl(args.media_url) : null;
      assertAttachable(article, args as AttachArgs, youtube ? "youtube" : "image");
      if (youtube) {
        media = { kind: "youtube", src: youtube };
      } else if (args.uploaded_path) {
        const path = args.uploaded_path.replace(/^\/+/, "");
        if (path.includes("..")) throw new McpToolError("bad_request", "uploaded_path non valido.");
        // Un file appena arrivato via upload firmato non è mai passato da un
        // controllo: se non è un'immagine si rimuove dal bucket pubblico.
        media = { kind: "image", image: await verifyUploadedImage(context, path, { removeIfInvalid: true }) };
      } else {
        const folder = FOLDER_BY_TARGET[args.attach_as];
        const own = bucketPathFromUrl(args.media_url!);
        media = {
          kind: "image",
          image: own
            ? await verifyUploadedImage(context, own)
            : await uploadImageFromInput(context, { source_url: args.media_url }, folder),
        };
      }

      const result = await attachMediaToArticle(context, article, media, args as AttachArgs);
      const src = media.kind === "youtube" ? media.src : media.image.url;
      return {
        text: `${media.kind === "youtube" ? "Video YouTube" : "Immagine"} ${attachSummary(article, args.attach_as, result).replace(/^Collegata/, "collegato/a")}`,
        targetId: article.id,
        data: { article_id: article.id, kind: media.kind, url: src, attached_as: args.attach_as, fields: result.fields, warnings: result.warnings },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_update",
    title: "Aggiorna un articolo",
    description:
      "Modifica i campi indicati di un articolo esistente (patch parziale: i campi non passati restano invariati). Copre tutte le impostazioni dell'editor: corpo Markdown (stessa sintassi media di article_create_draft), cover con punto focale/zoom, immagini delle Instagram Story, slug bilingui, tag, autori, collegamento voyage/waypoint. tags e authors sostituiscono l'elenco esistente, non lo sommano.",
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
      slug_it: z.string().max(160).nullable().optional(),
      slug_en: z.string().max(160).nullable().optional(),
      ...coverShape,
      ...instagramShape,
      ...tripShape,
      ...tagsShape,
      ...authorsShape,
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
      if (args.cover_focal_x !== undefined) patch.cover_focal_x = args.cover_focal_x;
      if (args.cover_focal_y !== undefined) patch.cover_focal_y = args.cover_focal_y;
      if (args.cover_zoom !== undefined) patch.cover_zoom = args.cover_zoom;
      for (const field of INSTAGRAM_FIELDS) {
        if (args[field] !== undefined) patch[field] = args[field];
      }
      if (args.slug_it !== undefined) patch.slug_it = args.slug_it?.trim() || null;
      if (args.slug_en !== undefined) patch.slug_en = args.slug_en?.trim() || null;
      if (args.voyage_id !== undefined) patch.voyage_id = args.voyage_id;
      if (args.voyage_segment_start !== undefined) patch.voyage_segment_start = args.voyage_segment_start;
      if (args.voyage_segment_end !== undefined) patch.voyage_segment_end = args.voyage_segment_end;
      if (args.voyage_waypoint_start_id !== undefined) patch.voyage_waypoint_start_id = args.voyage_waypoint_start_id;
      if (args.voyage_waypoint_end_id !== undefined) patch.voyage_waypoint_end_id = args.voyage_waypoint_end_id;
      if (args.location_name !== undefined) patch.location_name = args.location_name;
      if (args.latitude !== undefined) patch.latitude = args.latitude;
      if (args.longitude !== undefined) patch.longitude = args.longitude;

      const relationsChanged = args.tags !== undefined || args.authors !== undefined;
      if (Object.keys(patch).length === 0 && !relationsChanged) {
        return { text: "Nessun campo da aggiornare.", targetId: article.id, data: { article_id: article.id, changed: false } };
      }

      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        const { error } = await context.service.from("logbook_articles").update(patch).eq("id", article.id);
        if (error) {
          const unique = /slug_it|slug_en/.test(error.message) ? " (slug_it/slug_en già in uso da un altro articolo)" : "";
          throw new McpToolError("db_error", `Aggiornamento fallito: ${error.message}${unique}`);
        }
      }
      if (relationsChanged) {
        await replaceTagsAndAuthors(context, article.id, args.tags, typedAuthors(args.authors));
      }

      const fields = [...Object.keys(patch).filter((key) => key !== "updated_at"), ...(relationsChanged ? ["tags/authors"] : [])];
      const note =
        article.status === "published"
          ? " L'articolo è già pubblicato: la modifica è online da subito e fa ripartire l'ottimizzazione SEO."
          : "";
      return {
        text: `Articolo aggiornato (${fields.join(", ")}).${note}`,
        targetId: article.id,
        data: { article_id: article.id, changed: true, fields },
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

  registerTool(server, ctx, {
    name: "article_metrics",
    title: "Metriche aggregate degli articoli",
    description:
      "Restituisce le metriche di tutti gli articoli: visualizzazioni, tempo medio di lettura, visitatori unici, likes, commenti, distribuzione per lingua, più url_it e url_en per linkare l'articolo. Ordinati per numero di visualizzazioni decrescente.",
    scope: "analytics:read",
    kind: "read",
    inputSchema: {
      status: z.enum(["published", "draft", "scheduled"]).optional().describe("Filtra per stato. Senza filtro: tutti."),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (args, context) => {
      const { data, error } = await context.service.rpc("admin_article_view_insights");
      if (error) throw new McpToolError("db_error", `Lettura metriche fallita: ${error.message}`);

      let rows = (data ?? []) as Array<{
        article_id: string;
        title_it: string | null;
        title_en: string | null;
        story_id: string | null;
        status: string | null;
        published_at: string | null;
        view_count: number;
        tracked_views: number;
        registered_views: number;
        anonymous_views: number;
        distinct_visitors: number;
        distinct_registered: number;
        avg_dwell_ms: number | null;
        measured_dwell_count: number;
        views_it: number;
        views_en: number;
        top_lang: string | null;
        last_view_at: string | null;
        like_count: number;
        registered_likes: number;
        anonymous_likes: number;
        comment_count: number;
      }>;

      if (args.status) rows = rows.filter((r) => r.status === args.status);
      rows = rows.slice(0, args.limit ?? 50);

      const slugs = await loadSlugsByArticleId(context, rows.map((r) => r.article_id));

      return {
        text: `${rows.length} articoli con metriche.`,
        data: rows.map((r) => ({
          article_id: r.article_id,
          title_it: r.title_it,
          title_en: r.title_en,
          ...articleLinks(context.siteUrl, slugs.get(r.article_id)),
          status: r.status,
          published_at: r.published_at,
          view_count: r.view_count,
          tracked_views: r.tracked_views,
          distinct_visitors: r.distinct_visitors,
          avg_dwell_ms: r.avg_dwell_ms,
          views_it: r.views_it,
          views_en: r.views_en,
          top_lang: r.top_lang,
          like_count: r.like_count,
          comment_count: r.comment_count,
          last_view_at: r.last_view_at,
        })),
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "article_metrics_detail",
    title: "Metriche dettagliate di un articolo",
    description:
      "Restituisce le metriche complete di un singolo articolo: riepilogo con visualizzazioni, visitatori unici, tempo medio di lettura, likes, commenti, serie giornaliera degli ultimi 30 giorni e gli indirizzi pubblici url_it e url_en.",
    scope: "analytics:read",
    kind: "read",
    inputSchema: {
      article_id: z.string().uuid(),
    },
    handler: async (args, context) => {
      const { data, error } = await context.service.rpc("admin_article_view_insight_one", {
        _article_id: args.article_id,
      });
      if (error) throw new McpToolError("db_error", `Lettura metriche fallita: ${error.message}`);
      if (!data) throw new McpToolError("not_found", `Nessuna metrica per l'articolo ${args.article_id}.`);

      const detail = data as {
        article_id: string;
        title_it: string | null;
        title_en: string | null;
        story_id: string | null;
        status: string | null;
        published_at: string | null;
        view_count: number;
        summary: {
          tracked_views: number;
          registered_views: number;
          anonymous_views: number;
          distinct_visitors: number;
          distinct_registered: number;
          avg_dwell_ms: number | null;
          measured_dwell_count: number;
          views_it: number;
          views_en: number;
          views_unknown_lang: number;
          first_view_at: string | null;
          last_view_at: string | null;
          like_count: number;
          registered_likes: number;
          anonymous_likes: number;
          comment_count: number;
        };
        daily: Array<{ day: string; views: number; registered: number }>;
      };

      const slugs = await loadSlugsByArticleId(context, [detail.article_id]);

      return {
        text: `Metriche per "${detail.title_it || detail.title_en}": ${detail.view_count} visualizzazioni, ${detail.summary?.distinct_visitors ?? 0} visitatori unici, ${detail.summary?.like_count ?? 0} likes, ${detail.summary?.comment_count ?? 0} commenti.`,
        targetId: detail.article_id,
        data: { ...detail, ...articleLinks(context.siteUrl, slugs.get(detail.article_id)) },
      } satisfies ToolOutcome;
    },
  });
}
