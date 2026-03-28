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

export type VoyageType = "water" | "land";
export type VoyageStatus = "planned" | "active" | "completed";

export interface Voyage {
  id: string;
  name: string;
  description: string;
  type: VoyageType;
  status: VoyageStatus;
  sort_order: number;
  cached_geometry: any;
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
}
