import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bindMapToTheme,
  createThemedCartoStyle } from "@/lib/maplibre";
import {
  Anchor,
  Camera,
  Circle,
  Expand,
  MapPin,
  Navigation,
  Plus,
  Ship,
  Trash2,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "@/lib/i18n";
import type { Json } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  buildVesselRouteCoordinates,
  calculateBearingDegrees,
  calculateDistanceNm,
  calculatePolylineDistanceNm,
  createEmptyArticleMapOverlay,
  createEmptyArticleMapScene,
  createEmptyArticleMapVessel,
  destinationPoint,
  getArticleSceneCameraCenter,
  getRouteTerminalAngle,
  getArticleSceneTitle,
  normalizeArticleMapScenes,
  sortArticleMapScenesForLanguage,
  type ArticleMapOverlay,
  type ArticleMapOverlayKind,
  type ArticleMapRoutePattern,
  type ArticleMapScene,
  type ArticleMapVessel,
} from "@/lib/article-map";

interface ArticleMiniMapEditorProps {
  value: Json | unknown;
  onChange: (next: ArticleMapScene[]) => void;
  activeLanguage: Language;
  primaryRouteCoordinates?: [number, number][] | null;
}

type PlacementTool = "scene" | "vessel" | "anchor" | "buoy" | "current" | "wind";
type RouteTool = Extract<PlacementTool, "vessel" | "current" | "wind">;
type PendingPlacement = {
  tool: RouteTool;
  sceneId: string;
  entityId: string;
  latitude: number;
  longitude: number;
};

type FreeformRouteDraft = {
  sceneId: string;
  vesselId: string;
};

const TOOLBAR_TOOLS: Array<{
  id: PlacementTool;
  label: string;
  icon: LucideIcon;
  description: string;
}> = [
  { id: "scene", label: "Scene point", icon: MapPin, description: "Place or move the scene marker." },
  { id: "vessel", label: "Boat", icon: Ship, description: "First click places the boat, second click sets its route." },
  { id: "anchor", label: "Anchor", icon: Anchor, description: "Place an anchor marker." },
  { id: "buoy", label: "Buoy", icon: Circle, description: "Place a buoy marker." },
  { id: "current", label: "Current", icon: Waves, description: "First click places the current, second click sets its route." },
  { id: "wind", label: "Wind", icon: Navigation, description: "First click places the wind marker, second click sets its route." },
];

const OVERLAY_CONFIG: Record<ArticleMapOverlayKind, { symbol: string; color: string }> = {
  anchor: { symbol: "⚓", color: "hsl(209, 46%, 32%)" },
  buoy: { symbol: "●", color: "hsl(18, 76%, 46%)" },
  current: { symbol: "➝", color: "hsl(168, 52%, 34%)" },
  wind: { symbol: "➤", color: "hsl(201, 58%, 35%)" },
};

const VESSEL_ROUTE_PATTERNS: Array<{ value: ArticleMapRoutePattern; label: string }> = [
  { value: "straight", label: "Straight" },
  { value: "tack", label: "Tack / zig-zag" },
  { value: "figure8", label: "Figure-8" },
  { value: "freeform", label: "Freeform" },
];

const formatCoordinate = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "Not set";

const isRouteTool = (tool: PlacementTool): tool is RouteTool =>
  tool === "vessel" || tool === "current" || tool === "wind";

