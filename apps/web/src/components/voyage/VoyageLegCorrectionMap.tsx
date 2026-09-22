import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  bindMapToContainerResize,
  bindMapToTheme,
  createThemedCartoStyle,
  isMapLibreSupported,
  requestMapResize,
} from "@/lib/maplibre";
import type { GeocodedPlace } from "@/lib/voyage-utils";

export interface VoyageLegCorrectionMapAnchor {
  lat: number;
  lng: number;
  name: string;
}

export type VoyageLegCorrectionMapPlacementTarget = "narrative" | "technical" | null;

export interface VoyageLegCorrectionMapProps {
  fromAnchor: VoyageLegCorrectionMapAnchor;
  toAnchor: VoyageLegCorrectionMapAnchor;
  narrativePlace: GeocodedPlace | null;
  technicalPlaces: GeocodedPlace[];
  /** Non-null while a "place on the map" button is armed; the next click creates/moves that stop. */
  placementTarget: VoyageLegCorrectionMapPlacementTarget;
  onPlaceAt: (lat: number, lng: number) => void;
  onNarrativeMove: (lat: number, lng: number) => void;
  onTechnicalMove: (index: number, lat: number, lng: number) => void;
  lang: "it" | "en";
}

const NARRATIVE_MARKER_STYLE = `
  width:20px;height:20px;border-radius:50%;
  border:2.5px solid hsl(0,0%,100%);
  background:hsl(24,88%,52%);
  box-shadow:0 2px 8px rgba(15,23,42,0.32);
  cursor:grab;
`;

const TECHNICAL_MARKER_STYLE = `
  width:12px;height:12px;border-radius:50%;
  border:2px solid hsl(0,0%,100%);
  background:hsl(210,10%,46%);
  box-shadow:0 1px 6px rgba(15,23,42,0.28);
  cursor:grab;
`;

const ANCHOR_MARKER_STYLE = (color: string) => `
  width:14px;height:14px;border-radius:50%;
  border:2.5px solid ${color};
  background:hsl(0,0%,100%);
  box-shadow:0 1px 6px rgba(15,23,42,0.24);
`;

const copy = {
  it: {
    unavailable: "Mappa non disponibile su questo dispositivo.",
    hintIdle: "Trascina i pin per correggerne la posizione.",
    hintArmedNarrative: "Clicca sulla mappa per posizionare la tappa reale.",
    hintArmedTechnical: "Clicca sulla mappa per aggiungere una tappa tecnica.",
  },
  en: {
    unavailable: "Map not available on this device.",
    hintIdle: "Drag the pins to correct their position.",
    hintArmedNarrative: "Click the map to place the real stop.",
    hintArmedTechnical: "Click the map to add a technical stop.",
  },
} as const;

