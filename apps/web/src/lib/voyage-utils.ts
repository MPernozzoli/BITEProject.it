import type { Language } from "@/lib/i18n";
import { bilingualSlugOrFilter, slugForLang, type WithBilingualSlugs } from "@/lib/article-slug";
import { getActualStopHours } from "@/lib/voyage-schedule";

const BITE_MAPS_USER_AGENT = "BITE-Logbook/1.0";
const OSRM_BASE_URL = "https://router.project-osrm.org";
const BROUTER_BASE_URL = "https://brouter.de";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

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

export function totalCoordinateDistanceKm(coordinates: [number, number][]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLng, previousLat] = coordinates[index - 1];
    const [currentLng, currentLat] = coordinates[index];
    total += haversineNM(previousLat, previousLng, currentLat, currentLng) * 1.852;
  }
  return total;
}

// OSRM routing for land routes
export async function fetchOSRMRoute(
  waypoints: { lat: number; lng: number }[]
): Promise<{ geometry: [number, number][]; distanceKm: number } | null> {
  if (waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
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

const parseBRouterWaterwayGeoJson = async (
  res: Response
): Promise<{ coordinates: [number, number][]; distanceKm: number } | null> => {
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as {
      features?: Array<{ geometry?: { type?: string; coordinates?: [number, number][] } }>;
    };
    const geometry = data.features?.[0]?.geometry;
    if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      return null;
    }
    const coordinates = geometry.coordinates.filter(
      (c): c is [number, number] =>
        Array.isArray(c) &&
        c.length >= 2 &&
        Number.isFinite(Number(c[0])) &&
        Number.isFinite(Number(c[1]))
    );
    if (coordinates.length < 2) return null;

    let distanceKm = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
      const [lng0, lat0] = coordinates[i - 1];
      const [lng1, lat1] = coordinates[i];
      distanceKm += haversineNM(lat0, lng0, lat1, lng1) * 1.852;
    }
    return { coordinates, distanceKm };
  } catch {
    return null;
  }
};

/** One BRouter request for the whole chain (via points = pipe). Fewer 400s in the network tab than N−1 segment calls. */
export async function fetchBRouterWaterwayRoute(waypoints: { lat: number; lng: number }[]): Promise<{
  coordinates: [number, number][];
  distanceKm: number;
} | null> {
  if (waypoints.length < 2) return null;
  const lonlats = waypoints.map((w) => `${w.lng},${w.lat}`).join("|");
  const params = new URLSearchParams({
    lonlats,
    profile: "river",
    alternativeidx: "0",
    format: "geojson",
  });
  try {
    const res = await fetch(`${BROUTER_BASE_URL}/brouter?${params.toString()}`, {
      headers: { "User-Agent": BITE_MAPS_USER_AGENT },
    });
    return parseBRouterWaterwayGeoJson(res);
  } catch {
    return null;
  }
}

/** Single segment (fallback when the full-chain request fails). */
export async function fetchBRouterWaterwaySegment(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<{ coordinates: [number, number][]; distanceKm: number } | null> {
  return fetchBRouterWaterwayRoute([start, end]);
}

// --- Open-sea land avoidance -------------------------------------------------
// A tratta counts as "river/canal" when BRouter finds a navigable waterway between its two
// waypoints (see buildVoyageGeometry). Everywhere else it's open sea: by default that's a
// straight chord, but a straight chord can cross a headland or an island. This section fetches
// the nearby coastline from Overpass and, only when the chord actually crosses land, bulges it
// out just enough to clear the obstacle — a cheap heuristic, not a real navigation graph.
type LatLng = { lat: number; lng: number };

const MIN_LAND_CHECK_KM = 0.3;
const MAX_LAND_CHECK_KM = 800;
const LAND_AVOIDANCE_MAX_DEPTH = 6;
const LAND_AVOIDANCE_BULGE_STEPS = [0.15, 0.3, 0.5, 0.8, 1.2, 1.8];
const KM_PER_DEGREE_LAT = 111.32;

const kmPerDegreeLngAt = (lat: number) => KM_PER_DEGREE_LAT * Math.max(0.05, Math.cos((lat * Math.PI) / 180));

// Signed-area based segment intersection (proper crossings only; touching endpoints don't count,
// which is fine here — coastline data is dense enough that a true land crossing always shows up
// as a proper intersection somewhere along the chord).
const segmentsIntersect = (a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean => {
  const cross = (o: LatLng, p: LatLng, q: LatLng) =>
    (p.lng - o.lng) * (q.lat - o.lat) - (p.lat - o.lat) * (q.lng - o.lng);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

const countLandCrossings = (a: LatLng, b: LatLng, coastlineWays: LatLng[][]): number => {
  let count = 0;
  for (const way of coastlineWays) {
    for (let i = 1; i < way.length; i += 1) {
      if (segmentsIntersect(a, b, way[i - 1], way[i])) count += 1;
    }
  }
  return count;
};

const coastlineWaysCache = new Map<string, LatLng[][]>();
const COASTLINE_CACHE_MAX_ENTRIES = 200;

/** Coastline ways (OSM `natural=coastline`) within a padded bbox around the a–b chord. */
async function fetchCoastlineWays(a: LatLng, b: LatLng): Promise<LatLng[][]> {
  const cacheKey = `${a.lat.toFixed(3)},${a.lng.toFixed(3)}|${b.lat.toFixed(3)},${b.lng.toFixed(3)}`;
  const cached = coastlineWaysCache.get(cacheKey);
  if (cached) return cached;

  const midLat = (a.lat + b.lat) / 2;
  const straightDistanceKm = haversineNM(a.lat, a.lng, b.lat, b.lng) * 1.852;
  // Padding must comfortably exceed the widest bulge the routing step below can try, or a
  // legitimate detour could be "cleared" only because its far end fell outside the fetched data.
  const padKm = Math.max(15, straightDistanceKm * 0.6);
  const padLat = padKm / KM_PER_DEGREE_LAT;
  const padLng = padKm / kmPerDegreeLngAt(midLat);
  const south = Math.min(a.lat, b.lat) - padLat;
  const north = Math.max(a.lat, b.lat) + padLat;
  const west = Math.min(a.lng, b.lng) - padLng;
  const east = Math.max(a.lng, b.lng) + padLng;

  const query = `[out:json][timeout:20];way["natural"="coastline"](${south},${west},${north},${east});out geom;`;

  let ways: LatLng[][] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? globalThis.setTimeout(() => controller.abort(), 18000) : null;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller?.signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        elements?: { type?: string; geometry?: { lat: number; lon: number }[] }[];
      };
      ways = (data.elements || [])
        .filter(
          (el): el is { type: string; geometry: { lat: number; lon: number }[] } =>
            el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2
        )
        .map((el) => el.geometry.map((point) => ({ lat: point.lat, lng: point.lon })));
      break;
    } catch {
      // Try the next public Overpass endpoint.
    } finally {
      if (timeout) globalThis.clearTimeout(timeout);
    }
  }

  if (coastlineWaysCache.size >= COASTLINE_CACHE_MAX_ENTRIES) {
    const oldestKey = coastlineWaysCache.keys().next().value;
    if (oldestKey !== undefined) coastlineWaysCache.delete(oldestKey);
  }
  coastlineWaysCache.set(cacheKey, ways);
  return ways;
}

/** Point offset from the a–b midpoint, perpendicular to a–b, by offsetKm (planar approximation). */
const offsetPerpendicular = (a: LatLng, b: LatLng, offsetKm: number): LatLng => {
  const midLat = (a.lat + b.lat) / 2;
  const kmPerDegLng = kmPerDegreeLngAt(midLat);
  const ax = a.lng * kmPerDegLng;
  const ay = a.lat * KM_PER_DEGREE_LAT;
  const bx = b.lng * kmPerDegLng;
  const by = b.lat * KM_PER_DEGREE_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const ux = -dy / length;
  const uy = dx / length;
  const offsetX = (ax + bx) / 2 + ux * offsetKm;
  const offsetY = (ay + by) / 2 + uy * offsetKm;
  return { lat: offsetY / KM_PER_DEGREE_LAT, lng: offsetX / kmPerDegLng };
};

/**
 * Detours the a–b chord around land: tries bulging it out (growing steps, either side) until a
 * two-segment path clears every coastline crossing, subdividing recursively when a single bulge
 * isn't enough (e.g. a long chord grazing several islands). Depth-bounded, so a pathological case
 * just keeps the smallest-crossing-count path found rather than looping forever.
 */
function routeAroundLand(a: LatLng, b: LatLng, coastlineWays: LatLng[][], depth: number): LatLng[] {
  if (!coastlineWays.length || countLandCrossings(a, b, coastlineWays) === 0) return [a, b];
  if (depth >= LAND_AVOIDANCE_MAX_DEPTH) return [a, b];

  const straightKm = haversineNM(a.lat, a.lng, b.lat, b.lng) * 1.852;
  let best: { via: LatLng; crossings: number } | null = null;

  for (const side of [1, -1]) {
    for (const step of LAND_AVOIDANCE_BULGE_STEPS) {
      const via = offsetPerpendicular(a, b, side * step * straightKm);
      const crossings = countLandCrossings(a, via, coastlineWays) + countLandCrossings(via, b, coastlineWays);
      if (crossings === 0) return [a, via, b];
      if (!best || crossings < best.crossings) best = { via, crossings };
    }
  }

  const pivot =
    best?.via ??
    offsetPerpendicular(a, b, LAND_AVOIDANCE_BULGE_STEPS[LAND_AVOIDANCE_BULGE_STEPS.length - 1] * straightKm);
  const firstHalf = routeAroundLand(a, pivot, coastlineWays, depth + 1);
  const secondHalf = routeAroundLand(pivot, b, coastlineWays, depth + 1);
  return [...firstHalf.slice(0, -1), ...secondHalf];
}

