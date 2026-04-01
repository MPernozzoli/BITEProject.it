import type { Json } from "@/integrations/supabase/types";
import type { Language } from "@/lib/i18n";

export type ArticleMapScene = {
  id: string;
  title_en: string;
  title_it: string;
  description_en: string;
  description_it: string;
  wind_label_en: string;
  wind_label_it: string;
  latitude: number | null;
  longitude: number | null;
  camera_latitude: number | null;
  camera_longitude: number | null;
  zoom: number;
  anchor_id_en: string;
  anchor_id_it: string;
  anchor_preview_en: string;
  anchor_preview_it: string;
  anchor_block_en: number;
  anchor_block_it: number;
  wind_angle: number | null;
  show_main_route: boolean;
  vessels: ArticleMapVessel[];
  overlays: ArticleMapOverlay[];
};

export type ArticleMapVessel = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  color: string;
  heading: number | null;
  route_pattern: ArticleMapRoutePattern;
  route_heading: number | null;
  route_distance_nm: number | null;
  route_points: ArticleMapRoutePoint[];
};

export type ArticleMapRoutePattern = "straight" | "tack" | "figure8" | "freeform";

export type ArticleMapRoutePoint = {
  latitude: number;
  longitude: number;
};

export type ArticleMapOverlayKind = "anchor" | "buoy" | "current" | "wind";

export type ArticleMapOverlay = {
  id: string;
  kind: ArticleMapOverlayKind;
  label_en: string;
  label_it: string;
  latitude: number | null;
  longitude: number | null;
  angle: number | null;
  route_distance_nm: number | null;
};

export type ArticleContentBlockOption = {
  index: number;
  label: string;
  type: string;
};

type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
};

