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
      (c: [number, number]) => [c[1], c[0]]
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

export function slugifyVoyageName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voyage";
}

export function buildVoyagePath(voyage: Pick<Voyage, "id" | "name">): string {
  return `/voyages/${voyage.id}--${slugifyVoyageName(voyage.name)}`;
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

export function buildWaypointDefaultName(index: number, lat: number, lng: number, placeName?: string | null): string {
  const prefix = index === 0 ? "Start" : `Waypoint ${String(index + 1).padStart(2, "0")}`;
  return `${prefix} · ${placeName || formatWaypointCoordinateLabel(lat, lng)}`;
}

export function getPublicVoyageWaypoints(
  waypoints: VoyageWaypoint[],
  articles: Pick<GeoArticle, "voyage_id" | "voyage_segment_start" | "voyage_segment_end">[] = [],
  voyageId?: string | null
): VoyageWaypoint[] {
  const targetVoyageId = voyageId ?? waypoints[0]?.voyage_id ?? null;
  const articleLinkedIndexes = new Set<number>();

  articles.forEach((article) => {
    if (!targetVoyageId || article.voyage_id !== targetVoyageId) return;
    if (Number.isInteger(article.voyage_segment_start) && article.voyage_segment_start != null && article.voyage_segment_start >= 0) {
      articleLinkedIndexes.add(article.voyage_segment_start);
    }
    if (Number.isInteger(article.voyage_segment_end) && article.voyage_segment_end != null && article.voyage_segment_end >= 0) {
      articleLinkedIndexes.add(article.voyage_segment_end);
    }
  });

  return waypoints.filter(
    (waypoint, index) => waypoint.waypoint_type === "narrative" || articleLinkedIndexes.has(index)
  );
}

export function getStraightVoyageGeometry(waypoints: { lat: number; lng: number }[]): [number, number][] {
  return waypoints.map((waypoint) => [waypoint.lng, waypoint.lat]);
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
  description: string;
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
  sort_order: number;
  waypoint_type: "technical" | "narrative";
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
