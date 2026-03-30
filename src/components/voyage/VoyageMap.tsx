import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildPublicVoyageGeometry,
  getArticleVoyageFocus,
  getArticleWaypointRange,
  getAssociatedArticleForWaypoint,
  getLocalizedWaypointName,
  getPublicVoyageWaypoints,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";

interface VoyageMapProps {
  voyages: Voyage[];
  waypointsMap: Record<string, VoyageWaypoint[]>;
  articles: GeoArticle[];
  selectedArticleId?: string | null;
  hoveredArticleId?: string | null;
  highlightedVoyageId?: string | null;
  onArticleClick?: (article: GeoArticle) => void;
  lang: "en" | "it";
  initialFitReady?: boolean;
  disableInteractions?: boolean;
}

const escapePopupHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clampWaypointIndex = (value: number, max: number) => Math.max(0, Math.min(value, max));

const getVoyageStrokeColor = (voyage: Voyage, index: number, variant: "base" | "focus" = "base") => {
  const toneShift = ((index % 5) - 2) * (voyage.type === "water" ? 5 : 4);

  if (voyage.type === "water") {
    const hue = 206 + toneShift;
    if (variant === "focus") {
      return `hsl(${hue}, 78%, 42%)`;
    }

    if (voyage.status === "completed") return `hsl(${hue - 6}, 34%, 26%)`;
    if (voyage.status === "planned") return `hsl(${hue + 4}, 28%, 70%)`;
    return `hsl(${hue}, 52%, 46%)`;
  }

  const hue = 26 + toneShift;
  if (variant === "focus") {
    return `hsl(${hue}, 76%, 42%)`;
  }

  if (voyage.status === "completed") return `hsl(${hue}, 28%, 28%)`;
  if (voyage.status === "planned") return `hsl(${hue + 4}, 22%, 68%)`;
  return `hsl(${hue}, 44%, 44%)`;
};

