import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Navigation } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface ArticleMapSceneView {
  id: string;
  title: string;
  description: string;
  windLabel: string;
  latitude: number;
  longitude: number;
  zoom: number;
  windAngle: number | null;
}

interface ArticleMapAsideProps {
  latitude: number;
  longitude: number;
  title: string;
  scenes?: ArticleMapSceneView[];
  activeSceneId?: string | null;
  camera?: {
    latitude: number;
    longitude: number;
    zoom: number;
  } | null;
}

const ArticleMapAside = ({
  latitude,
  longitude,
  title,
  scenes = [],
  activeSceneId = null,
  camera = null,
}: ArticleMapAsideProps) => {
  const { lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const windMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const normalizedScenes = useMemo(
    () => scenes.filter((scene) => Number.isFinite(scene.latitude) && Number.isFinite(scene.longitude)),
    [scenes]
  );
  const activeScene = normalizedScenes.find((scene) => scene.id === activeSceneId) ?? normalizedScenes[0] ?? null;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            carto: {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              ],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
        },
        center: [longitude, latitude],
        zoom: 7,
        attributionControl: false,
      });

      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.once("load", () => requestAnimationFrame(() => map.resize()));
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize article map", error);
      windMarkerRef.current?.remove();
      windMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      windMarkerRef.current?.remove();
      windMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, mapUnavailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const pathCoordinates = normalizedScenes.map((scene) => [scene.longitude, scene.latitude]);
      const pointSourceId = "article-map-points";
      const pathSourceId = "article-map-path";

      if (map.getLayer(pathSourceId)) map.removeLayer(pathSourceId);
      if (map.getLayer(pointSourceId)) map.removeLayer(pointSourceId);
      if (map.getSource(pathSourceId)) map.removeSource(pathSourceId);
      if (map.getSource(pointSourceId)) map.removeSource(pointSourceId);

      if (pathCoordinates.length > 1) {
        map.addSource(pathSourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: pathCoordinates },
            properties: {},
          },
        });
        map.addLayer({
          id: pathSourceId,
          type: "line",
          source: pathSourceId,
          paint: {
            "line-color": "hsl(201, 52%, 48%)",
            "line-width": 3,
            "line-opacity": 0.55,
          },
        });
      }

      if (normalizedScenes.length) {
        map.addSource(pointSourceId, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: normalizedScenes.map((scene) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [scene.longitude, scene.latitude],
              },
              properties: {
                id: scene.id,
                active: scene.id === activeSceneId,
              },
            })),
          },
        });
        map.addLayer({
          id: pointSourceId,
          type: "circle",
          source: pointSourceId,
          paint: {
            "circle-radius": ["case", ["==", ["get", "active"], true], 7, 4.5],
            "circle-color": ["case", ["==", ["get", "active"], true], "hsl(201, 58%, 35%)", "hsl(201, 42%, 71%)"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "rgba(255,255,255,0.92)",
          },
        });
      }

      windMarkerRef.current?.remove();
      windMarkerRef.current = null;

      if (activeScene?.windAngle != null) {
        const markerEl = document.createElement("div");
        markerEl.className = "flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-[rgba(255,255,255,0.92)] shadow-[0_14px_30px_rgba(15,23,42,0.20)]";
        markerEl.innerHTML = `<div style="transform: rotate(${activeScene.windAngle}deg); color: hsl(201, 58%, 35%); font-size: 18px;">➤</div>`;
        windMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([activeScene.longitude, activeScene.latitude])
          .addTo(map);
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [activeScene, activeSceneId, normalizedScenes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    const currentCenter = map.getCenter();
    const needsMove =
      Math.abs(currentCenter.lng - camera.longitude) > 0.0001 ||
      Math.abs(currentCenter.lat - camera.latitude) > 0.0001 ||
      Math.abs(map.getZoom() - camera.zoom) > 0.01;

    if (!needsMove) return;

    map.jumpTo({
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
    });
  }, [camera]);

  return (
    <div className="glass-panel rounded-[28px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b glass-divider">
        <MapPin size={14} className="text-accent shrink-0" />
        <span className="text-[11px] font-sans text-muted-foreground tracking-wide truncate" title={title}>
          {lang === "it" ? "Minimappa articolo" : "Article minimap"}
        </span>
      </div>
      {mapUnavailable ? (
        <div className="w-full h-[280px] md:h-[320px] px-4 py-5 flex flex-col items-start justify-end gap-2 bg-[radial-gradient(circle_at_top_left,rgba(159,207,214,0.18)_0%,transparent_55%)]">
          <p className="text-sm font-sans text-foreground">
            {lang === "it" ? "Mappa non disponibile su questo dispositivo." : "Map unavailable on this device."}
          </p>
          <p className="text-xs font-sans text-muted-foreground">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </p>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="w-full h-[280px] md:h-[320px]" />
          {activeScene && (
            <div className="border-t glass-divider px-4 py-3 space-y-2">
              <div>
                <p className="text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                  {lang === "it" ? "Punto attivo" : "Active point"}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {activeScene.title || (lang === "it" ? "Posizione corrente" : "Current position")}
                </p>
              </div>
              {activeScene.description && (
                <p className="text-xs font-sans leading-relaxed text-muted-foreground">{activeScene.description}</p>
              )}
              {activeScene.windLabel && (
                <p className="inline-flex items-center gap-2 text-xs font-sans text-foreground">
                  <Navigation size={12} className="text-accent" />
                  {activeScene.windLabel}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ArticleMapAside;
