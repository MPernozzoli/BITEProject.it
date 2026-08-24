/**
 * Tool sulle storie (serie di articoli) del logbook.
 *
 * Una story è un contenitore narrativo: raggruppa articoli correlati in una
 * serie. Gli articoli collegano alla story tramite logbook_articles.story_id.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolError, type McpContext } from "../context.js";
import { clientRequestIdShape, confirmShape, registerTool, type ToolOutcome } from "../registry.js";

const STORY_COLUMNS = "id,slug,slug_it,slug_en,title_it,title_en,description_it,description_en,cover_image,created_at,updated_at";

interface StoryRow {
  id: string;
  slug: string;
  slug_it: string | null;
  slug_en: string | null;
  title_it: string;
  title_en: string;
  description_it: string | null;
  description_en: string | null;
  cover_image: string | null;
  created_at: string;
  updated_at: string;
}

function generateStorySlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function uniqueStorySlug(ctx: McpContext, base: string): Promise<string> {
  const start = base || `storia-${Date.now()}`;
  let candidate = start;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data, error } = await ctx.service
      .from("stories")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw new McpToolError("db_error", `Verifica slug fallita: ${error.message}`);
    if (!data) return candidate;
    candidate = `${start}-${attempt + 1}`;
  }
  throw new McpToolError("slug_conflict", `Impossibile trovare uno slug libero a partire da "${start}".`);
}

async function loadStory(ctx: McpContext, id: string): Promise<StoryRow> {
  const { data, error } = await ctx.service.from("stories").select(STORY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura story fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Story ${id} inesistente.`);
  return data as unknown as StoryRow;
}

export function registerStoryTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "story_search",
    title: "Cerca storie",
    description:
      "Elenca le storie del logbook con filtri per testo nei titoli. Restituisce l'elenco delle storie con slug, titoli e data.",
    scope: "stories:read",
    kind: "read",
    inputSchema: {
      query: z.string().max(200).optional().describe("Testo cercato nei titoli IT ed EN."),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async (args, context) => {
      let query = context.service
        .from("stories")
        .select(STORY_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(args.limit ?? 25);

      if (args.query) {
        const safe = args.query.replace(/[,%]/g, " ").trim();
        if (safe) query = query.or(`title_it.ilike.%${safe}%,title_en.ilike.%${safe}%`);
      }

      const { data, error } = await query;
      if (error) throw new McpToolError("db_error", `Ricerca fallita: ${error.message}`);
      const rows = (data ?? []) as StoryRow[];

      return {
        text: `${rows.length} storie trovate.`,
        data: rows.map((row) => ({
          id: row.id,
          title_it: row.title_it,
          title_en: row.title_en,
          slug_it: row.slug_it,
          slug_en: row.slug_en,
          cover_image: row.cover_image,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_get",
    title: "Leggi una storia",
    description:
      "Restituisce una storia completa con descrizione in entrambe le lingue e l'elenco degli articoli collegati (tramite story_id).",
    scope: "stories:read",
    kind: "read",
    inputSchema: {
      story_id: z.string().uuid().optional(),
      slug: z.string().max(120).optional().describe("Alternativa a story_id: cerca su slug, slug_it e slug_en."),
    },
    handler: async (args, context) => {
      let id = args.story_id ?? null;
      if (!id) {
        if (!args.slug) throw new McpToolError("bad_request", "Serve story_id oppure slug.");
        const safe = args.slug.replace(/,/g, "");
        const { data, error } = await context.service
          .from("stories")
          .select("id")
          .or(`slug.eq.${safe},slug_it.eq.${safe},slug_en.eq.${safe}`)
          .maybeSingle();
        if (error) throw new McpToolError("db_error", `Ricerca per slug fallita: ${error.message}`);
        if (!data) throw new McpToolError("not_found", `Nessuna story con slug "${args.slug}".`);
        id = (data as { id: string }).id;
      }

      const story = await loadStory(context, id);

      const { data: articles, error: articlesError } = await context.service
        .from("logbook_articles")
        .select("id,slug_it,slug_en,title_it,title_en,status,editorial_type,category,cover_image,scheduled_at,published_at,created_at,story_sort_order")
        .eq("story_id", id)
        .order("story_sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (articlesError) throw new McpToolError("db_error", `Lettura articoli fallita: ${articlesError.message}`);

      return {
        text: `"${story.title_it || story.title_en}" — ${(articles ?? []).length} articoli collegati.`,
        targetId: story.id,
        data: {
          ...story,
          articles: articles ?? [],
        },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_create",
    title: "Crea una storia",
    description:
      "Crea una nuova storia (serie di articoli). Titolo obbligatorio in italiano e inglese: il sito è bilingue.",
    scope: "stories:write",
    kind: "write",
    inputSchema: {
      title_it: z.string().min(3).max(300),
      title_en: z.string().min(3).max(300),
      description_it: z.string().max(2000).optional(),
      description_en: z.string().max(2000).optional(),
      cover_image: z.string().url().optional(),
      slug_it: z.string().max(160).optional(),
      slug_en: z.string().max(160).optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      const slug = await uniqueStorySlug(context, generateStorySlug(args.title_en || args.title_it));

      const { data, error } = await context.service
        .from("stories")
        .insert({
          slug,
          slug_it: args.slug_it?.trim() || generateStorySlug(args.title_it) || null,
          slug_en: args.slug_en?.trim() || generateStorySlug(args.title_en) || null,
          title_it: args.title_it.trim(),
          title_en: args.title_en.trim(),
          description_it: args.description_it?.trim() || null,
          description_en: args.description_en?.trim() || null,
          cover_image: args.cover_image ?? null,
        })
        .select("id,slug")
        .maybeSingle();
      if (error) {
        const unique = /slug_it|slug_en/.test(error.message) ? " (slug_it/slug_en già in uso da un'altra story)" : "";
        throw new McpToolError("db_error", `Creazione story fallita: ${error.message}${unique}`);
      }

      const created = data as { id: string; slug: string } | null;
      return {
        text: `Story creata: "${args.title_it}" (slug ${created?.slug}).`,
        targetId: created?.id ?? null,
        data: { story_id: created?.id, slug: created?.slug },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_update",
    title: "Aggiorna una storia",
    description:
      "Modifica i campi indicati di una story esistente (patch parziale: i campi non passati restano invariati). Copre titoli, descrizioni, cover e slug bilingui.",
    scope: "stories:write",
    kind: "write",
    inputSchema: {
      story_id: z.string().uuid(),
      title_it: z.string().min(3).max(300).optional(),
      title_en: z.string().min(3).max(300).optional(),
      description_it: z.string().max(2000).nullable().optional(),
      description_en: z.string().max(2000).nullable().optional(),
      cover_image: z.string().url().nullable().optional(),
      slug_it: z.string().max(160).nullable().optional(),
      slug_en: z.string().max(160).nullable().optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const story = await loadStory(context, args.story_id);

      const patch: Record<string, unknown> = {};
      if (args.title_it !== undefined) patch.title_it = args.title_it.trim();
      if (args.title_en !== undefined) patch.title_en = args.title_en.trim();
      if (args.description_it !== undefined) patch.description_it = args.description_it?.trim() || null;
      if (args.description_en !== undefined) patch.description_en = args.description_en?.trim() || null;
      if (args.cover_image !== undefined) patch.cover_image = args.cover_image;
      if (args.slug_it !== undefined) patch.slug_it = args.slug_it?.trim() || null;
      if (args.slug_en !== undefined) patch.slug_en = args.slug_en?.trim() || null;

      if (Object.keys(patch).length === 0) {
        return { text: "Nessun campo da aggiornare.", targetId: story.id, data: { story_id: story.id, changed: false } };
      }

      patch.updated_at = new Date().toISOString();
      const { error } = await context.service.from("stories").update(patch).eq("id", story.id);
      if (error) {
        const unique = /slug_it|slug_en/.test(error.message) ? " (slug_it/slug_en già in uso da un'altra story)" : "";
        throw new McpToolError("db_error", `Aggiornamento fallito: ${error.message}${unique}`);
      }

      const fields = Object.keys(patch).filter((key) => key !== "updated_at");
      return {
        text: `Story aggiornata (${fields.join(", ")}).`,
        targetId: story.id,
        data: { story_id: story.id, changed: true, fields },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_delete",
    title: "Elimina una storia",
    description:
      "Elimina una story. Gli articoli collegati non vengono eliminati: il loro story_id viene impostato a NULL. Richiede confirm: true.",
    scope: "stories:write",
    kind: "write",
    inputSchema: {
      story_id: z.string().uuid(),
      ...confirmShape,
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (args, context) => {
      const story = await loadStory(context, args.story_id);

      const { data: articles, error: countError } = await context.service
        .from("logbook_articles")
        .select("id")
        .eq("story_id", story.id);
      if (countError) throw new McpToolError("db_error", `Conteggio articoli fallito: ${countError.message}`);
      const articleCount = (articles ?? []).length;

      if (args.confirm !== true) {
        return {
          preview: true,
          text: `Anteprima — "${story.title_it || story.title_en}" verrebbe eliminata. ${articleCount} articoli collegati perderebbero il riferimento story_id (non verrebbero cancellati). Ripeti con confirm: true.`,
          targetId: story.id,
          data: { story_id: story.id, title_it: story.title_it, title_en: story.title_en, article_count: articleCount },
        } satisfies ToolOutcome;
      }

      // Scollega gli articoli prima di eliminare
      if (articleCount > 0) {
        const { error: unlinkError } = await context.service
          .from("logbook_articles")
          .update({ story_id: null })
          .eq("story_id", story.id);
        if (unlinkError) throw new McpToolError("db_error", `Scollegamento articoli fallito: ${unlinkError.message}`);
      }

      const { error: deleteError } = await context.service.from("stories").delete().eq("id", story.id);
      if (deleteError) throw new McpToolError("db_error", `Eliminazione story fallita: ${deleteError.message}`);

      return {
        text: `"${story.title_it || story.title_en}" eliminata. ${articleCount} articoli scollegati.`,
        targetId: story.id,
        data: { story_id: story.id, unlinked_articles: articleCount },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_assign_article",
    title: "Assegna un articolo a una storia",
    description:
      "Imposta story_id di un articolo, collegandolo a una story. L'articolo viene aggiunto alla serie. Se l'articolo era già collegato a un'altra story, viene spostato.",
    scope: "stories:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      story_id: z.string().uuid(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const [story, article] = await Promise.all([
        loadStory(context, args.story_id),
        (async () => {
          const { data, error } = await context.service
            .from("logbook_articles")
            .select("id,title_it,title_en,story_id")
            .eq("id", args.article_id)
            .maybeSingle();
          if (error) throw new McpToolError("db_error", `Lettura articolo fallita: ${error.message}`);
          if (!data) throw new McpToolError("not_found", `Articolo ${args.article_id} inesistente.`);
          return data as { id: string; title_it: string; title_en: string; story_id: string | null };
        })(),
      ]);

      const { error } = await context.service
        .from("logbook_articles")
        .update({ story_id: args.story_id, updated_at: new Date().toISOString() })
        .eq("id", args.article_id);
      if (error) throw new McpToolError("db_error", `Assegnamento fallito: ${error.message}`);

      const previousStory = article.story_id ? ` (era nella story ${article.story_id})` : "";
      return {
        text: `"${article.title_it || article.title_en}" assegnato alla story "${story.title_it || story.title_en}"${previousStory}.`,
        targetId: args.article_id,
        data: { article_id: args.article_id, story_id: args.story_id, previous_story_id: article.story_id },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "story_remove_article",
    title: "Rimuovi un articolo da una storia",
    description:
      "Imposta a NULL story_id di un articolo, scollegandolo dalla story. L'articolo non viene eliminato.",
    scope: "stories:write",
    kind: "write",
    inputSchema: {
      article_id: z.string().uuid(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const { data: article, error: readError } = await context.service
        .from("logbook_articles")
        .select("id,title_it,title_en,story_id")
        .eq("id", args.article_id)
        .maybeSingle();
      if (readError) throw new McpToolError("db_error", `Lettura articolo fallita: ${readError.message}`);
      if (!article) throw new McpToolError("not_found", `Articolo ${args.article_id} inesistente.`);

      const typed = article as { id: string; title_it: string; title_en: string; story_id: string | null };
      if (!typed.story_id) {
        return {
          text: `"${typed.title_it || typed.title_en}" non è collegato a nessuna story.`,
          targetId: args.article_id,
          data: { article_id: args.article_id, story_id: null, changed: false },
        } satisfies ToolOutcome;
      }

      const { error } = await context.service
        .from("logbook_articles")
        .update({ story_id: null, updated_at: new Date().toISOString() })
        .eq("id", args.article_id);
      if (error) throw new McpToolError("db_error", `Rimozione fallita: ${error.message}`);

      return {
        text: `"${typed.title_it || typed.title_en}" rimosso dalla story.`,
        targetId: args.article_id,
        data: { article_id: args.article_id, previous_story_id: typed.story_id, changed: true },
      } satisfies ToolOutcome;
    },
  });
}
