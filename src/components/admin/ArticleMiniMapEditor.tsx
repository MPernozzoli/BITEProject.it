import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Navigation, Plus, Trash2, Ship, Anchor, Waves } from "lucide-react";
import type { Language } from "@/lib/i18n";
import type { Json } from "@/integrations/supabase/types";
import {
  createEmptyArticleMapScene,
  createEmptyArticleMapOverlay,
  createEmptyArticleMapVessel,
  getArticleSceneTitle,
  normalizeArticleMapScenes,
  sortArticleMapScenesForLanguage,
  type ArticleMapOverlay,
  type ArticleMapOverlayKind,
  type ArticleMapScene,
  type ArticleMapVessel,
} from "@/lib/article-map";

interface ArticleMiniMapEditorProps {
  value: Json | unknown;
  onChange: (next: ArticleMapScene[]) => void;
  activeLanguage: Language;
  primaryRouteCoordinates?: [number, number][] | null;
}

const ArticleMiniMapEditor = ({
  value,
  onChange,
  activeLanguage,
  primaryRouteCoordinates = null,
}: ArticleMiniMapEditorProps) => {
  const scenes = useMemo(() => normalizeArticleMapScenes(value), [value]);
  const sortedScenes = useMemo(
    () => sortArticleMapScenesForLanguage(scenes, activeLanguage),
    [activeLanguage, scenes]
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sceneMarkersRef = useRef<maplibregl.Marker[]>([]);
  const scenesRef = useRef(scenes);
  const selectedSceneIdRef = useRef<string | null>(selectedSceneId);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  useEffect(() => {
    selectedSceneIdRef.current = selectedSceneId;
  }, [selectedSceneId]);

  useEffect(() => {
    if (!scenes.length) {
      setSelectedSceneId(null);
      return;
    }

    if (!selectedSceneId || !scenes.some((scene) => scene.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0].id);
    }
  }, [scenes, selectedSceneId]);

  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? null;

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
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
          },
        },
        layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
      },
      center: [15, 40],
      zoom: 4,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.once("load", () => requestAnimationFrame(() => map.resize()));
    map.on("click", (event) => {
      const currentSelectedSceneId = selectedSceneIdRef.current;
      if (!currentSelectedSceneId) return;

      onChange(scenesRef.current.map((scene) => (
        scene.id === currentSelectedSceneId
          ? { ...scene, longitude: event.lngLat.lng, latitude: event.lngLat.lat }
          : scene
      )));
    });

    mapRef.current = map;

    return () => {
      activeMarkerRef.current?.remove();
      activeMarkerRef.current = null;
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [onChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const coordinates = sortedScenes
        .filter((scene) => typeof scene.latitude === "number" && typeof scene.longitude === "number")
        .map((scene) => [scene.longitude as number, scene.latitude as number]);

      const featureCollection = {
        type: "FeatureCollection" as const,
        features: sortedScenes.flatMap((scene) => {
          if (typeof scene.latitude !== "number" || typeof scene.longitude !== "number") return [];
          return [{
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [scene.longitude, scene.latitude] as [number, number],
            },
            properties: {
              id: scene.id,
              active: scene.id === selectedSceneId,
              title: getArticleSceneTitle(scene, activeLanguage) || "Untitled",
            },
          }];
        }),
      };

      const routeSourceId = "article-scene-route";
      const pointSourceId = "article-scene-points";
      const vesselRouteSourceId = "article-scene-vessel-routes";
      const primaryRouteSourceId = "article-scene-primary-route";

      if (map.getLayer(routeSourceId)) map.removeLayer(routeSourceId);
      if (map.getLayer(pointSourceId)) map.removeLayer(pointSourceId);
      if (map.getLayer(vesselRouteSourceId)) map.removeLayer(vesselRouteSourceId);
      if (map.getLayer(primaryRouteSourceId)) map.removeLayer(primaryRouteSourceId);
      if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
      if (map.getSource(pointSourceId)) map.removeSource(pointSourceId);
      if (map.getSource(vesselRouteSourceId)) map.removeSource(vesselRouteSourceId);
      if (map.getSource(primaryRouteSourceId)) map.removeSource(primaryRouteSourceId);

      if (coordinates.length > 1) {
        map.addSource(routeSourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties: {},
          },
        });
        map.addLayer({
          id: routeSourceId,
          type: "line",
          source: routeSourceId,
          paint: {
            "line-color": "hsl(201, 58%, 42%)",
            "line-width": 3,
            "line-opacity": 0.6,
          },
        });
      }

      if (selectedScene?.show_main_route && primaryRouteCoordinates && primaryRouteCoordinates.length > 1) {
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

      if (featureCollection.features.length) {
        map.addSource(pointSourceId, { type: "geojson", data: featureCollection });
        map.addLayer({
          id: pointSourceId,
          type: "circle",
          source: pointSourceId,
          paint: {
            "circle-radius": ["case", ["==", ["get", "active"], true], 7, 5],
            "circle-color": ["case", ["==", ["get", "active"], true], "hsl(201, 58%, 38%)", "hsl(201, 42%, 70%)"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "rgba(255,255,255,0.92)",
          },
        });
      }

      activeMarkerRef.current?.remove();
      activeMarkerRef.current = null;
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];

      if (selectedScene && typeof selectedScene.latitude === "number" && typeof selectedScene.longitude === "number") {
        const markerEl = document.createElement("div");
        markerEl.className = "flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-[rgba(255,255,255,0.92)] shadow-[0_10px_24px_rgba(15,23,42,0.18)]";
        markerEl.innerHTML = `<div style="transform: rotate(${selectedScene.wind_angle ?? 0}deg); color: hsl(201, 58%, 35%);">➤</div>`;
        activeMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([selectedScene.longitude, selectedScene.latitude])
          .addTo(map);
      }

      const destinationPoint = (latitudeValue: number, longitudeValue: number, bearingDegrees: number, distanceNm: number) => {
        const earthRadiusKm = 6371;
        const distanceKm = distanceNm * 1.852;
        const angularDistance = distanceKm / earthRadiusKm;
        const bearing = (bearingDegrees * Math.PI) / 180;
        const latitudeRadians = (latitudeValue * Math.PI) / 180;
        const longitudeRadians = (longitudeValue * Math.PI) / 180;

        const nextLatitude = Math.asin(
          Math.sin(latitudeRadians) * Math.cos(angularDistance) +
          Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing)
        );
        const nextLongitude = longitudeRadians + Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
          Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitude)
        );

        return {
          latitude: (nextLatitude * 180) / Math.PI,
          longitude: (nextLongitude * 180) / Math.PI,
        };
      };

      const vesselRouteFeatures = (selectedScene?.vessels || []).flatMap((vessel) => {
        if (
          typeof vessel.latitude !== "number" ||
          typeof vessel.longitude !== "number" ||
          typeof vessel.route_heading !== "number" ||
          typeof vessel.route_distance_nm !== "number" ||
          vessel.route_distance_nm <= 0
        ) {
          return [];
        }

        const destination = destinationPoint(vessel.latitude, vessel.longitude, vessel.route_heading, vessel.route_distance_nm);
        return [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [vessel.longitude, vessel.latitude],
              [destination.longitude, destination.latitude],
            ],
          },
          properties: {},
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
            "line-color": "hsl(201, 68%, 34%)",
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.75,
          },
        });
      }

      const createMarkerElement = (symbol: string, color: string, angle?: number | null, label?: string) => {
        const element = document.createElement("div");
        element.className = "flex min-w-[34px] max-w-[140px] items-center gap-1.5 rounded-full border border-white/75 bg-[rgba(255,255,255,0.94)] px-2 py-1 shadow-[0_10px_22px_rgba(15,23,42,0.18)]";
        element.innerHTML = `
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;font-size:14px;color:${color};transform:rotate(${angle ?? 0}deg);">${symbol}</span>
          ${label ? `<span style="font:600 11px/1.2 ui-sans-serif,system-ui;color:rgba(15,23,42,0.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>` : ""}
        `;
        return element;
      };

      const vesselMarkers = (selectedScene?.vessels || []).flatMap((vessel) => {
        if (typeof vessel.latitude !== "number" || typeof vessel.longitude !== "number") return [];
        return [
          new maplibregl.Marker({
            element: createMarkerElement("⛵", "hsl(201, 58%, 35%)", vessel.heading, vessel.name || undefined),
            anchor: "center",
          }).setLngLat([vessel.longitude, vessel.latitude]).addTo(map),
        ];
      });

      const overlayConfig: Record<ArticleMapOverlayKind, { symbol: string; color: string }> = {
        anchor: { symbol: "⚓", color: "hsl(209, 46%, 32%)" },
        buoy: { symbol: "●", color: "hsl(18, 76%, 46%)" },
        current: { symbol: "➝", color: "hsl(168, 52%, 34%)" },
        wind: { symbol: "➤", color: "hsl(201, 58%, 35%)" },
      };

      const overlayMarkers = (selectedScene?.overlays || []).flatMap((overlay) => {
        if (typeof overlay.latitude !== "number" || typeof overlay.longitude !== "number") return [];
        const config = overlayConfig[overlay.kind];
        return [
          new maplibregl.Marker({
            element: createMarkerElement(config.symbol, config.color, overlay.angle, overlay.label_en || overlay.label_it || undefined),
            anchor: "center",
          }).setLngLat([overlay.longitude, overlay.latitude]).addTo(map),
        ];
      });

      sceneMarkersRef.current = [...vesselMarkers, ...overlayMarkers];

      if (selectedScene && typeof selectedScene.latitude === "number" && typeof selectedScene.longitude === "number") {
        map.easeTo({
          center: [selectedScene.longitude, selectedScene.latitude],
          zoom: selectedScene.zoom || 7.5,
          duration: 450,
        });
      } else if (coordinates.length > 1) {
        const bounds = coordinates.reduce(
          (acc, coordinate) => acc.extend(coordinate as [number, number]),
          new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number])
        );
        map.fitBounds(bounds, { padding: 42, duration: 0, maxZoom: 8.5 });
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [activeLanguage, primaryRouteCoordinates, selectedScene, selectedSceneId, sortedScenes]);

  const updateScene = (sceneId: string, patch: Partial<ArticleMapScene>) => {
    onChange(scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)));
  };

  const updateVessel = (sceneId: string, vesselId: string, patch: Partial<ArticleMapVessel>) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, vessels: scene.vessels.map((vessel) => (vessel.id === vesselId ? { ...vessel, ...patch } : vessel)) }
        : scene
    )));
  };

  const updateOverlay = (sceneId: string, overlayId: string, patch: Partial<ArticleMapOverlay>) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, overlays: scene.overlays.map((overlay) => (overlay.id === overlayId ? { ...overlay, ...patch } : overlay)) }
        : scene
    )));
  };

  const addScene = () => {
    const lastScene = scenes[scenes.length - 1];
    const nextScene = {
      ...createEmptyArticleMapScene(scenes.length),
      anchor_block_en: lastScene?.anchor_block_en ?? 0,
      anchor_block_it: lastScene?.anchor_block_it ?? 0,
      zoom: lastScene?.zoom ?? 7.5,
    };
    const nextScenes = [...scenes, nextScene];
    onChange(nextScenes);
    setSelectedSceneId(nextScene.id);
  };

  const removeScene = (sceneId: string) => {
    const nextScenes = scenes.filter((scene) => scene.id !== sceneId);
    onChange(nextScenes);
    setSelectedSceneId(nextScenes[0]?.id ?? null);
  };

  const addVessel = (sceneId: string) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, vessels: [...scene.vessels, createEmptyArticleMapVessel(scene.vessels.length)] }
        : scene
    )));
  };

  const removeVessel = (sceneId: string, vesselId: string) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, vessels: scene.vessels.filter((vessel) => vessel.id !== vesselId) }
        : scene
    )));
  };

  const addOverlay = (sceneId: string, kind: ArticleMapOverlayKind) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, overlays: [...scene.overlays, createEmptyArticleMapOverlay(kind, scene.overlays.length)] }
        : scene
    )));
  };

  const removeOverlay = (sceneId: string, overlayId: string) => {
    onChange(scenes.map((scene) => (
      scene.id === sceneId
        ? { ...scene, overlays: scene.overlays.filter((overlay) => overlay.id !== overlayId) }
        : scene
    )));
  };

  return (
    <section className="space-y-4 border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
            <MapPin size={12} className="mr-1 inline" /> Article Mini Map
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Scene sincronizzate allo scroll, con ancoraggi separati per inglese e italiano.
          </p>
        </div>
        <button
          type="button"
          onClick={addScene}
          className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
        >
          <Plus size={14} /> Add scene
        </button>
      </div>

      <div ref={mapContainerRef} className="aspect-[4/3] w-full overflow-hidden border border-border bg-muted" />

      <div className="grid gap-3">
        {scenes.length === 0 && (
          <div className="border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            Nessuna scena configurata. Aggiungi almeno un punto per attivare la minimappa narrativa.
          </div>
        )}

        {scenes.map((scene, index) => {
          const title = getArticleSceneTitle(scene, activeLanguage) || `Scene ${index + 1}`;
          const hasCoordinates = typeof scene.latitude === "number" && typeof scene.longitude === "number";

          return (
            <div
              key={scene.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedSceneId(scene.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedSceneId(scene.id);
                }
              }}
              className={`flex items-center justify-between gap-3 border px-3 py-3 text-left transition-colors ${
                selectedSceneId === scene.id ? "border-accent bg-accent/5" : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-sans tracking-[0.16em] uppercase text-muted-foreground">
                  Scene {String(index + 1).padStart(2, "0")}
                </p>
                <p className="truncate text-sm font-medium text-foreground">{title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasCoordinates ? `${scene.latitude?.toFixed(3)}, ${scene.longitude?.toFixed(3)}` : "No coordinates yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeScene(scene.id);
                }}
                className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                aria-label="Remove scene"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {selectedScene && (
        <div className="grid gap-4 border border-border p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Title EN</span>
              <input
                type="text"
                value={selectedScene.title_en}
                onChange={(event) => updateScene(selectedScene.id, { title_en: event.target.value })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Titolo IT</span>
              <input
                type="text"
                value={selectedScene.title_it}
                onChange={(event) => updateScene(selectedScene.id, { title_it: event.target.value })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Description EN</span>
              <textarea
                rows={3}
                value={selectedScene.description_en}
                onChange={(event) => updateScene(selectedScene.id, { description_en: event.target.value })}
                className="w-full resize-none border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Descrizione IT</span>
              <textarea
                rows={3}
                value={selectedScene.description_it}
                onChange={(event) => updateScene(selectedScene.id, { description_it: event.target.value })}
                className="w-full resize-none border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-border px-3 py-3">
              <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor EN</p>
              <p className="mt-1 text-sm text-foreground">
                {selectedScene.anchor_preview_en || "No linked text yet"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Select text in the English editor, then right click and choose this scene.
              </p>
            </div>
            <div className="border border-border px-3 py-3">
              <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor IT</p>
              <p className="mt-1 text-sm text-foreground">
                {selectedScene.anchor_preview_it || "Nessun testo collegato"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Seleziona il testo nell'editor italiano, tasto destro e collega questa scena.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Latitude</span>
              <input
                type="number"
                step="0.000001"
                value={selectedScene.latitude ?? ""}
                onChange={(event) => updateScene(selectedScene.id, { latitude: event.target.value === "" ? null : Number(event.target.value) })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Longitude</span>
              <input
                type="number"
                step="0.000001"
                value={selectedScene.longitude ?? ""}
                onChange={(event) => updateScene(selectedScene.id, { longitude: event.target.value === "" ? null : Number(event.target.value) })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Zoom</span>
              <input
                type="number"
                step="0.1"
                min={1}
                max={16}
                value={selectedScene.zoom}
                onChange={(event) => updateScene(selectedScene.id, { zoom: Number(event.target.value) || 7.5 })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
          </div>

          <label className="flex items-center gap-3 border border-border px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={selectedScene.show_main_route}
              onChange={(event) => updateScene(selectedScene.id, { show_main_route: event.target.checked })}
              className="h-4 w-4"
            />
            <span>
              {activeLanguage === "it"
                ? "Mostra overlay della rotta principale associata all'articolo"
                : "Show the main route overlay linked to this article"}
            </span>
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">
                <Navigation size={11} className="mr-1 inline" /> Wind angle
              </span>
              <input
                type="number"
                min={0}
                max={360}
                value={selectedScene.wind_angle ?? ""}
                onChange={(event) => updateScene(selectedScene.id, { wind_angle: event.target.value === "" ? null : Number(event.target.value) })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Wind label EN</span>
              <input
                type="text"
                value={selectedScene.wind_label_en}
                onChange={(event) => updateScene(selectedScene.id, { wind_label_en: event.target.value })}
                placeholder="e.g. 18 kn NE"
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Wind label IT</span>
              <input
                type="text"
                value={selectedScene.wind_label_it}
                onChange={(event) => updateScene(selectedScene.id, { wind_label_it: event.target.value })}
                placeholder="es. 18 kn NE"
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="grid gap-3 border border-border/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">
                  <Ship size={12} className="mr-1 inline" /> Boats
                </p>
                <p className="text-xs text-muted-foreground">Nome, orientamento e rotta diretta davanti alla barca.</p>
              </div>
              <button type="button" onClick={() => addVessel(selectedScene.id)} className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">
                <Plus size={13} /> Add boat
              </button>
            </div>
            {selectedScene.vessels.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessuna barca in questa scena.</p>
            )}
            {selectedScene.vessels.map((vessel, index) => (
              <div key={vessel.id} className="grid gap-3 border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">Boat {String(index + 1).padStart(2, "0")}</p>
                  <button type="button" onClick={() => removeVessel(selectedScene.id, vessel.id)} className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-destructive hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Name</span>
                    <input type="text" value={vessel.name} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { name: event.target.value })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Heading</span>
                    <input type="number" min={0} max={360} value={vessel.heading ?? ""} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { heading: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Latitude</span>
                    <input type="number" step="0.000001" value={vessel.latitude ?? ""} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { latitude: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Longitude</span>
                    <input type="number" step="0.000001" value={vessel.longitude ?? ""} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { longitude: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route heading</span>
                    <input type="number" min={0} max={360} value={vessel.route_heading ?? ""} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { route_heading: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route length (nm)</span>
                    <input type="number" min={0} step="0.1" value={vessel.route_distance_nm ?? ""} onChange={(event) => updateVessel(selectedScene.id, vessel.id, { route_distance_nm: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">
                  <Anchor size={12} className="mr-1 inline" /> Nautical overlays
                </p>
                <p className="text-xs text-muted-foreground">Ancora, gavitello, corrente, vento e altri marker di situazione.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => addOverlay(selectedScene.id, "anchor")} className="border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">Anchor</button>
                <button type="button" onClick={() => addOverlay(selectedScene.id, "buoy")} className="border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">Buoy</button>
                <button type="button" onClick={() => addOverlay(selectedScene.id, "current")} className="border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">Current</button>
                <button type="button" onClick={() => addOverlay(selectedScene.id, "wind")} className="border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">Wind</button>
              </div>
            </div>
            {selectedScene.overlays.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessun overlay in questa scena.</p>
            )}
            {selectedScene.overlays.map((overlay, index) => (
              <div key={overlay.id} className="grid gap-3 border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    {overlay.kind} {String(index + 1).padStart(2, "0")}
                  </p>
                  <button type="button" onClick={() => removeOverlay(selectedScene.id, overlay.id)} className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-destructive hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Kind</span>
                    <select value={overlay.kind} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { kind: event.target.value as ArticleMapOverlayKind })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent">
                      <option value="anchor">Anchor</option>
                      <option value="buoy">Buoy</option>
                      <option value="current">Current</option>
                      <option value="wind">Wind</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Label EN</span>
                    <input type="text" value={overlay.label_en} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { label_en: event.target.value })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Label IT</span>
                    <input type="text" value={overlay.label_it} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { label_it: event.target.value })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Latitude</span>
                    <input type="number" step="0.000001" value={overlay.latitude ?? ""} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { latitude: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Longitude</span>
                    <input type="number" step="0.000001" value={overlay.longitude ?? ""} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { longitude: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      <Waves size={11} className="mr-1 inline" /> Angle
                    </span>
                    <input type="number" min={0} max={360} value={overlay.angle ?? ""} onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { angle: event.target.value === "" ? null : Number(event.target.value) })} className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Clicca sulla mappa sopra per impostare o aggiornare le coordinate della scena selezionata.
          </p>
        </div>
      )}
    </section>
  );
};

export default ArticleMiniMapEditor;
