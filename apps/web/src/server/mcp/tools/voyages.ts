/**
 * Tool sulle tappe (waypoint) dei viaggi.
 *
 * Copre il contenuto narrativo che compare su /voyages/:id — nome, descrizione,
 * punti di interesse, attività previste e foto di ciascuna tappa — non la
 * geometria del percorso (lat/lng, ordine, date di transito, soste), che
 * resta di competenza dell'editor mappa in admin (`AdminVoyageManager.tsx`):
 * spostare una tappa da qui, senza vista sulla rotta sulla mappa, sarebbe un
 * errore facile e silenzioso.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolError, type McpContext } from "../context.js";
import { uploadImageFromUrl } from "../media.js";
import { clientRequestIdShape, registerTool, type ToolOutcome } from "../registry.js";

const VOYAGE_COLUMNS =
  "id,name,name_it,name_en,description,description_it,description_en,type,status,is_published,start_date,end_date,sort_order";

interface VoyageRow {
  id: string;
  name: string;
  name_it: string | null;
  name_en: string | null;
  description: string;
  description_it: string | null;
  description_en: string | null;
  type: "water" | "land";
  status: string;
  is_published: boolean;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
}

const WAYPOINT_COLUMNS =
  "id,voyage_id,sort_order,lat,lng,name,name_it,name_en,description_it,description_en,waypoint_type,visibility_mode,media,poi,activities,nearby_airports,event_date,event_time,date_start,date_end";

interface WaypointRow {
  id: string;
  voyage_id: string;
  sort_order: number;
  lat: number;
  lng: number;
  name: string;
  name_it: string | null;
  name_en: string | null;
  description_it: string | null;
  description_en: string | null;
  waypoint_type: string;
  visibility_mode: string;
  media: unknown;
  poi: unknown;
  activities: unknown;
  nearby_airports: unknown;
  event_date: string | null;
  event_time: string | null;
  date_start: string | null;
  date_end: string | null;
}

async function loadVoyage(ctx: McpContext, voyageId: string): Promise<VoyageRow> {
  const { data, error } = await ctx.service
    .from("voyages")
    .select(VOYAGE_COLUMNS)
    .eq("id", voyageId)
    .maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura rotta fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Rotta ${voyageId} inesistente.`);
  return data as unknown as VoyageRow;
}

async function loadWaypoint(ctx: McpContext, waypointId: string): Promise<WaypointRow> {
  const { data, error } = await ctx.service
    .from("voyage_waypoints")
    .select(WAYPOINT_COLUMNS)
    .eq("id", waypointId)
    .maybeSingle();
  if (error) throw new McpToolError("db_error", `Lettura tappa fallita: ${error.message}`);
  if (!data) throw new McpToolError("not_found", `Tappa ${waypointId} inesistente.`);
  return data as unknown as WaypointRow;
}

const waypointLabel = (waypoint: Pick<WaypointRow, "name" | "name_it" | "name_en">) =>
  waypoint.name_it || waypoint.name_en || waypoint.name;

const namedItemShape = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
});

type NamedItemInput = { name: string; description?: string | null };

/**
 * `namedItemShape` è un letterale non `as const`: come `authorsShape` in
 * `articles.ts`, la propagazione attraverso `z.objectOutputType<Shape, …>` in
 * `registry.ts` allarga `name` a opzionale. Zod lo valida comunque a runtime —
 * qui serve solo a TypeScript.
 */
function typedNamedItems(value: unknown): NamedItemInput[] | undefined {
  return value as NamedItemInput[] | undefined;
}

/** Stessa forma di `normalizeNamedList` in `lib/voyage-utils.ts`: name obbligatorio, description a null se vuota. */
function toNamedList(value: unknown): { name: string; description: string | null }[] | undefined {
  const items = typedNamedItems(value);
  if (items === undefined) return undefined;
  return items.map((item) => ({ name: item.name.trim(), description: item.description?.trim() || null }));
}

const mediaItemShape = z.object({
  kind: z.enum(["image", "video", "file"]).default("image"),
  url: z.string().url(),
  name: z.string().max(200).nullable().optional(),
  mime_type: z.string().max(100).nullable().optional(),
  path: z.string().max(300).nullable().optional(),
});

