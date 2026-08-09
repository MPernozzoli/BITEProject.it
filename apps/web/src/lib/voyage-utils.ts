import type { Language } from "@/lib/i18n";

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

/**
 * Durata prevista della sosta a un waypoint, per la pagina pubblica della rotta.
 * Preferisce la differenza reale tra `date_end` (arrivo) e `date_start` (ripartenza,
 * nomenclatura storica invertita: vedi AdminVoyageManager); in assenza di date esplicite
 * ripiega su stop_mode/stop_nights/stop_hours.
 */
export function formatWaypointStopDuration(
  waypoint: Pick<VoyageWaypoint, "date_start" | "date_end" | "stop_mode" | "stop_hours" | "stop_nights">,
  lang: Language
): string | null {
  const italian = lang === "it";
  const arrivalMs = waypoint.date_end ? Date.parse(waypoint.date_end) : NaN;
  const departureMs = waypoint.date_start ? Date.parse(waypoint.date_start) : NaN;

  if (Number.isFinite(arrivalMs) && Number.isFinite(departureMs) && departureMs > arrivalMs) {
    const hours = (departureMs - arrivalMs) / 3_600_000;
    if (hours >= 20) {
      const days = Math.max(1, Math.round(hours / 24));
      return italian ? `${days} ${days === 1 ? "giorno" : "giorni"}` : `${days} ${days === 1 ? "day" : "days"}`;
    }
    const roundedHours = Math.max(1, Math.round(hours));
    return italian ? `${roundedHours} ${roundedHours === 1 ? "ora" : "ore"}` : `${roundedHours} ${roundedHours === 1 ? "hour" : "hours"}`;
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
  target: [number, number]
) => {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  geometry.forEach((coordinate, index) => {
    const distance = getCoordinateDistance(coordinate, target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

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

export type VoyageGeometryBuildOptions = {
  /** When true with type water, use BRouter river profile between consecutive waypoints. */
  waterwayAutoroute?: boolean;
};

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
      return fullChain.coordinates;
    }

    // Se la catena intera non è instradabile (un via è fuori dal grafo idrico, BRouter risponde 400
    // "no track found"), NON buttiamo via tutta la rotta: instradiamo tratto per tratto, così solo i
    // segmenti senza via navigabile restano in linea retta — gli altri seguono comunque il canale/fiume.
    const waterwayRoute: [number, number][] = [];
    for (let index = 1; index < waypoints.length; index += 1) {
      const start = waypoints[index - 1];
      const end = waypoints[index];
      const segment = await fetchBRouterWaterwaySegment(start, end);
      if (segment?.coordinates && segment.coordinates.length >= 2) {
        appendRouteCoordinates(waterwayRoute, segment.coordinates);
      } else {
        appendRouteCoordinates(waterwayRoute, [
          [start.lng, start.lat],
          [end.lng, end.lat],
        ]);
      }
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
  description: string;
  description_en: string | null;
  description_it: string | null;
  type: VoyageType;
  /** When true with type water, geometry follows inland waterways (BRouter); still shown everywhere as a normal water voyage. Omitted = false. */
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
  created_at: string;
  updated_at: string;
}

export interface GeoArticle {
  id: string;
  title_en: string;
  title_it: string | null;
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
