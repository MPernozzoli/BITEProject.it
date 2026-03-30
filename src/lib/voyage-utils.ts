import type { Language } from "@/lib/i18n";

// Haversine distance in nautical miles
export function haversineNM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065; // Earth radius in NM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Total distance for a set of waypoints (straight lines)
export function totalWaypointDistance(waypoints: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineNM(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
  }
  return total;
}

// OSRM routing for land routes
export async function fetchOSRMRoute(
  waypoints: { lat: number; lng: number }[]
): Promise<{ geometry: [number, number][]; distanceKm: number } | null> {
  if (waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]) return null;
    const route = data.routes[0];
    // GeoJSON coordinates are [lng, lat], flip to [lat, lng] for Leaflet
    const geometry: [number, number][] = route.geometry.coordinates.map(
      (coordinate: [number, number]) => [coordinate[1], coordinate[0]]
    );
    return { geometry, distanceKm: route.distance / 1000 };
  } catch {
    return null;
  }
}

// Nominatim geocoding
export async function geocodePlace(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { "User-Agent": "BITE-Logbook/1.0" } }
    );
    const data = await res.json();
    if (!data?.[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
  } catch {
    return null;
  }
}

export async function reverseGeocodePlace(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=12`,
      { headers: { "User-Agent": "BITE-Logbook/1.0" } }
    );
    const data = await res.json();
    const address = data?.address || {};
    const parts = [
      address.harbour,
      address.marina,
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.county,
      address.state,
      data?.name,
    ].filter(Boolean);
    return parts[0] || data?.display_name?.split(",")?.[0] || null;
  } catch {
    return null;
  }
}

export function formatWaypointCoordinateLabel(lat: number, lng: number): string {
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lngHemisphere = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHemisphere} · ${Math.abs(lng).toFixed(2)}°${lngHemisphere}`;
}

const waypointLabelPrefix = (index: number, lang: Language) => {
  if (index === 0) return lang === "it" ? "Partenza" : "Start";
  return lang === "it" ? `Tappa ${String(index + 1).padStart(2, "0")}` : `Waypoint ${String(index + 1).padStart(2, "0")}`;
};

export function slugifyVoyageName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voyage";
}

const getVoyageSlugSource = (voyage: Pick<Voyage, "name" | "name_en" | "name_it">) =>
  voyage.name_en?.trim() || voyage.name_it?.trim() || voyage.name;

export function getLocalizedVoyageName(
  voyage: Pick<Voyage, "name" | "name_en" | "name_it">,
  lang: Language
): string {
  if (lang === "it") {
    return voyage.name_it?.trim() || voyage.name_en?.trim() || voyage.name;
  }

  return voyage.name_en?.trim() || voyage.name_it?.trim() || voyage.name;
}

export function getLocalizedVoyageDescription(
  voyage: Pick<Voyage, "description" | "description_en" | "description_it">,
  lang: Language
): string | null {
  const value = lang === "it"
    ? voyage.description_it?.trim() || voyage.description_en?.trim() || voyage.description?.trim()
    : voyage.description_en?.trim() || voyage.description_it?.trim() || voyage.description?.trim();

  return value || null;
}

export function buildVoyagePath(voyage: Pick<Voyage, "id" | "name" | "name_en" | "name_it">): string {
  return `/voyages/${voyage.id}--${slugifyVoyageName(getVoyageSlugSource(voyage))}`;
}

export function getVoyageIdFromRouteParam(value?: string | null): string | null {
  if (!value) return null;
  const [id] = value.split("--");
  return id || null;
}

