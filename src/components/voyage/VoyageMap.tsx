import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildPublicVoyageGeometry,
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
  highlightedVoyageId?: string | null;
  onArticleClick?: (article: GeoArticle) => void;
  lang: "en" | "it";
  initialFitReady?: boolean;
}

const escapePopupHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  highlightedVoyageId,
  onArticleClick,
  lang,
  initialFitReady = true,
}: VoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const waypointLayerHandlersRef = useRef<Record<string, {
    mouseenter: (event: maplibregl.MapLayerMouseEvent) => void;
    mousemove: (event: maplibregl.MapLayerMouseEvent) => void;
    mouseleave: (event: maplibregl.MapLayerMouseEvent) => void;
  }>>({});
  const articlesRef = useRef(articles);
  const onArticleClickRef = useRef(onArticleClick);
  const hasPerformedInitialFitRef = useRef(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const clearWaypointLayerHandlers = useCallback((map: maplibregl.Map) => {
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
  articlesRef.current = articles;
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
        clearWaypointLayerHandlers(mapRef.current);
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      if (mapRef.current) {
        clearWaypointLayerHandlers(mapRef.current);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearWaypointLayerHandlers, mapUnavailable]);

  // Draw voyage routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const getCachedGeometryCoordinates = (voyage: Voyage) => {
        const coordinates = (voyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
        return Array.isArray(coordinates) ? coordinates : [];
      };

      clearWaypointLayerHandlers(map);

      // Remove old sources/layers
      voyages.forEach((v) => {
        const lineId = `voyage-line-${v.id}`;
        const wpId = `voyage-wp-${v.id}`;
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(lineId)) map.removeSource(lineId);
        if (map.getLayer(wpId)) map.removeLayer(wpId);
        if (map.getSource(wpId)) map.removeSource(wpId);
      });

      // Clean stale layers from previous renders
      const style = map.getStyle();
      if (style) {
        style.layers.forEach((l) => {
          if (l.id.startsWith("voyage-line-") || l.id.startsWith("voyage-wp-")) {
            map.removeLayer(l.id);
          }
        });
      }

      voyages.forEach((voyage) => {
        const wps = waypointsMap[voyage.id] || [];
        if (!wps.length) return;

        const isWater = voyage.type === "water";
        const isHighlighted = highlightedVoyageId === voyage.id;
        const isActive = voyage.status === "active";
        const isCompleted = voyage.status === "completed";

        const lineColor = isWater
          ? isCompleted ? "hsl(220, 40%, 15%)" : isActive ? "hsl(210, 60%, 45%)" : "hsl(210, 30%, 65%)"
          : isCompleted ? "hsl(30, 30%, 25%)" : isActive ? "hsl(30, 50%, 40%)" : "hsl(30, 20%, 60%)";

        const routeCoordinates = buildPublicVoyageGeometry(
          wps,
          voyage.type,
          articles,
          voyage.id,
          getCachedGeometryCoordinates(voyage)
        );

        const lineId = `voyage-line-${voyage.id}`;
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
              "line-color": lineColor,
              "line-width": isHighlighted ? 5 : isActive ? 4 : 3,
              "line-opacity": voyage.status === "planned" ? 0.5 : isHighlighted ? 1 : 0.7,
              ...(voyage.status === "planned" ? { "line-dasharray": [3, 2] } : {}),
            },
          });
        }

        const visibleWaypoints = getPublicVoyageWaypoints(wps, articles, voyage.id);
        if (!visibleWaypoints.length) return;

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
                  markerColor: isStart ? "hsl(136, 42%, 42%)" : isEnd ? "hsl(8, 65%, 54%)" : isActive ? "hsl(180, 20%, 35%)" : "hsl(220, 10%, 70%)",
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
          },
        });

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
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.on("load", draw);
    }
  }, [articles, clearWaypointLayerHandlers, highlightedVoyageId, lang, voyages, waypointsMap]);

  // Draw article markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
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
          if (article.voyage_segment_start != null && article.voyage_segment_end != null) {
            // Segment midpoint
            const start = Math.min(article.voyage_segment_start, wps.length - 1);
            const end = Math.min(article.voyage_segment_end, wps.length - 1);
            const midIdx = Math.round((start + end) / 2);
            const wp = wps[midIdx] || wps[0];
            return { ...article, displayLat: wp.lat, displayLng: wp.lng };
          }
          if (article.voyage_segment_start != null) {
            const wp = wps[Math.min(article.voyage_segment_start, wps.length - 1)];
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
        const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
        const size = isSelected ? 56 : 44;

        const el = document.createElement("div");
        el.className = "voyage-marker-wrap";
        el.style.cssText = `cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;`;

        const circle = document.createElement("div");
        circle.style.cssText = `
          width:${size}px;height:${size}px;border-radius:50%;
          border:3px solid ${isSelected ? "hsl(180,20%,35%)" : "#fff"};
          background:${article.cover_image ? `url(${article.cover_image}) center/cover` : "hsl(220,40%,15%)"};
          box-shadow:${isSelected ? "0 0 0 3px hsla(180,20%,35%,0.3),0 4px 12px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.25)"};
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
          opacity:${isSelected ? "1" : "0"};transition:opacity 0.2s,max-width 0.2s ease,box-shadow 0.2s;
        `;
        label.style.cssText = labelBase;
        if (isSelected) {
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        }

        el.appendChild(circle);
        el.appendChild(label);

        el.addEventListener("mouseenter", () => {
          circle.style.transform = "scale(1.1)";
          label.style.opacity = "1";
          label.style.maxWidth = "min(280px,calc(100vw - 48px))";
          label.style.whiteSpace = "normal";
          label.style.overflow = "visible";
          label.style.textOverflow = "clip";
        });
        el.addEventListener("mouseleave", () => {
          if (article.id !== selectedArticleId) {
            circle.style.transform = "scale(1)";
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
  }, [articles, selectedArticleId, lang, waypointsMap]);

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