const DEFAULT_SCENE_ZOOM = 7.5;
const DEFAULT_VESSEL_COLORS = [
  "#0f766e",
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncateText = (value: string, maxLength = 72) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const textFromNode = (node: TipTapNode | null | undefined): string => {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((child) => textFromNode(child)).join(" ").replace(/\s+/g, " ").trim();
};

const normalizeNumber = (value: unknown, fallback: number | null = null) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeString = (value: unknown) => (typeof value === "string" ? value : "");

const normalizeAnchorIndex = (value: unknown) => {
  const parsed = normalizeNumber(value, 0);
  return Math.max(0, Math.round(parsed ?? 0));
};

const createNestedId = (prefix: string, seed?: number) =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${seed ?? Math.random().toString(36).slice(2, 8)}`;

export const createEmptyArticleMapVessel = (seed?: number): ArticleMapVessel => ({
  id: createNestedId("vessel", seed),
  name: "",
  latitude: null,
  longitude: null,
  color: DEFAULT_VESSEL_COLORS[Math.abs(seed ?? 0) % DEFAULT_VESSEL_COLORS.length],
  heading: null,
  route_pattern: "straight",
  route_heading: null,
  route_distance_nm: null,
  route_points: [],
});

export const createEmptyArticleMapOverlay = (
  kind: ArticleMapOverlayKind = "anchor",
  seed?: number
): ArticleMapOverlay => ({
  id: createNestedId("overlay", seed),
  kind,
  label_en: "",
  label_it: "",
  latitude: null,
  longitude: null,
  angle: null,
  route_distance_nm: null,
});

export const createEmptyArticleMapScene = (seed?: number): ArticleMapScene => ({
  id: createNestedId("scene", seed),
  title_en: "",
  title_it: "",
  description_en: "",
  description_it: "",
  wind_label_en: "",
  wind_label_it: "",
  latitude: null,
  longitude: null,
  camera_latitude: null,
  camera_longitude: null,
  zoom: DEFAULT_SCENE_ZOOM,
  anchor_id_en: "",
  anchor_id_it: "",
  anchor_preview_en: "",
  anchor_preview_it: "",
  anchor_block_en: 0,
  anchor_block_it: 0,
  wind_angle: null,
  show_main_route: false,
  vessels: [],
  overlays: [],
});

export const normalizeArticleMapScenes = (value: Json | unknown): ArticleMapScene[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];

    const scene = createEmptyArticleMapScene(index);
    const latitude = normalizeNumber(item.latitude);
    const longitude = normalizeNumber(item.longitude);
    const vessels = Array.isArray(item.vessels)
      ? item.vessels.flatMap((entry, vesselIndex) => {
          if (!isRecord(entry)) return [];

          const vessel = createEmptyArticleMapVessel(vesselIndex);
          return [{
            ...vessel,
            id: normalizeString(entry.id) || vessel.id,
            name: normalizeString(entry.name),
            latitude: normalizeNumber(entry.latitude),
            longitude: normalizeNumber(entry.longitude),
            color: normalizeString(entry.color) || vessel.color,
            heading: normalizeNumber(entry.heading),
            route_pattern:
              entry.route_pattern === "straight" ||
              entry.route_pattern === "tack" ||
              entry.route_pattern === "figure8" ||
              entry.route_pattern === "freeform"
                ? entry.route_pattern
                : "straight",
            route_heading: normalizeNumber(entry.route_heading),
            route_distance_nm: normalizeNumber(entry.route_distance_nm),
            route_points: Array.isArray(entry.route_points)
              ? entry.route_points.flatMap((routePoint) => {
                  if (!isRecord(routePoint)) return [];
                  const latitude = normalizeNumber(routePoint.latitude);
                  const longitude = normalizeNumber(routePoint.longitude);
                  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
                  return [{ latitude: latitude as number, longitude: longitude as number }];
                })
              : [],
          }];
        })
      : [];
    const overlays = Array.isArray(item.overlays)
      ? item.overlays.flatMap((entry, overlayIndex) => {
          if (!isRecord(entry)) return [];

          const overlay = createEmptyArticleMapOverlay("anchor", overlayIndex);
          const kind = entry.kind === "anchor" || entry.kind === "buoy" || entry.kind === "current" || entry.kind === "wind"
            ? entry.kind
            : "anchor";

          return [{
            ...overlay,
            id: normalizeString(entry.id) || overlay.id,
            kind: kind as ArticleMapOverlayKind,
            label_en: normalizeString(entry.label_en),
            label_it: normalizeString(entry.label_it),
            latitude: normalizeNumber(entry.latitude),
            longitude: normalizeNumber(entry.longitude),
            angle: normalizeNumber(entry.angle),
            route_distance_nm: normalizeNumber(entry.route_distance_nm),
          }];
        })
      : [];

    return [{
      ...scene,
      id: normalizeString(item.id) || scene.id,
      title_en: normalizeString(item.title_en),
      title_it: normalizeString(item.title_it),
      description_en: normalizeString(item.description_en),
      description_it: normalizeString(item.description_it),
      wind_label_en: normalizeString(item.wind_label_en),
      wind_label_it: normalizeString(item.wind_label_it),
      latitude,
      longitude,
      camera_latitude: normalizeNumber(item.camera_latitude, latitude),
      camera_longitude: normalizeNumber(item.camera_longitude, longitude),
      zoom: Math.max(1, Math.min(16, normalizeNumber(item.zoom, DEFAULT_SCENE_ZOOM) ?? DEFAULT_SCENE_ZOOM)),
      anchor_id_en: normalizeString(item.anchor_id_en),
      anchor_id_it: normalizeString(item.anchor_id_it),
      anchor_preview_en: normalizeString(item.anchor_preview_en),
      anchor_preview_it: normalizeString(item.anchor_preview_it),
      anchor_block_en: normalizeAnchorIndex(item.anchor_block_en),
      anchor_block_it: normalizeAnchorIndex(item.anchor_block_it),
      wind_angle: normalizeNumber(item.wind_angle),
      show_main_route: Boolean(item.show_main_route),
      vessels,
      overlays,
    }];
  });
};

export const getArticleSceneAnchorIndex = (scene: ArticleMapScene, lang: Language) =>
  lang === "it" ? scene.anchor_block_it : scene.anchor_block_en;

export const getArticleSceneAnchorId = (scene: ArticleMapScene, lang: Language) =>
  lang === "it" ? scene.anchor_id_it : scene.anchor_id_en;

export const getArticleSceneAnchorPreview = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.anchor_preview_it : scene.anchor_preview_en) || scene.anchor_preview_en || scene.anchor_preview_it;

export const getArticleSceneTitle = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.title_it : scene.title_en) || scene.title_en || scene.title_it;

export const getArticleSceneDescription = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.description_it : scene.description_en) || scene.description_en || scene.description_it;

export const getArticleSceneWindLabel = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.wind_label_it : scene.wind_label_en) || scene.wind_label_en || scene.wind_label_it;

export const getArticleOverlayLabel = (overlay: ArticleMapOverlay, lang: Language) =>
  (lang === "it" ? overlay.label_it : overlay.label_en) || overlay.label_en || overlay.label_it;

export const getArticleSceneCameraCenter = (scene: Pick<ArticleMapScene, "camera_latitude" | "camera_longitude" | "latitude" | "longitude">) => {
  const latitude = scene.camera_latitude ?? scene.latitude;
  const longitude = scene.camera_longitude ?? scene.longitude;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude: latitude as number,
    longitude: longitude as number,
  };
};

export const calculateBearingDegrees = (
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
) => {
  const startLatitudeRadians = (startLatitude * Math.PI) / 180;
  const endLatitudeRadians = (endLatitude * Math.PI) / 180;
  const deltaLongitudeRadians = ((endLongitude - startLongitude) * Math.PI) / 180;
  const y = Math.sin(deltaLongitudeRadians) * Math.cos(endLatitudeRadians);
  const x =
    Math.cos(startLatitudeRadians) * Math.sin(endLatitudeRadians) -
    Math.sin(startLatitudeRadians) * Math.cos(endLatitudeRadians) * Math.cos(deltaLongitudeRadians);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export const calculateDistanceNm = (
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
) => {
  const earthRadiusKm = 6371;
  const deltaLatitude = ((endLatitude - startLatitude) * Math.PI) / 180;
  const deltaLongitude = ((endLongitude - startLongitude) * Math.PI) / 180;
  const startLatitudeRadians = (startLatitude * Math.PI) / 180;
  const endLatitudeRadians = (endLatitude * Math.PI) / 180;

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const distanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distanceKm / 1.852;
};

export const calculatePolylineDistanceNm = (points: ArticleMapRoutePoint[]) => {
  if (points.length < 2) return 0;

  return points.slice(1).reduce((distance, point, index) => {
    const previousPoint = points[index];
    return distance + calculateDistanceNm(previousPoint.latitude, previousPoint.longitude, point.latitude, point.longitude);
  }, 0);
};

export const destinationPoint = (
  latitudeValue: number,
  longitudeValue: number,
  bearingDegrees: number,
  distanceNm: number
) => {
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

const offsetPointFromBearing = (
  originLatitude: number,
  originLongitude: number,
  baseBearing: number,
  forwardNm: number,
  lateralNm: number
) => {
  const forwardPoint = destinationPoint(originLatitude, originLongitude, baseBearing, forwardNm);
  return destinationPoint(forwardPoint.latitude, forwardPoint.longitude, (baseBearing + 90) % 360, lateralNm);
};

export const buildVesselRouteCoordinates = (vessel: ArticleMapVessel) => {
  if (typeof vessel.latitude !== "number" || typeof vessel.longitude !== "number") return [];

  const startPoint: [number, number] = [vessel.longitude, vessel.latitude];

  if (vessel.route_pattern === "freeform") {
    const freeformPoints = vessel.route_points
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => [point.longitude, point.latitude] as [number, number]);

    return freeformPoints.length ? [startPoint, ...freeformPoints] : [];
  }

  if (
    typeof vessel.route_heading !== "number" ||
    typeof vessel.route_distance_nm !== "number" ||
    vessel.route_distance_nm <= 0
  ) {
    return [];
  }

  if (vessel.route_pattern === "straight") {
    const destination = destinationPoint(vessel.latitude, vessel.longitude, vessel.route_heading, vessel.route_distance_nm);
    return [startPoint, [destination.longitude, destination.latitude]];
  }

  if (vessel.route_pattern === "tack") {
    const forwardStep = vessel.route_distance_nm / 4;
    const lateralAmplitude = Math.max(vessel.route_distance_nm * 0.16, 0.12);
    const offsets: Array<[number, number]> = [
      [0, 0],
      [forwardStep * 0.8, lateralAmplitude],
      [forwardStep * 1.8, -lateralAmplitude],
      [forwardStep * 2.8, lateralAmplitude],
      [vessel.route_distance_nm, 0],
    ];

    return offsets.map(([forwardNm, lateralNm]) => {
      const point = offsetPointFromBearing(
        vessel.latitude as number,
        vessel.longitude as number,
        vessel.route_heading as number,
        forwardNm,
        lateralNm
      );
      return [point.longitude, point.latitude] as [number, number];
    });
  }

  const figureEightSteps = Array.from({ length: 25 }, (_, index) => index / 24);
  const amplitude = Math.max(vessel.route_distance_nm * 0.18, 0.14);

  return figureEightSteps.map((progress) => {
    const point = offsetPointFromBearing(
      vessel.latitude as number,
      vessel.longitude as number,
      vessel.route_heading as number,
      vessel.route_distance_nm * progress,
      Math.sin(progress * Math.PI * 4) * amplitude
    );
    return [point.longitude, point.latitude] as [number, number];
  });
};

export const getRouteTerminalAngle = (coordinates: [number, number][]) => {
  if (coordinates.length < 2) return null;

  const previous = coordinates[coordinates.length - 2];
  const last = coordinates[coordinates.length - 1];
  return calculateBearingDegrees(previous[1], previous[0], last[1], last[0]);
};

export const getArticleContentBlocks = (value: Json | unknown, lang: Language): ArticleContentBlockOption[] => {
  if (!isRecord(value) || !Array.isArray(value.content)) return [];

  return value.content.flatMap((entry, index) => {
    const node = entry as TipTapNode;
    const type = typeof node.type === "string" ? node.type : "block";
    const rawText = textFromNode(node);
    const fallbackLabel = lang === "it"
      ? `Blocco ${String(index + 1).padStart(2, "0")}`
      : `Block ${String(index + 1).padStart(2, "0")}`;

    const prefix = type === "heading"
      ? "H"
      : type === "image"
        ? (lang === "it" ? "Immagine" : "Image")
        : type === "mediaFigure"
          ? (lang === "it" ? "Media" : "Media")
        : type === "bulletList" || type === "orderedList"
          ? (lang === "it" ? "Lista" : "List")
          : type === "blockquote"
            ? (lang === "it" ? "Citazione" : "Quote")
            : "";

    const label = truncateText(
      rawText ||
      normalizeString(node.attrs?.caption) ||
      normalizeString(node.attrs?.alt) ||
      normalizeString(node.attrs?.title) ||
      fallbackLabel
    );

    return [{
      index,
      type,
      label: prefix ? `${prefix} · ${label}` : label,
    }];
  });
};

export const sortArticleMapScenesForLanguage = (scenes: ArticleMapScene[], lang: Language) =>
  [...scenes]
    .filter((scene) => typeof scene.latitude === "number" && typeof scene.longitude === "number")
    .sort((a, b) => {
      const anchorDiff = getArticleSceneAnchorIndex(a, lang) - getArticleSceneAnchorIndex(b, lang);
      if (anchorDiff !== 0) return anchorDiff;
      return a.id.localeCompare(b.id);
    });
