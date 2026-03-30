import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Navigation, Plus, Trash2 } from "lucide-react";
import type { Language } from "@/lib/i18n";
import type { Json } from "@/integrations/supabase/types";
import {
  createEmptyArticleMapScene,
  getArticleContentBlocks,
  getArticleSceneTitle,
  normalizeArticleMapScenes,
  sortArticleMapScenesForLanguage,
  type ArticleMapScene,
} from "@/lib/article-map";

interface ArticleMiniMapEditorProps {
  value: Json | unknown;
  onChange: (next: ArticleMapScene[]) => void;
  contentEn: Json | unknown;
  contentIt: Json | unknown;
  activeLanguage: Language;
}

const ArticleMiniMapEditor = ({
  value,
  onChange,
  contentEn,
  contentIt,
  activeLanguage,
}: ArticleMiniMapEditorProps) => {
  const scenes = useMemo(() => normalizeArticleMapScenes(value), [value]);
  const contentBlocksEn = useMemo(() => getArticleContentBlocks(contentEn, "en"), [contentEn]);
  const contentBlocksIt = useMemo(() => getArticleContentBlocks(contentIt, "it"), [contentIt]);
  const sortedScenes = useMemo(
    () => sortArticleMapScenesForLanguage(scenes, activeLanguage),
    [activeLanguage, scenes]
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeMarkerRef = useRef<maplibregl.Marker | null>(null);
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

      if (map.getLayer(routeSourceId)) map.removeLayer(routeSourceId);
      if (map.getLayer(pointSourceId)) map.removeLayer(pointSourceId);
      if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
      if (map.getSource(pointSourceId)) map.removeSource(pointSourceId);

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

      if (selectedScene && typeof selectedScene.latitude === "number" && typeof selectedScene.longitude === "number") {
        const markerEl = document.createElement("div");
        markerEl.className = "flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-[rgba(255,255,255,0.92)] shadow-[0_10px_24px_rgba(15,23,42,0.18)]";
        markerEl.innerHTML = `<div style="transform: rotate(${selectedScene.wind_angle ?? 0}deg); color: hsl(201, 58%, 35%);">➤</div>`;
        activeMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([selectedScene.longitude, selectedScene.latitude])
          .addTo(map);
      }

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
  }, [activeLanguage, selectedScene, selectedSceneId, sortedScenes]);

  const updateScene = (sceneId: string, patch: Partial<ArticleMapScene>) => {
    onChange(scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)));
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

  const renderBlockOptions = (language: Language, blocks: { index: number; label: string }[]) => (
    <>
      <option value={0}>{language === "it" ? "Inizio articolo" : "Article start"}</option>
      {blocks.map((block) => (
        <option key={`${language}-${block.index}`} value={block.index}>
          {String(block.index + 1).padStart(2, "0")} · {block.label}
        </option>
      ))}
    </>
  );

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
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor EN</span>
              <select
                value={selectedScene.anchor_block_en}
                onChange={(event) => updateScene(selectedScene.id, { anchor_block_en: Number(event.target.value) })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              >
                {renderBlockOptions("en", contentBlocksEn)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor IT</span>
              <select
                value={selectedScene.anchor_block_it}
                onChange={(event) => updateScene(selectedScene.id, { anchor_block_it: Number(event.target.value) })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-accent"
              >
                {renderBlockOptions("it", contentBlocksIt)}
              </select>
            </label>
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

          <p className="text-xs text-muted-foreground">
            Clicca sulla mappa sopra per impostare o aggiornare le coordinate della scena selezionata.
          </p>
        </div>
      )}
    </section>
  );
};

export default ArticleMiniMapEditor;
