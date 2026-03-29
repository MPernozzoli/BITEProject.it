import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useI18n } from "@/lib/i18n";
import { MapPin } from "lucide-react";

interface ArticleMapAsideProps {
  latitude: number;
  longitude: number;
  title: string;
}

/** Mappa compatta a lato articolo, centrata sulla georef */
const ArticleMapAside = ({ latitude, longitude, title }: ArticleMapAsideProps) => {
  const { lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    try {
      if (!(maplibregl as any).supported?.()) {
        setMapUnavailable(true);
        return;
      }
    } catch { /* supported check unavailable, proceed */ }

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
          layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
        },
        center: [longitude, latitude],
        zoom: 10,
        attributionControl: {},
      });

      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      mapRef.current.once("load", () => {
        requestAnimationFrame(() => mapRef.current?.resize());
      });

      markerRef.current = new maplibregl.Marker({ color: "hsl(210, 55%, 38%)" })
        .setLngLat([longitude, latitude])
        .addTo(mapRef.current);
    } catch (error) {
      console.error("Failed to initialize article map", error);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapUnavailable(true);
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, mapUnavailable]);

  return (
    <div className="glass-panel rounded-[28px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b glass-divider">
        <MapPin size={14} className="text-accent shrink-0" />
        <span className="text-[11px] font-sans text-muted-foreground tracking-wide truncate" title={title}>
          {lang === "it" ? "Posizione articolo" : "Article location"}
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
        <div ref={containerRef} className="w-full h-[280px] md:h-[320px]" />
      )}
    </div>
  );
};

export default ArticleMapAside;
