import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useVoyages } from "@/hooks/use-voyages";
import {
  useObservationParameters,
  useObservations,
  type Observation,
  type ObservationParameter,
} from "@/hooks/use-observations";
import {
  buildValueScale,
  buildVoyageColorMap,
  formatValue,
  QC_LABELS,
  ROUTE_MUTED,
  valueScaleExpression,
} from "@/lib/observation-scale";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** ISO 8601 UTC to the second — the precision the logger actually reports. */
const isoUtc = (recordedAt: string) => new Date(recordedAt).toISOString().replace(/\.\d{3}Z$/, "Z");

const buildPopupHtml = (
  observation: Observation,
  voyageName: string | null,
  parameters: ObservationParameter[],
) => {
  const rows = parameters
    .map((p) => {
      const reading = observation.measurements[p.code];
      if (!reading) return null;
      const value =
        reading.value !== null && reading.value !== undefined
          ? `${formatValue(reading.value, p)} ${escapeHtml(p.unit)}`
          : escapeHtml(reading.text);
      const qc = QC_LABELS[reading.qc] ?? String(reading.qc);
      return `<tr>
        <td style="padding:2px 10px 2px 0;color:hsl(var(--muted-foreground));white-space:nowrap;">${escapeHtml(p.label_en)}</td>
        <td style="padding:2px 8px 2px 0;color:hsl(var(--foreground));font-weight:600;white-space:nowrap;">${value}</td>
        <td style="padding:2px 0;color:hsl(var(--fog));white-space:nowrap;">QC: ${escapeHtml(qc)}</td>
      </tr>`;
    })
    .filter(Boolean)
    .join("");

  const simulated =
    observation.source === "simulated"
      ? `<p style="margin:0 0 6px;padding:3px 6px;background:hsl(var(--data-amber) / 0.16);color:hsl(var(--data-amber) / 0.95);border-radius:calc(var(--radius) - 2px);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">Simulated — not a real measurement</p>`
      : "";

  const accuracy =
    observation.gps_accuracy_m !== null ? ` ±${escapeHtml(observation.gps_accuracy_m)} m` : "";

  return `<div style="font-family:var(--font-sans);min-width:250px;max-width:320px;">
    ${simulated}
    <p style="margin:0;font-size:13px;font-weight:600;color:hsl(var(--foreground));">${escapeHtml(isoUtc(observation.recorded_at))}</p>
    <p style="margin:2px 0 8px;font-size:11px;color:hsl(var(--muted-foreground));">
      ${escapeHtml(voyageName ?? "Not attributed to a voyage")}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">${rows}</table>
    <dl style="margin:8px 0 0;padding-top:6px;border-top:1px solid hsl(var(--border));font-size:10px;color:hsl(var(--fog));line-height:1.5;">
      <div>Position: ${observation.lat.toFixed(5)}, ${observation.lng.toFixed(5)}${accuracy}</div>
      <div>Position QC: ${escapeHtml(QC_LABELS[observation.qc_flag] ?? observation.qc_flag)}</div>
      <div>Instrument: ${escapeHtml(observation.device_label ?? "unknown")}${
        observation.device_code ? ` (${escapeHtml(observation.device_code)})` : ""
      }</div>
      ${observation.notes ? `<div>Notes: ${escapeHtml(observation.notes)}</div>` : ""}
    </dl>
  </div>`;
};