export function formatIsoDate(value?: string | null, locale = "en-US"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatVoyageDateRange(
  voyage: Pick<Voyage, "start_date" | "end_date">,
  locale = "en-US"
): string | null {
  const start = formatIsoDate(voyage.start_date, locale);
  const end = formatIsoDate(voyage.end_date, locale);
  if (!start && !end) return null;
  if (start && end) return `${start} → ${end}`;
  return start || end;
}

export function buildWaypointDefaultLocalizedNames(
  index: number,
  lat: number,
  lng: number,
  placeName?: string | null
): Record<Language, string> {
  const suffix = placeName || formatWaypointCoordinateLabel(lat, lng);
  return {
    en: `${waypointLabelPrefix(index, "en")} · ${suffix}`,
    it: `${waypointLabelPrefix(index, "it")} · ${suffix}`,
  };
}

export function buildWaypointDefaultName(index: number, lat: number, lng: number, placeName?: string | null): string {
  return buildWaypointDefaultLocalizedNames(index, lat, lng, placeName).en;
}

export interface VoyageWaypointMediaItem {
  kind: "image" | "video" | "file";
  mime_type: string | null;
  name: string | null;
  path: string | null;
  url: string;
}

export const normalizeWaypointMedia = (value: unknown): VoyageWaypointMediaItem[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const candidate = item as Partial<VoyageWaypointMediaItem>;
    if (typeof candidate.url !== "string" || !candidate.url) return [];

    return [{
      kind: candidate.kind === "image" || candidate.kind === "video" ? candidate.kind : "file",
      mime_type: typeof candidate.mime_type === "string" ? candidate.mime_type : null,
      name: typeof candidate.name === "string" ? candidate.name : null,
      path: typeof candidate.path === "string" ? candidate.path : null,
      url: candidate.url,
    }];
  });
};

export function getWaypointEffectiveType(
  waypoint: Pick<VoyageWaypoint, "visibility_mode" | "waypoint_type">,
  index: number,
  total: number
): "technical" | "narrative" {
  if (waypoint.visibility_mode === "manual") {
    return waypoint.waypoint_type === "narrative" ? "narrative" : "technical";
  }

  return index === 0 || index === total - 1 ? "narrative" : "technical";
}

export function getLocalizedWaypointName(
  waypoint: Pick<VoyageWaypoint, "name" | "name_en" | "name_it" | "lat" | "lng">,
  lang: Language,
  index: number
): string {
  const fallback = buildWaypointDefaultLocalizedNames(index, waypoint.lat, waypoint.lng);
  if (lang === "it") {
    return waypoint.name_it?.trim() || waypoint.name_en?.trim() || waypoint.name?.trim() || fallback.it;
  }

  return waypoint.name_en?.trim() || waypoint.name_it?.trim() || waypoint.name?.trim() || fallback.en;
}

export function getLocalizedWaypointDescription(
  waypoint: Pick<VoyageWaypoint, "description_en" | "description_it">,
  lang: Language
): string | null {
  const value = lang === "it"
    ? waypoint.description_it?.trim() || waypoint.description_en?.trim()
    : waypoint.description_en?.trim() || waypoint.description_it?.trim();

  return value || null;
}

const getArticleWaypointRange = (
  article: Pick<GeoArticle, "voyage_segment_start" | "voyage_segment_end">
) => {
  if (article.voyage_segment_start == null && article.voyage_segment_end == null) return null;

  const start = article.voyage_segment_start ?? article.voyage_segment_end ?? 0;
  const end = article.voyage_segment_end ?? article.voyage_segment_start ?? start;
  return [Math.min(start, end), Math.max(start, end)] as const;
};

const collectArticleLinkedWaypointIndexes = (
  articles: Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[],
  voyageId?: string | null
) => {
  const linkedIndexes = new Set<number>();

  articles.forEach((article) => {
    if (!voyageId || article.voyage_id !== voyageId) return;
    const range = getArticleWaypointRange(article);
    if (!range) return;

    for (let index = range[0]; index <= range[1]; index += 1) {
      linkedIndexes.add(index);
    }
  });

  return linkedIndexes;
};

export function getPublicVoyageWaypoints(
  waypoints: VoyageWaypoint[],
  articles: Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[] = [],
  voyageId?: string | null
): VoyageWaypoint[] {
  const targetVoyageId = voyageId ?? waypoints[0]?.voyage_id ?? null;
  const articleLinkedIndexes = collectArticleLinkedWaypointIndexes(articles, targetVoyageId);

  return waypoints.filter(
    (waypoint, index) =>
      getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative" || articleLinkedIndexes.has(index)
  );
}

export function getAssociatedArticleForWaypoint<
  T extends Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">
>(
  articles: T[],
  voyageId: string | null | undefined,
  waypointIndex: number
): T | null {
  for (const article of articles) {
    if (!voyageId || article.voyage_id !== voyageId) continue;
    const range = getArticleWaypointRange(article);
    if (!range) continue;
    if (waypointIndex >= range[0] && waypointIndex <= range[1]) return article;
  }

  return null;
}

const lerpCoordinate = (from: [number, number], to: [number, number], amount: number): [number, number] => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
];

