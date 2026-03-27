import { useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

// Auto-fit bounds
const FitAll = ({
  voyages,
  waypointsMap,
  articles,
}: {
  voyages: Voyage[];
  waypointsMap: Record<string, VoyageWaypoint[]>;
  articles: GeoArticle[];
}) => {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [];
    Object.values(waypointsMap).forEach((wps) =>
      wps.forEach((w) => {
        if (w.lat && w.lng) points.push([w.lat, w.lng]);
      })
    );
    articles.forEach((a) => {
      if (a.latitude && a.longitude) points.push([a.latitude, a.longitude]);
    });
    if (points.length > 1) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 12 });
    } else if (points.length === 1) {
      map.setView(points[0], 8);
    }
  }, [voyages, waypointsMap, articles, map]);
  return null;
};

// Fly to selected article
const FlyToArticle = ({ article }: { article: GeoArticle | undefined }) => {
  const map = useMap();
  useEffect(() => {
    if (article?.latitude && article?.longitude) {
      map.flyTo([article.latitude, article.longitude], 10, { duration: 1.2 });
    }
  }, [article, map]);
  return null;
};

// Custom article marker as DivIcon
const createArticleIcon = (coverImage: string | null, isSelected: boolean) => {
  const size = isSelected ? 56 : 44;
  const borderColor = isSelected ? "hsl(180, 20%, 35%)" : "white";
  const shadow = isSelected ? "0 0 0 3px hsla(180,20%,35%,0.3), 0 4px 12px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.25)";
  const bg = coverImage
    ? `background-image: url(${coverImage}); background-size: cover; background-position: center;`
    : "background: hsl(220, 40%, 15%);";

  return L.divIcon({
    className: "voyage-article-marker",
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      border: 3px solid ${borderColor};
      ${bg}
      box-shadow: ${shadow};
      transition: all 0.3s ease;
      cursor: pointer;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const VoyageMap = ({
  voyages,
  waypointsMap,
  articles,
  selectedArticleId,
  highlightedVoyageId,
  onArticleClick,
  lang,
}: VoyageMapProps) => {
  const selectedArticle = articles.find((a) => a.id === selectedArticleId);
  const geoArticles = articles.filter((a) => a.latitude && a.longitude);

  // Route colors
  const getRouteStyle = (voyage: Voyage, isHighlighted: boolean) => {
    const isWater = voyage.type === "water";
    const base = isWater ? "hsl(210, 60%, 45%)" : "hsl(30, 50%, 40%)";
    const completed = isWater ? "hsl(220, 40%, 15%)" : "hsl(30, 30%, 25%)";
    const planned = isWater ? "hsl(210, 30%, 65%)" : "hsl(30, 20%, 60%)";

    const color = voyage.status === "completed" ? completed : voyage.status === "active" ? base : planned;
    const weight = isHighlighted ? 5 : voyage.status === "active" ? 4 : 3;
    const opacity = voyage.status === "planned" ? 0.5 : isHighlighted ? 1 : 0.7;
    const dashArray = voyage.status === "planned" ? "8 6" : undefined;

    return { color, weight, opacity, dashArray };
  };

  return (
    <MapContainer
      center={[40, 15]}
      zoom={5}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={true}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitAll voyages={voyages} waypointsMap={waypointsMap} articles={articles} />
      {selectedArticle && <FlyToArticle article={selectedArticle} />}

      {/* Voyage routes */}
      {voyages.map((voyage) => {
        const wps = waypointsMap[voyage.id] || [];
        if (wps.length < 2) return null;
        const positions: [number, number][] = wps.map((w) => [w.lat, w.lng]);
        const isHighlighted = highlightedVoyageId === voyage.id;
        const style = getRouteStyle(voyage, isHighlighted);

        return (
          <Polyline
            key={voyage.id}
            positions={positions}
            pathOptions={style}
          />
        );
      })}

      {/* Waypoint dots */}
      {voyages.flatMap((voyage) => {
        const wps = waypointsMap[voyage.id] || [];
        return wps.map((wp) => (
          <CircleMarker
            key={wp.id}
            center={[wp.lat, wp.lng]}
            radius={4}
            pathOptions={{
              fillColor: voyage.status === "active" ? "hsl(180, 20%, 35%)" : "hsl(220, 10%, 70%)",
              fillOpacity: 1,
              color: "white",
              weight: 2,
            }}
          >
            {wp.name && (
              <Popup>
                <strong>{wp.name}</strong>
              </Popup>
            )}
          </CircleMarker>
        ));
      })}

      {/* Article markers as actual markers */}
      <ArticleMarkers
        articles={geoArticles}
        selectedArticleId={selectedArticleId}
        onArticleClick={onArticleClick}
        lang={lang}
      />
    </MapContainer>
  );
};

// Separate component for article markers using useMap
const ArticleMarkers = ({
  articles,
  selectedArticleId,
  onArticleClick,
  lang,
}: {
  articles: GeoArticle[];
  selectedArticleId?: string | null;
  onArticleClick?: (article: GeoArticle) => void;
  lang: "en" | "it";
}) => {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    articles.forEach((article) => {
      if (!article.latitude || !article.longitude) return;
      const isSelected = article.id === selectedArticleId;
      const icon = createArticleIcon(article.cover_image, isSelected);
      const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);

      const marker = L.marker([article.latitude, article.longitude], { icon })
        .addTo(map)
        .on("click", () => onArticleClick?.(article));

      // Tooltip with title
      marker.bindTooltip(title, {
        direction: "bottom",
        offset: [0, isSelected ? 32 : 26],
        className: "voyage-article-tooltip",
        permanent: false,
      });

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [articles, selectedArticleId, onArticleClick, lang, map]);

  return null;
};

export default VoyageMap;