const MapPage = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const observationsById = useRef(new Map<string, Observation>());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [routesReady, setRoutesReady] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [parameterCode, setParameterCode] = useState("all");

  const { data: voyages = [] } = useVoyages();
  const { data: parameters = [] } = useObservationParameters();
  const { data: observations = [], isLoading } = useObservations();

  // Colour follows the voyage, so it is assigned from the full list rather than
  // from whatever survives the current filter.
  const waterVoyages = useMemo(
    () => voyages.filter((v) => v.type === "water").sort((a, b) => a.sort_order - b.sort_order),
    [voyages],
  );
  const voyageColors = useMemo(
    () => buildVoyageColorMap(waterVoyages.map((v) => v.id)),
    [waterVoyages],
  );
  const voyageNames = useMemo(() => {
    const map = new Map<string, string>();
    waterVoyages.forEach((v) => map.set(v.id, v.name_en || v.name));
    return map;
  }, [waterVoyages]);

  const years = useMemo(() => {
    const set = new Set<string>();
    observations.forEach((o) => set.add(o.recorded_at.slice(0, 4)));
    return [...set].sort();
  }, [observations]);

  const selectedParameter = useMemo(
    () => parameters.find((p) => p.code === parameterCode) ?? null,
    [parameters, parameterCode],
  );

  const filtered = useMemo(
    () =>
      observations.filter((o) => {
        const day = o.recorded_at.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        if (selectedParameter && !o.measurements[selectedParameter.code]) return false;
        return true;
      }),
    [observations, from, to, selectedParameter],
  );

  const scale = useMemo(
    () => (selectedParameter ? buildValueScale(selectedParameter, filtered) : null),
    [selectedParameter, filtered],
  );

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: filtered.map((o) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [o.lng, o.lat] },
        properties: {
          id: o.id,
          voyage_id: o.voyage_id ?? "",
          value: selectedParameter ? (o.measurements[selectedParameter.code]?.value ?? null) : null,
        },
      })),
    }),
    [filtered, selectedParameter],
  );

  useEffect(() => {
    observationsById.current = new Map(observations.map((o) => [o.id, o]));
  }, [observations]);

  // Init map
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
            attribution:
              '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          },
        },
        layers: [{ id: "carto-light-layer", type: "raster", source: "carto-light", minzoom: 0, maxzoom: 20 }],
      },
      center: [18, 39],
      zoom: 5.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => setMapLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      setRoutesReady(false);
    };
  }, []);

  // Routes: the estimated line from the logbook. Observations are real GPS fixes and are
  // not expected to sit on it, so the line is context only.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || waterVoyages.length === 0 || routesReady) return;

    waterVoyages.forEach((voyage) => {
      const geometry = voyage.cached_geometry as { type?: string; coordinates?: unknown } | null;
      if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return;

      const sourceId = `route-${voyage.id}`;
      if (map.getSource(sourceId)) return;

      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "Feature", geometry: geometry as GeoJSON.Geometry, properties: {} },
      });
      map.addLayer({
        id: `route-line-${voyage.id}`,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": voyageColors.get(voyage.id) ?? ROUTE_MUTED, "line-width": 2, "line-opacity": 0.7 },
      });
    });

    setRoutesReady(true);
  }, [mapLoaded, waterVoyages, voyageColors, routesReady]);

  // Observation layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!map.getSource("observations")) {
      map.addSource("observations", { type: "geojson", data: geojson });
      map.addLayer({
        id: "observation-points",
        type: "circle",
        source: "observations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 4, 12, 7],
          "circle-color": "#2a78d6",
          // A surface ring keeps overlapping points readable along a dense track.
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "observation-points", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const observation = id ? observationsById.current.get(id) : undefined;
        if (!observation) return;
        new maplibregl.Popup({ offset: 10, maxWidth: "340px", className: "data-popup" })
          .setLngLat([observation.lng, observation.lat])
          .setHTML(buildPopupHtml(observation, voyageNames.get(observation.voyage_id ?? "") ?? null, parameters))
          .addTo(map);
      });
      map.on("mouseenter", "observation-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "observation-points", () => {
        map.getCanvas().style.cursor = "";
      });
    } else {
      (map.getSource("observations") as maplibregl.GeoJSONSource).setData(geojson);
    }
  }, [mapLoaded, geojson, parameters, voyageNames]);

  // Colour: identity (voyage) with no parameter selected, magnitude once one is.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer("observation-points")) return;

    if (scale) {
      map.setPaintProperty("observation-points", "circle-color", valueScaleExpression(scale));
    } else {
      const match: unknown[] = ["match", ["get", "voyage_id"]];
      waterVoyages.forEach((v) => match.push(v.id, voyageColors.get(v.id)));
      match.push(ROUTE_MUTED);
      map.setPaintProperty("observation-points", "circle-color", match as never);
    }

    // Routes recede while the points carry a value scale.
    waterVoyages.forEach((v) => {
      const layerId = `route-line-${v.id}`;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, "line-color", scale ? ROUTE_MUTED : (voyageColors.get(v.id) ?? ROUTE_MUTED));
      map.setPaintProperty(layerId, "line-opacity", scale ? 0.35 : 0.7);
    });
  }, [mapLoaded, scale, waterVoyages, voyageColors, routesReady]);

  // Fit to the points once they arrive
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || observations.length === 0 || fitted.current) return;
    fitted.current = true;
    const bounds = new maplibregl.LngLatBounds();
    observations.forEach((o) => bounds.extend([o.lng, o.lat]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 9 });
  }, [mapLoaded, observations]);

  const applyYear = (year: string) => {
    setFrom(`${year}-01-01`);
    setTo(`${year}-12-31`);
  };
  const activeYear = years.find((y) => from === `${y}-01-01` && to === `${y}-12-31`) ?? null;
  const isAll = !from && !to;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="px-6 py-4">
        <h1 className="editorial-heading text-2xl text-foreground">Observation Map</h1>
        <p className="text-sm font-sans text-muted-foreground">
          {isLoading
            ? "Loading observations…"
            : `${filtered.length.toLocaleString()} of ${observations.length.toLocaleString()} sampling points · ${waterVoyages.length} voyages`}
        </p>
      </div>

      <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setFrom("");
            setTo("");
          }}
          className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${
            isAll ? "data-badge--active" : "data-badge text-muted-foreground hover:text-foreground"
          }`}
        >
          All years
        </button>
        {years.map((year) => (
          <button
            key={year}
            onClick={() => applyYear(year)}
            className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-all ${
              activeYear === year ? "data-badge--active" : "data-badge text-muted-foreground hover:text-foreground"
            }`}
          >
            {year}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <label className="text-xs font-sans text-muted-foreground">
          From{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="ml-1 px-2 py-1.5 bg-transparent border border-border rounded-lg text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-teal/30"
          />
        </label>
        <label className="text-xs font-sans text-muted-foreground">
          To{" "}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ml-1 px-2 py-1.5 bg-transparent border border-border rounded-lg text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-teal/30"
          />
        </label>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <label className="text-xs font-sans text-muted-foreground">
          Data type{" "}
          <select
            value={parameterCode}
            onChange={(e) => setParameterCode(e.target.value)}
            className="ml-1 px-2 py-1.5 bg-transparent border border-border rounded-lg text-xs font-sans text-foreground focus:outline-none focus:ring-1 focus:ring-teal/30"
          >
            <option value="all">All data types</option>
            {parameters.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label_en} ({p.unit})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 relative mx-4 mb-4 rounded-2xl overflow-hidden border border-border">
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-salt z-10">
            <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading map…</p>
          </div>
        )}
        {/* Sized explicitly, not with `absolute inset-0`: maplibre-gl.css stamps
            `position: relative` on .maplibregl-map at equal specificity but later in the
            bundle, which cancels the absolute positioning and collapses the map to 0px. */}
        <div ref={containerRef} className="h-full w-full" />

        <div className="absolute bottom-4 left-4 glass-panel rounded-xl p-3 z-10 max-w-[240px]">
          {scale && selectedParameter ? (
            <>
              <p className="text-[10px] font-sans uppercase tracking-[0.15em] text-muted-foreground mb-2 font-medium">
                {selectedParameter.label_en}
              </p>
              <div
                className="h-2.5 w-full rounded-full"
                style={{ background: `linear-gradient(to right, ${scale.stops.join(", ")})` }}
              />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] font-sans text-muted-foreground">
                  {formatValue(scale.min, selectedParameter)}
                </span>
                <span className="text-[10px] font-sans text-muted-foreground">
                  {selectedParameter.unit}
                </span>
                <span className="text-[10px] font-sans text-muted-foreground">
                  {formatValue(scale.max, selectedParameter)}
                </span>
              </div>
              {selectedParameter.accuracy && (
                <p className="text-[10px] font-sans text-muted-foreground/70 mt-2">
                  Accuracy {selectedParameter.accuracy}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[10px] font-sans uppercase tracking-[0.15em] text-muted-foreground mb-2 font-medium">
                Voyages
              </p>
              <div className="space-y-1.5">
                {waterVoyages.map((v) => (
                  <div key={v.id} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white"
                      style={{ backgroundColor: voyageColors.get(v.id) }}
                    />
                    <span className="text-[11px] font-sans text-muted-foreground truncate">
                      {v.name_en || v.name}
                    </span>
                  </div>
                ))}
              </div>
              {selectedParameter && (
                <p className="text-[10px] font-sans text-muted-foreground/70 mt-2">
                  {selectedParameter.label_en} is categorical — see the tooltip.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapPage;