const getCoordinateDistance = ([ax, ay]: [number, number], [bx, by]: [number, number]) =>
  Math.hypot(ax - bx, ay - by);

export function getStraightVoyageGeometry(waypoints: { lat: number; lng: number }[]): [number, number][] {
  return waypoints.map((waypoint) => [waypoint.lng, waypoint.lat]);
}

export function buildPublicVoyageGeometry(
  waypoints: VoyageWaypoint[],
  type: VoyageType,
  articles: Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[] = [],
  voyageId?: string | null,
  cachedGeometry?: [number, number][] | null
): [number, number][] {
  const baseGeometry = cachedGeometry && cachedGeometry.length >= 2
    ? cachedGeometry
    : getStraightVoyageGeometry(waypoints);

  if (type !== "water" || waypoints.length < 3 || baseGeometry.length !== waypoints.length) {
    return baseGeometry;
  }

  const targetVoyageId = voyageId ?? waypoints[0]?.voyage_id ?? null;
  const articleLinkedIndexes = collectArticleLinkedWaypointIndexes(articles, targetVoyageId);
  const smoothed: [number, number][] = [[waypoints[0].lng, waypoints[0].lat]];

  for (let index = 1; index < waypoints.length - 1; index += 1) {
    const waypoint = waypoints[index];
    const isHiddenTechnical =
      getWaypointEffectiveType(waypoint, index, waypoints.length) === "technical" &&
      !articleLinkedIndexes.has(index);

    const current: [number, number] = [waypoint.lng, waypoint.lat];
    if (!isHiddenTechnical) {
      smoothed.push(current);
      continue;
    }

    const previous: [number, number] = [waypoints[index - 1].lng, waypoints[index - 1].lat];
    const next: [number, number] = [waypoints[index + 1].lng, waypoints[index + 1].lat];
    const prevDistance = getCoordinateDistance(previous, current);
    const nextDistance = getCoordinateDistance(current, next);
    if (prevDistance === 0 || nextDistance === 0) continue;

    const trimRatio = Math.min(0.22, 0.08 / Math.max(Math.min(prevDistance, nextDistance), 0.08));
    smoothed.push(
      lerpCoordinate(current, previous, trimRatio),
      lerpCoordinate(current, next, trimRatio)
    );
  }

  smoothed.push([waypoints[waypoints.length - 1].lng, waypoints[waypoints.length - 1].lat]);
  return smoothed;
}

export async function buildVoyageGeometry(
  waypoints: { lat: number; lng: number }[],
  type: VoyageType
): Promise<[number, number][]> {
  if (waypoints.length < 2) return getStraightVoyageGeometry(waypoints);
  if (type !== "land") return getStraightVoyageGeometry(waypoints);

  const route = await fetchOSRMRoute(waypoints);
  if (!route?.geometry?.length) return getStraightVoyageGeometry(waypoints);

  return route.geometry.map(([lat, lng]) => [lng, lat]);
}

export type VoyageType = "water" | "land";
export type VoyageStatus = "planned" | "active" | "completed";
export type VoyageGeometry = { type: "LineString"; coordinates: [number, number][] } | null;

export interface Voyage {
  id: string;
  name: string;
  name_en: string | null;
  name_it: string | null;
  description: string;
  description_en: string | null;
  description_it: string | null;
  type: VoyageType;
  status: VoyageStatus;
  sort_order: number;
  cached_geometry: VoyageGeometry;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoyageWaypoint {
  id: string;
  voyage_id: string;
  lat: number;
  lng: number;
  name: string;
  name_en: string | null;
  name_it: string | null;
  sort_order: number;
  waypoint_type: "technical" | "narrative";
  visibility_mode: "auto" | "manual";
  description_en: string | null;
  description_it: string | null;
  event_date: string | null;
  event_time: string | null;
  media: VoyageWaypointMediaItem[];
  date_start: string | null;
  date_end: string | null;
  created_at: string;
}

export interface GeoArticle {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  cover_image: string | null;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  cover_zoom?: number | null;
  excerpt_en: string | null;
  excerpt_it: string | null;
  published_at: string | null;
  latitude: number | null;
  longitude: number | null;
  voyage_id: string | null;
  voyage_segment_start: number | null;
  voyage_segment_end: number | null;
  location_name: string | null;
  authors?: { id: string; name: string; avatar_url: string | null }[];
  tags?: { id: string; name: string }[];
  likeCount?: number;
  viewCount?: number;
}