const quadraticBezierPoint = (p0: LatLng, p1: LatLng, p2: LatLng, t: number): LatLng => {
  const mt = 1 - t;
  return {
    lat: mt * mt * p0.lat + 2 * mt * t * p1.lat + t * t * p2.lat,
    lng: mt * mt * p0.lng + 2 * mt * t * p1.lng + t * t * p2.lng,
  };
};

/**
 * Bonus polish on top of a land-avoidance path: rounds each via-point corner into a short bezier
 * arc instead of a sharp bend. Only ever touches the small neighbourhood around a corner, and
 * falls back to the sharp corner there if the arc would newly graze land — smoothing is never
 * allowed to undo what routeAroundLand already guaranteed.
 */
function smoothLandAvoidanceCorners(points: LatLng[], coastlineWays: LatLng[][]): LatLng[] {
  if (points.length < 3) return points;

  const result: LatLng[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1];
    const corner = points[i];
    const next = points[i + 1];
    const trimRatio = 0.3;
    const arcStart: LatLng = {
      lat: corner.lat + (prev.lat - corner.lat) * trimRatio,
      lng: corner.lng + (prev.lng - corner.lng) * trimRatio,
    };
    const arcEnd: LatLng = {
      lat: corner.lat + (next.lat - corner.lat) * trimRatio,
      lng: corner.lng + (next.lng - corner.lng) * trimRatio,
    };

    const arcSamples = 6;
    const arcPoints: LatLng[] = [];
    for (let step = 0; step <= arcSamples; step += 1) {
      arcPoints.push(quadraticBezierPoint(arcStart, corner, arcEnd, step / arcSamples));
    }
    const arcIsSafe = arcPoints.every(
      (point, index) => index === 0 || countLandCrossings(arcPoints[index - 1], point, coastlineWays) === 0
    );

    if (!arcIsSafe) {
      result.push(corner);
      continue;
    }
    result.push(arcStart, ...arcPoints.slice(1, -1), arcEnd);
  }
  result.push(points[points.length - 1]);
  return result;
}

/** Open-sea tratta geometry: a straight chord, bulged around any land it would otherwise cross. */
export async function buildSeaSegmentGeometry(start: LatLng, end: LatLng): Promise<[number, number][]> {
  const straight: [number, number][] = [
    [start.lng, start.lat],
    [end.lng, end.lat],
  ];
  const straightDistanceKm = haversineNM(start.lat, start.lng, end.lat, end.lng) * 1.852;
  if (straightDistanceKm < MIN_LAND_CHECK_KM || straightDistanceKm > MAX_LAND_CHECK_KM) {
    return straight;
  }

  const coastlineWays = await fetchCoastlineWays(start, end);
  if (!coastlineWays.length) return straight;

  const avoided = routeAroundLand(start, end, coastlineWays, 0);
  if (avoided.length < 2) return straight;

  const smoothed = smoothLandAvoidanceCorners(avoided, coastlineWays);
  return smoothed.map((point) => [point.lng, point.lat] as [number, number]);
}

export interface GeocodedPlace {
  lat: number;
  lng: number;
  name: string;
}

interface ReverseGeocodeOptions {
  maritime?: boolean;
  maritimeLabelMode?: "auto" | "city" | "maritime";
}

interface ReverseGeocodeCandidate {
  label: string | null;
  generic: boolean;
}

interface NearbyNamedPlace {
  lat: number;
  lng: number;
  kind: "bay" | "cape" | "island" | "locality" | "harbour" | "marina" | "city" | "town" | "village" | "settlement";
  name: string;
  nameIt: string | null;
  nameEn: string | null;
}

const GENERIC_REVERSE_LABELS = new Set([
  "italia",
  "italy",
  "france",
  "francia",
  "france métropolitaine",
  "francia metropolitana",
  "metropolitan france",
  "españa",
  "spain",
  "greece",
  "grecia",
]);

const getNominatimAddress = (data: unknown) => {
  if (!data || typeof data !== "object") return {};
  const address = (data as { address?: unknown }).address;
  return address && typeof address === "object" ? address as Record<string, string | undefined> : {};
};

const cleanPlaceLabel = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const isGenericReverseLabel = (value: string | null) =>
  !value || GENERIC_REVERSE_LABELS.has(value.trim().toLowerCase());

const getLocalizedNearbyName = (place: NearbyNamedPlace, lang: Language) => {
  if (lang === "it") return place.nameIt || place.name || place.nameEn || null;
  return place.nameEn || place.name || place.nameIt || null;
};

const isHarbourPlace = (place: NearbyNamedPlace) => place.kind === "harbour" || place.kind === "marina";
const isSettlementPlace = (place: NearbyNamedPlace) =>
  place.kind === "city" || place.kind === "town" || place.kind === "village" || place.kind === "settlement";
const isMaritimeToponym = (place: NearbyNamedPlace) =>
  place.kind === "bay" || place.kind === "cape" || place.kind === "island" || place.kind === "locality";

const distanceKmTo = (origin: { lat: number; lng: number }, place: NearbyNamedPlace) =>
  haversineNM(origin.lat, origin.lng, place.lat, place.lng) * 1.852;

const getNearbyPlaceRank = (place: NearbyNamedPlace, origin: { lat: number; lng: number }, maritime: boolean) => {
  const distanceKm = distanceKmTo(origin, place);
  const kindPenalty: Record<NearbyNamedPlace["kind"], number> = {
    bay: maritime ? -4 : 10,
    cape: maritime ? 3 : 12,
    island: maritime ? 4 : 12,
    locality: maritime ? 6 : 14,
    harbour: maritime ? 0 : 8,
    marina: maritime ? 0 : 8,
    city: 0,
    town: 5,
    village: 9,
    settlement: 12,
  };
  return distanceKm + kindPenalty[place.kind];
};

const selectBestSettlement = (places: NearbyNamedPlace[], origin: { lat: number; lng: number }) =>
  places
    .filter(isSettlementPlace)
    .sort((a, b) => getNearbyPlaceRank(a, origin, false) - getNearbyPlaceRank(b, origin, false))[0] || null;

const selectBestMaritimeToponym = (places: NearbyNamedPlace[], origin: { lat: number; lng: number }) =>
  places
    .filter(isMaritimeToponym)
    .sort((a, b) => getNearbyPlaceRank(a, origin, true) - getNearbyPlaceRank(b, origin, true))[0] || null;

const selectMaritimeWaypointLabelPlace = (
  places: NearbyNamedPlace[],
  origin: { lat: number; lng: number },
  maritime: boolean,
  labelMode: "auto" | "city" | "maritime" = "auto"
) => {
  if (!maritime || labelMode === "city") {
    return selectBestSettlement(places, origin) || places[0] || null;
  }

  if (labelMode === "maritime") {
    return selectBestMaritimeToponym(places, origin) || selectBestSettlement(places, origin) || places[0] || null;
  }

  const nearestHarbourDistanceKm = places
    .filter(isHarbourPlace)
    .reduce((nearest, place) => Math.min(nearest, distanceKmTo(origin, place)), Number.POSITIVE_INFINITY);
  const nearestSettlement = selectBestSettlement(places, origin);
  const nearestSettlementDistanceKm = nearestSettlement ? distanceKmTo(origin, nearestSettlement) : Number.POSITIVE_INFINITY;

  const looksLikePortStop =
    nearestHarbourDistanceKm <= 3 ||
    nearestSettlementDistanceKm <= 1.5 ||
    (nearestSettlement?.kind === "city" && nearestSettlementDistanceKm <= 5);

  if (looksLikePortStop && nearestSettlement) {
    return nearestSettlement;
  }

  return selectBestMaritimeToponym(places, origin) || nearestSettlement || places[0] || null;
};

const normalizeOverpassPlace = (item: unknown): NearbyNamedPlace | null => {
  if (!item || typeof item !== "object") return null;
  const candidate = item as {
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string | undefined>;
  };
  const tags = candidate.tags || {};
  const lat = Number(candidate.lat ?? candidate.center?.lat);
  const lng = Number(candidate.lon ?? candidate.center?.lon);
  const name = cleanPlaceLabel(tags.name);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) return null;

  const natural = tags.natural;
  const place = tags.place;
  let kind: NearbyNamedPlace["kind"] = "settlement";
  if (natural === "bay" || natural === "strait" || natural === "beach") {
    kind = "bay";
  } else if (natural === "cape") {
    kind = "cape";
  } else if (natural === "coastline" || natural === "island") {
    kind = "island";
  } else if (tags.harbour) {
    kind = "harbour";
  } else if (tags.leisure === "marina") {
    kind = "marina";
  } else if (place === "city") {
    kind = "city";
  } else if (place === "town") {
    kind = "town";
  } else if (place === "village") {
    kind = "village";
  } else if (place === "locality" || place === "islet" || place === "island") {
    kind = "locality";
  }

  return {
    lat,
    lng,
    kind,
    name,
    nameIt: cleanPlaceLabel(tags["name:it"]) || null,
    nameEn: cleanPlaceLabel(tags["name:en"]) || null,
  };
};

