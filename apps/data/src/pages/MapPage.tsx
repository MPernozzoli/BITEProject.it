import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers, Filter } from "lucide-react";
import { useVoyages, useAllWaypoints } from "@/hooks/use-voyages";

const VOYAGE_COLORS = [
  "hsl(205, 55%, 48%)",
  "hsl(160, 40%, 45%)",
  "hsl(30, 60%, 50%)",
  "hsl(280, 40%, 55%)",
  "hsl(350, 50%, 50%)",
];

const MapPage = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const sourcesAdded = useRef(false);

  const { data: voyages = [] } = useVoyages();
  const { data: waypoints = [] } = useAllWaypoints();

  const waterVoyages = useMemo(() => voyages.filter(v => v.type === "water"), [voyages]);

  // Group waypoints by voyage
  const waypointsByVoyage = useMemo(() => {
    const map = new Map<string, typeof waypoints>();
    waypoints.forEach(wp => {
      const arr = map.get(wp.voyage_id) || [];
      arr.push(wp);
      map.set(wp.voyage_id, arr);
    });
    return map;
  }, [waypoints]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "carto-light": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          },
        },
        layers: [
          { id: "carto-light-layer", type: "raster", source: "carto-light", minzoom: 0, maxzoom: 20 },
        ],
      },
      center: [18, 39],
      zoom: 5.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => setMapLoaded(true));
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Add voyage data to map when ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || waterVoyages.length === 0 || sourcesAdded.current) return;
    sourcesAdded.current = true;

    // Add route lines per voyage
    waterVoyages.forEach((voyage, i) => {
      const vwps = waypointsByVoyage.get(voyage.id) || [];
      if (vwps.length < 2) return;

      const sorted = [...vwps].sort((a, b) => a.sort_order - b.sort_order);
      const coords = sorted.map(wp => [wp.lng, wp.lat] as [number, number]);
      const color = VOYAGE_COLORS[i % VOYAGE_COLORS.length];

      map.addSource(`route-${voyage.id}`, {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} },
      });

      map.addLayer({
        id: `route-line-${voyage.id}`,
        type: "line",
        source: `route-${voyage.id}`,
        paint: { "line-color": color, "line-width": 2.5, "line-opacity": 0.75 },
      });
    });

    // All waypoints as a single layer
    const features = waypoints
      .filter(wp => waterVoyages.some(v => v.id === wp.voyage_id))
      .map(wp => {
        const voyage = waterVoyages.find(v => v.id === wp.voyage_id);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [wp.lng, wp.lat] },
          properties: {
            name: wp.name_en || wp.name || "",
            voyage: voyage?.name_en || voyage?.name || "",
            type: wp.waypoint_type,
          },
        };
      });

    map.addSource("all-waypoints", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });

    map.addLayer({
      id: "waypoint-points",
      type: "circle",
      source: "all-waypoints",
      paint: {
        "circle-radius": 4,
        "circle-color": "hsl(192, 28%, 32%)",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fff",
      },
    });

    // Popup on click
    map.on("click", "waypoint-points", (e) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coords = feature.geometry.coordinates.slice() as [number, number];
      const props = feature.properties;

      new maplibregl.Popup({ offset: 12, className: "data-popup" })
        .setLngLat(coords)
        .setHTML(`
          <div style="font-family: 'DM Sans', sans-serif; padding: 4px 0;">
            <p style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">${props?.name || "Waypoint"}</p>
            <p style="font-size: 12px; color: #666;">Voyage: ${props?.voyage || "—"}</p>
            <p style="font-size: 12px; color: #666;">Type: ${props?.type || "—"}</p>
            <p style="font-size: 11px; color: #999; margin-top: 4px;">${coords[1].toFixed(4)}°N, ${coords[0].toFixed(4)}°E</p>
          </div>
        `)
        .addTo(map);
    });

    map.on("mouseenter", "waypoint-points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "waypoint-points", () => { map.getCanvas().style.cursor = ""; });

    // Fit bounds
    if (waypoints.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      waypoints.forEach(wp => bounds.extend([wp.lng, wp.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 10 });
    }
  }, [mapLoaded, waterVoyages, waypoints, waypointsByVoyage]);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="editorial-heading text-2xl text-foreground">Observation Map</h1>
          <p className="text-sm font-sans text-muted-foreground">
            {waterVoyages.length} voyages · {waypoints.length} waypoints
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <button className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors">
            <Layers size={14} /> Layers
          </button>
          <button className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors">
            <Filter size={14} /> Filter
          </button>
        </div>
      </div>

      <div className="flex-1 relative mx-4 mb-4 rounded-2xl overflow-hidden border border-border">
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-salt z-10">
            <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading map...</p>
          </div>
        )}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend */}
        <div className="absolute bottom-4 left-4 glass-panel rounded-xl p-3 z-10 max-w-[220px]">
          <p className="text-[10px] font-sans uppercase tracking-[0.15em] text-muted-foreground mb-2 font-medium">Voyages</p>
          <div className="space-y-1.5">
            {waterVoyages.map((v, i) => (
              <div key={v.id} className="flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: VOYAGE_COLORS[i % VOYAGE_COLORS.length] }} />
                <span className="text-[11px] font-sans text-muted-foreground truncate">{v.name_en || v.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-teal border-2 border-primary-foreground" />
              <span className="text-[11px] font-sans text-muted-foreground">Waypoint</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapPage;
