import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CalendarCheck, MapPin, Navigation, Ship } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ArticleMapOverlay, ArticleMapVessel } from "@/lib/article-map";
import { buildVesselRouteCoordinates, destinationPoint, getRouteTerminalAngle } from "@/lib/article-map";
import { bindMapToContainerResize, createCartoRasterStyle, isMapLibreSupported, requestMapResize } from "@/lib/maplibre";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";

export interface ArticleMapSceneView {
  id: string;
  title: string;
  description: string;
  windLabel: string;
  latitude: number;
  longitude: number;
  zoom: number;
  windAngle: number | null;
  showMainRoute?: boolean;
  vessels?: ArticleMapVessel[];
  overlays?: Array<ArticleMapOverlay & { label?: string }>;
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
  primaryRouteCoordinates?: [number, number][] | null;
  distanceValue?: number | null;
  distanceUnit?: "NM" | "KM" | null;
  bookingCta?: {
    href: string;
    label: string;
    description?: string;
  } | null;
}

const ArticleMapAside = ({
  latitude,
  longitude,
  title,
  scenes = [],
  activeSceneId = null,
  camera = null,
  primaryRouteCoordinates = null,
  distanceValue = null,
  distanceUnit = null,
  bookingCta = null,
}: ArticleMapAsideProps) => {
  const { lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const windMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sceneMarkersRef = useRef<maplibregl.Marker[]>([]);
  const mapResizeCleanupRef = useRef<(() => void) | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const normalizedScenes = useMemo(
    () => scenes.filter((scene) => Number.isFinite(scene.latitude) && Number.isFinite(scene.longitude)),
    [scenes]
  );
  const activeScene = normalizedScenes.find((scene) => scene.id === activeSceneId) ?? normalizedScenes[0] ?? null;
  const activeVessels = useMemo(() => activeScene?.vessels ?? [], [activeScene]);
  const activeOverlays = useMemo(() => activeScene?.overlays ?? [], [activeScene]);
  const shouldFitPrimaryRoute = Boolean(activeScene?.showMainRoute && primaryRouteCoordinates && primaryRouteCoordinates.length > 1);

  const createMarkerElement = (
    kind: "vessel" | "anchor" | "buoy" | "current" | "wind",
    angle?: number | null,
    titleText?: string,
    customColor?: string
  ) => {
    const element = document.createElement("div");
    const palette = {
      vessel: "hsl(201, 58%, 35%)",
      anchor: "hsl(209, 46%, 32%)",
      buoy: "hsl(18, 76%, 46%)",
      current: "hsl(168, 52%, 34%)",
      wind: "hsl(201, 58%, 35%)",
    } as const;
    const symbol = {
      vessel: "⛵",
      anchor: "⚓",
      buoy: "●",
      current: "➝",
      wind: "➤",
    } as const;
    const color = customColor || palette[kind];

    element.className = "flex min-w-[34px] max-w-[140px] items-center gap-1.5 rounded-full border border-white/75 bg-[rgba(255,255,255,0.94)] px-2 py-1 shadow-[0_10px_22px_rgba(15,23,42,0.18)]";
    element.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;font-size:14px;color:${color};transform:rotate(${angle ?? 0}deg);">${symbol[kind]}</span>
      ${titleText ? `<span style="font:600 11px/1.2 ui-sans-serif,system-ui;color:rgba(15,23,42,0.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${titleText}</span>` : ""}
    `;
    return element;
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      if (!isMapLibreSupported()) {
        setMapUnavailable(true);
        return;
      }

      setMapLoaded(false);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: createCartoRasterStyle(),
        center: [longitude, latitude],
        zoom: 7,
        attributionControl: false,
      });

      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.once("load", () => {
        setMapLoaded(true);
        requestMapResize(map);
      });
      map.on("webglcontextlost", () => {
        setMapLoaded(false);
      });
      map.on("webglcontextrestored", () => {
        requestMapResize(map);
      });
      mapResizeCleanupRef.current = bindMapToContainerResize(map, containerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize article map", error);
      windMarkerRef.current?.remove();
      windMarkerRef.current = null;
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      setMapLoaded(false);
      mapResizeCleanupRef.current?.();
      mapResizeCleanupRef.current = null;
      windMarkerRef.current?.remove();
      windMarkerRef.current = null;
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];
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
      const vesselRouteSourceId = "article-map-vessel-routes";
      const overlayRouteSourceId = "article-map-overlay-routes";
      const primaryRouteSourceId = "article-map-primary-route";

      if (map.getLayer(pathSourceId)) map.removeLayer(pathSourceId);
      if (map.getLayer(pointSourceId)) map.removeLayer(pointSourceId);
      if (map.getLayer(vesselRouteSourceId)) map.removeLayer(vesselRouteSourceId);
      if (map.getLayer(overlayRouteSourceId)) map.removeLayer(overlayRouteSourceId);
      if (map.getLayer(primaryRouteSourceId)) map.removeLayer(primaryRouteSourceId);
      if (map.getSource(pathSourceId)) map.removeSource(pathSourceId);
      if (map.getSource(pointSourceId)) map.removeSource(pointSourceId);
      if (map.getSource(vesselRouteSourceId)) map.removeSource(vesselRouteSourceId);
      if (map.getSource(overlayRouteSourceId)) map.removeSource(overlayRouteSourceId);
      if (map.getSource(primaryRouteSourceId)) map.removeSource(primaryRouteSourceId);

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

      if (activeScene?.showMainRoute && primaryRouteCoordinates && primaryRouteCoordinates.length > 1) {
        map.addSource(primaryRouteSourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: primaryRouteCoordinates },
            properties: {},
          },
        });
        map.addLayer({
          id: primaryRouteSourceId,
          type: "line",
          source: primaryRouteSourceId,
          paint: {
            "line-color": "hsl(30, 85%, 48%)",
            "line-width": 3,
            "line-opacity": 0.75,
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
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];

      if (activeScene?.windAngle != null) {
        const markerEl = document.createElement("div");
        markerEl.className = "flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-[rgba(255,255,255,0.92)] shadow-[0_14px_30px_rgba(15,23,42,0.20)]";
        markerEl.innerHTML = `<div style="transform: rotate(${activeScene.windAngle}deg); color: hsl(201, 58%, 35%); font-size: 18px;">➤</div>`;
        windMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([activeScene.longitude, activeScene.latitude])
          .addTo(map);
      }

      const vesselRouteFeatures = activeVessels.flatMap((vessel) => {
        const routeCoordinates = buildVesselRouteCoordinates(vessel);
        if (routeCoordinates.length < 2) return [];

        return [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: routeCoordinates,
          },
          properties: {
            color: vessel.color,
          },
        }];
      });

      if (vesselRouteFeatures.length) {
        map.addSource(vesselRouteSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: vesselRouteFeatures },
        });
        map.addLayer({
          id: vesselRouteSourceId,
          type: "line",
          source: vesselRouteSourceId,
          paint: {
            "line-color": ["coalesce", ["get", "color"], "hsl(201, 68%, 34%)"],
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.7,
          },
        });
      }

      const overlayRouteFeatures = activeOverlays.flatMap((overlay) => {
        if (
          (overlay.kind !== "current" && overlay.kind !== "wind") ||
          typeof overlay.latitude !== "number" ||
          typeof overlay.longitude !== "number" ||
          typeof overlay.angle !== "number" ||
          typeof overlay.route_distance_nm !== "number" ||
          overlay.route_distance_nm <= 0
        ) {
          return [];
        }

        const destination = destinationPoint(
          overlay.latitude,
          overlay.longitude,
          overlay.angle,
          overlay.route_distance_nm
        );

        return [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [overlay.longitude, overlay.latitude],
              [destination.longitude, destination.latitude],
            ],
          },
          properties: {
            kind: overlay.kind,
          },
        }];
      });

      if (overlayRouteFeatures.length) {
        map.addSource(overlayRouteSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: overlayRouteFeatures },
        });
        map.addLayer({
          id: overlayRouteSourceId,
          type: "line",
          source: overlayRouteSourceId,
          paint: {
            "line-color": [
              "match",
              ["get", "kind"],
              "current",
              "hsl(168, 52%, 34%)",
              "hsl(201, 58%, 35%)",
            ],
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.7,
          },
        });
      }

      const vesselMarkers = activeVessels.flatMap((vessel) => {
        if (typeof vessel.latitude !== "number" || typeof vessel.longitude !== "number") return [];
        const routeCoordinates = buildVesselRouteCoordinates(vessel);
        const routeAngle = getRouteTerminalAngle(routeCoordinates);
        const routeEnd = routeCoordinates.length > 1 ? routeCoordinates[routeCoordinates.length - 1] : null;
        return [
          new maplibregl.Marker({
            element: createMarkerElement("vessel", vessel.heading, vessel.name || undefined, vessel.color),
            anchor: "center",
          })
            .setLngLat([vessel.longitude, vessel.latitude])
            .addTo(map),
          ...(routeEnd && routeAngle != null
            ? [new maplibregl.Marker({
                element: createMarkerElement("wind", routeAngle, undefined, vessel.color),
                anchor: "center",
              })
                .setLngLat(routeEnd)
                .addTo(map)]
            : []),
        ];
      });

      const overlayMarkers = activeOverlays.flatMap((overlay) => {
        if (typeof overlay.latitude !== "number" || typeof overlay.longitude !== "number") return [];
        return [
          new maplibregl.Marker({
            element: createMarkerElement(overlay.kind, overlay.angle, overlay.label),
            anchor: "center",
          })
            .setLngLat([overlay.longitude, overlay.latitude])
            .addTo(map),
        ];
      });

      sceneMarkersRef.current = [...vesselMarkers, ...overlayMarkers];
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [activeOverlays, activeScene, activeSceneId, activeVessels, normalizedScenes, primaryRouteCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (shouldFitPrimaryRoute && primaryRouteCoordinates && primaryRouteCoordinates.length > 1) {
      const relevantCoordinates = [
        ...primaryRouteCoordinates,
        ...(activeScene ? [[activeScene.longitude, activeScene.latitude] as [number, number]] : []),
      ];
      const bounds = relevantCoordinates.reduce(
        (acc, coordinate) => acc.extend(coordinate),
        new maplibregl.LngLatBounds(relevantCoordinates[0], relevantCoordinates[0])
      );
      map.fitBounds(bounds, { padding: 44, duration: 0, maxZoom: 10.5 });
      return;
    }

    if (!camera) return;

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
  }, [activeScene, camera, primaryRouteCoordinates, shouldFitPrimaryRoute]);

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
          <div className="relative">
            <div ref={containerRef} className="w-full h-[280px] md:h-[320px]" aria-busy={!mapLoaded} />
            {!mapLoaded ? (
              <MapLoadingPlaceholder
                label={lang === "it" ? "Caricamento minimappa" : "Loading minimap"}
                className="bg-[radial-gradient(circle_at_top_left,rgba(159,207,214,0.18)_0%,transparent_55%)]"
              />
            ) : null}
          </div>
          {(activeScene?.description || activeScene?.windLabel || (distanceValue ?? 0) > 0 || bookingCta) && (
            <div className="border-t glass-divider px-4 py-3 space-y-2">
              {activeScene?.description && (
                <p className="text-xs font-sans leading-relaxed text-muted-foreground">{activeScene.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {activeScene?.windLabel && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[11px] font-sans text-foreground">
                    <Navigation size={12} className="text-accent" />
                    {activeScene.windLabel}
                  </span>
                )}
                {(distanceValue ?? 0) > 0 && distanceUnit && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[11px] font-sans text-foreground">
                    <Ship size={12} className="text-accent" />
                    {Math.round(distanceValue ?? 0).toLocaleString()} {distanceUnit}
                  </span>
                )}
              </div>
              {(activeVessels.length > 0 || activeOverlays.length > 0) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {activeVessels.map((vessel) => (
                    <span
                      key={vessel.id}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-white/70 px-2.5 py-1 text-[11px] font-sans text-foreground"
                      style={{ borderColor: `${vessel.color}55` }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: vessel.color }} />
                      {vessel.name || (lang === "it" ? "Barca" : "Boat")}
                    </span>
                  ))}
                  {activeOverlays.map((overlay) => (
                    <span key={overlay.id} className="rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[11px] font-sans text-muted-foreground">
                      {overlay.label || overlay.kind}
                    </span>
                  ))}
                </div>
              )}
              {bookingCta && (
                <Link
                  to={bookingCta.href}
                  className="mt-3 flex items-center justify-between gap-3 rounded-[20px] border border-emerald-300/70 bg-emerald-50/85 px-3 py-3 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                      <CalendarCheck size={15} className="shrink-0 text-emerald-700" />
                      {bookingCta.label}
                    </span>
                    {bookingCta.description && (
                      <span className="mt-1 block text-xs leading-relaxed text-emerald-900/80">
                        {bookingCta.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-emerald-700 px-3 py-1 text-[11px] font-semibold text-white">
                    {lang === "it" ? "Vai" : "Open"}
                  </span>
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ArticleMapAside;