async function fetchNearbyNamedPlaces(
  lat: number,
  lng: number,
  maritime: boolean
): Promise<NearbyNamedPlace[]> {
  const maritimeRadiusMeters = 70000;
  const settlementRadiusMeters = maritime ? 150000 : 50000;
  const maritimeSelectors = maritime
    ? `
      node(around:${maritimeRadiusMeters},${lat},${lng})["natural"~"^(bay|strait|cape|beach)$"]["name"];
      way(around:${maritimeRadiusMeters},${lat},${lng})["natural"~"^(bay|strait|cape|beach)$"]["name"];
      relation(around:${maritimeRadiusMeters},${lat},${lng})["natural"~"^(bay|strait|cape|beach)$"]["name"];
      node(around:${maritimeRadiusMeters},${lat},${lng})["place"~"^(locality|islet|island)$"]["name"];
      way(around:${maritimeRadiusMeters},${lat},${lng})["place"~"^(locality|islet|island)$"]["name"];
      relation(around:${maritimeRadiusMeters},${lat},${lng})["place"~"^(locality|islet|island)$"]["name"];
      node(around:${maritimeRadiusMeters},${lat},${lng})["harbour"]["name"];
      way(around:${maritimeRadiusMeters},${lat},${lng})["harbour"]["name"];
      node(around:${maritimeRadiusMeters},${lat},${lng})["leisure"="marina"]["name"];
      way(around:${maritimeRadiusMeters},${lat},${lng})["leisure"="marina"]["name"];
    `
    : "";
  const query = `
    [out:json][timeout:12];
    (
      ${maritimeSelectors}
      node(around:${settlementRadiusMeters},${lat},${lng})["place"~"^(city|town|village)$"]["name"];
      way(around:${settlementRadiusMeters},${lat},${lng})["place"~"^(city|town|village)$"]["name"];
      relation(around:${settlementRadiusMeters},${lat},${lng})["place"~"^(city|town|village)$"]["name"];
    );
    out center tags 30;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? globalThis.setTimeout(() => controller.abort(), 14000) : null;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller?.signal,
      });
      if (!res.ok) continue;
      const data = await res.json() as { elements?: unknown[] };
      const seen = new Set<string>();
      const places = (data.elements || [])
        .map((item) => normalizeOverpassPlace(item))
        .filter((item): item is NearbyNamedPlace => {
          if (!item) return false;
          const key = `${item.kind}:${item.name.toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => getNearbyPlaceRank(a, { lat, lng }, maritime) - getNearbyPlaceRank(b, { lat, lng }, maritime))
        .slice(0, 20);
      if (places.length) return places;
    } catch {
      // Try the next public Overpass endpoint.
    } finally {
      if (timeout) globalThis.clearTimeout(timeout);
    }
  }

  return [];
}

function normalizeOverpassAirport(item: unknown, lat: number, lng: number): VoyageWaypointAirport | null {
  if (!item || typeof item !== "object") return null;
  const candidate = item as {
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string | undefined>;
  };
  const tags = candidate.tags || {};
  const name = tags.name || tags["name:en"] || tags["name:it"];
  const airportLat = candidate.lat ?? candidate.center?.lat;
  const airportLng = candidate.lon ?? candidate.center?.lon;
  if (!name || !Number.isFinite(airportLat) || !Number.isFinite(airportLng)) return null;
  return {
    name,
    iata: tags.iata?.toUpperCase() || null,
    icao: tags.icao?.toUpperCase() || null,
    distanceKm: haversineNM(lat, lng, airportLat as number, airportLng as number) * 1.852,
    lat: airportLat as number,
    lng: airportLng as number,
  };
}

/**
 * Nearby airports via the free public Overpass API (OpenStreetMap `aeroway=aerodrome`) — no API key needed.
 * Restricted to aerodromes tagged with an IATA code: in OSM that's the reliable signal for an airport
 * serving commercial passenger traffic, as opposed to aviosuperfici, gliding strips and private airfields
 * (which almost never carry one, even when tagged `aeroway=aerodrome`).
 */
export async function fetchNearbyAirports(lat: number, lng: number, limit = 8): Promise<VoyageWaypointAirport[]> {
  const radii = [120000, 300000];

  for (const radiusMeters of radii) {
    const query = `
      [out:json][timeout:15];
      (
        node(around:${radiusMeters},${lat},${lng})["aeroway"="aerodrome"]["iata"];
        way(around:${radiusMeters},${lat},${lng})["aeroway"="aerodrome"]["iata"];
        relation(around:${radiusMeters},${lat},${lng})["aeroway"="aerodrome"]["iata"];
      );
      out center tags 30;
    `;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller ? globalThis.setTimeout(() => controller.abort(), 17000) : null;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ data: query }).toString(),
          signal: controller?.signal,
        });
        if (!res.ok) continue;
        const data = await res.json() as { elements?: unknown[] };
        const seen = new Set<string>();
        const airports = (data.elements || [])
          .map((item) => normalizeOverpassAirport(item, lat, lng))
          .filter((item): item is VoyageWaypointAirport => {
            if (!item) return false;
            const key = item.iata || item.icao || item.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
          .slice(0, limit);
        if (airports.length) return airports;
      } catch {
        // Try the next public Overpass endpoint.
      } finally {
        if (timeout) globalThis.clearTimeout(timeout);
      }
    }
  }

  return [];
}

async function fetchNearbySettlementsFromNominatim(lat: number, lng: number): Promise<NearbyNamedPlace[]> {
  const degrees = 1.35;
  const viewbox = [
    lng - degrees,
    lat + degrees,
    lng + degrees,
    lat - degrees,
  ].join(",");
  const queries = ["city", "town", "village"];

  try {
    const results = await Promise.all(queries.map(async (query) => {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: query,
        limit: "10",
        addressdetails: "1",
        bounded: "1",
        viewbox,
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { "User-Agent": BITE_MAPS_USER_AGENT },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }));
    const seen = new Set<string>();
    return results.flat().flatMap((item): NearbyNamedPlace[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as {
        lat?: string | number | null;
        lon?: string | number | null;
        name?: string | null;
        display_name?: string | null;
        type?: string | null;
        address?: Record<string, string | undefined>;
      };
      const itemLat = Number(candidate.lat);
      const itemLng = Number(candidate.lon);
      const address = candidate.address || {};
      const name = cleanPlaceLabel(candidate.name) ||
        cleanPlaceLabel(address.city) ||
        cleanPlaceLabel(address.town) ||
        cleanPlaceLabel(address.village) ||
        cleanPlaceLabel(candidate.display_name?.split(",")?.[0]);
      if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng) || !name) return [];
      const kind = candidate.type === "city" || address.city
        ? "city"
        : candidate.type === "town" || address.town
          ? "town"
          : "village";
      const key = `${kind}:${name.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        lat: itemLat,
        lng: itemLng,
        kind,
        name,
        nameIt: null,
        nameEn: null,
      }];
    }).sort((a, b) => getNearbyPlaceRank(a, { lat, lng }, false) - getNearbyPlaceRank(b, { lat, lng }, false));
  } catch {
    return [];
  }
}

async function fetchNearbyLabelPlaces(
  lat: number,
  lng: number,
  maritime: boolean
): Promise<NearbyNamedPlace[]> {
  const overpassPlaces = await fetchNearbyNamedPlaces(lat, lng, maritime);
  if (overpassPlaces.length) return overpassPlaces;
  return fetchNearbySettlementsFromNominatim(lat, lng);
}

function getWaypointFallbackName(index: number): string {
  return `WPT ${String(index + 1).padStart(2, "0")}`;
}

export function isWaypointCoordinateLabel(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && /^\d+(?:\.\d+)?°[NS]\s*·\s*\d+(?:\.\d+)?°[EW]$/i.test(trimmed));
}

const normalizeGeocodedPlace = (item: unknown): GeocodedPlace | null => {
  if (!item || typeof item !== "object") return null;

  const candidate = item as {
    lat?: string | number | null;
    lon?: string | number | null;
    display_name?: string | null;
  };
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lon);
  const name = candidate.display_name?.trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) return null;

  return { lat, lng, name };
};

export async function snapPointToNearestRoad(
  point: { lat: number; lng: number }
): Promise<{ lat: number; lng: number; distanceMeters: number } | null> {
  try {
    const res = await fetch(
      `${OSRM_BASE_URL}/nearest/v1/driving/${point.lng},${point.lat}?number=1`
    );
    const data = await res.json();
    const waypoint = data?.waypoints?.[0];
    const location = waypoint?.location;
    if (!Array.isArray(location) || location.length < 2) return null;

    return {
      lat: Number(location[1]),
      lng: Number(location[0]),
      distanceMeters: Number(waypoint.distance) || 0,
    };
  } catch {
    return null;
  }
}

export async function geocodePlaces(query: string, limit = 5): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(trimmedQuery)}&limit=${Math.max(1, Math.min(limit, 10))}&addressdetails=1`,
      { headers: { "User-Agent": BITE_MAPS_USER_AGENT } }
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => normalizeGeocodedPlace(item))
      .filter((item): item is GeocodedPlace => Boolean(item));
  } catch {
    return [];
  }
}

// Nominatim geocoding
export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  const [result] = await geocodePlaces(query, 1);
  return result || null;
}

