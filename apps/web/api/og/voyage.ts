/**
 * GET /api/og/voyage?slug=<slug|id> — immagine di anteprima social di una rotta.
 *
 * Condividendo una pagina viaggio su WhatsApp, Facebook o Telegram si vedeva
 * l'immagine generica del sito: uguale per tutte le rotte. Qui la pagina porta
 * con sé la propria mappa — la stessa rotta che il sito disegna con MapLibre,
 * ridisegnata server-side su base CARTO (`src/server/og/route-map.ts`).
 *
 * L'endpoint è pubblico e in sola lettura: legge i viaggi pubblicati con la
 * chiave publishable, come /api/prerender e /api/sitemap.
 */
import { encodeIndexedPng } from "../../src/server/og/png.js";
import {
  OG_HEIGHT,
  OG_WIDTH,
  isValidCoordinate,
  renderRouteMap,
  type Coordinate,
  type VoyageType,
} from "../../src/server/og/route-map.js";
import type { NodeRequest, NodeResponse } from "../../src/server/http.js";

const SITE_URL = "https://biteproject.it";
const FALLBACK_IMAGE = `${SITE_URL}/og-image.jpeg`;

/** Come in api/prerender.ts: le `VITE_*` non esistono nel runtime serverless. */
const FALLBACK_SUPABASE_URL = "https://ekwloweuicrqjjgabfdp.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrd2xvd2V1aWNycWpqZ2FiZmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Njk0NDgsImV4cCI6MjA5NTU0NTQ0OH0.8zzIIA3yrIdBe2T-L0GTIy75Cdv3p1hSR7HroZmEfqY";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseFetch = async (pathAndQuery: string): Promise<any[] | null> => {
  const baseUrl = process.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const apikey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !apikey) return null;
  try {
    const response = await fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
      headers: { apikey, Authorization: `Bearer ${apikey}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as any[];
  } catch {
    return null;
  }
};

const fetchVoyage = async (ref: string) => {
  const select = "id,type,status,status_override,cached_geometry,updated_at";
  const bySlug = await supabaseFetch(
    `voyages?select=${select}&or=(slug.eq.${encodeURIComponent(ref)},slug_it.eq.${encodeURIComponent(ref)},slug_en.eq.${encodeURIComponent(ref)})&is_published=eq.true&limit=1`,
  );
  if (bySlug?.[0]) return bySlug[0];

  // Link storici `<uuid>--<slug>` o `<uuid>` nudo, come in api/prerender.ts.
  const legacyId = ref.split("--")[0];
  if (legacyId && UUID_PATTERN.test(legacyId)) {
    const byId = await supabaseFetch(
      `voyages?select=${select}&id=eq.${encodeURIComponent(legacyId)}&is_published=eq.true&limit=1`,
    );
    if (byId?.[0]) return byId[0];
  }
  return null;
};

/**
 * Marca solo le tappe "narrative", quelle che la pagina viaggio mostra come
 * soste: stessa regola di `getWaypointEffectiveType` in lib/voyage-utils.ts,
 * riscritta qui per non trascinare il bundle client dentro la function.
 */
const isNarrativeWaypoint = (waypoint: any, index: number, total: number) => {
  if (waypoint.visibility_mode === "manual") return waypoint.waypoint_type === "narrative";
  if (
    Number(waypoint.planned_stop_duration_minutes ?? 0) > 0
    || (waypoint.stop_mode === "hours" && Number(waypoint.stop_hours ?? 0) > 0)
    || (waypoint.stop_mode === "nights" && Number(waypoint.stop_nights ?? 0) > 0)
  ) {
    return true;
  }
  return index === 0 || index === total - 1;
};

const redirectToFallback = (res: NodeResponse) => {
  res.statusCode = 302;
  res.setHeader("Location", FALLBACK_IMAGE);
  // Cache breve: se la rotta viene pubblicata dopo, il fallback non resta appiccicato.
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end();
};

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  const url = new URL(req.url || "/", SITE_URL);
  const ref = (url.searchParams.get("slug") || url.searchParams.get("id") || "").trim();
  if (!ref) return redirectToFallback(res);

  const voyage = await fetchVoyage(ref);
  if (!voyage) return redirectToFallback(res);

  const waypoints =
    (await supabaseFetch(
      `voyage_waypoints?select=lat,lng,sort_order,visibility_mode,waypoint_type,planned_stop_duration_minutes,stop_mode,stop_hours,stop_nights&voyage_id=eq.${encodeURIComponent(voyage.id)}&order=sort_order.asc`,
    )) ?? [];

  const waypointCoordinates: Coordinate[] = waypoints
    .map((waypoint) => [Number(waypoint.lng), Number(waypoint.lat)] as Coordinate)
    .filter(isValidCoordinate);

  // Stessa priorità della pagina viaggio: la geometria calcolata se c'è,
  // altrimenti i waypoint uniti in linea retta.
  const geometry = (voyage.cached_geometry as { coordinates?: unknown } | null)?.coordinates;
  const routeCoordinates: Coordinate[] =
    Array.isArray(geometry) && geometry.filter(isValidCoordinate).length >= 2
      ? (geometry.filter(isValidCoordinate) as Coordinate[])
      : waypointCoordinates;

  if (!routeCoordinates.length) return redirectToFallback(res);

  const stops = waypoints
    .filter((waypoint, index) => isNarrativeWaypoint(waypoint, index, waypoints.length))
    .map((waypoint) => [Number(waypoint.lng), Number(waypoint.lat)] as Coordinate)
    .filter(isValidCoordinate);

  try {
    const image = await renderRouteMap({
      coordinates: routeCoordinates,
      stops,
      type: (voyage.type === "land" ? "land" : "water") as VoyageType,
      status: voyage.status_override || voyage.status || "completed",
      width: OG_WIDTH,
      height: OG_HEIGHT,
    });
    // A palette invece che RGBA: l'anteprima di WhatsApp scarta le immagini pesanti.
    const png = encodeIndexedPng(image);

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.end(png);
  } catch (error) {
    console.error("[og/voyage] rendering fallito", error);
    redirectToFallback(res);
  }
}
