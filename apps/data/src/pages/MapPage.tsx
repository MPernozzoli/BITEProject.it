import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createCartoRasterStyle } from "@shared/maps/carto";
import MapControlPanel from "@/components/MapControlPanel";
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
import { buildVoyageUrl } from "@/lib/voyage-link";
import type { Voyage } from "@/hooks/use-voyages";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** ISO 8601 UTC to the second — the precision the logger actually reports. */
const isoUtc = (recordedAt: string) => new Date(recordedAt).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Human date for the popup badge; the exact ISO instant lives in the station module. */
const badgeDate = (recordedAt: string) =>
  new Date(recordedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const metaRow = (label: string, value: string) =>
  `<div style="display:flex;gap:8px;justify-content:space-between;">
    <span style="color:hsl(220 10% 48%);">${escapeHtml(label)}</span>
    <span style="color:hsl(220 28% 14%);font-weight:600;text-align:right;">${value}</span>
  </div>`;

/**
 * Built from the logbook's own popup classes (.voyage-popup*, defined in the shared
 * stylesheet) so a researcher landing here meets the same object they'd meet on
 * biteproject.it — and the voyage title is a way into its story, not a label.
 */
const buildPopupHtml = (
  observation: Observation,
  voyage: Voyage | null,
  accent: string,
  parameters: ObservationParameter[],
) => {
  const rows = parameters
    .map((p) => {
      const reading = observation.measurements[p.code];
      if (!reading) return null;
      const value =
        reading.value !== null && reading.value !== undefined
          ? `${formatValue(reading.value, p)} <span style="color:hsl(220 10% 48%);font-weight:500;">${escapeHtml(p.unit)}</span>`
          : escapeHtml(reading.text);
      // QC 1 = good is the expected case; only call out the readings that need judging.
      const qc =
        reading.qc === 1
          ? ""
          : `<span style="color:hsl(38 65% 38%);font-weight:600;"> · ${escapeHtml(QC_LABELS[reading.qc] ?? String(reading.qc))}</span>`;
      return `<tr>
        <td style="padding:3px 10px 3px 0;color:hsl(220 10% 48%);">${escapeHtml(p.label_en)}</td>
        <td style="padding:3px 0;color:hsl(220 28% 14%);font-weight:700;text-align:right;white-space:nowrap;">${value}${qc}</td>
      </tr>`;
    })
    .filter(Boolean)
    .join("");

  const simulated =
    observation.source === "simulated"
      ? `<section class="voyage-popup__module" style="border-color:hsl(38 65% 78%);background:hsl(38 80% 96%);padding:9px 11px;">
          <div style="color:hsl(38 70% 30%);font-size:10px;font-weight:750;letter-spacing:0.04em;line-height:1.35;">
            Simulated point — not a real measurement.
          </div>
        </section>`
      : "";

  const accuracy =
    observation.gps_accuracy_m !== null ? ` ±${escapeHtml(observation.gps_accuracy_m)} m` : "";

  const action = voyage
    ? `<div class="voyage-popup__actions">
        <a class="voyage-popup__action" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;"
           href="${escapeHtml(buildVoyageUrl(voyage))}" target="_blank" rel="noopener noreferrer">
          Read this voyage →
        </a>
      </div>`
    : "";

  return `<div class="voyage-popup" style="--voyage-popup-accent:${escapeHtml(accent)};">
    <div class="voyage-popup__header">
      <span class="voyage-popup__badge">${escapeHtml(badgeDate(observation.recorded_at))}</span>
      <div class="voyage-popup__title">${escapeHtml(voyage ? voyage.name_en || voyage.name : "Unattributed observation")}</div>
    </div>
    <div class="voyage-popup__body">
      ${simulated}
      <section class="voyage-popup__module voyage-popup__module--article">
        <div class="voyage-popup__module-kicker">Measurements</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">${rows}</table>
      </section>
      <section class="voyage-popup__module voyage-popup__module--booking">
        <div class="voyage-popup__module-kicker">Station</div>
        <div style="display:grid;gap:3px;font-size:10.5px;line-height:1.45;">
          ${metaRow("Recorded", escapeHtml(isoUtc(observation.recorded_at)))}
          ${metaRow("Position", `${observation.lat.toFixed(5)}, ${observation.lng.toFixed(5)}${accuracy}`)}
          ${metaRow("Position QC", escapeHtml(QC_LABELS[observation.qc_flag] ?? observation.qc_flag))}
          ${metaRow("Instrument", escapeHtml(observation.device_label ?? "unknown"))}
          ${observation.notes ? metaRow("Notes", escapeHtml(observation.notes)) : ""}
        </div>
      </section>
      ${action}
    </div>
  </div>`;
};

const MapPage = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const observationsById = useRef(new Map<string, Observation>());
  /** What the once-registered click handler needs; kept in a ref so it never goes stale. */
  const popupContext = useRef<{
    voyagesById: Map<string, Voyage>;
    voyageColors: Map<string, string>;
    parameters: ObservationParameter[];
  }>({ voyagesById: new Map(), voyageColors: new Map(), parameters: [] });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [routesReady, setRoutesReady] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [parameterCode, setParameterCode] = useState("all");

  const { data: voyages = [] } = useVoyages();
  const { data: parameters = [] } = useObservationParameters();
  const { data: observations = [], isLoading } = useObservations();

  // Only voyages that have actually happened or are happening: a planned route carries no
  // observations, so on a data map it is a promise, not a record.
  const waterVoyages = useMemo(
    () =>
      voyages
        .filter((v) => v.type === "water" && (v.status === "completed" || v.status === "active"))
        .sort((a, b) => a.sort_order - b.sort_order),
    [voyages],
  );
  // Colour follows the voyage, so it is assigned from the full sailed list rather than
  // from whatever survives the current filter.
  const voyageColors = useMemo(
    () => buildVoyageColorMap(waterVoyages.map((v) => v.id)),
    [waterVoyages],
  );
  const voyagesById = useMemo(() => {
    const map = new Map<string, Voyage>();
    waterVoyages.forEach((v) => map.set(v.id, v));
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

  useEffect(() => {
    popupContext.current = { voyagesById, voyageColors, parameters };
  }, [voyagesById, voyageColors, parameters]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createCartoRasterStyle(),
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

      // Registered once, so it must read its context from refs: closing over the render's
      // `parameters` would freeze the popup on whatever was loaded at map-init time.
      map.on("click", "observation-points", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const observation = id ? observationsById.current.get(id) : undefined;
        if (!observation) return;
        const voyage = observation.voyage_id
          ? (popupContext.current.voyagesById.get(observation.voyage_id) ?? null)
          : null;
        const accent = (voyage && popupContext.current.voyageColors.get(voyage.id)) || ROUTE_MUTED;
        new maplibregl.Popup({
          offset: 14,
          closeButton: true,
          closeOnClick: false,
          maxWidth: "340px",
          // The logbook's own popup shell, so the card matches biteproject.it exactly;
          // `observation-popup` only caps its height (see index.css).
          className: "voyage-waypoint-popup observation-popup",
        })
          .setLngLat([observation.lng, observation.lat])
          .setHTML(buildPopupHtml(observation, voyage, accent, popupContext.current.parameters))
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
  }, [mapLoaded, geojson]);

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
    // Full-bleed map with a floating control panel, matching the /logbook map: the data is
    // the surface, the controls hover over it rather than stacking above it.
    <div className="relative mx-3 mb-3 h-[calc(100dvh-7rem)] overflow-hidden rounded-[28px] border border-border md:mx-4 md:mb-4">
      {!mapLoaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-salt">
          <p className="text-sm font-sans text-muted-foreground animate-pulse">Loading map…</p>
        </div>
      )}
      {/* Sized explicitly, not with `absolute inset-0`: maplibre-gl.css stamps
          `position: relative` on .maplibregl-map at equal specificity but later in the
          bundle, which cancels the absolute positioning and collapses the map to 0px. */}
      <div ref={containerRef} className="h-full w-full" />

      <MapControlPanel
        isLoading={isLoading}
        pointCount={filtered.length}
        totalCount={observations.length}
        parameters={parameters}
        parameterCode={parameterCode}
        onSelectParameter={setParameterCode}
        scale={scale}
        years={years}
        activeYear={activeYear}
        isAllYears={isAll}
        onAllYears={() => {
          setFrom("");
          setTo("");
        }}
        onSelectYear={applyYear}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        voyages={waterVoyages}
        voyageColors={voyageColors}
      />
    </div>
  );
};

export default MapPage;