const ArticleMiniMapWorkspace = ({
  value,
  onChange,
  activeLanguage,
  primaryRouteCoordinates = null,
  selectedSceneId,
  onSelectedSceneIdChange,
  isFullscreen = false,
  onRequestFullscreen,
}: ArticleMiniMapEditorProps & {
  selectedSceneId: string | null;
  onSelectedSceneIdChange: (sceneId: string | null) => void;
  isFullscreen?: boolean;
  onRequestFullscreen?: () => void;
}) => {
  const scenes = useMemo(() => normalizeArticleMapScenes(value), [value]);
  const sortedScenes = useMemo(
    () => sortArticleMapScenesForLanguage(scenes, activeLanguage),
    [activeLanguage, scenes]
  );
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sceneMarkersRef = useRef<maplibregl.Marker[]>([]);
  const scenesRef = useRef(scenes);
  const selectedSceneIdRef = useRef<string | null>(selectedSceneId);
  const activeToolRef = useRef<PlacementTool>("scene");
  const pendingPlacementRef = useRef<PendingPlacement | null>(null);
  const handleMapClickRef = useRef<(longitude: number, latitude: number) => void>(() => undefined);
  const [activeTool, setActiveTool] = useState<PlacementTool>("scene");
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [freeformRouteDraft, setFreeformRouteDraft] = useState<FreeformRouteDraft | null>(null);
  const [visibleCamera, setVisibleCamera] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  useEffect(() => {
    selectedSceneIdRef.current = selectedSceneId;
  }, [selectedSceneId]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    pendingPlacementRef.current = pendingPlacement;
  }, [pendingPlacement]);

  useEffect(() => {
    if (!pendingPlacement) return;
    if (pendingPlacement.sceneId !== selectedSceneId) {
      setPendingPlacement(null);
    }
  }, [pendingPlacement, selectedSceneId]);

  useEffect(() => {
    if (!freeformRouteDraft) return;
    if (freeformRouteDraft.sceneId !== selectedSceneId) {
      setFreeformRouteDraft(null);
      return;
    }
    const draftScene = scenes.find((scene) => scene.id === freeformRouteDraft.sceneId);
    if (!draftScene?.vessels.some((vessel) => vessel.id === freeformRouteDraft.vesselId)) {
      setFreeformRouteDraft(null);
    }
  }, [freeformRouteDraft, scenes, selectedSceneId]);

  const commitScenes = (transform: (current: ArticleMapScene[]) => ArticleMapScene[]) => {
    onChange(transform(scenesRef.current));
  };

  const updateScene = (sceneId: string, patch: Partial<ArticleMapScene>) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
    );
  };

  const updateVessel = (sceneId: string, vesselId: string, patch: Partial<ArticleMapVessel>) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, vessels: scene.vessels.map((vessel) => (vessel.id === vesselId ? { ...vessel, ...patch } : vessel)) }
          : scene
      )
    );
  };

  const updateOverlay = (sceneId: string, overlayId: string, patch: Partial<ArticleMapOverlay>) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, overlays: scene.overlays.map((overlay) => (overlay.id === overlayId ? { ...overlay, ...patch } : overlay)) }
          : scene
      )
    );
  };

  const placeScenePoint = (sceneId: string, latitude: number, longitude: number) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        return {
          ...scene,
          latitude,
          longitude,
          camera_latitude: scene.camera_latitude ?? latitude,
          camera_longitude: scene.camera_longitude ?? longitude,
        };
      })
    );
  };

  const addPlacedVessel = (sceneId: string, latitude: number, longitude: number) => {
    const vessel = createEmptyArticleMapVessel(Date.now());
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, vessels: [...scene.vessels, { ...vessel, latitude, longitude }] }
          : scene
      )
    );
    return vessel.id;
  };

  const appendVesselRoutePoint = (sceneId: string, vesselId: string, latitude: number, longitude: number) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;

        return {
          ...scene,
          vessels: scene.vessels.map((vessel) => {
            if (vessel.id !== vesselId) return vessel;

            const nextRoutePoints = [...vessel.route_points, { latitude, longitude }];
            const routeCoordinates = buildVesselRouteCoordinates({
              ...vessel,
              route_pattern: "freeform",
              route_points: nextRoutePoints,
            });
            const routeAngle = getRouteTerminalAngle(routeCoordinates);
            const routePointPairs = routeCoordinates.map(([pointLongitude, pointLatitude]) => ({
              latitude: pointLatitude,
              longitude: pointLongitude,
            }));

            return {
              ...vessel,
              route_pattern: "freeform",
              route_points: nextRoutePoints,
              route_heading: routeAngle,
              route_distance_nm: Number(calculatePolylineDistanceNm(routePointPairs).toFixed(2)),
              heading: routeAngle ?? vessel.heading,
            };
          }),
        };
      })
    );
  };

  const removeLastVesselRoutePoint = (sceneId: string, vesselId: string) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;

        return {
          ...scene,
          vessels: scene.vessels.map((vessel) => {
            if (vessel.id !== vesselId) return vessel;
            const nextRoutePoints = vessel.route_points.slice(0, -1);
            const routeCoordinates = buildVesselRouteCoordinates({
              ...vessel,
              route_pattern: "freeform",
              route_points: nextRoutePoints,
            });
            const routeAngle = getRouteTerminalAngle(routeCoordinates);
            const routePointPairs = routeCoordinates.map(([pointLongitude, pointLatitude]) => ({
              latitude: pointLatitude,
              longitude: pointLongitude,
            }));

            return {
              ...vessel,
              route_points: nextRoutePoints,
              route_heading: routeAngle,
              route_distance_nm: nextRoutePoints.length
                ? Number(calculatePolylineDistanceNm(routePointPairs).toFixed(2))
                : null,
              heading: routeAngle ?? vessel.heading,
            };
          }),
        };
      })
    );
  };

  const addPlacedOverlay = (sceneId: string, kind: ArticleMapOverlayKind, latitude: number, longitude: number) => {
    const overlay = createEmptyArticleMapOverlay(kind, Date.now());
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, overlays: [...scene.overlays, { ...overlay, latitude, longitude }] }
          : scene
      )
    );
    return overlay.id;
  };

  const finishRoutePlacement = (route: PendingPlacement, latitude: number, longitude: number) => {
    const heading = Number(calculateBearingDegrees(route.latitude, route.longitude, latitude, longitude).toFixed(1));
    const distance = Number(calculateDistanceNm(route.latitude, route.longitude, latitude, longitude).toFixed(2));

    if (route.tool === "vessel") {
      updateVessel(route.sceneId, route.entityId, {
        heading,
        route_pattern: "straight",
        route_heading: heading,
        route_distance_nm: distance,
        route_points: [],
      });
      return;
    }

    updateOverlay(route.sceneId, route.entityId, {
      angle: heading,
      route_distance_nm: distance,
    });
  };

  const handleMapClick = (longitude: number, latitude: number) => {
    const currentSceneId = selectedSceneIdRef.current;
    if (!currentSceneId) return;

    const freeformDraft = freeformRouteDraft;
    if (freeformDraft && freeformDraft.sceneId === currentSceneId) {
      appendVesselRoutePoint(currentSceneId, freeformDraft.vesselId, latitude, longitude);
      return;
    }

    const pending = pendingPlacementRef.current;
    if (pending && pending.sceneId === currentSceneId) {
      finishRoutePlacement(pending, latitude, longitude);
      setPendingPlacement(null);
      return;
    }

    const tool = activeToolRef.current;

    if (tool === "scene") {
      placeScenePoint(currentSceneId, latitude, longitude);
      return;
    }

    if (tool === "vessel") {
      const vesselId = addPlacedVessel(currentSceneId, latitude, longitude);
      setPendingPlacement({ tool, sceneId: currentSceneId, entityId: vesselId, latitude, longitude });
      return;
    }

    if (tool === "anchor" || tool === "buoy") {
      addPlacedOverlay(currentSceneId, tool, latitude, longitude);
      return;
    }

    const overlayId = addPlacedOverlay(currentSceneId, tool, latitude, longitude);
    setPendingPlacement({ tool, sceneId: currentSceneId, entityId: overlayId, latitude, longitude });
  };
  handleMapClickRef.current = handleMapClick;

  const captureCurrentView = () => {
    const map = mapRef.current;
    const currentSceneId = selectedSceneIdRef.current;
    if (!map || !currentSceneId) return;

    const center = map.getCenter();
    updateScene(currentSceneId, {
      camera_latitude: Number(center.lat.toFixed(6)),
      camera_longitude: Number(center.lng.toFixed(6)),
      zoom: Number(map.getZoom().toFixed(2)),
    });
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: createThemedCartoStyle(),
      center: [15, 40],
      zoom: 4,
      attributionControl: false,
    });

    // La basemap segue il tema anche se cambia a mappa aperta.
    bindMapToTheme(map);

    const updateVisibleCamera = () => {
      const center = map.getCenter();
      setVisibleCamera({
        latitude: Number(center.lat.toFixed(6)),
        longitude: Number(center.lng.toFixed(6)),
        zoom: Number(map.getZoom().toFixed(2)),
      });
    };

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.once("load", () => {
      requestAnimationFrame(() => map.resize());
      updateVisibleCamera();
    });
    map.on("click", (event) => {
      handleMapClickRef.current(event.lngLat.lng, event.lngLat.lat);
    });
    map.on("moveend", updateVisibleCamera);
    mapRef.current = map;

    return () => {
      activeMarkerRef.current?.remove();
      activeMarkerRef.current = null;
      sceneMarkersRef.current.forEach((marker) => marker.remove());
      sceneMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    requestAnimationFrame(() => map.resize());
  }, [isFullscreen]);

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
      const overlayRouteSourceId = "article-scene-overlay-routes";
      const primaryRouteSourceId = "article-scene-primary-route";

      if (map.getLayer(routeSourceId)) map.removeLayer(routeSourceId);
      if (map.getLayer(pointSourceId)) map.removeLayer(pointSourceId);
      if (map.getLayer(vesselRouteSourceId)) map.removeLayer(vesselRouteSourceId);
      if (map.getLayer(overlayRouteSourceId)) map.removeLayer(overlayRouteSourceId);
      if (map.getLayer(primaryRouteSourceId)) map.removeLayer(primaryRouteSourceId);
      if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
      if (map.getSource(pointSourceId)) map.removeSource(pointSourceId);
      if (map.getSource(vesselRouteSourceId)) map.removeSource(vesselRouteSourceId);
      if (map.getSource(overlayRouteSourceId)) map.removeSource(overlayRouteSourceId);
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
        markerEl.className =
          "flex h-10 w-10 items-center justify-center rounded-full border border-glass-edge/70 bg-[rgba(255,255,255,0.92)] shadow-[0_10px_24px_rgba(15,23,42,0.18)]";
        markerEl.innerHTML = `<div style="transform: rotate(${selectedScene.wind_angle ?? 0}deg); color: hsl(201, 58%, 35%);">➤</div>`;
        activeMarkerRef.current = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([selectedScene.longitude, selectedScene.latitude])
          .addTo(map);
      }

      const vesselRouteFeatures = (selectedScene?.vessels || []).flatMap((vessel) => {
        const routeCoordinates = buildVesselRouteCoordinates(vessel);
        if (routeCoordinates.length < 2) return [];

        return [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: routeCoordinates,
          },
          properties: {
            color: vessel.color,
          },
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
            "line-color": ["coalesce", ["get", "color"], "hsl(201, 68%, 34%)"],
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.75,
          },
        });
      }

      const overlayRouteFeatures = (selectedScene?.overlays || []).flatMap((overlay) => {
        if (
          (overlay.kind !== "current" && overlay.kind !== "wind") ||
          typeof overlay.latitude !== "number" ||
          typeof overlay.longitude !== "number" ||
          typeof overlay.angle !== "number" ||
          typeof overlay.route_distance_nm !== "number" ||
          overlay.route_distance_nm <= 0
        ) {
          return [];
        }

        const destination = destinationPoint(overlay.latitude, overlay.longitude, overlay.angle, overlay.route_distance_nm);
        return [{
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [overlay.longitude, overlay.latitude],
              [destination.longitude, destination.latitude],
            ],
          },
          properties: {
            kind: overlay.kind,
          },
        }];
      });

      if (overlayRouteFeatures.length) {
        map.addSource(overlayRouteSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: overlayRouteFeatures },
        });
        map.addLayer({
          id: overlayRouteSourceId,
          type: "line",
          source: overlayRouteSourceId,
          paint: {
            "line-color": ["match", ["get", "kind"], "current", "hsl(168, 52%, 34%)", "hsl(201, 58%, 35%)"],
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.7,
          },
        });
      }

      const createMarkerElement = (symbol: string, color: string, angle?: number | null, label?: string) => {
        const element = document.createElement("div");
        element.className =
          "flex min-w-[34px] max-w-[140px] items-center gap-1.5 rounded-full border border-glass-edge/75 bg-[rgba(255,255,255,0.94)] px-2 py-1 shadow-[0_10px_22px_rgba(15,23,42,0.18)]";
        element.innerHTML = `
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;font-size:14px;color:${color};transform:rotate(${angle ?? 0}deg);">${symbol}</span>
          ${label ? `<span style="font:600 11px/1.2 ui-sans-serif,system-ui;color:rgba(15,23,42,0.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>` : ""}
        `;
        return element;
      };

      const vesselMarkers = (selectedScene?.vessels || []).flatMap((vessel) => {
        if (typeof vessel.latitude !== "number" || typeof vessel.longitude !== "number") return [];
        const routeCoordinates = buildVesselRouteCoordinates(vessel);
        const routeAngle = getRouteTerminalAngle(routeCoordinates);
        const routeEnd = routeCoordinates.length > 1 ? routeCoordinates[routeCoordinates.length - 1] : null;

        return [
          new maplibregl.Marker({
            element: createMarkerElement("⛵", vessel.color, vessel.heading, vessel.name || undefined),
            anchor: "center",
          }).setLngLat([vessel.longitude, vessel.latitude]).addTo(map),
          ...(routeEnd && routeAngle != null
            ? [new maplibregl.Marker({
                element: createMarkerElement("➤", vessel.color, routeAngle),
                anchor: "center",
              }).setLngLat(routeEnd).addTo(map)]
            : []),
        ];
      });

      const overlayMarkers = (selectedScene?.overlays || []).flatMap((overlay) => {
        if (typeof overlay.latitude !== "number" || typeof overlay.longitude !== "number") return [];
        const config = OVERLAY_CONFIG[overlay.kind];
        return [
          new maplibregl.Marker({
            element: createMarkerElement(config.symbol, config.color, overlay.angle, overlay.label_en || overlay.label_it || undefined),
            anchor: "center",
          }).setLngLat([overlay.longitude, overlay.latitude]).addTo(map),
        ];
      });

      sceneMarkersRef.current = [...vesselMarkers, ...overlayMarkers];

      const cameraCenter = selectedScene ? getArticleSceneCameraCenter(selectedScene) : null;
      if (cameraCenter) {
        map.easeTo({
          center: [cameraCenter.longitude, cameraCenter.latitude],
          zoom: selectedScene?.zoom || 7.5,
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
    onSelectedSceneIdChange(nextScene.id);
  };

  const removeScene = (sceneId: string) => {
    const nextScenes = scenes.filter((scene) => scene.id !== sceneId);
    onChange(nextScenes);
    onSelectedSceneIdChange(nextScenes[0]?.id ?? null);
  };

  const addVessel = (sceneId: string) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, vessels: [...scene.vessels, createEmptyArticleMapVessel(scene.vessels.length)] }
          : scene
      )
    );
  };

  const removeVessel = (sceneId: string, vesselId: string) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, vessels: scene.vessels.filter((vessel) => vessel.id !== vesselId) }
          : scene
      )
    );
  };

  const addOverlay = (sceneId: string, kind: ArticleMapOverlayKind) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, overlays: [...scene.overlays, createEmptyArticleMapOverlay(kind, scene.overlays.length)] }
          : scene
      )
    );
  };

  const removeOverlay = (sceneId: string, overlayId: string) => {
    commitScenes((currentScenes) =>
      currentScenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, overlays: scene.overlays.filter((overlay) => overlay.id !== overlayId) }
          : scene
      )
    );
  };

  const cameraCenter = selectedScene ? getArticleSceneCameraCenter(selectedScene) : null;
  const activeToolMeta = TOOLBAR_TOOLS.find((tool) => tool.id === activeTool);
  const freeformDraftVessel = selectedScene?.vessels.find((vessel) => vessel.id === freeformRouteDraft?.vesselId) ?? null;
  const pendingMessage = freeformDraftVessel
    ? `Freeform route: click on the map to append points for ${freeformDraftVessel.name || "the selected boat"}.`
    : pendingPlacement
    ? pendingPlacement.tool === "vessel"
      ? "Second click: set boat route."
      : pendingPlacement.tool === "current"
        ? "Second click: set current route."
        : "Second click: set wind route."
    : activeToolMeta?.description ?? "";

  return (
    <section className={cn("space-y-4 border border-border p-4", isFullscreen && "h-full overflow-y-auto border-0")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-sans tracking-[0.18em] uppercase text-muted-foreground">
            <MapPin size={12} className="mr-1 inline" /> Article Mini Map
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Scene sincronizzate allo scroll, con camera indipendente dal marker e piazzamento diretto sulla mappa.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={addScene}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <Plus size={14} /> Add scene
          </button>
          {onRequestFullscreen ? (
            <button
              type="button"
              onClick={onRequestFullscreen}
              className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
            >
              <Expand size={14} /> Fullscreen
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 border border-border/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Map toolbar</p>
            <p className="text-xs text-muted-foreground">{pendingMessage}</p>
          </div>
          <button
            type="button"
            onClick={captureCurrentView}
            disabled={!selectedSceneId}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Save the current map view as the scene camera"
          >
            <Camera size={13} /> Save current view
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {TOOLBAR_TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setActiveTool(tool.id);
                  if (!isRouteTool(tool.id)) setPendingPlacement(null);
                  setFreeformRouteDraft(null);
                }}
                className={cn(
                  "inline-flex items-center gap-2 border px-3 py-2 text-xs transition-colors",
                  activeTool === tool.id
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                )}
                title={tool.description}
              >
                <Icon size={13} />
                {tool.label}
              </button>
            );
          })}
          {pendingPlacement || freeformRouteDraft ? (
            <button
              type="button"
              onClick={() => {
                setPendingPlacement(null);
                setFreeformRouteDraft(null);
              }}
              className="inline-flex items-center gap-2 border border-destructive/40 px-3 py-2 text-xs text-destructive transition-colors hover:border-destructive"
            >
              Cancel route edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <div
          ref={mapContainerRef}
          className={cn(
            "w-full overflow-hidden border border-border bg-muted",
            isFullscreen ? "h-[52vh] min-h-[420px]" : "aspect-[4/3]"
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            Visible view: {visibleCamera ? `${formatCoordinate(visibleCamera.latitude)}, ${formatCoordinate(visibleCamera.longitude)} · z${visibleCamera.zoom.toFixed(2)}` : "Move the map to inspect the scene"}
          </span>
          <span>
            Saved camera: {cameraCenter ? `${formatCoordinate(cameraCenter.latitude)}, ${formatCoordinate(cameraCenter.longitude)} · z${selectedScene?.zoom.toFixed(2)}` : "Fallbacks to the scene point"}
          </span>
        </div>
      </div>

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
              onClick={() => onSelectedSceneIdChange(scene.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectedSceneIdChange(scene.id);
                }
              }}
              className={cn(
                "flex items-center justify-between gap-3 border px-3 py-3 text-left transition-colors",
                selectedSceneId === scene.id ? "border-accent bg-accent/5" : "border-border hover:border-foreground/30"
              )}
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

      {selectedScene ? (
        <div className="grid gap-4 border border-border p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Title EN</span>
              <input
                type="text"
                value={selectedScene.title_en}
                onChange={(event) => updateScene(selectedScene.id, { title_en: event.target.value })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Titolo IT</span>
              <input
                type="text"
                value={selectedScene.title_it}
                onChange={(event) => updateScene(selectedScene.id, { title_it: event.target.value })}
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
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
                className="w-full resize-none border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Descrizione IT</span>
              <textarea
                rows={3}
                value={selectedScene.description_it}
                onChange={(event) => updateScene(selectedScene.id, { description_it: event.target.value })}
                className="w-full resize-none border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-border px-3 py-3">
              <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor EN</p>
              <p className="mt-1 text-sm text-foreground">{selectedScene.anchor_preview_en || "No linked text yet"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Select text in the English editor, then right click and choose this scene.
              </p>
            </div>
            <div className="border border-border px-3 py-3">
              <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Anchor IT</p>
              <p className="mt-1 text-sm text-foreground">{selectedScene.anchor_preview_it || "Nessun testo collegato"}</p>
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
                onChange={(event) =>
                  updateScene(selectedScene.id, {
                    latitude: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Longitude</span>
              <input
                type="number"
                step="0.000001"
                value={selectedScene.longitude ?? ""}
                onChange={(event) =>
                  updateScene(selectedScene.id, {
                    longitude: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
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
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-border px-3 py-3">
              <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Saved camera center</p>
              <p className="mt-1 text-sm text-foreground">
                {cameraCenter ? `${formatCoordinate(cameraCenter.latitude)}, ${formatCoordinate(cameraCenter.longitude)}` : "Uses the scene point"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Muovi la mappa come vuoi mostrarla nell'articolo, poi premi il pulsante con la camera.
              </p>
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
                onChange={(event) =>
                  updateScene(selectedScene.id, {
                    wind_angle: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Wind label EN</span>
              <input
                type="text"
                value={selectedScene.wind_label_en}
                onChange={(event) => updateScene(selectedScene.id, { wind_label_en: event.target.value })}
                placeholder="e.g. 18 kn NE"
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">Wind label IT</span>
              <input
                type="text"
                value={selectedScene.wind_label_it}
                onChange={(event) => updateScene(selectedScene.id, { wind_label_it: event.target.value })}
                placeholder="es. 18 kn NE"
                className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 border border-border/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">
                  <Ship size={12} className="mr-1 inline" /> Boats
                </p>
                <p className="text-xs text-muted-foreground">Nome, colore e rotte straight, tack, figure-8 o freeform.</p>
              </div>
              <button
                type="button"
                onClick={() => addVessel(selectedScene.id)}
                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground"
              >
                <Plus size={13} /> Add boat
              </button>
            </div>
            {selectedScene.vessels.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessuna barca in questa scena. Usa la toolbar e clicca sulla mappa per aggiungerla.</p>
            )}
            {selectedScene.vessels.map((vessel, index) => (
              <div key={vessel.id} className="grid gap-3 border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    Boat {String(index + 1).padStart(2, "0")}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeVessel(selectedScene.id, vessel.id)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Name</span>
                    <input
                      type="text"
                      value={vessel.name}
                      onChange={(event) => updateVessel(selectedScene.id, vessel.id, { name: event.target.value })}
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Heading</span>
                    <input
                      type="number"
                      min={0}
                      max={360}
                      value={vessel.heading ?? ""}
                      onChange={(event) =>
                        updateVessel(selectedScene.id, vessel.id, {
                          heading: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Color</span>
                    <input
                      type="color"
                      value={vessel.color}
                      onChange={(event) => updateVessel(selectedScene.id, vessel.id, { color: event.target.value })}
                      className="h-10 w-full border border-border bg-transparent p-1"
                    />
                  </label>
                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route pattern</span>
                    <select
                      value={vessel.route_pattern}
                      onChange={(event) => {
                        const nextPattern = event.target.value as ArticleMapRoutePattern;
                        if (nextPattern !== "freeform" && freeformRouteDraft?.vesselId === vessel.id) {
                          setFreeformRouteDraft(null);
                        }
                        updateVessel(selectedScene.id, vessel.id, {
                          route_pattern: nextPattern,
                          route_points: nextPattern === "freeform" ? vessel.route_points : [],
                        });
                      }}
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    >
                      {VESSEL_ROUTE_PATTERNS.map((pattern) => (
                        <option key={pattern.value} value={pattern.value}>
                          {pattern.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Latitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={vessel.latitude ?? ""}
                      onChange={(event) =>
                        updateVessel(selectedScene.id, vessel.id, {
                          latitude: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Longitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={vessel.longitude ?? ""}
                      onChange={(event) =>
                        updateVessel(selectedScene.id, vessel.id, {
                          longitude: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route heading</span>
                    <input
                      type="number"
                      min={0}
                      max={360}
                      value={vessel.route_heading ?? ""}
                      onChange={(event) =>
                        updateVessel(selectedScene.id, vessel.id, {
                          route_heading: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route length (nm)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={vessel.route_distance_nm ?? ""}
                      onChange={(event) =>
                        updateVessel(selectedScene.id, vessel.id, {
                          route_distance_nm: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                {vessel.route_pattern === "freeform" && (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <div className="flex items-center border border-border px-3 py-2 text-[11px] text-muted-foreground">
                      La rotta libera usa questa barca come punto iniziale e mantiene il colore scelto.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFreeformRouteDraft((currentDraft) =>
                          currentDraft?.vesselId === vessel.id && currentDraft.sceneId === selectedScene.id
                            ? null
                            : { sceneId: selectedScene.id, vesselId: vessel.id }
                        )
                      }
                      className={cn(
                        "border px-3 py-2 text-xs transition-colors",
                        freeformRouteDraft?.vesselId === vessel.id && freeformRouteDraft.sceneId === selectedScene.id
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                      )}
                    >
                      {freeformRouteDraft?.vesselId === vessel.id && freeformRouteDraft.sceneId === selectedScene.id ? "Stop drawing" : "Draw route"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLastVesselRoutePoint(selectedScene.id, vessel.id)}
                      disabled={vessel.route_points.length === 0}
                      className="border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Undo point
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateVessel(selectedScene.id, vessel.id, {
                          route_points: [],
                          route_heading: null,
                          route_distance_nm: null,
                        })
                      }
                      disabled={vessel.route_points.length === 0}
                      className="border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear route
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-3 border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-sans tracking-[0.16em] uppercase text-muted-foreground">
                  <Anchor size={12} className="mr-1 inline" /> Nautical overlays
                </p>
                <p className="text-xs text-muted-foreground">Ancora, gavitello, corrente e vento piazzabili dalla toolbar o dai pulsanti qui sotto.</p>
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
                  <button
                    type="button"
                    onClick={() => removeOverlay(selectedScene.id, overlay.id)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:border-destructive hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Kind</span>
                    <select
                      value={overlay.kind}
                      onChange={(event) =>
                        updateOverlay(selectedScene.id, overlay.id, { kind: event.target.value as ArticleMapOverlayKind })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    >
                      <option value="anchor">Anchor</option>
                      <option value="buoy">Buoy</option>
                      <option value="current">Current</option>
                      <option value="wind">Wind</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Label EN</span>
                    <input
                      type="text"
                      value={overlay.label_en}
                      onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { label_en: event.target.value })}
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Label IT</span>
                    <input
                      type="text"
                      value={overlay.label_it}
                      onChange={(event) => updateOverlay(selectedScene.id, overlay.id, { label_it: event.target.value })}
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Latitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={overlay.latitude ?? ""}
                      onChange={(event) =>
                        updateOverlay(selectedScene.id, overlay.id, {
                          latitude: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Longitude</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={overlay.longitude ?? ""}
                      onChange={(event) =>
                        updateOverlay(selectedScene.id, overlay.id, {
                          longitude: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      <Waves size={11} className="mr-1 inline" /> Angle
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={360}
                      value={overlay.angle ?? ""}
                      onChange={(event) =>
                        updateOverlay(selectedScene.id, overlay.id, {
                          angle: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                {(overlay.kind === "current" || overlay.kind === "wind") && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Route length (nm)</span>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={overlay.route_distance_nm ?? ""}
                        onChange={(event) =>
                          updateOverlay(selectedScene.id, overlay.id, {
                            route_distance_nm: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      />
                    </label>
                    <div className="flex items-end border border-border px-3 py-2 text-[11px] text-muted-foreground">
                      Toolbar workflow: first click places the marker, second click defines direction and length.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            La toolbar controlla i click sulla mappa: usa "Scene point" per spostare la scena, oppure scegli un elemento e clicca direttamente sulla carta per piazzarlo.
          </p>
        </div>
      ) : null}
    </section>
  );
};

const ArticleMiniMapEditor = ({
  value,
  onChange,
  activeLanguage,
  primaryRouteCoordinates = null,
}: ArticleMiniMapEditorProps) => {
  const scenes = useMemo(() => normalizeArticleMapScenes(value), [value]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!scenes.length) {
      setSelectedSceneId(null);
      return;
    }

    if (!selectedSceneId || !scenes.some((scene) => scene.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0].id);
    }
  }, [scenes, selectedSceneId]);

  return (
    <>
      <ArticleMiniMapWorkspace
        value={value}
        onChange={onChange}
        activeLanguage={activeLanguage}
        primaryRouteCoordinates={primaryRouteCoordinates}
        selectedSceneId={selectedSceneId}
        onSelectedSceneIdChange={setSelectedSceneId}
        onRequestFullscreen={() => setIsFullscreen(true)}
      />

      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="h-[96vh] max-w-[98vw] overflow-hidden border border-border bg-background p-0 sm:rounded-2xl">
          <DialogTitle className="sr-only">Article mini map fullscreen editor</DialogTitle>
          <DialogDescription className="sr-only">
            Fullscreen workspace for building article map scenes, markers, and routes.
          </DialogDescription>
          <ArticleMiniMapWorkspace
            value={value}
            onChange={onChange}
            activeLanguage={activeLanguage}
            primaryRouteCoordinates={primaryRouteCoordinates}
            selectedSceneId={selectedSceneId}
            onSelectedSceneIdChange={setSelectedSceneId}
            isFullscreen
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ArticleMiniMapEditor;