async function reverseGeocodePlaceWithAcceptLanguage(
  lat: number,
  lng: number,
  acceptLanguage: string
): Promise<ReverseGeocodeCandidate> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=12&accept-language=${encodeURIComponent(acceptLanguage)}`,
      { headers: { "User-Agent": BITE_MAPS_USER_AGENT } }
    );
    const data = await res.json();
    const address = getNominatimAddress(data);
    const specific = [
      address.harbour,
      address.marina,
      address.bay,
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.suburb,
      address.city_district,
      cleanPlaceLabel((data as { name?: unknown })?.name),
    ].map(cleanPlaceLabel).find(Boolean) || null;
    if (specific && !isGenericReverseLabel(specific)) {
      return { label: specific, generic: false };
    }

    const generic = [
      address.county,
      address.state,
      address.region,
      address.country,
      (data as { display_name?: string })?.display_name?.split(",")?.[0],
    ].map(cleanPlaceLabel).find(Boolean) || null;
    return { label: generic, generic: true };
  } catch {
    return { label: null, generic: true };
  }
}

/** Reverse geocode in English (default for single-language callers). */
export async function reverseGeocodePlace(lat: number, lng: number): Promise<string | null> {
  return (await reverseGeocodePlaceWithAcceptLanguage(lat, lng, "en")).label;
}

/** Reverse geocode with separate IT/EN labels from Nominatim (`accept-language`). */
export async function reverseGeocodePlaceLocalized(
  lat: number,
  lng: number,
  options?: ReverseGeocodeOptions
): Promise<{ it: string | null; en: string | null }> {
  const [it, en] = await Promise.all([
    reverseGeocodePlaceWithAcceptLanguage(lat, lng, "it"),
    reverseGeocodePlaceWithAcceptLanguage(lat, lng, "en"),
  ]);
  const needsNearbyPlace =
    isGenericReverseLabel(it.label) ||
    isGenericReverseLabel(en.label) ||
    it.generic ||
    en.generic;

  if (needsNearbyPlace) {
    const nearbyPlaces = await fetchNearbyLabelPlaces(lat, lng, Boolean(options?.maritime));
    const nearbyPlace = selectMaritimeWaypointLabelPlace(
      nearbyPlaces,
      { lat, lng },
      Boolean(options?.maritime),
      options?.maritimeLabelMode || "auto"
    );
    if (nearbyPlace) {
      return {
        it: getLocalizedNearbyName(nearbyPlace, "it"),
        en: getLocalizedNearbyName(nearbyPlace, "en"),
      };
    }
  }

  return { it: it.label, en: en.label };
}

export function formatWaypointCoordinateLabel(lat: number, lng: number): string {
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lngHemisphere = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHemisphere} · ${Math.abs(lng).toFixed(2)}°${lngHemisphere}`;
}

/**
 * Etichetta di sequenza lungo il percorso (da mostrare accanto al nome, non nel campo `name`).
 * `total` = numero waypoint del viaggio; `index` = posizione nell’ordine `sort_order`.
 */
export function getWaypointSequenceHeading(index: number, total: number, lang: Language): string {
  if (index === 0) return lang === "it" ? "Partenza" : "Start";
  if (total > 1 && index === total - 1) return lang === "it" ? "Arrivo" : "Arrival";
  return lang === "it" ? `Tappa ${String(index + 1).padStart(2, "0")}` : `Waypoint ${String(index + 1).padStart(2, "0")}`;
}

/**
 * Etichetta per la legenda mappa: solo le soste pubbliche visibili, numerate 1, 2, 3…
 * (ignora i waypoint tecnici del percorso completo).
 */
