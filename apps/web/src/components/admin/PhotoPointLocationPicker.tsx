import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  bindMapToContainerResize,
  createCartoRasterStyle,
  isMapLibreSupported,
  requestMapResize,
} from "@/lib/maplibre";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PhotoPointLocationPickerProps = {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  /** Marks the point as read from the file rather than pinned by hand. */
  isFromExif: boolean;
};

const DEFAULT_CENTER: [number, number] = [15, 40];
const DEFAULT_ZOOM = 5;
const PINNED_ZOOM = 11;

const PhotoPointLocationPicker = ({
  lat,
  lng,
  onChange,
  isFromExif,
}: PhotoPointLocationPickerProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapUnavailable) return;

    if (!isMapLibreSupported()) {
      setMapUnavailable(true);
      return;
    }

    let map: maplibregl.Map | null = null;
    let cleanupResize: (() => void) | undefined;

    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: createCartoRasterStyle(),
        center: lat != null && lng != null ? [lng, lat] : DEFAULT_CENTER,
        zoom: lat != null && lng != null ? PINNED_ZOOM : DEFAULT_ZOOM,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => requestMapResize(map!));
      map.on("click", (event) => {
        onChangeRef.current(event.lngLat.lat, event.lngLat.lng);
      });

      cleanupResize = bindMapToContainerResize(map, containerRef.current);
      mapRef.current = map;
    } catch (error) {
      console.error("Failed to initialize the photo point picker map", error);
      setMapUnavailable(true);
    }

    return () => {
      cleanupResize?.();
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // Runs once: later coordinate changes are handled by the marker effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapUnavailable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lat == null || lng == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      const element = document.createElement("div");
      element.style.cssText = `
        width:18px;height:18px;border-radius:50%;
        border:2.5px solid hsl(0,0%,100%);
        background:hsl(18,76%,46%);
        box-shadow:0 2px 8px rgba(15,23,42,0.28);
        cursor:grab;
      `;
      markerRef.current = new maplibregl.Marker({ element, anchor: "center", draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      markerRef.current.on("dragend", () => {
        const position = markerRef.current?.getLngLat();
        if (position) onChangeRef.current(position.lat, position.lng);
      });
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }
  }, [lat, lng]);

  /** Recentres only when the coordinates arrive from EXIF; dragging must not fight the user. */
  useEffect(() => {
    if (!isFromExif || lat == null || lng == null) return;
    mapRef.current?.easeTo({ center: [lng, lat], zoom: PINNED_ZOOM, duration: 600 });
  }, [isFromExif, lat, lng]);

  const handleNumericChange = (field: "lat" | "lng") => (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    if (field === "lat") {
      if (parsed < -90 || parsed > 90) return;
      onChange(parsed, lng ?? 0);
    } else {
      if (parsed < -180 || parsed > 180) return;
      onChange(lat ?? 0, parsed);
    }
  };

  return (
    <div className="space-y-3">
      {mapUnavailable ? (
        <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-4 text-center text-sm text-muted-foreground">
          Mappa non disponibile su questo dispositivo. Inserisci le coordinate a mano.
        </div>
      ) : (
        <div
          ref={containerRef}
          className="h-[260px] w-full overflow-hidden rounded-xl border border-border"
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="photo-point-lat">Latitudine</Label>
          <Input
            id="photo-point-lat"
            type="number"
            step="0.000001"
            value={lat ?? ""}
            onChange={(event) => handleNumericChange("lat")(event.target.value)}
            placeholder="41.902"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="photo-point-lng">Longitudine</Label>
          <Input
            id="photo-point-lng"
            type="number"
            step="0.000001"
            value={lng ?? ""}
            onChange={(event) => handleNumericChange("lng")(event.target.value)}
            placeholder="12.496"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {lat == null || lng == null
          ? "Clicca sulla mappa per posizionare il punto."
          : isFromExif
            ? "Coordinate lette dalla foto. Clicca o trascina il pin per correggerle."
            : "Punto posizionato a mano. Clicca o trascina il pin per spostarlo."}
      </p>
    </div>
  );
};

export default PhotoPointLocationPicker;