const VoyageLegCorrectionMap = ({
  fromAnchor,
  toAnchor,
  narrativePlace,
  technicalPlaces,
  placementTarget,
  onPlaceAt,
  onNarrativeMove,
  onTechnicalMove,
  lang,
}: VoyageLegCorrectionMapProps) => {
  const t = copy[lang];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fromMarkerRef = useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = useRef<maplibregl.Marker | null>(null);
  const narrativeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const technicalMarkerRefs = useRef<maplibregl.Marker[]>([]);
  const onPlaceAtRef = useRef(onPlaceAt);
  const onNarrativeMoveRef = useRef(onNarrativeMove);
  const onTechnicalMoveRef = useRef(onTechnicalMove);
  const placementTargetRef = useRef(placementTarget);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  onPlaceAtRef.current = onPlaceAt;
  onNarrativeMoveRef.current = onNarrativeMove;
  onTechnicalMoveRef.current = onTechnicalMove;
  placementTargetRef.current = placementTarget;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    if (!isMapLibreSupported()) {
      setMapUnavailable(true);
      return;
    }

    let map: maplibregl.Map | null = null;
    let cleanupResize: (() => void) | undefined;

    try {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend([fromAnchor.lng, fromAnchor.lat]);
      bounds.extend([toAnchor.lng, toAnchor.lat]);

      map = new maplibregl.Map({
        container: containerRef.current,
        style: createThemedCartoStyle(),
        center: bounds.getCenter(),
        zoom: 8,
        attributionControl: false,
      });

      bindMapToTheme(map);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        requestMapResize(map!);
        map!.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 0 });
      });
      map.on("click", (event) => {
        if (!placementTargetRef.current) return;
        onPlaceAtRef.current(event.lngLat.lat, event.lngLat.lng);
      });

      cleanupResize = bindMapToContainerResize(map, containerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize the leg correction map", error);
      setMapUnavailable(true);
    }

    return () => {
      cleanupResize?.();
      fromMarkerRef.current?.remove();
      toMarkerRef.current?.remove();
      narrativeMarkerRef.current?.remove();
      technicalMarkerRefs.current.forEach((marker) => marker.remove());
      technicalMarkerRefs.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // Runs once: the from/to anchors are fixed for the lifetime of this modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapUnavailable]);

  // Fixed context markers: where the boat departed from, and the next planned stop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!fromMarkerRef.current) {
      const element = document.createElement("div");
      element.style.cssText = ANCHOR_MARKER_STYLE("hsl(210,10%,46%)");
      element.title = fromAnchor.name;
      fromMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([fromAnchor.lng, fromAnchor.lat])
        .addTo(map);
    }
    if (!toMarkerRef.current) {
      const element = document.createElement("div");
      element.style.cssText = ANCHOR_MARKER_STYLE("hsl(0,72%,50%)");
      element.title = toAnchor.name;
      toMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([toAnchor.lng, toAnchor.lat])
        .addTo(map);
    }
  }, [fromAnchor, toAnchor]);

  // Reference line between the two anchors: context only, not the actual routed geometry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const sourceId = "leg-correction-reference-line";
      const data: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [fromAnchor.lng, fromAnchor.lat],
            [toAnchor.lng, toAnchor.lat],
          ],
        },
        properties: {},
      };

      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      if (!map.isStyleLoaded()) return;
      map.addSource(sourceId, { type: "geojson", data });
      map.addLayer({
        id: sourceId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round" },
        paint: {
          "line-color": "hsl(210,10%,55%)",
          "line-width": 1.5,
          "line-opacity": 0.55,
          "line-dasharray": [1.4, 1.6],
        },
      });
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [fromAnchor, toAnchor]);

  // The real (narrative) stop: one draggable marker, created/removed as it's set/cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!narrativePlace) {
      narrativeMarkerRef.current?.remove();
      narrativeMarkerRef.current = null;
      return;
    }

    if (!narrativeMarkerRef.current) {
      const element = document.createElement("div");
      element.style.cssText = NARRATIVE_MARKER_STYLE;
      element.title = narrativePlace.name;
      narrativeMarkerRef.current = new maplibregl.Marker({ element, anchor: "center", draggable: true })
        .setLngLat([narrativePlace.lng, narrativePlace.lat])
        .addTo(map);
      narrativeMarkerRef.current.on("dragend", () => {
        const position = narrativeMarkerRef.current?.getLngLat();
        if (position) onNarrativeMoveRef.current(position.lat, position.lng);
      });
    } else {
      narrativeMarkerRef.current.setLngLat([narrativePlace.lng, narrativePlace.lat]);
    }
  }, [narrativePlace]);

  // Technical (route-shape) stops: one small draggable marker per entry, kept in sync by index.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    technicalMarkerRefs.current.forEach((marker, index) => {
      if (index >= technicalPlaces.length) marker.remove();
    });
    technicalMarkerRefs.current = technicalMarkerRefs.current.slice(0, technicalPlaces.length);

    technicalPlaces.forEach((place, index) => {
      const existing = technicalMarkerRefs.current[index];
      if (existing) {
        existing.setLngLat([place.lng, place.lat]);
        return;
      }

      const element = document.createElement("div");
      element.style.cssText = TECHNICAL_MARKER_STYLE;
      element.title = place.name;
      const marker = new maplibregl.Marker({ element, anchor: "center", draggable: true })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const position = marker.getLngLat();
        if (position) onTechnicalMoveRef.current(index, position.lat, position.lng);
      });
      technicalMarkerRefs.current[index] = marker;
    });
  }, [technicalPlaces]);

  const hint = mapUnavailable
    ? t.unavailable
    : placementTarget === "narrative"
      ? t.hintArmedNarrative
      : placementTarget === "technical"
        ? t.hintArmedTechnical
        : t.hintIdle;

  return (
    <div className="space-y-1.5">
      {mapUnavailable ? (
        <div className="flex h-[220px] items-center justify-center rounded-[16px] border border-dashed border-border bg-muted/40 px-4 text-center text-xs text-muted-foreground font-sans">
          {t.unavailable}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="h-[220px] w-full overflow-hidden rounded-[16px] border border-border"
          style={placementTarget ? { cursor: "crosshair" } : undefined}
        />
      )}
      <p className="text-[11px] text-muted-foreground font-sans">{hint}</p>
    </div>
  );
};

export default VoyageLegCorrectionMap;