export function registerVoyageTools(server: McpServer, ctx: McpContext): void {
  registerTool(server, ctx, {
    name: "voyage_search",
    title: "Cerca rotte",
    description:
      "Elenca le rotte (voyages) con filtri per pubblicazione e testo nel nome. Non restituisce le tappe: per quelle serve voyage_get.",
    scope: "voyages:read",
    kind: "read",
    inputSchema: {
      query: z.string().max(200).optional().describe("Testo cercato nei nomi IT ed EN."),
      is_published: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async (args, context) => {
      let query = context.service
        .from("voyages")
        .select(VOYAGE_COLUMNS)
        .order("sort_order", { ascending: true })
        .limit(args.limit ?? 25);

      if (args.is_published !== undefined) query = query.eq("is_published", args.is_published);
      if (args.query) {
        const safe = args.query.replace(/[,%]/g, " ").trim();
        if (safe) query = query.or(`name.ilike.%${safe}%,name_it.ilike.%${safe}%,name_en.ilike.%${safe}%`);
      }

      const { data, error } = await query;
      if (error) throw new McpToolError("db_error", `Ricerca fallita: ${error.message}`);
      const rows = (data ?? []) as VoyageRow[];

      return {
        text: `${rows.length} rotte trovate.`,
        data: rows,
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "voyage_get",
    title: "Leggi una rotta con le sue tappe",
    description:
      "Restituisce una rotta e l'elenco ordinato delle sue tappe, con nome, descrizione, punti di interesse, attività previste e foto di ciascuna — lo stesso contenuto mostrato su /voyages/:id.",
    scope: "voyages:read",
    kind: "read",
    inputSchema: {
      voyage_id: z.string().uuid(),
    },
    handler: async (args, context) => {
      const { data: voyage, error } = await context.service
        .from("voyages")
        .select(VOYAGE_COLUMNS)
        .eq("id", args.voyage_id)
        .maybeSingle();
      if (error) throw new McpToolError("db_error", `Lettura rotta fallita: ${error.message}`);
      if (!voyage) throw new McpToolError("not_found", `Rotta ${args.voyage_id} inesistente.`);
      const voyageRow = voyage as VoyageRow;

      const { data: waypoints, error: waypointsError } = await context.service
        .from("voyage_waypoints")
        .select(WAYPOINT_COLUMNS)
        .eq("voyage_id", args.voyage_id)
        .order("sort_order", { ascending: true });
      if (waypointsError) throw new McpToolError("db_error", `Lettura tappe fallita: ${waypointsError.message}`);
      const rows = (waypoints ?? []) as WaypointRow[];

      return {
        text: `"${voyageRow.name_it || voyageRow.name}" — ${rows.length} tappe.`,
        targetId: voyageRow.id,
        data: { voyage: voyageRow, waypoints: rows },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "voyage_update",
    title: "Aggiorna il contenuto narrativo di una rotta",
    description:
      "Modifica i campi indicati di una rotta esistente (patch parziale: i campi non passati restano invariati). Copre nome e descrizione in entrambe le lingue — lo stesso contenuto testuale mostrato in testa a /voyages/:id. Non tocca geometria, date, stato o pubblicazione: quelli restano di competenza dell'editor mappa in admin.",
    scope: "voyages:write",
    kind: "write",
    inputSchema: {
      voyage_id: z.string().uuid(),
      name_it: z.string().min(1).max(200).optional(),
      name_en: z.string().min(1).max(200).optional(),
      description_it: z.string().max(4000).nullable().optional(),
      description_en: z.string().max(4000).nullable().optional(),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const voyage = await loadVoyage(context, args.voyage_id);

      const patch: Record<string, unknown> = {};
      if (args.name_it !== undefined) patch.name_it = args.name_it.trim();
      if (args.name_en !== undefined) patch.name_en = args.name_en.trim();
      if (args.description_it !== undefined) patch.description_it = args.description_it?.trim() || null;
      if (args.description_en !== undefined) patch.description_en = args.description_en?.trim() || null;

      if (Object.keys(patch).length === 0) {
        return {
          text: "Nessun campo da aggiornare.",
          targetId: voyage.id,
          data: { voyage_id: voyage.id, changed: false },
        } satisfies ToolOutcome;
      }

      const { error } = await context.service.from("voyages").update(patch).eq("id", voyage.id);
      if (error) throw new McpToolError("db_error", `Aggiornamento rotta fallito: ${error.message}`);

      const fields = Object.keys(patch);
      return {
        text: `Rotta "${voyage.name_it || voyage.name}" aggiornata (${fields.join(", ")}).`,
        targetId: voyage.id,
        data: { voyage_id: voyage.id, changed: true, fields },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "voyage_waypoint_update",
    title: "Aggiorna il contenuto narrativo di una tappa",
    description:
      "Modifica i campi indicati di una tappa esistente (patch parziale: i campi non passati restano invariati). Copre nome, descrizione, punti di interesse e attività previste in entrambe le lingue, e l'elenco foto/media — gli stessi campi mostrati su /voyages/:id. poi, activities e media, quando passati, sostituiscono l'elenco esistente, non lo sommano: per aggiungere una singola foto (es. l'immagine della città) senza perdere le altre usa voyage_waypoint_upload_image.",
    scope: "voyages:write",
    kind: "write",
    inputSchema: {
      waypoint_id: z.string().uuid(),
      name_it: z.string().min(1).max(200).optional(),
      name_en: z.string().min(1).max(200).optional(),
      description_it: z.string().max(4000).nullable().optional(),
      description_en: z.string().max(4000).nullable().optional(),
      poi: z
        .array(namedItemShape)
        .max(30)
        .optional()
        .describe("Elenco finale dei punti di interesse della tappa. Sostituisce quelli esistenti, non li somma."),
      activities: z
        .array(namedItemShape)
        .max(30)
        .optional()
        .describe("Elenco finale delle attività previste. Sostituisce quelle esistenti, non le somma."),
      media: z
        .array(mediaItemShape)
        .max(60)
        .optional()
        .describe("Elenco finale di foto/video/allegati della tappa. Sostituisce quello esistente, non lo somma."),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (args, context) => {
      const waypoint = await loadWaypoint(context, args.waypoint_id);

      const patch: Record<string, unknown> = {};
      if (args.name_it !== undefined) patch.name_it = args.name_it.trim();
      if (args.name_en !== undefined) patch.name_en = args.name_en.trim();
      if (args.description_it !== undefined) patch.description_it = args.description_it?.trim() || null;
      if (args.description_en !== undefined) patch.description_en = args.description_en?.trim() || null;
      if (args.poi !== undefined) patch.poi = toNamedList(args.poi);
      if (args.activities !== undefined) patch.activities = toNamedList(args.activities);
      if (args.media !== undefined) patch.media = args.media;

      if (Object.keys(patch).length === 0) {
        return {
          text: "Nessun campo da aggiornare.",
          targetId: waypoint.id,
          data: { waypoint_id: waypoint.id, changed: false },
        } satisfies ToolOutcome;
      }

      const { error } = await context.service.from("voyage_waypoints").update(patch).eq("id", waypoint.id);
      if (error) throw new McpToolError("db_error", `Aggiornamento tappa fallito: ${error.message}`);

      const fields = Object.keys(patch);
      return {
        text: `Tappa "${waypointLabel(waypoint)}" aggiornata (${fields.join(", ")}).`,
        targetId: waypoint.id,
        data: { waypoint_id: waypoint.id, voyage_id: waypoint.voyage_id, changed: true, fields },
      } satisfies ToolOutcome;
    },
  });

  registerTool(server, ctx, {
    name: "voyage_waypoint_upload_image",
    title: "Carica una foto per una tappa (es. immagine della città)",
    description:
      "Scarica un'immagine da un URL https e la ripubblica nello storage BITE (stesso bucket dell'upload manuale nella mappa admin). Se waypoint_id è indicato, la aggiunge subito alla galleria della tappa senza toccare le foto già presenti; altrimenti restituisce solo l'URL pubblico da riusare con voyage_waypoint_update.",
    scope: "voyages:write",
    kind: "write",
    inputSchema: {
      source_url: z.string().url().describe("URL https dell'immagine sorgente."),
      waypoint_id: z.string().uuid().optional().describe("Se indicato, l'immagine viene aggiunta alla galleria di questa tappa."),
      caption: z.string().max(200).optional().describe("Didascalia/nome dell'immagine, es. il nome della città."),
      folder: z.string().max(60).optional().describe('Cartella nel bucket. Default "voyages".'),
      ...clientRequestIdShape,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
    handler: async (args, context) => {
      // Verifica che la tappa esista *prima* di scaricare e caricare l'immagine:
      // altrimenti un waypoint_id sbagliato lascerebbe nel bucket un file
      // orfano, mai collegato a nessuna tappa e mai ripulito.
      const waypoint = args.waypoint_id ? await loadWaypoint(context, args.waypoint_id) : null;

      const uploaded = await uploadImageFromUrl(context, { sourceUrl: args.source_url, folder: args.folder ?? "voyages" });

      if (!waypoint) {
        return {
          text: `Immagine caricata (${Math.round(uploaded.bytes / 1024)} KB): ${uploaded.url}`,
          data: uploaded,
        } satisfies ToolOutcome;
      }

      const existingMedia = Array.isArray(waypoint.media) ? (waypoint.media as Record<string, unknown>[]) : [];
      const nextMedia = [
        ...existingMedia,
        {
          kind: "image",
          url: uploaded.url,
          name: args.caption?.trim() || null,
          mime_type: uploaded.contentType,
          path: uploaded.path,
        },
      ];

      const { error } = await context.service.from("voyage_waypoints").update({ media: nextMedia }).eq("id", waypoint.id);
      if (error) throw new McpToolError("db_error", `Salvataggio foto sulla tappa fallito: ${error.message}`);

      return {
        text: `Immagine caricata e aggiunta alla tappa "${waypointLabel(waypoint)}" (${nextMedia.length} foto/media totali).`,
        targetId: waypoint.id,
        data: { waypoint_id: waypoint.id, voyage_id: waypoint.voyage_id, ...uploaded, media_count: nextMedia.length },
      } satisfies ToolOutcome;
    },
  });
}
