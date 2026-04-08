import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useI18n } from "@/lib/i18n";
import { MapPin } from "lucide-react";

export interface ArticleMapAsideProps {
  latitude: number;
  longitude: number;
  title: string;
  scenes?: unknown[];
  activeSceneId?: string | null;
  camera?: { latitude: number; longitude: number; zoom: number } | null;
  primaryRouteCoordinates?: [number, number][] | null;
  distanceValue?: number | null;
  distanceUnit?: "KM" | "NM" | null;
}

/** Mappa compatta a lato articolo, centrata sulla georef */
const ArticleMapAside = ({ latitude, longitude, title }: ArticleMapAsideProps) => {
  const { lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

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
        layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
      },
      center: [longitude, latitude],
      zoom: 10,
      attributionControl: true,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    mapRef.current.once("load", () => {
      requestAnimationFrame(() => mapRef.current?.resize());
    });

    markerRef.current = new maplibregl.Marker({ color: "hsl(210, 55%, 38%)" })
      .setLngLat([longitude, latitude])
      .addTo(mapRef.current);

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  return (
    <div className="border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/80">
        <MapPin size={14} className="text-accent shrink-0" />
        <span className="text-[11px] font-sans text-muted-foreground tracking-wide truncate" title={title}>
          {lang === "it" ? "Posizione articolo" : "Article location"}
        </span>
      </div>
      <div ref={containerRef} className="w-full h-[280px] md:h-[320px]" />
    </div>
  );
};

export default ArticleMapAside;
