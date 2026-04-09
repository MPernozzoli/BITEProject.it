import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import {
  buildVoyageSegmentGeometry,
  getArticleVoyageFocus,
  getAssociatedArticleForWaypoint,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
  getVisibleStopsLegendHeading,
  getVoyageMapLineStringCoordinates,
  resolveArticleRouteRange,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";
import { bindMapToContainerResize, createCartoRasterStyle, requestMapResize } from "@/lib/maplibre";
import MapLoadingPlaceholder from "@/components/MapLoadingPlaceholder";

interface VoyageMapProps {
  voyages: Voyage[];
  waypointsMap: Record<string, VoyageWaypoint[]>;
  articles: GeoArticle[];
  selectedArticleId?: string | null;
  hoveredArticleId?: string | null;
  highlightedVoyageId?: string | null;
  onArticleClick?: (article: GeoArticle) => void;
  onVoyageSelect?: (voyageId: string | null) => void;
  selectedRouteVoyageId?: string | null;
  flyToWaypointRef?: MutableRefObject<((lat: number, lng: number, popupLabel?: string) => void) | null>;
  lang: "en" | "it";
  initialFitReady?: boolean;
  disableInteractions?: boolean;
  onMapUnavailable?: () => void;
}

const escapePopupHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clampWaypointIndex = (value: number, max: number) => Math.max(0, Math.min(value, max));

type PositionedArticle = GeoArticle & { displayLat: number; displayLng: number };

function buildPositionedArticlesForCluster(
  articles: GeoArticle[],
  waypointsMap: Record<string, VoyageWaypoint[]>
): PositionedArticle[] {
  return articles
    .map((article) => {
      if (article.latitude != null && article.longitude != null) {
        return { ...article, displayLat: article.latitude, displayLng: article.longitude };
      }
      if (article.voyage_id) {
        const wps = waypointsMap[article.voyage_id] || [];
        if (wps.length < 1) return null;
        const range = resolveArticleRouteRange(article, wps);
        if (range) {
          const start = clampWaypointIndex(range[0], wps.length - 1);
          const end = clampWaypointIndex(range[1], wps.length - 1);
          const midIdx = Math.round((start + end) / 2);
          const wp = wps[midIdx] || wps[0];
          return { ...article, displayLat: wp.lat, displayLng: wp.lng };
        }
        const mid = wps[Math.floor(wps.length / 2)];
        return { ...article, displayLat: mid.lat, displayLng: mid.lng };
      }
      return null;
    })
    .filter(Boolean) as PositionedArticle[];
}

const getVoyageYearTier = (voyage: Voyage) => {
  if (!voyage.start_date) return 0;
  const startDate = new Date(voyage.start_date);
  if (Number.isNaN(startDate.getTime())) return 0;

  return Math.max(0, new Date().getFullYear() - startDate.getFullYear());
};

const getVoyageLineWidthScale = (voyage: Voyage) => {
  const yearTier = getVoyageYearTier(voyage);
  if (yearTier <= 0) return 1;
  if (yearTier === 1) return 0.76;
  if (yearTier === 2) return 0.56;
  return 0.34;
};

const getVoyageStrokeColor = (voyage: Voyage, variant: "base" | "focus" = "base") => {
  if (voyage.type === "water") {
    if (variant === "focus") return "hsl(206, 84%, 40%)";
    if (voyage.status === "completed") return "hsl(208, 48%, 34%)";
    if (voyage.status === "planned") return "hsl(205, 60%, 68%)";
    return "hsl(206, 72%, 47%)";
  }

  if (variant === "focus") return "hsl(28, 90%, 44%)";
  if (voyage.status === "completed") return "hsl(28, 54%, 36%)";
  if (voyage.status === "planned") return "hsl(31, 72%, 70%)";
  return "hsl(30, 78%, 50%)";
};

const getVoyageStatusDashArray = (voyage: Voyage): number[] | undefined => {
  if (voyage.status === "planned") {
    return voyage.type === "water" ? [2.2, 2.8] : [1.6, 2.2];
  }

  return undefined;
};

const getVoyageStatusCasingColor = (voyage: Voyage) => {
  if (voyage.type === "water") {
    if (voyage.status === "active") return "hsla(206, 80%, 44%, 0.22)";
    if (voyage.status === "planned") return "hsla(205, 56%, 70%, 0.18)";
    return "hsla(208, 46%, 24%, 0.18)";
  }

  if (voyage.status === "active") return "hsla(30, 84%, 46%, 0.22)";
  if (voyage.status === "planned") return "hsla(31, 68%, 70%, 0.16)";
  return "hsla(28, 44%, 28%, 0.16)";
};

const getVoyageLineMetrics = (
  voyage: Voyage,
  state: { isFocused: boolean; isHovered: boolean; isDimmed: boolean; activeArticleFocusMode?: "voyage" | "segment" | "point" | null }
) => {
  const { isFocused, isHovered, isDimmed, activeArticleFocusMode } = state;
  const widthScale = getVoyageLineWidthScale(voyage);

  const baseWidth = isFocused
    ? activeArticleFocusMode === "voyage" ? 5.8 : 4.8
    : isHovered
      ? 5.2
      : voyage.status === "active"
        ? 4.6
        : voyage.status === "planned"
          ? 3.2
          : 3.4;
  const width = Math.max(0.9, baseWidth * widthScale);

  const opacity = isDimmed
    ? 0.16
    : voyage.status === "planned"
      ? isFocused || isHovered ? 0.82 : 0.58
      : voyage.status === "active"
        ? isFocused || isHovered ? 1 : 0.94
        : isFocused || isHovered
          ? 0.98
          : 0.78;

  const casingWidth = isFocused
    ? width + Math.max(1.4, 4 * widthScale)
    : isHovered
      ? width + Math.max(1.2, 3.4 * widthScale)
      : voyage.status === "active"
        ? width + Math.max(1.1, 3 * widthScale)
        : width + Math.max(1, 2.4 * widthScale);

  const casingOpacity = isDimmed
    ? 0.08
    : voyage.status === "active"
      ? isFocused || isHovered ? 0.42 : 0.3
      : voyage.status === "planned"
        ? isFocused || isHovered ? 0.24 : 0.16
        : isFocused || isHovered
          ? 0.24
          : 0.16;

  return { width, opacity, casingWidth, casingOpacity };
};

const getArticleSegmentGeometry = (
  waypoints: VoyageWaypoint[],
  type: Voyage["type"],
  startIndex: number,
  endIndex: number,
  cachedGeometry?: [number, number][] | null
) => {
  return buildVoyageSegmentGeometry(waypoints, type, startIndex, endIndex, cachedGeometry);
};

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  hoveredArticleId,
  highlightedVoyageId,
  onArticleClick,
  onVoyageSelect,
  selectedRouteVoyageId: controlledRouteVoyageId,
  flyToWaypointRef,
  lang,
  initialFitReady = true,
  disableInteractions = false,
  onMapUnavailable,
}: VoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const lineLayerHandlersRef = useRef<Record<string, {
    click: (e: maplibregl.MapLayerMouseEvent) => void;
    mouseenter: () => void;
    mouseleave: () => void;
  }>>({});
  const waypointLayerHandlersRef = useRef<Record<string, {
    mouseenter: (event: maplibregl.MapLayerMouseEvent) => void;
    mousemove: (event: maplibregl.MapLayerMouseEvent) => void;
    mouseleave: (event: maplibregl.MapLayerMouseEvent) => void;
  }>>({});
  const onArticleClickRef = useRef(onArticleClick);
  const onVoyageSelectRef = useRef(onVoyageSelect);
  const hasPerformedInitialFitRef = useRef(false);
  const mapResizeCleanupRef = useRef<(() => void) | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hoveredRouteVoyageId, setHoveredRouteVoyageId] = useState<string | null>(null);

  const clusterIndexRef = useRef<Supercluster | null>(null);
  const articlesByIdRef = useRef<Map<string, PositionedArticle>>(new Map());
  const runArticleMarkersSyncRef = useRef<() => void>(() => {});
  const hoveredRouteVoyageIdRef = useRef<string | null>(null);
  hoveredRouteVoyageIdRef.current = hoveredRouteVoyageId;

  const selectedArticleIdRef = useRef(selectedArticleId);
  selectedArticleIdRef.current = selectedArticleId;
  const hoveredArticleIdRef = useRef(hoveredArticleId);
  hoveredArticleIdRef.current = hoveredArticleId;
  const highlightedVoyageIdRef = useRef(highlightedVoyageId);
  highlightedVoyageIdRef.current = highlightedVoyageId;
  const langRef = useRef(lang);
  langRef.current = lang;

  const publishedVoyages = useMemo(() => voyages.filter((v) => v.is_published), [voyages]);
  const articlesForMap = useMemo(
    () => articles.filter((a) => a.published_at != null),
    [articles]
  );
  const positionedArticles = useMemo(
    () => buildPositionedArticlesForCluster(articlesForMap, waypointsMap),
    [articlesForMap, waypointsMap]
  );

  /** Tutti i waypoint pubblici (tutti i viaggi) per cluster sulla mappa */
  const mapWaypointClusterInputs = useMemo(() => {
    type Item = {
      key: string;
      lng: number;
      lat: number;
      voyageId: string;
      waypoint: VoyageWaypoint;
      sequenceHeading: string;
      name: string;
      articleTitle: string;
      fillColor: string;
    };
    const items: Item[] = [];
    for (const voyage of publishedVoyages) {
      const wps = waypointsMap[voyage.id] || [];
      if (!wps.length) continue;
      const visible = getPublicVoyageWaypoints(wps, articlesForMap, voyage.id);
      const isActive = voyage.status === "active";
      for (let vi = 0; vi < visible.length; vi++) {
        const w = visible[vi]!;
        const routeIndex = wps.findIndex((waypoint) => waypoint.id === w.id);
        const safeIndex = routeIndex >= 0 ? routeIndex : vi;
        const associatedArticle = getAssociatedArticleForWaypoint(articlesForMap, voyage.id, safeIndex, wps);
        const isStart = vi === 0;
        const isEnd = vi === visible.length - 1;
        const fillColor = isStart
          ? "hsl(136, 42%, 42%)"
          : isEnd
            ? "hsl(8, 65%, 54%)"
            : isActive
              ? "hsl(180, 20%, 35%)"
              : "hsl(220, 10%, 70%)";
        const name = getLocalizedWaypointName(w, lang, safeIndex);
        const sequenceHeading = getVisibleStopsLegendHeading(vi, visible.length, lang);
        const articleTitle = associatedArticle
          ? lang === "en"
            ? associatedArticle.title_en
            : associatedArticle.title_it || associatedArticle.title_en
          : "";
        items.push({
          key: `${voyage.id}:${w.id}`,
          lng: w.lng,
          lat: w.lat,
          voyageId: voyage.id,
          waypoint: w,
          sequenceHeading,
          name,
          articleTitle,
          fillColor,
        });
      }
    }
    return items;
  }, [publishedVoyages, waypointsMap, articlesForMap, lang]);

  const waypointClusterIndexRef = useRef<Supercluster | null>(null);
  const mapWaypointsByKeyRef = useRef<Map<string, (typeof mapWaypointClusterInputs)[0]>>(new Map());
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const runWaypointMarkersSyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (mapUnavailable) {
      onMapUnavailable?.();
    }
  }, [mapUnavailable, onMapUnavailable]);

  const clearInteractiveLayerHandlers = useCallback((map: maplibregl.Map) => {
    Object.entries(lineLayerHandlersRef.current).forEach(([layerId, handlers]) => {
      map.off("click", layerId, handlers.click);
      map.off("mouseenter", layerId, handlers.mouseenter);
      map.off("mouseleave", layerId, handlers.mouseleave);
    });
    lineLayerHandlersRef.current = {};

    Object.entries(waypointLayerHandlersRef.current).forEach(([layerId, handlers]) => {
      map.off("mouseenter", layerId, handlers.mouseenter);
      map.off("mousemove", layerId, handlers.mousemove);
      map.off("mouseleave", layerId, handlers.mouseleave);
    });
    waypointLayerHandlersRef.current = {};
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  // Keep refs in sync
  onArticleClickRef.current = onArticleClick;
  onVoyageSelectRef.current = onVoyageSelect;

  useEffect(() => {
    if (controlledRouteVoyageId !== undefined) {
      setHoveredRouteVoyageId(controlledRouteVoyageId);
    }
  }, [controlledRouteVoyageId]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      setMapLoaded(false);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: createCartoRasterStyle(),
        center: [15, 40],
        zoom: 5,
        attributionControl: false,
      });

      map.on("load", () => {
        setMapLoaded(true);
        requestMapResize(map);
      });

      map.on("webglcontextlost", () => {
        setMapLoaded(false);
      });

      map.on("webglcontextrestored", () => {
        requestMapResize(map);
      });

      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("click", (e) => {
        const point = e.point;
        queueMicrotask(() => {
          const hitLayerIds = Object.keys(lineLayerHandlersRef.current);
          const features =
            hitLayerIds.length > 0 ? map.queryRenderedFeatures(point, { layers: hitLayerIds }) : [];
          if (features.length === 0) {
            setHoveredRouteVoyageId(null);
            onVoyageSelectRef.current?.(null);
          }
        });
      });

      mapResizeCleanupRef.current = bindMapToContainerResize(map, containerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize voyage map", error);
      popupRef.current?.remove();
      popupRef.current = null;
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      waypointMarkersRef.current.forEach((marker) => marker.remove());
      waypointMarkersRef.current = [];
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
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      waypointMarkersRef.current.forEach((marker) => marker.remove());
      waypointMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearInteractiveLayerHandlers, mapUnavailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToWaypointRef) return;

    flyToWaypointRef.current = (lat: number, lng: number, popupLabel?: string) => {
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 10), duration: 1200 });

      popupRef.current?.remove();
      popupRef.current = null;

      if (popupLabel) {
        const popup = new maplibregl.Popup({
          offset: 12,
          closeButton: true,
          closeOnClick: true,
          maxWidth: "260px",
        });

        const popupHtml = `
          <div style="display:grid;gap:4px;font-family:var(--font-sans);min-width:120px;max-width:240px;">
            <strong style="font-size:12px;line-height:1.35;color:hsl(220,40%,15%);">${escapePopupHtml(popupLabel)}</strong>
          </div>
        `;

        popup.setLngLat([lng, lat]).setHTML(popupHtml);

        map.once("moveend", () => {
          popup.addTo(map);
        });

        popupRef.current = popup;
      }
    };

    return () => {
      flyToWaypointRef.current = null;
    };
  }, [flyToWaypointRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (disableInteractions) {
      setHoveredRouteVoyageId(null);
    }

    const handlers = [
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.dragPan,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];

    handlers.forEach((handler) => {
      if (disableInteractions) {
        handler.disable();
      } else {
        handler.enable();
      }
    });

    map.getCanvas().style.pointerEvents = disableInteractions ? "none" : "auto";
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = disableInteractions ? "none" : "auto";
      containerRef.current.style.touchAction = disableInteractions ? "none" : "auto";
    }
  }, [disableInteractions]);

  // Draw voyage routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const getCachedGeometryCoordinates = (voyage: Voyage) => {
        const coordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        return Array.isArray(coordinates) ? coordinates : [];
      };

      const activeArticle =
        articlesForMap.find((article) => article.id === selectedArticleId) || null;
      const activeArticleFocus = activeArticle ? getArticleVoyageFocus(activeArticle) : null;
      const routeFocusVoyageId = activeArticleFocus?.voyageId || highlightedVoyageId || null;
      const hoverFocusVoyageId = routeFocusVoyageId ? null : hoveredRouteVoyageId;

      clearInteractiveLayerHandlers(map);

      const style = map.getStyle();
      if (style) {
        [...style.layers].reverse().forEach((l) => {
          if (l.id.startsWith("voyage-")) {
            map.removeLayer(l.id);
          }
        });

        Object.keys(style.sources).forEach((sourceId) => {
          if (sourceId.startsWith("voyage-") && map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        });
      }

      publishedVoyages.forEach((voyage) => {
        const wps = waypointsMap[voyage.id] || [];
        if (!wps.length) return;

        const routeArticleFocus =
          activeArticle && activeArticle.voyage_id === voyage.id ? getArticleVoyageFocus(activeArticle, wps) : null;

        const isFocused = routeFocusVoyageId === voyage.id;
        const isHovered = hoverFocusVoyageId === voyage.id;
        const isActive = voyage.status === "active";
        const hasComparisonFocus = Boolean(routeFocusVoyageId || hoverFocusVoyageId);
        const isDimmed = hasComparisonFocus && !isFocused && !isHovered;
        const baseColor = getVoyageStrokeColor(voyage, "base");
        const focusColor = getVoyageStrokeColor(voyage, "focus");

        const routeCoordinates = getVoyageMapLineStringCoordinates(voyage, wps, articlesForMap);

        const lineId = `voyage-line-${voyage.id}`;
        const lineCasingId = `voyage-line-casing-${voyage.id}`;
        const lineHitId = `voyage-hit-${voyage.id}`;
        if (routeCoordinates.length >= 2) {
          map.addSource(lineId, {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: routeCoordinates,
              },
              properties: {},
            },
          });

          const lineMetrics = getVoyageLineMetrics(voyage, {
            isFocused,
            isHovered,
            isDimmed,
            activeArticleFocusMode: routeArticleFocus ? (routeArticleFocus.mode === "none" ? null : routeArticleFocus.mode) : null,
          });

          map.addLayer({
            id: lineCasingId,
            type: "line",
            source: lineId,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": getVoyageStatusCasingColor(voyage),
              "line-width": lineMetrics.casingWidth,
              "line-opacity": lineMetrics.casingOpacity,
              ...(voyage.status === "planned" ? { "line-dasharray": [2.6, 3.4] } : {}),
            },
          });

          map.addLayer({
            id: lineId,
            type: "line",
            source: lineId,
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": baseColor,
              "line-width": lineMetrics.width,
              "line-opacity": lineMetrics.opacity,
              ...(getVoyageStatusDashArray(voyage) ? { "line-dasharray": getVoyageStatusDashArray(voyage) } : {}),
            },
          });

          map.addLayer({
            id: lineHitId,
            type: "line",
            source: lineId,
            paint: {
              "line-color": baseColor,
              "line-width": 30,
              "line-opacity": 0,
            },
          });

          const lineHandlers = {
            click: (e: maplibregl.MapLayerMouseEvent) => {
              e.originalEvent.stopPropagation();
              const isAlready = hoveredRouteVoyageIdRef.current === voyage.id;
              const nextId = isAlready ? null : voyage.id;
              setHoveredRouteVoyageId(nextId);
              onVoyageSelectRef.current?.(nextId);
            },
            mouseenter: () => {
              map.getCanvas().style.cursor = "pointer";
            },
            mouseleave: () => {
              map.getCanvas().style.cursor = "";
            },
          };

          lineLayerHandlersRef.current[lineHitId] = lineHandlers;
          map.on("click", lineHitId, lineHandlers.click);
          map.on("mouseenter", lineHitId, lineHandlers.mouseenter);
          map.on("mouseleave", lineHitId, lineHandlers.mouseleave);
        }

        if (routeArticleFocus?.voyageId === voyage.id) {
          if (routeArticleFocus.mode === "voyage" && routeCoordinates.length >= 2) {
            const focusLineId = `voyage-line-focus-${voyage.id}`;
            map.addSource(focusLineId, {
              type: "geojson",
              data: {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: routeCoordinates,
                },
                properties: {},
              },
            });

            map.addLayer({
              id: focusLineId,
              type: "line",
              source: focusLineId,
              paint: {
                "line-color": focusColor,
                "line-width": Math.max(1.8, 7 * getVoyageLineWidthScale(voyage)),
                "line-opacity": 0.96,
              },
            });
          }

          if (
            routeArticleFocus.mode === "segment" &&
            routeArticleFocus.startIndex != null &&
            routeArticleFocus.endIndex != null
          ) {
            const focusSegmentCoordinates = getArticleSegmentGeometry(
              wps,
              voyage.type,
              routeArticleFocus.startIndex,
              routeArticleFocus.endIndex,
              getCachedGeometryCoordinates(voyage)
            );

            if (focusSegmentCoordinates.length >= 2) {
              const focusSegmentId = `voyage-line-focus-${voyage.id}`;
              map.addSource(focusSegmentId, {
                type: "geojson",
                data: {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: focusSegmentCoordinates,
                  },
                  properties: {},
                },
              });

              map.addLayer({
                id: focusSegmentId,
                type: "line",
                source: focusSegmentId,
                paint: {
                  "line-color": focusColor,
                  "line-width": Math.max(1.8, 7 * getVoyageLineWidthScale(voyage)),
                  "line-opacity": 0.96,
                },
              });
            }
          }
        }

        /* Waypoint visibili: cluster HTML (effect separato), non layer circle */

        if (
          routeArticleFocus?.voyageId === voyage.id &&
          routeArticleFocus.mode === "point" &&
          routeArticleFocus.startIndex != null &&
          wps.length
        ) {
          const focusPointIndex = clampWaypointIndex(routeArticleFocus.startIndex, wps.length - 1);
          const focusWaypoint = wps[focusPointIndex];
          const focusPointId = `voyage-point-focus-${voyage.id}`;

          if (focusWaypoint) {
            map.addSource(focusPointId, {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: [{
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [focusWaypoint.lng, focusWaypoint.lat],
                  },
                  properties: {},
                }],
              },
            });

            map.addLayer({
              id: focusPointId,
              type: "circle",
              source: focusPointId,
              paint: {
                "circle-radius": 8,
                "circle-color": focusColor,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#fff",
              },
            });
          }
        }
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.once("load", draw);
    }

    return () => {
      map.off("load", draw);
    };
  }, [
    articlesForMap,
    clearInteractiveLayerHandlers,
    highlightedVoyageId,
    hoveredRouteVoyageId,
    lang,
    publishedVoyages,
    selectedArticleId,
    waypointsMap,
  ]);

  // Waypoint pubblici (tutti i viaggi): cluster leggeri, distinti dagli articoli
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const index = new Supercluster({
      radius: 56,
      maxZoom: 22,
      minPoints: 2,
      minZoom: 0,
    });

    index.load(
      mapWaypointClusterInputs.map((item) => ({
        type: "Feature" as const,
        properties: { id: item.key },
        geometry: {
          type: "Point" as const,
          coordinates: [item.lng, item.lat] as [number, number],
        },
      }))
    );

    waypointClusterIndexRef.current = index;
    mapWaypointsByKeyRef.current = new Map(mapWaypointClusterInputs.map((i) => [i.key, i]));

    const showWaypointPopup = (
      coords: [number, number],
      sequenceHeading: string,
      name: string,
      articleTitle: string,
      accentColor: string
    ) => {
      if (!name && !sequenceHeading) return;
      const L = langRef.current;
      const seqBlock = sequenceHeading
        ? `<div style="margin:0 0 8px;">
            <span style="display:inline-flex;align-items:center;min-height:22px;padding:0 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${accentColor};background:linear-gradient(135deg,hsla(0,0%,100%,0.95),hsl(210,25%,97%));border:1px solid hsl(220,14%,88%);box-shadow:0 1px 2px rgba(15,23,42,0.05);">${escapePopupHtml(sequenceHeading)}</span>
          </div>`
        : "";
      const articleBlock = articleTitle
        ? `<div style="margin-top:11px;padding-top:11px;border-top:1px solid hsl(220,14%,91%);">
            <span style="display:block;font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:hsl(220,10%,52%);margin-bottom:4px;">${L === "it" ? "Articolo" : "Article"}</span>
            <span style="font-size:11px;line-height:1.45;color:hsl(220,14%,34%);">${escapePopupHtml(articleTitle)}</span>
          </div>`
        : "";
      const popupHtml = `
        <div style="font-family:var(--font-sans),ui-sans-serif,system-ui,sans-serif;padding:14px 16px 15px;min-width:172px;max-width:280px;border-radius:16px;background:linear-gradient(165deg,hsl(0,0%,100%) 0%,hsl(210,40%,99.2%) 100%);box-shadow:0 14px 44px rgba(15,23,42,0.13),0 0 0 1px rgba(15,23,42,0.05);border-left:4px solid ${accentColor};">
          ${seqBlock}
          <div style="font-size:13px;font-weight:600;line-height:1.38;color:hsl(220,28%,14%);letter-spacing:-0.015em;">${escapePopupHtml(name || "—")}</div>
          ${articleBlock}
        </div>
      `;
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          offset: 14,
          closeButton: false,
          closeOnClick: false,
          closeOnMove: false,
          maxWidth: "300px",
          className: "voyage-waypoint-popup",
        });
      }
      popupRef.current.setLngLat(coords).setHTML(popupHtml).addTo(map);
    };

    const syncWaypointMarkers = () => {
      const sc = waypointClusterIndexRef.current;
      if (!sc) return;

      waypointMarkersRef.current.forEach((m) => m.remove());
      waypointMarkersRef.current = [];

      const bounds = map.getBounds();
      const zoom = Math.floor(map.getZoom());
      const clusters = sc.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom
      );

      const markerFocusVoyageId =
        highlightedVoyageIdRef.current || hoveredRouteVoyageIdRef.current || null;

      clusters.forEach((feature) => {
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          id?: string;
        };

        if (props.cluster === true) {
          const el = document.createElement("div");
          el.style.cssText = `
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            z-index:4;pointer-events:auto;
            min-width:22px;height:22px;padding:0 5px;border-radius:9999px;
            background:hsla(210, 18%, 96%, 0.96);color:hsl(220, 20%, 34%);
            font-size:10.5px;font-weight:600;font-family:var(--font-sans);
            box-shadow:0 1px 4px rgba(15,23,42,0.12);
            border:1px solid hsl(220, 14%, 82%);
          `;
          el.textContent = String(props.point_count ?? "");
          el.title =
            langRef.current === "it"
              ? `${props.point_count ?? ""} scali vicini`
              : `${props.point_count ?? ""} nearby stops`;
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cid = props.cluster_id;
            if (cid == null) return;
            const expansionZoom = Math.min(sc.getClusterExpansionZoom(cid), 19);
            map.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: 420 });
          });
          waypointMarkersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          );
          return;
        }

        const meta = mapWaypointsByKeyRef.current.get(String(props.id));
        if (!meta) return;

        const isDimmed = Boolean(
          markerFocusVoyageId && meta.voyageId !== markerFocusVoyageId
        );
        const size = 17;
        const el = document.createElement("div");
        el.style.cssText = `cursor:pointer;z-index:4;display:flex;align-items:center;justify-content:center;opacity:${isDimmed ? "0.38" : "1"};transition:opacity 0.2s ease;`;

        const dot = document.createElement("div");
        dot.style.cssText = `
          width:${size}px;height:${size}px;border-radius:50%;
          border:1.5px solid hsl(0,0%,100%);
          background:${meta.fillColor};
          box-shadow:0 1px 5px rgba(15,23,42,0.14);
          transition:transform 0.2s ease;
        `;
        el.appendChild(dot);

        const coords: [number, number] = [lng, lat];

        el.addEventListener("mouseenter", () => {
          dot.style.transform = "scale(1.12)";
          el.style.opacity = "1";
          showWaypointPopup(coords, meta.sequenceHeading, meta.name, meta.articleTitle, meta.fillColor);
        });
        el.addEventListener("mouseleave", () => {
          dot.style.transform = "scale(1)";
          if (isDimmed) el.style.opacity = "0.38";
          popupRef.current?.remove();
          popupRef.current = null;
        });

        waypointMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat(coords)
            .addTo(map)
        );
      });
    };

    runWaypointMarkersSyncRef.current = syncWaypointMarkers;

    let zoomRafWp = 0;
    const scheduleWpZoom = () => {
      if (zoomRafWp) return;
      zoomRafWp = window.requestAnimationFrame(() => {
        zoomRafWp = 0;
        syncWaypointMarkers();
      });
    };

    const onMoveEndWp = () => syncWaypointMarkers();
    map.on("moveend", onMoveEndWp);
    map.on("zoomend", onMoveEndWp);
    map.on("zoom", scheduleWpZoom);

    if (map.isStyleLoaded()) {
      syncWaypointMarkers();
    } else {
      map.once("load", syncWaypointMarkers);
    }

    return () => {
      if (zoomRafWp) window.cancelAnimationFrame(zoomRafWp);
      map.off("moveend", onMoveEndWp);
      map.off("zoomend", onMoveEndWp);
      map.off("zoom", scheduleWpZoom);
      map.off("load", syncWaypointMarkers);
      waypointMarkersRef.current.forEach((m) => m.remove());
      waypointMarkersRef.current = [];
      waypointClusterIndexRef.current = null;
      runWaypointMarkersSyncRef.current = () => {};
    };
  }, [mapWaypointClusterInputs]);

  useEffect(() => {
    runWaypointMarkersSyncRef.current();
  }, [highlightedVoyageId, hoveredRouteVoyageId]);

  // Articoli sulla mappa: Supercluster + marker (stesso stile di prima)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const index = new Supercluster({
      radius: 96,
      maxZoom: 22,
      minPoints: 2,
      minZoom: 0,
    });

    index.load(
      positionedArticles.map((article) => ({
        type: "Feature" as const,
        properties: { id: article.id },
        geometry: {
          type: "Point" as const,
          coordinates: [article.displayLng, article.displayLat] as [number, number],
        },
      }))
    );

    clusterIndexRef.current = index;
    articlesByIdRef.current = new Map(positionedArticles.map((a) => [a.id, a]));

    const syncMarkers = () => {
      const sc = clusterIndexRef.current;
      if (!sc) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const bounds = map.getBounds();
      const zoom = Math.floor(map.getZoom());
      const clusters = sc.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom
      );

      const markerFocusVoyageId =
        highlightedVoyageIdRef.current || hoveredRouteVoyageIdRef.current || null;
      const L = langRef.current;

      clusters.forEach((feature) => {
        if (feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          id?: string;
        };

        if (props.cluster === true) {
          const el = document.createElement("div");
          el.style.cssText = `
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            z-index:6;pointer-events:auto;
            min-width:36px;min-height:36px;padding:0 8px;border-radius:9999px;
            background:hsl(220,40%,22%);color:#fff;font-size:13px;font-weight:700;
            font-family:var(--font-sans);box-shadow:0 2px 10px rgba(0,0,0,0.25);
            border:2px solid #fff;
          `;
          el.textContent = String(props.point_count ?? "");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cid = props.cluster_id;
            if (cid == null) return;
            const expansionZoom = Math.min(sc.getClusterExpansionZoom(cid), 18);
            map.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: 450 });
          });
          markersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
          );
          return;
        }

        const article = articlesByIdRef.current.get(String(props.id));
        if (!article) return;

        const isSelected = article.id === selectedArticleIdRef.current;
        const isHovered = article.id === hoveredArticleIdRef.current;
        const isFocused = isSelected || isHovered;
        const isDimmed = Boolean(
          markerFocusVoyageId && article.voyage_id !== markerFocusVoyageId && !isFocused
        );
        const title = L === "en" ? article.title_en : article.title_it || article.title_en;
        const size = isFocused ? 56 : isDimmed ? 38 : 44;

        const el = document.createElement("div");
        el.className = "voyage-marker-wrap";
        el.style.cssText = `cursor:pointer;z-index:6;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:${isDimmed ? "0.32" : "1"};transition:opacity 0.25s ease;`;

        const circle = document.createElement("div");
        circle.style.cssText = `
          width:${size}px;height:${size}px;border-radius:50%;
          border:3px solid ${isFocused ? "hsl(180,20%,35%)" : "#fff"};
          background:${article.cover_image ? `url(${article.cover_image}) center/cover` : "hsl(220,40%,15%)"};
          box-shadow:${isFocused ? "0 0 0 3px hsla(180,20%,35%,0.3),0 4px 12px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.25)"};
          transition:all 0.3s ease;
        `;

        const label = document.createElement("div");
        label.textContent = title;
        label.title = title;
        const labelBase = `
          font-family:var(--font-sans);font-size:11px;font-weight:500;line-height:1.35;
          color:hsl(220,40%,15%);background:hsla(40,20%,97%,0.95);
          padding:6px 10px;border-radius:4px;
          box-shadow:0 2px 10px rgba(0,0,0,0.12);
          max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          text-align:center;pointer-events:none;
          opacity:${isFocused ? "1" : "0"};transition:opacity 0.2s,max-width 0.2s ease,box-shadow 0.2s;
        `;
        label.style.cssText = labelBase;
        if (isFocused) {
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        }

        el.appendChild(circle);
        el.appendChild(label);

        el.addEventListener("mouseenter", () => {
          circle.style.transform = "scale(1.1)";
          el.style.opacity = "1";
          label.style.opacity = "1";
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        });
        el.addEventListener("mouseleave", () => {
          if (
            article.id !== selectedArticleIdRef.current &&
            article.id !== hoveredArticleIdRef.current
          ) {
            circle.style.transform = "scale(1)";
            el.style.opacity = isDimmed ? "0.32" : "1";
            label.style.opacity = "0";
            label.style.maxWidth = "120px";
            label.style.whiteSpace = "nowrap";
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";
          }
        });

        el.addEventListener("click", () => {
          onArticleClickRef.current?.(article);
        });

        markersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([lng, lat])
            .addTo(map)
        );
      });
    };

    runArticleMarkersSyncRef.current = syncMarkers;

    let zoomRaf = 0;
    const scheduleSyncFromZoom = () => {
      if (zoomRaf) return;
      zoomRaf = window.requestAnimationFrame(() => {
        zoomRaf = 0;
        syncMarkers();
      });
    };

    const onMoveEnd = () => syncMarkers();
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);
    map.on("zoom", scheduleSyncFromZoom);

    if (map.isStyleLoaded()) {
      syncMarkers();
    } else {
      map.once("load", syncMarkers);
    }

    return () => {
      if (zoomRaf) window.cancelAnimationFrame(zoomRaf);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onMoveEnd);
      map.off("zoom", scheduleSyncFromZoom);
      map.off("load", syncMarkers);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      clusterIndexRef.current = null;
      runArticleMarkersSyncRef.current = () => {};
    };
  }, [positionedArticles]);

  useEffect(() => {
    runArticleMarkersSyncRef.current();
  }, [selectedArticleId, hoveredArticleId, highlightedVoyageId, hoveredRouteVoyageId, lang]);

  // Fly to selected article with smart bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedArticleId) return;
    const article = articles.find((a) => a.id === selectedArticleId);
    if (!article) return;

    // If article has segment bounds, fit to segment (indici risolti da UUID se presenti)
    const segmentRange =
      article.voyage_id ? resolveArticleRouteRange(article, waypointsMap[article.voyage_id] || []) : null;
    if (article.voyage_id && segmentRange) {
      const wps = waypointsMap[article.voyage_id] || [];
      const start = segmentRange[0];
      const end = segmentRange[1];
      const segWps = wps.slice(start, end + 1);
      if (segWps.length >= 2) {
        const bounds = segWps.reduce(
          (b, w) => b.extend([w.lng, w.lat]),
          new maplibregl.LngLatBounds([segWps[0].lng, segWps[0].lat], [segWps[0].lng, segWps[0].lat])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 });
        return;
      }
      if (segWps.length === 1) {
        map.flyTo({ center: [segWps[0].lng, segWps[0].lat], zoom: 10, duration: 1200 });
        return;
      }
    }

    // If full voyage
    if (article.voyage_id && !segmentRange) {
      const wps = waypointsMap[article.voyage_id] || [];
      if (wps.length >= 2) {
        const bounds = wps.reduce(
          (b, w) => b.extend([w.lng, w.lat]),
          new maplibregl.LngLatBounds([wps[0].lng, wps[0].lat], [wps[0].lng, wps[0].lat])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 });
        return;
      }
      if (wps.length === 1) {
        map.flyTo({ center: [wps[0].lng, wps[0].lat], zoom: 10, duration: 1200 });
        return;
      }
    }

    // Single point
    if (article.latitude && article.longitude) {
      map.flyTo({ center: [article.longitude, article.latitude], zoom: 10, duration: 1200 });
    }
  }, [selectedArticleId, articles, waypointsMap]);

  // Fit bounds on initial load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initialFitReady || hasPerformedInitialFitRef.current) return;

    const isValidLngLat = (value: unknown): value is [number, number] =>
      Array.isArray(value) &&
      value.length >= 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]);

    const fit = () => {
      const points: [number, number][] = [];
      publishedVoyages.forEach((voyage) => {
        const geometryCoordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        geometryCoordinates?.forEach((coordinate) => {
          if (isValidLngLat(coordinate)) {
            points.push(coordinate);
          }
        });
      });
      publishedVoyages.forEach((v) => {
        const wps = waypointsMap[v.id] || [];
        wps.forEach((w) => {
          if (Number.isFinite(w.lat) && Number.isFinite(w.lng)) {
            points.push([w.lng, w.lat]);
          }
        });
      });
      articlesForMap.forEach((a) => {
        if (Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) {
          points.push([a.longitude, a.latitude]);
        }
      });
      positionedArticles.forEach((a) => {
        points.push([a.displayLng, a.displayLat]);
      });

      try {
        if (points.length >= 2) {
          hasPerformedInitialFitRef.current = true;
          const bounds = points.reduce(
            (b, p) => b.extend(p),
            new maplibregl.LngLatBounds(points[0], points[0])
          );
          map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
        } else if (points.length === 1) {
          hasPerformedInitialFitRef.current = true;
          map.flyTo({ center: points[0], zoom: 8 });
        }
      } catch (error) {
        console.error("Failed to fit initial voyage bounds", error);
      }
    };

    if (map.isStyleLoaded()) {
      fit();
    } else {
      map.once("load", fit);
    }
  }, [initialFitReady, publishedVoyages, waypointsMap, articlesForMap, positionedArticles]);

  if (mapUnavailable) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_top,hsl(var(--muted))_0%,transparent_60%)] px-6 text-center">
        <div className="max-w-md space-y-3">
          <p className="text-sm font-sans text-muted-foreground">
            {lang === "it"
              ? "La mappa non è disponibile su questo dispositivo o browser. Passa alla vista lista per continuare."
              : "The map is unavailable on this device or browser. Switch to list view to keep browsing."}
          </p>
          {onMapUnavailable ? (
            <button
              type="button"
              onClick={onMapUnavailable}
              className="inline-flex items-center justify-center rounded-full border border-white/60 bg-background/80 px-4 py-2 text-xs font-sans text-foreground shadow-lg transition-colors hover:bg-background"
            >
              {lang === "it" ? "Apri vista lista" : "Open list view"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" aria-busy={!mapLoaded}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {!mapLoaded && !mapUnavailable ? (
        <MapLoadingPlaceholder label={lang === "it" ? "Caricamento mappa" : "Loading map"} />
      ) : null}
    </div>
  );
};

export default VoyageMap;
