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

export interface TrackMapSegment {
  uid: string;
  color: string;
  /** Runs of [lng, lat], split at recording breaks. */
  runs: [number, number][][];
}

export interface TrackMapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "boundary" | "landmark" | "stop";
}

export interface VoyageTrackMapProps {
  planned: [number, number][];
  segments: TrackMapSegment[];
  /** Parts of the recording no segment covers. */
  uncovered: [number, number][][];
  pins: TrackMapPin[];
  selectedUid: string | null;
  /** Start/end of the selected segment, draggable along the track. */
  handles: { start: [number, number]; end: [number, number] } | null;
  cutMode: boolean;
  onSelect: (uid: string) => void;
  onMapClick: (lat: number, lng: number) => void;
  onHandleDrag: (which: "start" | "end", lat: number, lng: number) => void;
  /** Changes when a new track is opened: the map refits to it. */
  fitKey: string;
}

const HANDLE_STYLE = (color: string) => `
  width:18px;height:18px;border-radius:50%;
  border:3px solid ${color};background:hsl(0,0%,100%);
  box-shadow:0 2px 8px rgba(15,23,42,0.35);cursor:grab;
`;

const PIN_STYLE: Record<TrackMapPin["kind"], string> = {
  boundary: "width:14px;height:14px;border-radius:50%;border:2.5px solid hsl(0,0%,100%);background:hsl(24,88%,52%);box-shadow:0 1px 6px rgba(15,23,42,0.3);",
  landmark: "width:10px;height:10px;border-radius:50%;border:2px solid hsl(0,0%,100%);background:hsl(24,60%,62%);box-shadow:0 1px 4px rgba(15,23,42,0.25);",
  stop: "width:9px;height:9px;border-radius:2px;border:1.5px solid hsl(0,0%,100%);background:hsl(215,25%,27%);box-shadow:0 1px 4px rgba(15,23,42,0.25);",
};

const SEGMENT_SOURCE = "track-segments";
const UNCOVERED_SOURCE = "track-uncovered";
const PLANNED_SOURCE = "track-planned";

const VoyageTrackMap = (props: VoyageTrackMapProps) => {
  const { planned, segments, uncovered, pins, selectedUid, handles, cutMode, fitKey } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const pinMarkers = useRef<maplibregl.Marker[]>([]);
  const handleMarkers = useRef<{ start?: maplibregl.Marker; end?: maplibregl.Marker }>({});
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!isMapLibreSupported()) {
      setUnavailable(true);
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createThemedCartoStyle(),
      center: [15, 39],
      zoom: 5,
      attributionControl: false,
    });
    bindMapToTheme(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource(PLANNED_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: PLANNED_SOURCE,
        type: "line",
        source: PLANNED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "hsl(215,16%,47%)", "line-width": 1.6, "line-opacity": 0.7, "line-dasharray": [2, 2] },
      });
      map.addSource(UNCOVERED_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: UNCOVERED_SOURCE,
        type: "line",
        source: UNCOVERED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "hsl(215,10%,60%)", "line-width": 2, "line-opacity": 0.55 },
      });
      map.addSource(SEGMENT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${SEGMENT_SOURCE}-casing`,
        type: "line",
        source: SEGMENT_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "hsl(0,0%,100%)",
          "line-width": ["case", ["==", ["get", "selected"], true], 8, 5],
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: SEGMENT_SOURCE,
        type: "line",
        source: SEGMENT_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], true], 5, 3],
        },
      });
      map.on("click", SEGMENT_SOURCE, (event) => {
        if (callbacks.current.cutMode) return;
        const uid = event.features?.[0]?.properties?.uid;
        if (typeof uid === "string") callbacks.current.onSelect(uid);
      });
      map.on("mouseenter", SEGMENT_SOURCE, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", SEGMENT_SOURCE, () => (map.getCanvas().style.cursor = ""));
      map.on("click", (event) => {
        if (callbacks.current.cutMode) callbacks.current.onMapClick(event.lngLat.lat, event.lngLat.lng);
      });
      requestMapResize(map);
      setReady(true);
    });
    const cleanupResize = bindMapToContainerResize(map, containerRef.current);
    mapRef.current = map;
    const pins = pinMarkers;
    const handlesRef = handleMarkers;
    return () => {
      cleanupResize?.();
      pins.current.forEach((m) => m.remove());
      handlesRef.current.start?.remove();
      handlesRef.current.end?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(PLANNED_SOURCE) as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: planned.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: planned } }] : [],
    });
  }, [planned, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SEGMENT_SOURCE) as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: segments.flatMap((segment) =>
        segment.runs
          .filter((run) => run.length > 1)
          .map((run) => ({
            type: "Feature" as const,
            properties: { uid: segment.uid, color: segment.color, selected: segment.uid === selectedUid },
            geometry: { type: "LineString" as const, coordinates: run },
          }))
      ),
    });
    (map.getSource(UNCOVERED_SOURCE) as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: uncovered
        .filter((run) => run.length > 1)
        .map((run) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: run } })),
    });
  }, [segments, uncovered, selectedUid, ready]);

  // Refit when a different track is opened, not on every edit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bounds = new maplibregl.LngLatBounds();
    [...segments.flatMap((s) => s.runs.flat()), ...uncovered.flat()].forEach((c) => bounds.extend(c));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    pinMarkers.current.forEach((m) => m.remove());
    pinMarkers.current = pins.map((pin) => {
      const element = document.createElement("div");
      element.style.cssText = PIN_STYLE[pin.kind];
      element.title = pin.name;
      return new maplibregl.Marker({ element, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map);
    });
  }, [pins, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (["start", "end"] as const).forEach((which) => {
      const position = handles?.[which];
      let marker = handleMarkers.current[which];
      if (!position) {
        marker?.remove();
        handleMarkers.current[which] = undefined;
        return;
      }
      if (!marker) {
        const element = document.createElement("div");
        element.style.cssText = HANDLE_STYLE(which === "start" ? "hsl(152,60%,36%)" : "hsl(0,72%,50%)");
        element.title = which === "start" ? "Inizio segmento (trascina)" : "Fine segmento (trascina)";
        marker = new maplibregl.Marker({ element, anchor: "center", draggable: true }).setLngLat(position).addTo(map);
        marker.on("dragend", () => {
          const at = marker!.getLngLat();
          callbacks.current.onHandleDrag(which, at.lat, at.lng);
        });
        handleMarkers.current[which] = marker;
      } else {
        marker.setLngLat(position);
      }
    });
  }, [handles, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = cutMode ? "crosshair" : "";
  }, [cutMode]);

  if (unavailable) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Mappa non disponibile su questo dispositivo.</div>;
  }
  return <div ref={containerRef} className="h-full w-full" />;
};

export default VoyageTrackMap;
