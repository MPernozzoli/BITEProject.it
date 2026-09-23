import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bindMapToTheme,
  createThemedCartoStyle } from "@/lib/maplibre";
import { getBoatMarkerIconMarkup } from "@/lib/map-presence";
import type { Language } from "@/lib/language";
import type { VoyageBoatPosition } from "@/lib/voyage-utils";

interface VoyageRouteHeroMapProps {
  /** [lng, lat] pairs, in route order. */
  coordinates: [number, number][];
  className?: string;
  /** Derived boat position for this voyage, if any. See lib/voyage-utils.ts getVoyageBoatPosition. */
  boatPosition?: VoyageBoatPosition | null;
  /** Only used for the boat marker's tooltip text. */
  lang?: Language;
  /** Recorded route from confirmed GPX tracks ([lng, lat] runs); drawn over the planned line. */
  actualTrack?: [number, number][][];
}

// Close enough to a route endpoint (~1km) to just recolor that dot instead of adding a
// second, overlapping marker on top of it.
const ROUTE_END_TOLERANCE_DEG = 0.01;

const isNearCoordinate = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) <= ROUTE_END_TOLERANCE_DEG && Math.abs(a[1] - b[1]) <= ROUTE_END_TOLERANCE_DEG;

/** Decorative, non-interactive route map used as a voyage page hero background. */
const VoyageRouteHeroMap = ({ coordinates, className, boatPosition = null, lang = "it", actualTrack }: VoyageRouteHeroMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boatMarkerRef = useRef<maplibregl.Marker | null>(null);
  const boatPositionRef = useRef(boatPosition);
  boatPositionRef.current = boatPosition;
  const langRef = useRef(lang);
  langRef.current = lang;
  const syncBoatRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current || coordinates.length < 2) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createThemedCartoStyle(),
      center: coordinates[0],
      zoom: 4,
      attributionControl: false,
      interactive: false,
    });

    // La basemap segue il tema anche se cambia a mappa aperta.
    bindMapToTheme(map);
    mapRef.current = map;

    const startCoord = coordinates[0];
    const endCoord = coordinates[coordinates.length - 1];

    // A docked boat right at the route's start/end just recolors that existing dot; anywhere
    // else (mid-route stop, or in transit) gets its own small marker instead.
    const computeRouteEndsData = () => {
      const position = boatPositionRef.current;
      const dockedAtStart =
        position?.status === "docked" && isNearCoordinate([position.lng, position.lat], startCoord);
      const dockedAtEnd =
        position?.status === "docked" && isNearCoordinate([position.lng, position.lat], endCoord);
      return {
        type: "FeatureCollection" as const,
        features: [
          { type: "Feature" as const, properties: { isBoat: dockedAtStart }, geometry: { type: "Point" as const, coordinates: startCoord } },
          { type: "Feature" as const, properties: { isBoat: dockedAtEnd }, geometry: { type: "Point" as const, coordinates: endCoord } },
        ],
      };
    };

    const updateBoatState = () => {
      const position = boatPositionRef.current;
      const endsData = computeRouteEndsData();
      const endsSource = map.getSource("route-ends") as maplibregl.GeoJSONSource | undefined;
      endsSource?.setData(endsData);

      const isAtRecoloredEnd = endsData.features.some((feature) => feature.properties.isBoat);
      const needsOwnMarker = position != null && !isAtRecoloredEnd;

      if (!needsOwnMarker) {
        boatMarkerRef.current?.remove();
        boatMarkerRef.current = null;
        return;
      }

      if (!boatMarkerRef.current) {
        const element = document.createElement("div");
        element.className = "voyage-boat-marker";
        element.innerHTML = `
          <span class="voyage-boat-marker__halo" aria-hidden="true"></span>
          <span class="voyage-boat-marker__chip" aria-hidden="true">${getBoatMarkerIconMarkup()}</span>
        `;
        boatMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" });
      }
      boatMarkerRef.current.getElement().title =
        position!.status === "in-transit"
          ? langRef.current === "it" ? "In navigazione" : "Under way"
          : langRef.current === "it" ? "Barca" : "Boat";
      boatMarkerRef.current.setLngLat([position!.lng, position!.lat]).addTo(map);
    };

    syncBoatRef.current = updateBoatState;

    map.once("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1f5c5c", "line-width": 3, "line-opacity": 0.85 },
      });
      map.addSource("route-ends", {
        type: "geojson",
        data: computeRouteEndsData(),
      });
      map.addLayer({
        id: "route-ends-dot",
        type: "circle",
        source: "route-ends",
        paint: {
          "circle-radius": ["case", ["get", "isBoat"], 7, 5],
          "circle-color": ["case", ["get", "isBoat"], "hsl(38, 92%, 52%)", "#ffffff"],
          "circle-stroke-color": ["case", ["get", "isBoat"], "hsl(30, 82%, 42%)", "#1f5c5c"],
          "circle-stroke-width": 2,
        },
      });

      updateBoatState();

      const bounds = coordinates.reduce(
        (acc, coord) => acc.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
      );
      map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 10 });
      requestAnimationFrame(() => map.resize());
    });

    return () => {
      boatMarkerRef.current?.remove();
      boatMarkerRef.current = null;
      syncBoatRef.current = () => {};
      map.remove();
      mapRef.current = null;
    };
    // Coordinates identity only needs to trigger a rebuild on genuine content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(coordinates)]);

  useEffect(() => {
    syncBoatRef.current();
  }, [boatPosition, lang]);

  // Real route over the plan: planned line fades and dashes, the recording is drawn solid on top.
  const actualKey = JSON.stringify(actualTrack ?? []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const runs = (actualTrack ?? []).filter((run) => run.length > 1);
    const draw = () => {
      const data = {
        type: "FeatureCollection" as const,
        features: runs.map((run) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: run } })),
      };
      const source = map.getSource("actual-route") as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        map.addSource("actual-route", { type: "geojson", data });
        map.addLayer({
          id: "actual-route-line",
          type: "line",
          source: "actual-route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "hsl(24, 88%, 52%)", "line-width": 3, "line-opacity": 0.95 },
        }, "route-ends-dot");
      }
      if (map.getLayer("route-line")) {
        map.setPaintProperty("route-line", "line-opacity", runs.length ? 0.55 : 0.85);
        map.setPaintProperty("route-line", "line-dasharray", runs.length ? [1.5, 1.5] : [1, 0]);
      }
    };
    if (map.getLayer("route-ends-dot")) draw();
    else map.once("idle", draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualKey, JSON.stringify(coordinates)]);

  return (
    <div className={className} aria-hidden="true">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
};

export default VoyageRouteHeroMap;