export function getVisibleStopsLegendHeading(
  visibleIndex: number,
  visibleCount: number,
  lang: Language
): string {
  if (visibleIndex === 0) return lang === "it" ? "Partenza" : "Start";
  if (visibleCount > 1 && visibleIndex === visibleCount - 1) {
    return lang === "it" ? "Arrivo" : "Arrival";
  }
  return String(visibleIndex);
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

export function buildVoyagePath(
  voyage: Pick<Voyage, "id" | "slug" | "slug_en" | "slug_it">,
  lang: Language
): string {
  const slug = slugForLang(voyage, lang);
  return `/voyages/${slug || voyage.id}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Legacy voyage links were `/voyages/<uuid>` or `/voyages/<uuid>--<slug>`.
 * Detects those so VoyagePage can fall back to an id lookup and redirect to
 * the canonical slug URL.
 */
export function getLegacyVoyageIdFromRouteParam(value?: string | null): string | null {
  if (!value) return null;
  const [id] = value.split("--");
  return id && UUID_PATTERN.test(id) ? id : null;
}

export { bilingualSlugOrFilter, slugForLang, type WithBilingualSlugs };

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

export function hasVoyageDatesTbd(
  voyage: Pick<Voyage, "status" | "start_date" | "end_date">
): boolean {
  return voyage.status === "planned" && !voyage.start_date && !voyage.end_date;
}

const formatVoyageDateWindow = (
  value: string | null,
  flexDays: number | null | undefined,
  locale: string
) => {
  const formatted = formatIsoDate(value, locale);
  if (!formatted) return null;
  const days = Number.isFinite(flexDays) ? Math.max(0, Number(flexDays)) : 0;
  if (days <= 0) return formatted;
  return locale.startsWith("it") ? `${formatted} ± ${days} giorni` : `${formatted} ± ${days} days`;
};

export function formatVoyageDateRange(
  voyage: Pick<Voyage, "status" | "start_date" | "end_date" | "start_date_flex_days" | "end_date_flex_days">,
  locale = "en-US"
): string | null {
  const start = formatVoyageDateWindow(voyage.start_date, voyage.start_date_flex_days, locale);
  const end = formatVoyageDateWindow(voyage.end_date, voyage.end_date_flex_days, locale);
  if (!start && !end) {
    return hasVoyageDatesTbd(voyage) ? (locale.startsWith("it") ? "Da definirsi" : "Dates TBD") : null;
  }
  if (start && end) return `${start} → ${end}`;
  return start || end;
}

/** Per elenchi: più recente = fine viaggio, altrimenti inizio, poi ultimo aggiornamento. */
export function getVoyageRecencyMillis(
  voyage: Pick<Voyage, "end_date" | "start_date" | "updated_at" | "created_at"> | null | undefined
): number {
  if (!voyage || typeof voyage !== "object") return 0;
  const parse = (s: string | null | undefined): number => {
    if (s == null || typeof s !== "string" || !s.trim()) return 0;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  };
  return (
    parse(voyage.end_date) ||
    parse(voyage.start_date) ||
    parse(voyage.updated_at) ||
    parse(voyage.created_at)
  );
}

export function formatWaypointMoment(
  waypoint: Pick<VoyageWaypoint, "event_date" | "event_time" | "date_start" | "date_end">,
  locale = "en-US"
): string | null {
  const eventDate = formatIsoDate(waypoint.event_date, locale);
  if (eventDate) {
    const eventTime = waypoint.event_time?.slice(0, 5);
    return eventTime ? `${eventDate} · ${eventTime}` : eventDate;
  }

  const start = formatIsoDate(waypoint.date_start, locale);
  const end = formatIsoDate(waypoint.date_end, locale);
  if (start && end) return start === end ? start : `${start} → ${end}`;
  return start || end;
}

function formatStopDurationHours(hours: number, lang: Language): string {
  const italian = lang === "it";
  if (hours >= 20) {
    const days = Math.max(1, Math.round(hours / 24));
    return italian ? `${days} ${days === 1 ? "giorno" : "giorni"}` : `${days} ${days === 1 ? "day" : "days"}`;
  }
  const roundedHours = Math.max(1, Math.round(hours));
  return italian ? `${roundedHours} ${roundedHours === 1 ? "ora" : "ore"}` : `${roundedHours} ${roundedHours === 1 ? "hour" : "hours"}`;
}

/**
 * Durata prevista della sosta a un waypoint, per la pagina pubblica della rotta.
 * Preferisce la differenza reale tra `date_end` (arrivo) e `date_start` (ripartenza,
 * nomenclatura storica invertita: vedi AdminVoyageManager); in assenza di date esplicite
 * ripiega su stop_mode/stop_nights/stop_hours. Usare solo quando manca un actual: vedi
 * `formatWaypointActualStopDuration`, che ha sempre la precedenza quando l'equipaggio
 * ha registrato sia l'arrivo che la ripartenza.
 */
export function formatWaypointStopDuration(
  waypoint: Pick<VoyageWaypoint, "date_start" | "date_end" | "stop_mode" | "stop_hours" | "stop_nights">,
  lang: Language
): string | null {
  const italian = lang === "it";
  const arrivalMs = waypoint.date_end ? Date.parse(waypoint.date_end) : NaN;
  const departureMs = waypoint.date_start ? Date.parse(waypoint.date_start) : NaN;

  if (Number.isFinite(arrivalMs) && Number.isFinite(departureMs) && departureMs > arrivalMs) {
    return formatStopDurationHours((departureMs - arrivalMs) / 3_600_000, lang);
  }

  if (waypoint.stop_mode === "nights" && waypoint.stop_nights) {
    const nights = waypoint.stop_nights;
    return italian ? `${nights} ${nights === 1 ? "giorno" : "giorni"}` : `${nights} ${nights === 1 ? "day" : "days"}`;
  }
  if (waypoint.stop_mode === "hours" && waypoint.stop_hours) {
    const hours = waypoint.stop_hours;
    return italian ? `${hours} ${hours === 1 ? "ora" : "ore"}` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return null;
}

/**
 * Durata REALE della sosta, quando l'equipaggio ha registrato sia l'arrivo che la
 * ripartenza (`actual_arrival_at`/`actual_departure_at`, vedi lib/voyage-schedule.ts).
 * Quello che è successo davvero batte sempre la stima pianificata.
 */
export function formatWaypointActualStopDuration(
  waypoint: Pick<VoyageWaypoint, "actual_arrival_at" | "actual_departure_at">,
  lang: Language
): string | null {
  const hours = getActualStopHours(waypoint);
  return hours == null ? null : formatStopDurationHours(hours, lang);
}

/**
 * Durata sosta finora, quando l'arrivo è stato registrato ma non ancora la
 * ripartenza: usa la finestra di partenza pianificata (piano o tratta) come
 * stima migliore disponibile, finché un actual_departure_at reale non chiude
 * la sosta per davvero (a quel punto vince `formatWaypointActualStopDuration`).
 */
export function formatWaypointOngoingStopDuration(
  actualArrivalAt: string | null | undefined,
  plannedDepartureAt: string | null | undefined,
  lang: Language
): string | null {
  if (!actualArrivalAt || !plannedDepartureAt) return null;
  const arrivalMs = Date.parse(actualArrivalAt);
  const departureMs = Date.parse(plannedDepartureAt);
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(departureMs) || departureMs <= arrivalMs) return null;
  return formatStopDurationHours((departureMs - arrivalMs) / 3_600_000, lang);
}

export function buildWaypointDefaultLocalizedNames(
  _index: number,
  lat: number,
  lng: number,
  placeName?: string | null,
  placeByLang?: { it: string | null; en: string | null } | null
): Record<Language, string> {
  const fallback = getWaypointFallbackName(_index);
  if (placeByLang) {
    return {
      it: placeByLang.it?.trim() || placeByLang.en?.trim() || placeName?.trim() || fallback,
      en: placeByLang.en?.trim() || placeByLang.it?.trim() || placeName?.trim() || fallback,
    };
  }
  const single = placeName?.trim() || fallback;
  return { it: single, en: single };
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

export interface VoyageWaypointPoi {
  name: string;
  description: string | null;
}

export interface VoyageWaypointActivity {
  name: string;
  description: string | null;
}

export interface VoyageWaypointAirport {
  name: string;
  iata: string | null;
  icao: string | null;
  distanceKm: number | null;
  lat: number | null;
  lng: number | null;
}

const normalizeNamedList = <T extends { name: string; description: string | null }>(
  value: unknown
): T[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<T>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) return [];
    return [{
      name: candidate.name,
      description: typeof candidate.description === "string" && candidate.description.trim() ? candidate.description : null,
    } as T];
  });
};

export const normalizeWaypointPoi = (value: unknown): VoyageWaypointPoi[] => normalizeNamedList<VoyageWaypointPoi>(value);

export const normalizeWaypointActivities = (value: unknown): VoyageWaypointActivity[] => normalizeNamedList<VoyageWaypointActivity>(value);

export const normalizeWaypointAirports = (value: unknown): VoyageWaypointAirport[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<VoyageWaypointAirport>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) return [];
    return [{
      name: candidate.name,
      iata: typeof candidate.iata === "string" && candidate.iata.trim() ? candidate.iata : null,
      icao: typeof candidate.icao === "string" && candidate.icao.trim() ? candidate.icao : null,
      distanceKm: typeof candidate.distanceKm === "number" && Number.isFinite(candidate.distanceKm) ? candidate.distanceKm : null,
      lat: typeof candidate.lat === "number" && Number.isFinite(candidate.lat) ? candidate.lat : null,
      lng: typeof candidate.lng === "number" && Number.isFinite(candidate.lng) ? candidate.lng : null,
    }];
  });
};

export function getWaypointEffectiveType(
  waypoint: {
    visibility_mode?: VoyageWaypoint["visibility_mode"];
    waypoint_type?: VoyageWaypoint["waypoint_type"];
    planned_stop_duration_minutes?: number | null;
    stop_mode?: "legacy" | "hours" | "nights" | null;
    stop_hours?: number | null;
    stop_nights?: number | null;
  },
  index: number,
  total: number
): "technical" | "narrative" {
  if (waypoint.visibility_mode === "manual") {
    return waypoint.waypoint_type === "narrative" ? "narrative" : "technical";
  }

  if (
    Number(waypoint.planned_stop_duration_minutes ?? 0) > 0 ||
    (waypoint.stop_mode === "hours" && Number(waypoint.stop_hours ?? 0) > 0) ||
    (waypoint.stop_mode === "nights" && Number(waypoint.stop_nights ?? 0) > 0)
  ) {
    return "narrative";
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

export const getArticleWaypointRange = (
  article: Pick<GeoArticle, "voyage_segment_start" | "voyage_segment_end">
) => {
  if (article.voyage_segment_start == null && article.voyage_segment_end == null) return null;

  const start = article.voyage_segment_start ?? article.voyage_segment_end ?? 0;
  const end = article.voyage_segment_end ?? article.voyage_segment_start ?? start;
  return [Math.min(start, end), Math.max(start, end)] as const;
};

/**
 * Indici [lo, hi] nella lista waypoint ordinata (sort_order). Preferisce gli UUID se risolvibili,
 * così riordini/inserimenti non rompono il legame rispetto ai soli voyage_segment_*.
 */
export function resolveArticleRouteRange(
  article: Pick<
    GeoArticle,
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >,
  waypoints: Pick<VoyageWaypoint, "id">[]
): readonly [number, number] | null {
  const n = waypoints.length;
  if (n === 0) return null;

  const clampIdx = (value: number) => Math.max(0, Math.min(value, n - 1));

  const startId = article.voyage_waypoint_start_id?.trim() || null;
  const endId = article.voyage_waypoint_end_id?.trim() || null;
  const idxStart = startId ? waypoints.findIndex((w) => w.id === startId) : -1;
  const idxEnd = endId ? waypoints.findIndex((w) => w.id === endId) : -1;

  if (idxStart >= 0 && idxEnd >= 0) {
    const lo = clampIdx(Math.min(idxStart, idxEnd));
    const hi = clampIdx(Math.max(idxStart, idxEnd));
    return [lo, hi] as const;
  }

  const pointAtStart = idxStart >= 0 && (!endId || endId === startId);
  const pointAtEndOnly = idxEnd >= 0 && !startId;
  if (pointAtStart || pointAtEndOnly) {
    const i = clampIdx(pointAtStart ? idxStart : idxEnd);
    return [i, i] as const;
  }

  const numeric = getArticleWaypointRange(article);
  if (!numeric) return null;
  const lo = clampIdx(Math.min(numeric[0], numeric[1]));
  const hi = clampIdx(Math.max(numeric[0], numeric[1]));
  return [lo, hi] as const;
}

export function getArticleVoyageFocus(
  article: Pick<
    GeoArticle,
    | "voyage_id"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >,
  orderedWaypoints?: Pick<VoyageWaypoint, "id">[]
): {
  voyageId: string | null;
  mode: "none" | "point" | "segment" | "voyage";
  startIndex: number | null;
  endIndex: number | null;
} {
  if (!article.voyage_id) {
    return {
      voyageId: null,
      mode: "none",
      startIndex: null,
      endIndex: null,
    };
  }

  const resolved =
    orderedWaypoints && orderedWaypoints.length > 0 ? resolveArticleRouteRange(article, orderedWaypoints) : null;
  const range = resolved ?? getArticleWaypointRange(article);
  if (!range) {
    return {
      voyageId: article.voyage_id,
      mode: "voyage",
      startIndex: null,
      endIndex: null,
    };
  }

  return {
    voyageId: article.voyage_id,
    mode: range[0] === range[1] ? "point" : "segment",
    startIndex: range[0],
    endIndex: range[1],
  };
}

const collectArticleLinkedWaypointIndexes = (
  articles: Pick<
    GeoArticle,
    | "voyage_id"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >[],
  voyageId: string | null | undefined,
  orderedWaypoints: Pick<VoyageWaypoint, "id">[]
) => {
  const linkedIndexes = new Set<number>();

  articles.forEach((article) => {
    if (!voyageId || article.voyage_id !== voyageId) return;
    const range = resolveArticleRouteRange(article, orderedWaypoints);
    if (!range) return;
    if (range[0] !== range[1]) return;
    linkedIndexes.add(range[0]);
  });

  return linkedIndexes;
};

export function getPublicVoyageWaypoints(
  waypoints: VoyageWaypoint[],
  articles: Pick<
    GeoArticle,
    | "voyage_id"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >[] = [],
  voyageId?: string | null
): VoyageWaypoint[] {
  const targetVoyageId = voyageId ?? waypoints[0]?.voyage_id ?? null;
  const articleLinkedIndexes = collectArticleLinkedWaypointIndexes(articles, targetVoyageId, waypoints);

  return waypoints.filter(
    (waypoint, index) =>
      getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative" || articleLinkedIndexes.has(index)
  );
}

/**
 * Tappe effettive: quelle davvero toccate. Esclude le "skipped" (previste ma
 * saltate); include le "added" (non previste, aggiunte a posteriori) oltre a
 * quelle "planned" invariate. È il filtro che alimenta mappa e geometria del
 * percorso reale — ortogonale a {@link getPublicVoyageWaypoints}, che filtra
 * per visibilità pubblica/tecnica.
 */
export function getActualVoyageWaypoints(waypoints: VoyageWaypoint[]): VoyageWaypoint[] {
  return waypoints.filter((waypoint) => waypoint.actual_status !== "skipped");
}

export function getAssociatedArticleForWaypoint<
  T extends Pick<
    GeoArticle,
    | "voyage_id"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >
>(
  articles: T[],
  voyageId: string | null | undefined,
  waypointIndex: number,
  orderedWaypoints: Pick<VoyageWaypoint, "id">[]
): T | null {
  for (const article of articles) {
    if (!voyageId || article.voyage_id !== voyageId) continue;
    const range = resolveArticleRouteRange(article, orderedWaypoints);
    if (!range) continue;
    if (range[0] === range[1] && waypointIndex === range[0]) return article;
  }

  return null;
}

export function getLocalizedArticleTitle(
  article: Pick<GeoArticle, "title_en" | "title_it">,
  lang: Language
): string {
  const en = article.title_en?.trim() || "";
  const it = article.title_it?.trim();
  if (lang === "it") return it || en;
  return en || it || "";
}

/** Etichetta posizione mostrata al pubblico: se l'articolo copre un leg (segmento), usa il waypoint di partenza. */
export function getArticleDisplayLocationLabel(
  article: Pick<
    GeoArticle,
    | "voyage_id"
    | "location_name"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >,
  waypointsMap: Record<string, VoyageWaypoint[]>,
  lang: Language
): string {
  const voyageId = article.voyage_id;
  if (!voyageId) return article.location_name?.trim() || "";
  const wps = waypointsMap[voyageId];
  if (!wps?.length) return article.location_name?.trim() || "";
  const range = resolveArticleRouteRange(article, wps);
  if (!range || range[0] === range[1]) return article.location_name?.trim() || "";
  const startWp = wps[range[0]];
  if (!startWp) return article.location_name?.trim() || "";
  return getLocalizedWaypointName(startWp, lang, range[0]);
}

/** Punti/segmenti nella legenda mappa per collegare articoli alle tappe visibili. */
export type VoyageLegendRouteBinding =
  | { kind: "point"; visibleIndex: number; articles: GeoArticle[] }
  | { kind: "edge"; edgeIndex: number; articles: GeoArticle[] }
  | { kind: "span"; fromVisible: number; toVisible: number; articles: GeoArticle[] };

export function buildVoyageLegendArticlePlan(
  voyageId: string,
  waypoints: VoyageWaypoint[],
  visibleWaypoints: VoyageWaypoint[],
  articles: GeoArticle[]
): {
  wholeVoyageArticles: GeoArticle[];
  routeBindings: VoyageLegendRouteBinding[];
  storyIds: string[];
} {
  const voyageArticles = articles.filter((article) => article.voyage_id === voyageId);
  const wholeVoyageArticles: GeoArticle[] = [];
  const pointMap = new Map<number, GeoArticle[]>();
  const edgeMap = new Map<number, GeoArticle[]>();
  const spanMap = new Map<string, GeoArticle[]>();
  const storyIdsSet = new Set<string>();

  const pushToIndexMap = (map: Map<number, GeoArticle[]>, key: number, article: GeoArticle) => {
    const list = map.get(key);
    if (list) list.push(article);
    else map.set(key, [article]);
  };

  const routeIndexOf = (wp: VoyageWaypoint) => waypoints.findIndex((w) => w.id === wp.id);
  const visRoutes = visibleWaypoints.map((w) => routeIndexOf(w));

  for (const article of voyageArticles) {
    if (article.story_id) storyIdsSet.add(article.story_id);

    const resolved = resolveArticleRouteRange(article, waypoints);
    if (!resolved) {
      wholeVoyageArticles.push(article);
      continue;
    }

    const lo = resolved[0];
    const hi = resolved[1];

    if (lo === hi) {
      const visIdx = visRoutes.findIndex((r) => r === lo);
      if (visIdx >= 0) pushToIndexMap(pointMap, visIdx, article);
      continue;
    }

    /** Segmento = tra due waypoint consecutivi nella lista visibile (ignora i tecnici nascosti). */
    let edgeHit = -1;
    for (let edge = 0; edge < visRoutes.length - 1; edge += 1) {
      const rA = visRoutes[edge]!;
      const rB = visRoutes[edge + 1]!;
      const visLo = Math.min(rA, rB);
      const visHi = Math.max(rA, rB);
      if (lo === visLo && hi === visHi) {
        edgeHit = edge;
        break;
      }
    }

    if (edgeHit >= 0) {
      pushToIndexMap(edgeMap, edgeHit, article);
      continue;
    }

    const inSpanIndexes = visibleWaypoints
      .map((_, visIdx) => visIdx)
      .filter((visIdx) => {
        const r = visRoutes[visIdx];
        return r >= lo && r <= hi;
      });

    if (inSpanIndexes.length === 0) continue;

    const vmin = Math.min(...inSpanIndexes);
    const vmax = Math.max(...inSpanIndexes);

    if (vmin === vmax) {
      pushToIndexMap(pointMap, vmin, article);
      continue;
    }

    const spanKey = `${String(vmin)}:${String(vmax)}`;
    const spanList = spanMap.get(spanKey);
    if (spanList) spanList.push(article);
    else spanMap.set(spanKey, [article]);
  }

  const routeBindings: VoyageLegendRouteBinding[] = [];
  for (const [visibleIndex, arts] of pointMap) {
    routeBindings.push({ kind: "point", visibleIndex, articles: arts });
  }
  for (const [edgeIndex, arts] of edgeMap) {
    routeBindings.push({ kind: "edge", edgeIndex, articles: arts });
  }
  for (const [key, arts] of spanMap) {
    const [fromS, toS] = key.split(":");
    const fromVisible = Number(fromS);
    const toVisible = Number(toS);
    routeBindings.push({ kind: "span", fromVisible, toVisible, articles: arts });
  }

  return {
    wholeVoyageArticles,
    routeBindings,
    storyIds: [...storyIdsSet],
  };
}

const lerpCoordinate = (from: [number, number], to: [number, number], amount: number): [number, number] => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
];

const getCoordinateDistance = ([ax, ay]: [number, number], [bx, by]: [number, number]) =>
  Math.hypot(ax - bx, ay - by);

const areCoordinatesNearlyEqual = (first: [number, number], second: [number, number], epsilon = 1e-6) =>
  Math.abs(first[0] - second[0]) <= epsilon && Math.abs(first[1] - second[1]) <= epsilon;

const clampWaypointIndex = (value: number, max: number) => Math.max(0, Math.min(value, max));

const appendRouteCoordinates = (
  accumulator: [number, number][],
  coordinates: [number, number][]
) => {
  coordinates.forEach((coordinate) => {
    const previous = accumulator[accumulator.length - 1];
    if (previous && areCoordinatesNearlyEqual(previous, coordinate)) return;
    accumulator.push(coordinate);
  });
};

export function getStraightVoyageGeometry(waypoints: { lat: number; lng: number }[]): [number, number][] {
  return waypoints.map((waypoint) => [waypoint.lng, waypoint.lat]);
}

export function buildPublicVoyageGeometry(
  waypoints: VoyageWaypoint[],
  type: VoyageType,
  articles: Pick<
    GeoArticle,
    | "voyage_id"
    | "voyage_segment_start"
    | "voyage_segment_end"
    | "voyage_waypoint_start_id"
    | "voyage_waypoint_end_id"
  >[] = [],
  voyageId?: string | null,
  cachedGeometry?: [number, number][] | null
): [number, number][] {
  if (type === "land") {
    return cachedGeometry && cachedGeometry.length >= 2 ? cachedGeometry : [];
  }

  const baseGeometry = cachedGeometry && cachedGeometry.length >= 2
    ? cachedGeometry
    : getStraightVoyageGeometry(waypoints);

  if (type !== "water" || waypoints.length < 3 || baseGeometry.length !== waypoints.length) {
    return baseGeometry;
  }

  const targetVoyageId = voyageId ?? waypoints[0]?.voyage_id ?? null;
  const articleLinkedIndexes = collectArticleLinkedWaypointIndexes(articles, targetVoyageId, waypoints);
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

/** Line coordinates for the public map: land uses cached road geometry when valid, else straight segments between waypoints. */
export function getVoyageMapLineStringCoordinates(
  voyage: Pick<Voyage, "id" | "type" | "cached_geometry">,
  waypoints: VoyageWaypoint[],
  articles: Parameters<typeof buildPublicVoyageGeometry>[2] = []
): [number, number][] {
  if (waypoints.length < 2) return [];

  const cached = voyage.cached_geometry?.coordinates;
  const validCached =
    Array.isArray(cached) &&
    cached.length >= 2 &&
    cached.every(
      (c) =>
        Array.isArray(c) &&
        c.length >= 2 &&
        Number.isFinite(Number(c[0])) &&
        Number.isFinite(Number(c[1]))
    );

  if (voyage.type === "land") {
    if (validCached) return cached as [number, number][];
    return getStraightVoyageGeometry(waypoints);
  }

  return buildPublicVoyageGeometry(
    waypoints,
    voyage.type,
    articles,
    voyage.id,
    validCached ? (cached as [number, number][]) : null
  );
}

const getNearestGeometryCoordinateIndex = (
  geometry: [number, number][],
  target: [number, number],
  fromIndex = 0
) => {
  let nearestIndex = fromIndex;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = fromIndex; index < geometry.length; index += 1) {
    const distance = getCoordinateDistance(geometry[index], target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
};

export function buildVoyageSegmentGeometry(
  waypoints: VoyageWaypoint[],
  type: VoyageType,
  startIndex: number,
  endIndex: number,
  cachedGeometry?: [number, number][] | null
): [number, number][] {
  if (!waypoints.length) return [];

  const safeStart = clampWaypointIndex(startIndex, waypoints.length - 1);
  const safeEnd = clampWaypointIndex(endIndex, waypoints.length - 1);
  const segmentStart = Math.min(safeStart, safeEnd);
  const segmentEnd = Math.max(safeStart, safeEnd);
  const segmentWaypoints = waypoints.slice(segmentStart, segmentEnd + 1);
  if (segmentWaypoints.length < 2) return [];

  if (type === "land") {
    if (!cachedGeometry || cachedGeometry.length < 2) return [];

    const startCoordinate: [number, number] = [waypoints[safeStart].lng, waypoints[safeStart].lat];
    const endCoordinate: [number, number] = [waypoints[safeEnd].lng, waypoints[safeEnd].lat];
    const cachedStartIndex = getNearestGeometryCoordinateIndex(cachedGeometry, startCoordinate);
    const cachedEndIndex = getNearestGeometryCoordinateIndex(cachedGeometry, endCoordinate);

    if (cachedStartIndex === cachedEndIndex) return [];

    const slicedGeometry = cachedGeometry.slice(
      Math.min(cachedStartIndex, cachedEndIndex),
      Math.max(cachedStartIndex, cachedEndIndex) + 1
    );

    return slicedGeometry.length >= 2
      ? (safeStart <= safeEnd ? slicedGeometry : [...slicedGeometry].reverse())
      : [];
  }

  if (type === "water" && cachedGeometry && cachedGeometry.length >= 2) {
    const startCoordinate: [number, number] = [waypoints[safeStart].lng, waypoints[safeStart].lat];
    const endCoordinate: [number, number] = [waypoints[safeEnd].lng, waypoints[safeEnd].lat];
    const cachedStartIndex = getNearestGeometryCoordinateIndex(cachedGeometry, startCoordinate);
    const cachedEndIndex = getNearestGeometryCoordinateIndex(cachedGeometry, endCoordinate);

    if (cachedStartIndex === cachedEndIndex) return [];

    const slicedGeometry = cachedGeometry.slice(
      Math.min(cachedStartIndex, cachedEndIndex),
      Math.max(cachedStartIndex, cachedEndIndex) + 1
    );

    return slicedGeometry.length >= 2
      ? (safeStart <= safeEnd ? slicedGeometry : [...slicedGeometry].reverse())
      : [];
  }

  return buildPublicVoyageGeometry(segmentWaypoints, type, []);
}

/**
 * Index of the last waypoint reached by an unbroken chain of recorded arrivals
 * counting from the start (0 if none). Only the route up to this waypoint has
 * actually been travelled — admin actuals (`actual_arrival_at`, see
 * lib/voyage-schedule.ts) are the source of truth, not the voyage's own status,
 * so an "active" voyage that just started must not render as fully travelled.
 */
export function getVoyageTravelledWaypointIndex(waypoints: VoyageWaypoint[]): number {
  let index = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const waypoint = waypoints[i];
    // A skipped/added stop never gets its own actual_arrival_at (it isn't a booking-leg
    // endpoint, see set_voyage_waypoint_actual_status), so it must not block the chain —
    // nor does a "technical" waypoint (route shape only, no public stop): it is never a
    // booking-leg endpoint either, so it never receives its own actual_arrival_at. Only an
    // unreached *narrative* (real, public) stop blocks progress.
    const isCorrection = waypoint?.actual_status === "skipped" || waypoint?.actual_status === "added";
    const isTechnical = getWaypointEffectiveType(waypoint, i, waypoints.length) === "technical";
    if (!isCorrection && !isTechnical && !waypoint?.actual_arrival_at) break;
    index = i;
  }
  return index;
}

export type VoyageBoatPosition =
  | { status: "docked"; lat: number; lng: number; waypointId: string }
  | {
      status: "in-transit";
      lat: number;
      lng: number;
      fromWaypointId: string;
      toWaypointId: string;
      /** 0..1, elapsed real time vs. planned duration of this leg. See getVoyageBoatPosition. */
      fraction: number;
    };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Distance-weighted point at `fraction` (0..1) along a coordinate path. */
function pointAtFractionAlong(coordinates: [number, number][], fraction: number): [number, number] | null {
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return coordinates[0];

  const segmentLengths = coordinates.slice(1).map((coordinate, index) => {
    const [previousLng, previousLat] = coordinates[index];
    const [lng, lat] = coordinate;
    return haversineNM(previousLat, previousLng, lat, lng);
  });
  const total = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return coordinates[0];

  const target = clamp01(fraction) * total;
  let travelled = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (travelled + segmentLength >= target) {
      const amount = segmentLength === 0 ? 0 : (target - travelled) / segmentLength;
      return lerpCoordinate(coordinates[index], coordinates[index + 1], amount);
    }
    travelled += segmentLength;
  }
  return coordinates[coordinates.length - 1];
}

/**
 * Where the boat is right now on an active voyage, derived from the actuals staff already
 * record via the "parti ora"/"arriva ora" buttons (lib/voyage-schedule.ts) — no manual pin,
 * no live-GPS source yet. Only meaningful while the voyage is "active": a planned voyage
 * hasn't left, a completed one is done travelling.
 *
 * Mirrors the "does this stop block progress" rule getVoyageTravelledWaypointIndex already
 * uses (skipped/added corrections and technical route-shape points never need their own
 * actual_arrival_at) so the two stay consistent about which stops are real leg endpoints.
 */
export function getVoyageBoatPosition(
  voyage: Pick<Voyage, "type" | "cached_geometry" | "status">,
  waypoints: VoyageWaypoint[],
  now: Date = new Date()
): VoyageBoatPosition | null {
  if (voyage.status !== "active") return null;

  const actualWps = getActualVoyageWaypoints(waypoints);
  const legEndpoints = actualWps
    .map((waypoint, index) => ({ waypoint, index }))
    .filter(({ waypoint, index }) => {
      const isCorrection = waypoint.actual_status === "skipped" || waypoint.actual_status === "added";
      const isTechnical = getWaypointEffectiveType(waypoint, index, actualWps.length) === "technical";
      return !isCorrection && !isTechnical;
    });

  if (legEndpoints.length === 0) return null;
  if (legEndpoints.length === 1) {
    const only = legEndpoints[0].waypoint;
    return { status: "docked", lat: only.lat, lng: only.lng, waypointId: only.id };
  }

  let currentLegStart = -1;
  for (let i = 0; i < legEndpoints.length - 1; i += 1) {
    if (!legEndpoints[i + 1].waypoint.actual_arrival_at) {
      currentLegStart = i;
      break;
    }
  }

  if (currentLegStart === -1) {
    // Every leg is closed: stay docked at the final stop.
    const last = legEndpoints[legEndpoints.length - 1].waypoint;
    return { status: "docked", lat: last.lat, lng: last.lng, waypointId: last.id };
  }

  const origin = legEndpoints[currentLegStart];
  const dest = legEndpoints[currentLegStart + 1];

  if (!origin.waypoint.actual_departure_at) {
    return { status: "docked", lat: origin.waypoint.lat, lng: origin.waypoint.lng, waypointId: origin.waypoint.id };
  }

  const departureMs = Date.parse(origin.waypoint.actual_departure_at);
  const etaMs = dest.waypoint.date_end ? Date.parse(dest.waypoint.date_end) : NaN;
  const fraction =
    Number.isFinite(departureMs) && Number.isFinite(etaMs) && etaMs > departureMs
      ? clamp01((now.getTime() - departureMs) / (etaMs - departureMs))
      : 0.5;

  const cachedGeometry = voyage.cached_geometry?.coordinates ?? null;
  let segmentCoordinates = buildVoyageSegmentGeometry(
    actualWps,
    voyage.type,
    origin.index,
    dest.index,
    cachedGeometry
  );
  if (segmentCoordinates.length < 2) {
    segmentCoordinates = [
      [origin.waypoint.lng, origin.waypoint.lat],
      [dest.waypoint.lng, dest.waypoint.lat],
    ];
  }

  const point = pointAtFractionAlong(segmentCoordinates, fraction) ?? [dest.waypoint.lng, dest.waypoint.lat];

  return {
    status: "in-transit",
    lat: point[1],
    lng: point[0],
    fromWaypointId: origin.waypoint.id,
    toWaypointId: dest.waypoint.id,
    fraction,
  };
}

/** getVoyageBoatPosition for every active voyage, keyed by voyage id. */
export function getFleetBoatPositions(
  voyages: Pick<Voyage, "id" | "type" | "cached_geometry" | "status">[],
  waypointsMap: Record<string, VoyageWaypoint[]>
): Record<string, VoyageBoatPosition> {
  const positions: Record<string, VoyageBoatPosition> = {};
  for (const voyage of voyages) {
    if (voyage.status !== "active") continue;
    const position = getVoyageBoatPosition(voyage, waypointsMap[voyage.id] || []);
    if (position) positions[voyage.id] = position;
  }
  return positions;
}

export type VoyageGeometryBuildOptions = {
  /**
   * When true with type water, auto-route each tratta: BRouter's river profile where a
   * navigable waterway connects the two waypoints, otherwise a straight sea chord bulged around
   * any land it would cross. When false/omitted, water geometry is a straight chord throughout
   * (manual override for when the heuristic gets a voyage wrong).
   */
  waterwayAutoroute?: boolean;
};

/**
 * The single-request full-chain reply from fetchBRouterWaterwayRoute can silently beeline
 * straight across land for a via pair its river-profile graph can't actually connect, instead
 * of failing the whole request the way a single out-of-graph point normally would. Each gap
 * shows up as zero routing detail between two consecutive input waypoints (BRouter gives every
 * real river/coastal stretch several intermediate points); those gaps are patched with the same
 * open-sea land-avoidance the per-segment fallback below already uses — it only ever changes a
 * straight chord that actually crosses land, so a genuinely fine open-sea gap is left untouched.
 */
async function patchWaterwayBeelines(
  coordinates: [number, number][],
  waypoints: { lat: number; lng: number }[]
): Promise<[number, number][]> {
  const patched: [number, number][] = [];
  let searchFrom = 0;

  for (let index = 1; index < waypoints.length; index += 1) {
    const startWaypoint = waypoints[index - 1];
    const endWaypoint = waypoints[index];
    const startIndex = getNearestGeometryCoordinateIndex(
      coordinates,
      [startWaypoint.lng, startWaypoint.lat],
      searchFrom
    );
    const endIndex = getNearestGeometryCoordinateIndex(
      coordinates,
      [endWaypoint.lng, endWaypoint.lat],
      startIndex
    );

    const straightDistanceKm = haversineNM(startWaypoint.lat, startWaypoint.lng, endWaypoint.lat, endWaypoint.lng) * 1.852;
    if (endIndex - startIndex <= 1 && straightDistanceKm >= MIN_LAND_CHECK_KM) {
      appendRouteCoordinates(patched, await buildSeaSegmentGeometry(startWaypoint, endWaypoint));
    } else {
      appendRouteCoordinates(patched, coordinates.slice(startIndex, endIndex + 1));
    }
    searchFrom = endIndex;
  }

  return patched.length >= 2 ? patched : coordinates;
}

export async function buildVoyageGeometry(
  waypoints: { lat: number; lng: number }[],
  type: VoyageType,
  options?: VoyageGeometryBuildOptions
): Promise<[number, number][]> {
  if (waypoints.length < 2) return getStraightVoyageGeometry(waypoints);

  const useWaterwayRouting = type === "water" && Boolean(options?.waterwayAutoroute);
  if (type !== "land" && !useWaterwayRouting) return getStraightVoyageGeometry(waypoints);

  const snappedWaypointCache = new Map<string, { lat: number; lng: number }>();
  const getSnappedWaypoint = async (waypoint: { lat: number; lng: number }) => {
    const cacheKey = `${waypoint.lat.toFixed(6)},${waypoint.lng.toFixed(6)}`;
    const cached = snappedWaypointCache.get(cacheKey);
    if (cached) return cached;

    const snapped = await snapPointToNearestRoad(waypoint);
    const resolved = snapped ? { lat: snapped.lat, lng: snapped.lng } : waypoint;
    snappedWaypointCache.set(cacheKey, resolved);
    return resolved;
  };

  const fullRoute: [number, number][] = [];

  if (useWaterwayRouting) {
    // Primo tentativo: un'unica richiesta per tutta la catena (geometria migliore, 1 sola chiamata).
    const fullChain = await fetchBRouterWaterwayRoute(waypoints);
    if (fullChain?.coordinates?.length && fullChain.coordinates.length >= 2) {
      return await patchWaterwayBeelines(fullChain.coordinates, waypoints);
    }

    // Se la catena intera non è instradabile (un via è fuori dal grafo idrico, BRouter risponde 400
    // "no track found"), classifichiamo tratta per tratta: dove BRouter trova una via navigabile è
    // fiume/canale, altrove è mare aperto — e in quel caso la corda retta viene aggirata solo se
    // attraversa davvero della terra (vedi buildSeaSegmentGeometry).
    const waterwayRoute: [number, number][] = [];
    for (let index = 1; index < waypoints.length; index += 1) {
      const start = waypoints[index - 1];
      const end = waypoints[index];
      const segment = await fetchBRouterWaterwaySegment(start, end);
      const segmentCoordinates =
        segment?.coordinates && segment.coordinates.length >= 2
          ? segment.coordinates
          : await buildSeaSegmentGeometry(start, end);
      appendRouteCoordinates(waterwayRoute, segmentCoordinates);
    }

    return waterwayRoute.length >= 2 ? waterwayRoute : getStraightVoyageGeometry(waypoints);
  }

  for (let index = 1; index < waypoints.length; index += 1) {
    const start = waypoints[index - 1];
    const end = waypoints[index];
    const snappedStart = await getSnappedWaypoint(start);
    const snappedEnd = await getSnappedWaypoint(end);

    if (areCoordinatesNearlyEqual(
      [snappedStart.lng, snappedStart.lat],
      [snappedEnd.lng, snappedEnd.lat]
    )) {
      appendRouteCoordinates(fullRoute, [[snappedStart.lng, snappedStart.lat]]);
      appendRouteCoordinates(fullRoute, [[snappedEnd.lng, snappedEnd.lat]]);
      continue;
    }

    const routedSegment =
      await fetchOSRMRoute([snappedStart, snappedEnd]) ||
      await fetchOSRMRoute([start, end]);

    if (routedSegment?.geometry?.length) {
      appendRouteCoordinates(
        fullRoute,
        routedSegment.geometry.map(([lat, lng]) => [lng, lat] as [number, number])
      );
      continue;
    }

    appendRouteCoordinates(fullRoute, [
      [snappedStart.lng, snappedStart.lat],
      [snappedEnd.lng, snappedEnd.lat],
    ]);
  }

  return fullRoute.length >= 2 ? fullRoute : getStraightVoyageGeometry(waypoints);
}

export type VoyageType = "water" | "land";
export type VoyageStatus = "planned" | "active" | "completed";
export type VoyageGeometry = { type: "LineString"; coordinates: [number, number][] } | null;

export interface Voyage {
  id: string;
  name: string;
  name_en: string | null;
  name_it: string | null;
  /** Canonical / legacy fallback slug (always present). See slugForLang in lib/article-slug.ts. */
  slug: string;
  slug_en?: string | null;
  slug_it?: string | null;
  description: string;
  description_en: string | null;
  description_it: string | null;
  type: VoyageType;
  /**
   * When true (the default for water voyages) each tratta is auto-routed: river/canal via
   * BRouter or open sea bulged around land, whichever fits. False forces a plain straight chord
   * throughout — the manual override for when the heuristic misreads a voyage. Always shown as a
   * normal water voyage either way.
   */
  waterway_autoroute?: boolean;
  booking_enabled?: boolean;
  booking_max_guests?: number;
  booking_planning_speed_kn?: number;
  booking_contribution_per_nm_eur?: number;
  departure_window_start?: string | null;
  departure_window_end?: string | null;
  /** Derived cache maintained by the database; see lib/voyage-schedule.ts. */
  status: VoyageStatus;
  /** Forces {@link status}. Null means the derived value wins. */
  status_override?: VoyageStatus | null;
  is_published: boolean;
  sort_order: number;
  cached_geometry: VoyageGeometry;
  start_date: string | null;
  start_time: string | null;
  start_date_flex_days?: number | null;
  end_date: string | null;
  end_time: string | null;
  end_date_flex_days?: number | null;
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
  poi?: VoyageWaypointPoi[];
  activities?: VoyageWaypointActivity[];
  nearby_airports?: VoyageWaypointAirport[];
  planned_stop_duration_minutes?: number;
  stop_mode?: "legacy" | "hours" | "nights" | null;
  stop_hours?: number | null;
  stop_nights?: number | null;
  stop_departure_time?: string | null;
  date_start: string | null;
  date_end: string | null;
  /** Recorded "arriva ora" timestamp; see lib/voyage-schedule.ts. Null until the admin logs it. */
  actual_arrival_at?: string | null;
  /** Recorded "parti ora" timestamp; see lib/voyage-schedule.ts. Null until the admin logs it. */
  actual_departure_at?: string | null;
  /**
   * Tappe previste vs tappe effettive. "planned" (default): no correction. "skipped": planned
   * but not actually reached. "added": not part of the original plan, recorded only to show
   * what actually happened. Set via the live widget's route-correction modal; see
   * lib/waypoint-form.ts and the set_voyage_waypoint_actual_status RPC.
   */
  actual_status?: "planned" | "skipped" | "added";
  created_at: string;
  updated_at: string;
}

export interface GeoArticle {
  id: string;
  title_en: string;
  title_it: string | null;
  /** Slug canonico/legacy, sempre presente. Vedi slugForLang in lib/article-slug.ts. */
  slug: string;
  /**
   * Slug per lingua. Le query li restituiscono già (`select("*")`), ma il tipo
   * non li dichiarava: senza, articlePathForLang ripiegava sempre su `slug` e
   * una card italiana finiva per linkare l'indirizzo inglese. Restano opzionali
   * perché lo snapshot pubblico può non portarli, e in quel caso il fallback
   * su `slug` è il comportamento giusto.
   */
  slug_en?: string | null;
  slug_it?: string | null;
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
  voyage_waypoint_start_id?: string | null;
  voyage_waypoint_end_id?: string | null;
  location_name: string | null;
  category?: string | null;
  story_id?: string | null;
  authors?: { id: string; name: string; avatar_url: string | null }[];
  tags?: { id: string; name: string }[];
  likeCount?: number;
  viewCount?: number;
}

/**
 * Etichetta di un waypoint nei <select> admin ("Start", "WP 03 · Nome", "Arrival").
 * Prefisso posizionale + nome custom se presente. Usato dall'editor articoli
 * (pagina e pannello di associazione geo) — vive qui perché serve a entrambi.
 */
export function getWaypointOptionLabel(waypoint: VoyageWaypoint, index: number, total: number) {
  const customName = waypoint.name_en?.trim() || waypoint.name_it?.trim() || waypoint.name?.trim();
  const prefix = index === 0
    ? "Start"
    : index === total - 1
      ? "Arrival"
      : `WP ${String(index + 1).padStart(2, "0")}`;

  return customName ? `${prefix} · ${customName}` : prefix;
}
