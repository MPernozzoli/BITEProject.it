import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bindMapToTheme,
  createThemedCartoStyle } from "@/lib/maplibre";

interface VoyageRouteHeroMapProps {
  /** [lng, lat] pairs, in route order. */
  coordinates: [number, number][];
  className?: string;
}

/** Decorative, non-interactive route map used as a voyage page hero background. */
const VoyageRouteHeroMap = ({ coordinates, className }: VoyageRouteHeroMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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
        data: {
          type: "FeatureCollection",
          features: [coordinates[0], coordinates[coordinates.length - 1]].map((coord) => ({
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: coord },
          })),
        },
      });
      map.addLayer({
        id: "route-ends-dot",
        type: "circle",
        source: "route-ends",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#1f5c5c",
          "circle-stroke-width": 2,
        },
      });

      const bounds = coordinates.reduce(
        (acc, coord) => acc.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
      );
      map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 10 });
      requestAnimationFrame(() => map.resize());
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Coordinates identity only needs to trigger a rebuild on genuine content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(coordinates)]);

  return (
    <div className={className} aria-hidden="true">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
};

export default VoyageRouteHeroMap;
