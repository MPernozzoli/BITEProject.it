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
  zoom: number;
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
  heading: number | null;
  route_heading: number | null;
  route_distance_nm: number | null;
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
  heading: null,
  route_heading: null,
  route_distance_nm: null,
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
  zoom: DEFAULT_SCENE_ZOOM,
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
            heading: normalizeNumber(entry.heading),
            route_heading: normalizeNumber(entry.route_heading),
            route_distance_nm: normalizeNumber(entry.route_distance_nm),
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
            kind,
            label_en: normalizeString(entry.label_en),
            label_it: normalizeString(entry.label_it),
            latitude: normalizeNumber(entry.latitude),
            longitude: normalizeNumber(entry.longitude),
            angle: normalizeNumber(entry.angle),
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
      zoom: Math.max(1, Math.min(16, normalizeNumber(item.zoom, DEFAULT_SCENE_ZOOM) ?? DEFAULT_SCENE_ZOOM)),
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

export const getArticleSceneTitle = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.title_it : scene.title_en) || scene.title_en || scene.title_it;

export const getArticleSceneDescription = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.description_it : scene.description_en) || scene.description_en || scene.description_it;

export const getArticleSceneWindLabel = (scene: ArticleMapScene, lang: Language) =>
  (lang === "it" ? scene.wind_label_it : scene.wind_label_en) || scene.wind_label_en || scene.wind_label_it;

export const getArticleOverlayLabel = (overlay: ArticleMapOverlay, lang: Language) =>
  (lang === "it" ? overlay.label_it : overlay.label_en) || overlay.label_en || overlay.label_it;

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
