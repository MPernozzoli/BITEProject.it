import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";

interface VoyageMapProps {
  voyages: Voyage[];
  waypointsMap: Record<string, VoyageWaypoint[]>;
  articles: GeoArticle[];
  selectedArticleId?: string | null;
  highlightedVoyageId?: string | null;
  onArticleClick?: (article: GeoArticle) => void;
  lang: "en" | "it";
}

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  highlightedVoyageId,
  onArticleClick,
  lang,
}: VoyageMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const articlesRef = useRef(articles);
  const onArticleClickRef = useRef(onArticleClick);

  // Keep refs in sync
  articlesRef.current = articles;
  onArticleClickRef.current = onArticleClick;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

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

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw voyage routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
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
        if (wps.length < 2) return;

        const isWater = voyage.type === "water";
        const isHighlighted = highlightedVoyageId === voyage.id;
        const isActive = voyage.status === "active";
        const isCompleted = voyage.status === "completed";

        const lineColor = isWater
          ? isCompleted ? "hsl(220, 40%, 15%)" : isActive ? "hsl(210, 60%, 45%)" : "hsl(210, 30%, 65%)"
          : isCompleted ? "hsl(30, 30%, 25%)" : isActive ? "hsl(30, 50%, 40%)" : "hsl(30, 20%, 60%)";

        const lineId = `voyage-line-${voyage.id}`;
        map.addSource(lineId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: wps.map((w) => [w.lng, w.lat]),
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

        // Waypoint circles
        const wpId = `voyage-wp-${voyage.id}`;
        map.addSource(wpId, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: wps.map((w) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [w.lng, w.lat] },
              properties: { name: w.name || "" },
            })),
          },
        });

        map.addLayer({
          id: wpId,
          type: "circle",
          source: wpId,
          paint: {
            "circle-radius": isActive ? 5 : 4,
            "circle-color": isActive ? "hsl(180, 20%, 35%)" : "hsl(220, 10%, 70%)",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff",
          },
        });

        // Popup on waypoint click
        map.on("click", wpId, (e) => {
          const feature = e.features?.[0];
          const name = feature?.properties?.name;
          if (!name) return;
          const coords = (feature?.geometry as any).coordinates;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ offset: 10, closeButton: false })
            .setLngLat(coords)
            .setHTML(`<strong style="font-family:var(--font-sans);font-size:12px">${name}</strong>`)
            .addTo(map);
        });

        map.on("mouseenter", wpId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", wpId, () => { map.getCanvas().style.cursor = ""; });
      });
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.on("load", draw);
    }
  }, [voyages, waypointsMap, highlightedVoyageId]);

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
      const title = lang === "en" ? article.title_en : ((article as any).title_it || article.title_en);
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
        label.style.cssText = `
          font-family:var(--font-sans);font-size:10px;font-weight:500;
          color:hsl(220,40%,15%);background:hsla(40,20%,97%,0.9);
          padding:2px 6px;border-radius:2px;white-space:nowrap;
          max-width:120px;overflow:hidden;text-overflow:ellipsis;
          box-shadow:0 1px 4px rgba(0,0,0,0.1);
          opacity:${isSelected ? "1" : "0"};transition:opacity 0.2s;
        `;
        label.textContent = title;

        el.appendChild(circle);
        el.appendChild(label);

        el.addEventListener("mouseenter", () => {
          circle.style.transform = "scale(1.1)";
          label.style.opacity = "1";
        });
        el.addEventListener("mouseleave", () => {
          if (article.id !== selectedArticleId) {
            circle.style.transform = "scale(1)";
            label.style.opacity = "0";
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
  }, [articles, selectedArticleId, lang]);

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
    }

    // Single point
    if (article.latitude && article.longitude) {
      map.flyTo({ center: [article.longitude, article.latitude], zoom: 10, duration: 1200 });
    }
  }, [selectedArticleId, articles, waypointsMap]);

  // Fit bounds on initial load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const fit = () => {
      const points: [number, number][] = [];
      Object.values(waypointsMap).forEach((wps) =>
        wps.forEach((w) => { if (w.lat && w.lng) points.push([w.lng, w.lat]); })
      );
      articles.forEach((a) => {
        if (a.latitude && a.longitude) points.push([a.longitude, a.latitude]);
      });
      if (points.length >= 2) {
        const bounds = points.reduce(
          (b, p) => b.extend(p),
          new maplibregl.LngLatBounds(points[0], points[0])
        );
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      } else if (points.length === 1) {
        map.flyTo({ center: points[0], zoom: 8 });
      }
    };

    if (map.isStyleLoaded()) {
      fit();
    } else {
      map.on("load", fit);
    }
  }, [waypointsMap, articles]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

export default VoyageMap;
