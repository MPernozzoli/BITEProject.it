import { useEffect, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";

type PositionedArticle = GeoArticle & { displayLat: number; displayLng: number };

function buildPositionedArticles(
  articles: GeoArticle[],
  waypointsMap: Record<string, VoyageWaypoint[]>
): PositionedArticle[] {
  return articles
    .map((article) => {
      if (article.latitude && article.longitude) {
        return { ...article, displayLat: article.latitude, displayLng: article.longitude };
      }
      if (article.voyage_id) {
        const wps = waypointsMap[article.voyage_id] || [];
        if (wps.length < 1) return null;
        if (article.voyage_segment_start != null && article.voyage_segment_end != null) {
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
        const mid = wps[Math.floor(wps.length / 2)];
        return { ...article, displayLat: mid.lat, displayLng: mid.lng };
      }
      return null;
    })
    .filter(Boolean) as PositionedArticle[];
}

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
  const onArticleClickRef = useRef(onArticleClick);
  const clusterIndexRef = useRef<Supercluster | null>(null);
  const articlesByIdRef = useRef<Map<string, PositionedArticle>>(new Map());

  const positionedArticles = useMemo(
    () => buildPositionedArticles(articles, waypointsMap),
    [articles, waypointsMap]
  );

  // Keep refs in sync
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

  // Articoli: cluster (pallino + conteggio) quando vicini; zoom al click; singoli con marker copertina
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const index = new Supercluster({
      radius: 72,
      maxZoom: 17,
      minPoints: 2,
    });

    index.load(
      positionedArticles.map((a) => ({
        type: "Feature" as const,
        properties: { id: a.id },
        geometry: { type: "Point" as const, coordinates: [a.displayLng, a.displayLat] },
      }))
    );

    clusterIndexRef.current = index;
    articlesByIdRef.current = new Map(positionedArticles.map((a) => [a.id, a]));

    const buildArticleMarkerElement = (article: PositionedArticle) => {
      const isSelected = article.id === selectedArticleId;
      const title = lang === "en" ? article.title_en : ((article as { title_it?: string }).title_it || article.title_en);
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

      return el;
    };

    const syncMarkers = () => {
      const sc = clusterIndexRef.current;
      if (!map || !sc) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (positionedArticles.length === 0) return;

      const b = map.getBounds();
      const bbox: [number, number, number, number] = [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ];
      const z = Math.floor(map.getZoom());
      const features = sc.getClusters(bbox, z);

      for (const feature of features) {
        const geom = feature.geometry as { type?: string; coordinates?: [number, number] };
        if (!geom?.coordinates) continue;
        const [lng, lat] = geom.coordinates;
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          point_count_abbreviated?: string | number;
          id?: string;
        };

        if (props.cluster && props.cluster_id != null) {
          const countLabel =
            props.point_count_abbreviated != null
              ? String(props.point_count_abbreviated)
              : String(props.point_count ?? "");
          const el = document.createElement("div");
          el.className = "voyage-cluster-marker";
          el.style.cssText = `
            width:48px;height:48px;border-radius:50%;
            background:hsl(210,55%,38%);color:#fff;
            font-family:var(--font-sans),system-ui,sans-serif;font-size:15px;font-weight:600;
            display:flex;align-items:center;justify-content:center;
            border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.28);
            cursor:pointer;user-select:none;
          `;
          el.textContent = countLabel;
          el.setAttribute(
            "aria-label",
            lang === "it"
              ? `${props.point_count ?? ""} articoli in questo punto`
              : `${props.point_count ?? ""} articles at this location`
          );
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const expansion = sc.getClusterExpansionZoom(props.cluster_id!);
            const nextZoom = Math.min(Math.max(expansion, z + 0.35), 18);
            map.easeTo({ center: [lng, lat], zoom: nextZoom, duration: 550 });
          });
          markersRef.current.push(
            new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map)
          );
        } else if (props.id) {
          const article = articlesByIdRef.current.get(props.id);
          if (!article) continue;
          const el = buildArticleMarkerElement(article);
          markersRef.current.push(
            new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map)
          );
        }
      }
    };

    const onReady = () => {
      syncMarkers();
    };

    if (map.isStyleLoaded()) {
      onReady();
    } else {
      map.once("load", onReady);
    }

    map.on("moveend", syncMarkers);
    map.on("zoomend", syncMarkers);

    return () => {
      map.off("moveend", syncMarkers);
      map.off("zoomend", syncMarkers);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      clusterIndexRef.current = null;
    };
  }, [positionedArticles, selectedArticleId, lang]);

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