const getArticleSegmentGeometry = (
  waypoints: VoyageWaypoint[],
  type: Voyage["type"],
  startIndex: number,
  endIndex: number
) => {
  if (!waypoints.length) return [];

  const safeStart = clampWaypointIndex(startIndex, waypoints.length - 1);
  const safeEnd = clampWaypointIndex(endIndex, waypoints.length - 1);
  const segmentWaypoints = waypoints.slice(Math.min(safeStart, safeEnd), Math.max(safeStart, safeEnd) + 1);
  return buildPublicVoyageGeometry(segmentWaypoints, type, []);
};

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  hoveredArticleId,
  highlightedVoyageId,
  onArticleClick,
  lang,
  initialFitReady = true,
  disableInteractions = false,
}: VoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const lineLayerHandlersRef = useRef<Record<string, {
    mouseenter: () => void;
    mouseleave: () => void;
  }>>({});
  const waypointLayerHandlersRef = useRef<Record<string, {
    mouseenter: (event: maplibregl.MapLayerMouseEvent) => void;
    mousemove: (event: maplibregl.MapLayerMouseEvent) => void;
    mouseleave: (event: maplibregl.MapLayerMouseEvent) => void;
  }>>({});
  const onArticleClickRef = useRef(onArticleClick);
  const hasPerformedInitialFitRef = useRef(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [hoveredRouteVoyageId, setHoveredRouteVoyageId] = useState<string | null>(null);

  const clearInteractiveLayerHandlers = useCallback((map: maplibregl.Map) => {
    Object.entries(lineLayerHandlersRef.current).forEach(([layerId, handlers]) => {
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

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      mapRef.current = new maplibregl.Map({
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
          layers: [
            { id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 },
          ],
        },
        center: [15, 40],
        zoom: 5,
        attributionControl: false,
      });

      mapRef.current.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    } catch (error) {
      console.error("Failed to initialize voyage map", error);
      popupRef.current?.remove();
      popupRef.current = null;
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      if (mapRef.current) {
        clearInteractiveLayerHandlers(mapRef.current);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearInteractiveLayerHandlers, mapUnavailable]);

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

      const activeArticle = articles.find((article) => article.id === (hoveredArticleId ?? selectedArticleId)) || null;
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

      voyages.forEach((voyage, voyageIndex) => {
        const wps = waypointsMap[voyage.id] || [];
        if (!wps.length) return;

        const isFocused = routeFocusVoyageId === voyage.id;
        const isHovered = hoverFocusVoyageId === voyage.id;
        const isActive = voyage.status === "active";
        const hasComparisonFocus = Boolean(routeFocusVoyageId || hoverFocusVoyageId);
        const isDimmed = hasComparisonFocus && !isFocused && !isHovered;
        const baseColor = getVoyageStrokeColor(voyage, voyageIndex, "base");
        const focusColor = getVoyageStrokeColor(voyage, voyageIndex, "focus");

        const routeCoordinates = buildPublicVoyageGeometry(
          wps,
          voyage.type,
          articles,
          voyage.id,
          getCachedGeometryCoordinates(voyage)
        );

        const lineId = `voyage-line-${voyage.id}`;
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

          map.addLayer({
            id: lineId,
            type: "line",
            source: lineId,
            paint: {
              "line-color": baseColor,
              "line-width": isFocused
                ? activeArticleFocus?.mode === "voyage" ? 5.5 : 4.4
                : isHovered
                  ? 5
                  : isActive
                    ? 4
                    : 3,
              "line-opacity": isDimmed
                ? 0.16
                : voyage.status === "planned"
                  ? isFocused || isHovered ? 0.72 : 0.5
                  : isFocused || isHovered
                    ? 0.96
                    : 0.72,
              ...(voyage.status === "planned" ? { "line-dasharray": [3, 2] } : {}),
            },
          });

          map.addLayer({
            id: lineHitId,
            type: "line",
            source: lineId,
            paint: {
              "line-color": baseColor,
              "line-width": 18,
              "line-opacity": 0,
            },
          });

          const lineHandlers = {
            mouseenter: () => {
              map.getCanvas().style.cursor = "pointer";
              setHoveredRouteVoyageId((current) => current === voyage.id ? current : voyage.id);
            },
            mouseleave: () => {
              map.getCanvas().style.cursor = "";
              setHoveredRouteVoyageId((current) => current === voyage.id ? null : current);
            },
          };

          lineLayerHandlersRef.current[lineHitId] = lineHandlers;
          map.on("mouseenter", lineHitId, lineHandlers.mouseenter);
          map.on("mouseleave", lineHitId, lineHandlers.mouseleave);
        }

        if (activeArticleFocus?.voyageId === voyage.id) {
          if (activeArticleFocus.mode === "voyage" && routeCoordinates.length >= 2) {
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
                "line-width": 7,
                "line-opacity": 0.96,
              },
            });
          }

          if (
            activeArticleFocus.mode === "segment" &&
            activeArticleFocus.startIndex != null &&
            activeArticleFocus.endIndex != null
          ) {
            const focusSegmentCoordinates = getArticleSegmentGeometry(
              wps,
              voyage.type,
              activeArticleFocus.startIndex,
              activeArticleFocus.endIndex
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
                  "line-width": 7,
                  "line-opacity": 0.96,
                },
              });
            }
          }
        }

        const visibleWaypoints = getPublicVoyageWaypoints(wps, articles, voyage.id);
        if (visibleWaypoints.length) {
          const wpId = `voyage-wp-${voyage.id}`;
          map.addSource(wpId, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: visibleWaypoints.map((w, visibleIndex) => {
                const routeIndex = wps.findIndex((waypoint) => waypoint.id === w.id);
                const safeIndex = routeIndex >= 0 ? routeIndex : visibleIndex;
                const associatedArticle = getAssociatedArticleForWaypoint(articles, voyage.id, safeIndex);
                const isStart = safeIndex === 0;
                const isEnd = safeIndex === wps.length - 1;
                return {
                  type: "Feature" as const,
                  geometry: { type: "Point" as const, coordinates: [w.lng, w.lat] },
                  properties: {
                    name: getLocalizedWaypointName(w, lang, safeIndex),
                    articleTitle: associatedArticle
                      ? lang === "en"
                        ? associatedArticle.title_en
                        : associatedArticle.title_it || associatedArticle.title_en
                      : "",
                    markerColor: isStart
                      ? "hsl(136, 42%, 42%)"
                      : isEnd
                        ? "hsl(8, 65%, 54%)"
                        : isActive
                          ? "hsl(180, 20%, 35%)"
                          : "hsl(220, 10%, 70%)",
                    markerRadius: isStart || isEnd ? 5 : isActive ? 5 : 4,
                  },
                };
              }),
            },
          });

          map.addLayer({
            id: wpId,
            type: "circle",
            source: wpId,
            paint: {
              "circle-radius": ["coalesce", ["get", "markerRadius"], isActive ? 5 : 4],
              "circle-color": ["coalesce", ["get", "markerColor"], isActive ? "hsl(180, 20%, 35%)" : "hsl(220, 10%, 70%)"],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
              "circle-opacity": isDimmed ? 0.24 : 1,
              "circle-stroke-opacity": isDimmed ? 0.45 : 1,
            },
          });

          if (
            activeArticleFocus?.voyageId === voyage.id &&
            activeArticleFocus.mode === "point" &&
            activeArticleFocus.startIndex != null
          ) {
            const focusPointIndex = clampWaypointIndex(activeArticleFocus.startIndex, wps.length - 1);
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

          const renderWaypointHoverPopup = (event: maplibregl.MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            if (!feature?.geometry || feature.geometry.type !== "Point") return;
            const coords = feature.geometry.coordinates as [number, number];
            const name = String(feature.properties?.name || "");
            const articleTitle = String(feature.properties?.articleTitle || "");
            if (!name) return;

            const popupHtml = `
              <div style="display:grid;gap:4px;font-family:var(--font-sans);min-width:160px;max-width:240px;">
                <strong style="font-size:12px;line-height:1.35;color:hsl(220,40%,15%);">${escapePopupHtml(name)}</strong>
                ${articleTitle
                  ? `<span style="font-size:11px;line-height:1.4;color:hsl(220,15%,40%);">${lang === "it" ? "Articolo" : "Article"}: ${escapePopupHtml(articleTitle)}</span>`
                  : ""}
              </div>
            `;

            if (!popupRef.current) {
              popupRef.current = new maplibregl.Popup({
                offset: 12,
                closeButton: false,
                closeOnClick: false,
                closeOnMove: false,
                maxWidth: "260px",
              });
            }

            popupRef.current.setLngLat(coords).setHTML(popupHtml).addTo(map);
          };

          const handlers = {
            mouseenter: (event: maplibregl.MapLayerMouseEvent) => {
              map.getCanvas().style.cursor = "pointer";
              renderWaypointHoverPopup(event);
            },
            mousemove: (event: maplibregl.MapLayerMouseEvent) => {
              renderWaypointHoverPopup(event);
            },
            mouseleave: () => {
              map.getCanvas().style.cursor = "";
              popupRef.current?.remove();
              popupRef.current = null;
            },
          };

          waypointLayerHandlersRef.current[wpId] = handlers;
          map.on("mouseenter", wpId, handlers.mouseenter);
          map.on("mousemove", wpId, handlers.mousemove);
          map.on("mouseleave", wpId, handlers.mouseleave);
        }
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.on("load", draw);
    }
  }, [
    articles,
    clearInteractiveLayerHandlers,
    highlightedVoyageId,
    hoveredArticleId,
    hoveredRouteVoyageId,
    lang,
    selectedArticleId,
    voyages,
    waypointsMap,
  ]);

  // Draw article markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const markerFocusVoyageId = highlightedVoyageId || hoveredRouteVoyageId || null;

      // Clear old markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Compute article positions: use lat/lng if present, else derive from voyage
      const positionedArticles = articles.map((article) => {
        if (article.latitude && article.longitude) {
          return { ...article, displayLat: article.latitude, displayLng: article.longitude };
        }
        // If associated to a voyage with segments
        if (article.voyage_id) {
          const wps = waypointsMap[article.voyage_id] || [];
          if (wps.length < 1) return null;
          const range = getArticleWaypointRange(article);
          if (range) {
            const start = clampWaypointIndex(range[0], wps.length - 1);
            const end = clampWaypointIndex(range[1], wps.length - 1);
            const midIdx = Math.round((start + end) / 2);
            const wp = wps[midIdx] || wps[0];
            return { ...article, displayLat: wp.lat, displayLng: wp.lng };
          }
          // Full voyage - use midpoint
          const mid = wps[Math.floor(wps.length / 2)];
          return { ...article, displayLat: mid.lat, displayLng: mid.lng };
        }
        return null;
      }).filter(Boolean) as (GeoArticle & { displayLat: number; displayLng: number })[];

      positionedArticles.forEach((article) => {
        const isSelected = article.id === selectedArticleId;
        const isHovered = article.id === hoveredArticleId;
        const isFocused = isSelected || isHovered;
        const isDimmed = Boolean(markerFocusVoyageId && article.voyage_id !== markerFocusVoyageId && !isFocused);
        const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
        const size = isFocused ? 56 : isDimmed ? 38 : 44;

        const el = document.createElement("div");
        el.className = "voyage-marker-wrap";
        el.style.cssText = `cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:${isDimmed ? "0.32" : "1"};transition:opacity 0.25s ease;`;

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
          if (article.id !== selectedArticleId && article.id !== hoveredArticleId) {
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

        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([article.displayLng, article.displayLat])
          .addTo(map);

        markersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.on("load", draw);
    }
  }, [articles, highlightedVoyageId, hoveredArticleId, hoveredRouteVoyageId, lang, selectedArticleId, waypointsMap]);

  // Fly to selected article with smart bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedArticleId) return;
    const article = articles.find((a) => a.id === selectedArticleId);
    if (!article) return;

    // If article has segment bounds, fit to segment
    if (article.voyage_id && article.voyage_segment_start != null && article.voyage_segment_end != null) {
      const wps = waypointsMap[article.voyage_id] || [];
      const start = Math.min(article.voyage_segment_start, wps.length - 1);
      const end = Math.min(article.voyage_segment_end, wps.length - 1);
      const segWps = wps.slice(start, end + 1);
      if (segWps.length >= 2) {
        const bounds = segWps.reduce(
          (b, w) => b.extend([w.lng, w.lat]),
          new maplibregl.LngLatBounds([segWps[0].lng, segWps[0].lat], [segWps[0].lng, segWps[0].lat])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 });
        return;
      }
    }

    // If full voyage
    if (article.voyage_id && article.voyage_segment_start == null && article.voyage_segment_end == null) {
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
      voyages.forEach((voyage) => {
        const geometryCoordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        geometryCoordinates?.forEach((coordinate) => {
          if (isValidLngLat(coordinate)) {
            points.push(coordinate);
          }
        });
      });
      Object.values(waypointsMap).forEach((wps) =>
        wps.forEach((w) => {
          if (Number.isFinite(w.lat) && Number.isFinite(w.lng)) {
            points.push([w.lng, w.lat]);
          }
        })
      );
      articles.forEach((a) => {
        if (Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) {
          points.push([a.longitude, a.latitude]);
        }
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
  }, [initialFitReady, voyages, waypointsMap, articles]);

  if (mapUnavailable) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_top,hsl(var(--muted))_0%,transparent_60%)] px-6 text-center">
        <p className="max-w-md text-sm font-sans text-muted-foreground">
          {lang === "it"
            ? "La mappa non è disponibile su questo dispositivo. Passa alla vista lista per continuare."
            : "The map is unavailable on this device. Switch to list view to keep browsing."}
        </p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

export default VoyageMap;
