import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Plus,
  Edit,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Ship,
  Mountain,
  Eye,
  EyeOff,
  LocateFixed,
  Clock3,
  Loader2,
  Search,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  totalWaypointDistance,
  reverseGeocodePlace,
  buildWaypointDefaultName,
  buildWaypointDefaultLocalizedNames,
  formatWaypointCoordinateLabel,
  buildVoyageGeometry,
  geocodePlaces,
  getLocalizedWaypointName,
  getLocalizedVoyageName,
  getWaypointEffectiveType,
  getStraightVoyageGeometry,
  normalizeWaypointMedia,
} from "@/lib/voyage-utils";
import type { GeocodedPlace, Voyage, VoyageWaypoint, VoyageWaypointMediaItem } from "@/lib/voyage-utils";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

interface VoyageFormState {
  name_it: string;
  name_en: string;
  description_it: string;
  description_en: string;
  type: "water" | "land";
  status: "planned" | "active" | "completed";
  is_published: boolean;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
}

interface VoyageListFilters {
  type: "all" | Voyage["type"];
  publicationStatus: "all" | "published" | "draft";
  createdFrom: string;
  createdTo: string;
  departureFrom: string;
  departureTo: string;
}

interface VoyageListSort {
  field: "created_at" | "start_date" | "type" | "publicationStatus";
  direction: "asc" | "desc";
}

const emptyVoyageForm: VoyageFormState = {
  name_it: "",
  name_en: "",
  description_it: "",
  description_en: "",
  type: "water",
  status: "planned",
  is_published: true,
  start_date: "",
  start_time: "",
  end_date: "",
  end_time: "",
};

const emptyVoyageListFilters: VoyageListFilters = {
  type: "all",
  publicationStatus: "all",
  createdFrom: "",
  createdTo: "",
  departureFrom: "",
  departureTo: "",
};

const defaultVoyageListSort: VoyageListSort = {
  field: "created_at",
  direction: "desc",
};

const popupLabelStyle = "display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:hsl(220,10%,45%);margin-bottom:6px;font-family:var(--font-sans);";
const popupInputStyle = "width:100%;padding:8px 10px;border:1px solid hsl(var(--border));background:hsl(var(--background));font-size:12px;font-family:var(--font-sans);outline:none;";
const popupTextareaStyle = `${popupInputStyle}min-height:68px;resize:vertical;`;
const popupMetaStyle = "margin:0;font-size:12px;color:hsl(220,15%,30%);";
const popupSectionStyle = "display:grid;gap:10px;padding:12px;border:1px solid hsl(var(--border));background:hsla(var(--background),0.94);";
const popupSectionTitleStyle = "margin:0;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:hsl(220,10%,45%);font-family:var(--font-sans);";
const popupLanguageOptions = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
] as const;

const sortWaypoints = (waypoints: VoyageWaypoint[]) =>
  [...waypoints].sort((a, b) => a.sort_order - b.sort_order);

const getErrorMessage = (error: { message?: string | null } | null, fallback: string) =>
  error?.message || fallback;

const isMissingWaypointMetadataColumnError = (
  error: { message?: string | null; details?: string | null; hint?: string | null } | null
) => {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return ["waypoint_type", "date_start", "date_end", "visibility_mode", "name_it", "name_en", "description_it", "description_en", "event_date", "event_time", "media"].some((column) => text.includes(column)) &&
    (text.includes("column") || text.includes("schema cache"));
};

const isMissingVoyageDateColumnError = (
  error: { message?: string | null; details?: string | null; hint?: string | null } | null
) => {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return ["start_date", "start_time", "end_date", "end_time", "name_it", "name_en", "description_it", "description_en", "is_published"].some((column) => text.includes(column)) &&
    (text.includes("column") || text.includes("schema cache"));
};

const stripUnsupportedWaypointMetadata = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) =>
      ["voyage_id", "lat", "lng", "name", "sort_order"].includes(key)
    )
  );

type VoyageRecord = Record<string, unknown> &
  Pick<Voyage, "id" | "name" | "type" | "status" | "is_published" | "sort_order" | "created_at" | "updated_at">;

type WaypointRecord = Record<string, unknown> &
  Pick<VoyageWaypoint, "id" | "voyage_id" | "lat" | "lng" | "sort_order" | "created_at">;

const normalizeWaypoint = (waypoint: WaypointRecord): VoyageWaypoint => ({
  ...waypoint,
  name: (waypoint?.name ?? waypoint?.name_it ?? waypoint?.name_en ?? "") as string,
  name_it: (waypoint?.name_it ?? waypoint?.name ?? "") as string,
  name_en: (waypoint?.name_en ?? waypoint?.name ?? "") as string,
  waypoint_type: waypoint?.waypoint_type === "narrative" ? "narrative" : "technical",
  visibility_mode: waypoint?.visibility_mode === "manual" ? "manual" : "auto",
  description_it: (waypoint?.description_it ?? null) as string | null,
  description_en: (waypoint?.description_en ?? null) as string | null,
  event_date: (waypoint?.event_date ?? null) as string | null,
  event_time: (waypoint?.event_time ?? null) as string | null,
  media: normalizeWaypointMedia(waypoint?.media),
  date_start: (waypoint?.date_start ?? null) as string | null,
  date_end: (waypoint?.date_end ?? null) as string | null,
});

const normalizeVoyage = (voyage: VoyageRecord): Voyage => ({
  ...voyage,
  name: (voyage?.name ?? voyage?.name_it ?? voyage?.name_en ?? "") as string,
  name_it: (voyage?.name_it ?? voyage?.name ?? "") as string,
  name_en: (voyage?.name_en ?? voyage?.name ?? "") as string,
  description: (voyage?.description ?? voyage?.description_it ?? voyage?.description_en ?? "") as string,
  description_it: (voyage?.description_it ?? voyage?.description ?? "") as string,
  description_en: (voyage?.description_en ?? voyage?.description ?? "") as string,
  cached_geometry: (voyage?.cached_geometry ?? null) as Voyage["cached_geometry"],
  is_published: (voyage?.is_published ?? true) as boolean,
  start_date: (voyage?.start_date ?? null) as string | null,
  start_time: (voyage?.start_time ?? null) as string | null,
  end_date: (voyage?.end_date ?? null) as string | null,
  end_time: (voyage?.end_time ?? null) as string | null,
});

const formatVoyageDateRange = (voyage: Voyage) => {
  if (!voyage.start_date && !voyage.end_date) return null;
  const start = [voyage.start_date, voyage.start_time].filter(Boolean).join(" ");
  const end = [voyage.end_date, voyage.end_time].filter(Boolean).join(" ");
  if (start && end) return `${start} → ${end}`;
  return start || end;
};

const getCachedGeometryCoordinates = (voyage: Voyage | undefined): [number, number][] => {
  const coordinates = (voyage?.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
  return Array.isArray(coordinates) ? coordinates : [];
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getDistanceToSegmentSquared = (
  point: maplibregl.Point,
  segmentStart: maplibregl.Point,
  segmentEnd: maplibregl.Point
) => {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - segmentStart.x;
    const py = point.y - segmentStart.y;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / (dx * dx + dy * dy)
    )
  );
  const projectedX = segmentStart.x + t * dx;
  const projectedY = segmentStart.y + t * dy;
  const deltaX = point.x - projectedX;
  const deltaY = point.y - projectedY;
  return deltaX * deltaX + deltaY * deltaY;
};

const getNearestSegmentIndex = (
  map: maplibregl.Map,
  point: maplibregl.Point,
  waypoints: VoyageWaypoint[]
) => {
  if (waypoints.length < 2) return null;

  let nearestSegmentIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const segmentStart = map.project([waypoints[index].lng, waypoints[index].lat]);
    const segmentEnd = map.project([waypoints[index + 1].lng, waypoints[index + 1].lat]);
    const distance = getDistanceToSegmentSquared(point, segmentStart, segmentEnd);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestSegmentIndex = index;
    }
  }

  return nearestSegmentIndex;
};

const getDateOnlyValue = (value?: string | null) => {
  if (!value) return null;
  return value.slice(0, 10);
};

const isDateWithinRange = (value: string | null, from: string, to: string) => {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
};

const getVoyageYearTier = (voyage: Pick<Voyage, "start_date">) => {
  if (!voyage.start_date) return 0;
  const startDate = new Date(voyage.start_date);
  if (Number.isNaN(startDate.getTime())) return 0;

  return Math.max(0, new Date().getFullYear() - startDate.getFullYear());
};

const getVoyageLineWidthScale = (voyage: Pick<Voyage, "start_date">) => {
  const yearTier = getVoyageYearTier(voyage);
  if (yearTier <= 0) return 1;
  if (yearTier === 1) return 0.76;
  if (yearTier === 2) return 0.56;
  return 0.34;
};

const getVoyageRouteColor = (voyageType: Voyage["type"]) =>
  voyageType === "water" ? "hsl(206, 72%, 47%)" : "hsl(30, 78%, 50%)";

interface AdminVoyageManagerProps {
  onRegisterLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void;
}

const serializeVoyageForm = (form: VoyageFormState) => JSON.stringify(form);
const ADMIN_ROUTE_DRAFT_STORAGE_KEY = "bite_admin_route_draft";
const ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY = "bite_admin_route_form_draft";
const createLocalWaypointId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isLocalWaypointId = (waypointId: string) => waypointId.startsWith("local-");
const serializeWaypointDrafts = (waypoints: VoyageWaypoint[]) => JSON.stringify(
  sortWaypoints(waypoints).map((waypoint) => ({
    id: waypoint.id,
    lat: waypoint.lat,
    lng: waypoint.lng,
    sort_order: waypoint.sort_order,
    name: waypoint.name,
    name_it: waypoint.name_it,
    name_en: waypoint.name_en,
    description_it: waypoint.description_it,
    description_en: waypoint.description_en,
    event_date: waypoint.event_date,
    event_time: waypoint.event_time,
    waypoint_type: waypoint.waypoint_type,
    visibility_mode: waypoint.visibility_mode,
    media: waypoint.media,
  }))
);

const loadStoredRouteDraft = () => {
  if (typeof window === "undefined") return null as null | { selectedVoyageId: string; waypoints: VoyageWaypoint[] };
  try {
    const raw = window.sessionStorage.getItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedVoyageId?: string; waypoints?: WaypointRecord[] };
    if (!parsed.selectedVoyageId || !Array.isArray(parsed.waypoints)) return null;
    return {
      selectedVoyageId: parsed.selectedVoyageId,
      waypoints: parsed.waypoints.map((waypoint) => normalizeWaypoint(waypoint)),
    };
  } catch {
    return null;
  }
};

const loadStoredVoyageFormDraft = () => {
  if (typeof window === "undefined") return null as null | { editingVoyageId: string | null; voyageForm: VoyageFormState };
  try {
    const raw = window.sessionStorage.getItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { editingVoyageId?: string | null; voyageForm?: VoyageFormState };
    if (!parsed.voyageForm) return null;
    return {
      editingVoyageId: parsed.editingVoyageId ?? null,
      voyageForm: parsed.voyageForm,
    };
  } catch {
    return null;
  }
};

const AdminVoyageManager = ({ onRegisterLeaveGuard }: AdminVoyageManagerProps) => {
  const initialStoredRouteDraft = loadStoredRouteDraft();
  const initialStoredVoyageFormDraft = loadStoredVoyageFormDraft();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [waypoints, setWaypoints] = useState<Record<string, VoyageWaypoint[]>>({});
  const [selectedVoyageId, setSelectedVoyageId] = useState<string | null>(initialStoredRouteDraft?.selectedVoyageId || null);
  const [showVoyageForm, setShowVoyageForm] = useState(Boolean(initialStoredVoyageFormDraft));
  const [editingVoyage, setEditingVoyage] = useState<Voyage | null>(null);
  const [voyageForm, setVoyageForm] = useState<VoyageFormState>(initialStoredVoyageFormDraft?.voyageForm || emptyVoyageForm);
  const [listFilters, setListFilters] = useState<VoyageListFilters>(emptyVoyageListFilters);
  const [listSort, setListSort] = useState<VoyageListSort>(defaultVoyageListSort);
  const initialVoyageFormSnapshotRef = useRef(serializeVoyageForm(emptyVoyageForm));
  const isVoyageFormDirty = showVoyageForm && serializeVoyageForm(voyageForm) !== initialVoyageFormSnapshotRef.current;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markersByWaypointRef = useRef<Record<string, maplibregl.Marker>>({});
  const openedWaypointPopupIdRef = useRef<string | null>(null);
  const pendingPopupOpenWaypointIdRef = useRef<string | null>(null);
  const voyagesRef = useRef<Voyage[]>([]);
  const waypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const persistedWaypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const storedRouteDraftRef = useRef(initialStoredRouteDraft);
  const storedVoyageFormDraftRef = useRef(initialStoredVoyageFormDraft);
  const selectedVoyageRef = useRef<string | null>(null);
  const geometryRequestRef = useRef<Record<string, number>>({});
  const geometryOverrideRef = useRef<Record<string, [number, number][]>>({});
  const segmentInsertRef = useRef<{ voyageId: string; insertIndex: number } | null>(null);
  const waypointRelocationRef = useRef<{ voyageId: string; waypointId: string } | null>(null);
  const segmentPreviewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routeLineMouseDownRef = useRef<((event: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const routeLineMouseEnterRef = useRef<(() => void) | null>(null);
  const routeLineMouseLeaveRef = useRef<(() => void) | null>(null);
  const suppressMapClickUntilRef = useRef(0);
  const searchResultMarkerRef = useRef<maplibregl.Marker | null>(null);
  const searchRequestRef = useRef(0);

  const [landSearchQuery, setLandSearchQuery] = useState("");
  const [landSearchResults, setLandSearchResults] = useState<GeocodedPlace[]>([]);
  const [landSearchLoading, setLandSearchLoading] = useState(false);
  const [editingWaypointNameId, setEditingWaypointNameId] = useState<string | null>(null);
  const [editingWaypointNameValue, setEditingWaypointNameValue] = useState("");
  const [savingWaypointNameId, setSavingWaypointNameId] = useState<string | null>(null);
  const [draggedWaypointId, setDraggedWaypointId] = useState<string | null>(null);
  const [dragOverWaypointId, setDragOverWaypointId] = useState<string | null>(null);
  const [isSavingRouteDraft, setIsSavingRouteDraft] = useState(false);

  const commitVoyages = useCallback((nextVoyages: Voyage[]) => {
    voyagesRef.current = nextVoyages;
    setVoyages(nextVoyages);
  }, []);

  const commitWaypoints = useCallback((voyageId: string, nextWaypoints: VoyageWaypoint[]) => {
    const sorted = sortWaypoints(nextWaypoints);
    const nextMap = { ...waypointsRef.current, [voyageId]: sorted };
    waypointsRef.current = nextMap;
    setWaypoints(nextMap);
    return sorted;
  }, []);

  const commitPersistedWaypoints = useCallback((voyageId: string, nextWaypoints: VoyageWaypoint[]) => {
    const sorted = sortWaypoints(nextWaypoints);
    persistedWaypointsRef.current = { ...persistedWaypointsRef.current, [voyageId]: sorted };
    return commitWaypoints(voyageId, sorted);
  }, [commitWaypoints]);

  useEffect(() => {
    selectedVoyageRef.current = selectedVoyageId;
  }, [selectedVoyageId]);

  const fetchVoyages = useCallback(async () => {
    const { data, error } = await supabase.from("voyages").select("*").order("sort_order", { ascending: true });
    if (error) {
      toast.error(getErrorMessage(error, "Unable to load voyages"));
      return;
    }
    commitVoyages((data || []).map((voyage) => normalizeVoyage(voyage)));
  }, [commitVoyages]);

  const fetchWaypoints = useCallback(async (voyageId: string) => {
    const { data, error } = await supabase
      .from("voyage_waypoints")
      .select("*")
      .eq("voyage_id", voyageId)
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error(getErrorMessage(error, "Unable to load waypoints"));
      return [];
    }

    const persistedWaypoints = commitPersistedWaypoints(voyageId, (data || []).map((waypoint) => normalizeWaypoint(waypoint)));
    const storedDraft = storedRouteDraftRef.current;
    if (storedDraft?.selectedVoyageId === voyageId) {
      return commitWaypoints(voyageId, storedDraft.waypoints);
    }

    return persistedWaypoints;
  }, [commitPersistedWaypoints, commitWaypoints]);

  useEffect(() => {
    void fetchVoyages();
  }, [fetchVoyages]);

  useEffect(() => {
    const storedFormDraft = storedVoyageFormDraftRef.current;
    if (!storedFormDraft) return;
    if (!showVoyageForm) return;
    if (!storedFormDraft.editingVoyageId) return;
    const matchingVoyage = voyages.find((voyage) => voyage.id === storedFormDraft.editingVoyageId) || null;
    setEditingVoyage(matchingVoyage);
  }, [showVoyageForm, voyages]);

  const removeSegmentPreviewMarker = useCallback(() => {
    segmentPreviewMarkerRef.current?.remove();
    segmentPreviewMarkerRef.current = null;
  }, []);

  const clearSearchResultMarker = useCallback(() => {
    searchResultMarkerRef.current?.remove();
    searchResultMarkerRef.current = null;
  }, []);

  const cancelWaypointRelocation = useCallback(() => {
    waypointRelocationRef.current = null;
    const map = mapRef.current;
    if (!map || segmentInsertRef.current) return;
    map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
  }, []);

  const focusSearchResult = useCallback((result: GeocodedPlace) => {
    const map = mapRef.current;
    if (!map) return;

    if (!searchResultMarkerRef.current) {
      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        width:16px;
        height:16px;
        border-radius:999px;
        border:2px solid white;
        background:hsl(210, 62%, 45%);
        box-shadow:0 2px 12px rgba(0,0,0,0.24);
      `;
      searchResultMarkerRef.current = new maplibregl.Marker({ element: markerEl })
        .setLngLat([result.lng, result.lat])
        .addTo(map);
    } else {
      searchResultMarkerRef.current.setLngLat([result.lng, result.lat]);
    }

    map.flyTo({
      center: [result.lng, result.lat],
      zoom: Math.max(map.getZoom(), 11),
      duration: 500,
      essential: true,
    });
  }, []);

  const resetSegmentInsertState = useCallback(() => {
    const map = mapRef.current;
    segmentInsertRef.current = null;
    removeSegmentPreviewMarker();
    if (!map) return;
    if (!map.dragPan.isEnabled()) map.dragPan.enable();
    map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
  }, [removeSegmentPreviewMarker]);

  const ensureSegmentPreviewMarker = useCallback((map: maplibregl.Map, lng: number, lat: number) => {
    if (!segmentPreviewMarkerRef.current) {
      const previewEl = document.createElement("div");
      previewEl.style.cssText = `
        width:14px;
        height:14px;
        border-radius:999px;
        border:2px solid white;
        background:hsl(42, 95%, 58%);
        box-shadow:0 2px 10px rgba(0,0,0,0.22);
      `;
      segmentPreviewMarkerRef.current = new maplibregl.Marker({ element: previewEl })
        .setLngLat([lng, lat])
        .addTo(map);
      return;
    }

    segmentPreviewMarkerRef.current.setLngLat([lng, lat]);
  }, []);

  const refreshVoyageGeometryPreview = useCallback(async (voyageId: string, candidateWaypoints?: VoyageWaypoint[]) => {
    const voyage = voyagesRef.current.find((item) => item.id === voyageId);
    if (!voyage) return;

    const sortedWaypoints = sortWaypoints(candidateWaypoints || waypointsRef.current[voyageId] || []);
    const requestId = (geometryRequestRef.current[voyageId] || 0) + 1;
    geometryRequestRef.current[voyageId] = requestId;

    const coordinates = await buildVoyageGeometry(sortedWaypoints, voyage.type);
    if (geometryRequestRef.current[voyageId] !== requestId) return;

    geometryOverrideRef.current[voyageId] = coordinates;
  }, []);

  const syncVoyageGeometry = useCallback(async (voyageId: string, candidateWaypoints?: VoyageWaypoint[]) => {
    await refreshVoyageGeometryPreview(voyageId, candidateWaypoints);

    const coordinates = geometryOverrideRef.current[voyageId];
    const cachedGeometry = coordinates.length >= 2 ? { type: "LineString" as const, coordinates } : null;
    const payload: TablesUpdate<"voyages"> = { cached_geometry: cachedGeometry };
    const { error } = await supabase.from("voyages").update(payload).eq("id", voyageId);

    if (error) {
      console.error("Unable to sync voyage geometry", error);
      return;
    }

    commitVoyages(
      voyagesRef.current.map((item) =>
        item.id === voyageId
          ? normalizeVoyage({ ...item, cached_geometry: cachedGeometry })
          : item
      )
    );
  }, [commitVoyages, refreshVoyageGeometryPreview]);

  const uploadWaypointMediaAsset = useCallback(async (waypointId: string, file: File) => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `voyage-waypoints/${waypointId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });

    if (error) {
      toast.error(getErrorMessage(error, "Unable to upload waypoint media"));
      return null;
    }

    const { data } = supabase.storage.from("logbook-media").getPublicUrl(path);
    return {
      kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file",
      mime_type: file.type || null,
      name: file.name,
      path,
      url: data.publicUrl,
    } satisfies VoyageWaypointMediaItem;
  }, []);

  const deleteWaypointMediaAsset = useCallback(async (mediaItem: VoyageWaypointMediaItem) => {
    if (!mediaItem.path) return;

    const { error } = await supabase.storage.from("logbook-media").remove([mediaItem.path]);
    if (error) {
      console.error("Unable to delete waypoint media asset", error);
    }
  }, []);

  const persistWaypointPatch = useCallback(async (waypointId: string, changes: Partial<VoyageWaypoint>) => {
    const payload = changes as unknown as TablesUpdate<"voyage_waypoints">;
    let appliedChanges = changes;
    let { error } = await supabase.from("voyage_waypoints").update(payload).eq("id", waypointId);

    if (error && isMissingWaypointMetadataColumnError(error)) {
      const legacyPayload = stripUnsupportedWaypointMetadata(payload as Record<string, unknown>) as TablesUpdate<"voyage_waypoints">;
      if (!Object.keys(legacyPayload).length) {
        toast.error("Apply the latest waypoint migration to save localized content, dates, and media.");
        return { success: false, appliedChanges: null as Partial<VoyageWaypoint> | null };
      }

      const fallbackResult = await supabase.from("voyage_waypoints").update(legacyPayload).eq("id", waypointId);
      error = fallbackResult.error;
      appliedChanges = legacyPayload as unknown as Partial<VoyageWaypoint>;
    }

    if (error) {
      toast.error(getErrorMessage(error, "Unable to update waypoint"));
      return { success: false, appliedChanges: null as Partial<VoyageWaypoint> | null };
    }

    return { success: true, appliedChanges };
  }, []);

  const persistWaypointInsert = useCallback(async (voyageId: string, waypoint: VoyageWaypoint, sortOrder: number) => {
    const name_it = waypoint.name_it?.trim() || null;
    const name_en = waypoint.name_en?.trim() || null;
    const legacyName = waypoint.name?.trim() || name_en || name_it || buildWaypointDefaultName(sortOrder, waypoint.lat, waypoint.lng);
    const baseData: TablesInsert<"voyage_waypoints"> = {
      voyage_id: voyageId,
      lat: waypoint.lat,
      lng: waypoint.lng,
      name: legacyName,
      name_it,
      name_en,
      sort_order: sortOrder,
      waypoint_type: waypoint.waypoint_type,
      visibility_mode: waypoint.visibility_mode,
      description_it: waypoint.description_it,
      description_en: waypoint.description_en,
      event_date: waypoint.event_date,
      event_time: waypoint.event_time,
      media: waypoint.media,
    };
    const legacyBaseData: TablesInsert<"voyage_waypoints"> = {
      voyage_id: voyageId,
      lat: waypoint.lat,
      lng: waypoint.lng,
      name: legacyName,
      sort_order: sortOrder,
    };
    const runInsert = (payload: TablesInsert<"voyage_waypoints">) =>
      supabase.from("voyage_waypoints").insert(payload).select().single();

    let { data, error } = await runInsert(baseData);
    if (error && isMissingWaypointMetadataColumnError(error)) {
      ({ data, error } = await runInsert(legacyBaseData));
    }

    if (error || !data) {
      toast.error(getErrorMessage(error, "Unable to insert waypoint"));
      return null;
    }

    return normalizeWaypoint(data);
  }, []);

  const updateWaypoint = useCallback(
    async (
      voyageId: string,
      waypointId: string,
      changes: Partial<VoyageWaypoint>,
      options?: { successMessage?: string | null; syncGeometry?: boolean }
    ) => {
      const nextWaypoints = commitWaypoints(
        voyageId,
        (waypointsRef.current[voyageId] || []).map((waypoint) =>
          waypoint.id === waypointId ? normalizeWaypoint({ ...waypoint, ...changes }) : waypoint
        )
      );

      if (options?.syncGeometry) {
        geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(nextWaypoints);
        void refreshVoyageGeometryPreview(voyageId, nextWaypoints);
      }

      if (options?.successMessage) {
        toast.success(options.successMessage);
      }

      return true;
    },
    [commitWaypoints, refreshVoyageGeometryPreview]
  );

  const insertWaypointAtIndex = useCallback(
    async (voyageId: string, lat: number, lng: number, insertIndex: number) => {
      const currentWaypoints = waypointsRef.current[voyageId] || [];
      const boundedIndex = Math.max(0, Math.min(insertIndex, currentWaypoints.length));
      const provisionalNames = buildWaypointDefaultLocalizedNames(boundedIndex, lat, lng);
      const provisionalName = provisionalNames[lang];
      const nextWaypoints = [...currentWaypoints];
      const createdWaypoint = normalizeWaypoint({
        id: createLocalWaypointId(),
        voyage_id: voyageId,
        lat,
        lng,
        name: provisionalName,
        name_it: provisionalNames.it,
        name_en: provisionalNames.en,
        sort_order: boundedIndex,
        created_at: new Date().toISOString(),
        waypoint_type: "technical",
        visibility_mode: "auto",
        description_it: null,
        description_en: null,
        event_date: null,
        event_time: null,
        media: [],
        date_start: null,
        date_end: null,
      });
      nextWaypoints.splice(boundedIndex, 0, createdWaypoint);
      const committedWaypoints = commitWaypoints(
        voyageId,
        nextWaypoints.map((waypoint, index) => normalizeWaypoint({ ...waypoint, sort_order: index }))
      );
      geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(committedWaypoints);
      void refreshVoyageGeometryPreview(voyageId, committedWaypoints);

      const suggestedPlace = await reverseGeocodePlace(lat, lng);
      if (!suggestedPlace) return true;

      const currentWaypoint = (waypointsRef.current[voyageId] || []).find((item) => item.id === createdWaypoint.id);
      if (!currentWaypoint) return true;

      const hasCustomLocalizedName = currentWaypoint.name_it !== provisionalNames.it || currentWaypoint.name_en !== provisionalNames.en;
      if (hasCustomLocalizedName) return true;

      const suggestedNames = buildWaypointDefaultLocalizedNames(boundedIndex, lat, lng, suggestedPlace);
      if (suggestedNames.it === provisionalNames.it && suggestedNames.en === provisionalNames.en) return true;

      await updateWaypoint(voyageId, createdWaypoint.id, {
        name: suggestedNames[lang],
        name_it: suggestedNames.it,
        name_en: suggestedNames.en,
      });
      return true;
    },
    [commitWaypoints, lang, refreshVoyageGeometryPreview, updateWaypoint]
  );

  const deleteWaypoint = useCallback(
    async (voyageId: string, waypointId: string) => {
      if (!confirm("Delete this waypoint?")) return;

      const nextWaypoints = commitWaypoints(
        voyageId,
        (waypointsRef.current[voyageId] || []).filter((waypoint) => waypoint.id !== waypointId)
      );
      geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(nextWaypoints);
      void refreshVoyageGeometryPreview(voyageId, nextWaypoints);
    },
    [commitWaypoints, refreshVoyageGeometryPreview]
  );

  const runLandSearch = useCallback(async () => {
    const query = landSearchQuery.trim();
    if (!query) {
      setLandSearchResults([]);
      clearSearchResultMarker();
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setLandSearchLoading(true);

    const results = await geocodePlaces(query, 6);
    if (searchRequestRef.current !== requestId) return;

    setLandSearchLoading(false);
    setLandSearchResults(results);

    if (results[0]) {
      focusSearchResult(results[0]);
    } else {
      clearSearchResultMarker();
      toast.error("Nessun indirizzo o POI trovato");
    }
  }, [clearSearchResultMarker, focusSearchResult, landSearchQuery]);

  const addSearchResultWaypoint = useCallback(async (result: GeocodedPlace) => {
    const voyageId = selectedVoyageRef.current;
    if (!voyageId) return;

    focusSearchResult(result);
    const insertIndex = waypointsRef.current[voyageId]?.length || 0;
    await insertWaypointAtIndex(voyageId, result.lat, result.lng, insertIndex);
  }, [focusSearchResult, insertWaypointAtIndex]);

  const fitMapToWaypoints = useCallback((candidateWaypoints: VoyageWaypoint[]) => {
    const map = mapRef.current;
    if (!map || !candidateWaypoints.length) return;

    if (candidateWaypoints.length === 1) {
      map.flyTo({
        center: [candidateWaypoints[0].lng, candidateWaypoints[0].lat],
        zoom: Math.max(map.getZoom(), 10),
        duration: 500,
      });
      return;
    }

    const bounds = candidateWaypoints.reduce(
      (accumulator, waypoint) => accumulator.extend([waypoint.lng, waypoint.lat]),
      new maplibregl.LngLatBounds(
        [candidateWaypoints[0].lng, candidateWaypoints[0].lat],
        [candidateWaypoints[0].lng, candidateWaypoints[0].lat]
      )
    );

    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 });
  }, []);

  const focusWaypointOnMap = useCallback((waypointId: string) => {
    const marker = markersByWaypointRef.current[waypointId];
    const map = mapRef.current;
    if (!marker || !map) return false;

    const position = marker.getLngLat();
    map.easeTo({
      center: [position.lng, position.lat],
      zoom: Math.max(map.getZoom(), 8),
      offset: [0, 96],
      duration: 400,
      essential: true,
    });
    return true;
  }, []);

  const openWaypointPopup = useCallback((waypointId: string) => {
    const marker = markersByWaypointRef.current[waypointId];
    if (!marker) return;

    const popup = marker.getPopup();
    if (!popup) return;

    if (popup.isOpen()) {
      popup.remove();
      return;
    }

     if (openedWaypointPopupIdRef.current && openedWaypointPopupIdRef.current !== waypointId) {
      const openedMarker = markersByWaypointRef.current[openedWaypointPopupIdRef.current];
      openedMarker?.getPopup()?.remove();
    }

    marker.togglePopup();
    void focusWaypointOnMap(waypointId);
  }, [focusWaypointOnMap]);

  const startWaypointRelocation = useCallback((voyageId: string, waypointId: string) => {
    waypointRelocationRef.current = { voyageId, waypointId };
    pendingPopupOpenWaypointIdRef.current = null;
    const marker = markersByWaypointRef.current[waypointId];
    marker?.getPopup()?.remove();
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = "crosshair";
    }
    toast.message("Click the map to update the waypoint position");
  }, []);

  const beginWaypointNameEdit = useCallback((waypoint: VoyageWaypoint, index: number) => {
    setEditingWaypointNameId(waypoint.id);
    setEditingWaypointNameValue(getLocalizedWaypointName(waypoint, lang, index));
  }, [lang]);

  const cancelWaypointNameEdit = useCallback(() => {
    setEditingWaypointNameId(null);
    setEditingWaypointNameValue("");
    setSavingWaypointNameId(null);
  }, []);

  const submitWaypointNameEdit = useCallback(async (waypoint: VoyageWaypoint, index: number) => {
    const fallbackNames = buildWaypointDefaultLocalizedNames(index, waypoint.lat, waypoint.lng);
    const trimmedValue = editingWaypointNameValue.trim();
    const nextLocalizedName = trimmedValue || fallbackNames[lang];
    const nextNameIt = lang === "it" ? nextLocalizedName : (waypoint.name_it?.trim() || fallbackNames.it);
    const nextNameEn = lang === "en" ? nextLocalizedName : (waypoint.name_en?.trim() || fallbackNames.en);
    const legacyName = (lang === "it" ? nextNameIt : nextNameEn) || nextNameIt || nextNameEn || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng);

    setSavingWaypointNameId(waypoint.id);
    const success = await updateWaypoint(
      waypoint.voyage_id,
      waypoint.id,
      {
        name: legacyName,
        name_it: nextNameIt,
        name_en: nextNameEn,
      }
    );

    if (success) {
      setEditingWaypointNameId(null);
      setEditingWaypointNameValue("");
    }
    setSavingWaypointNameId(null);
  }, [editingWaypointNameValue, lang, updateWaypoint]);

  useEffect(() => {
    setEditingWaypointNameId(null);
    setEditingWaypointNameValue("");
    setSavingWaypointNameId(null);
  }, [selectedVoyageId]);

  const toggleWaypointVisibility = useCallback(async (waypoint: VoyageWaypoint, index: number, total: number) => {
    const effectiveType = getWaypointEffectiveType(waypoint, index, total);
    const nextType = effectiveType === "narrative" ? "technical" : "narrative";
    await updateWaypoint(
      waypoint.voyage_id,
      waypoint.id,
      {
        visibility_mode: "manual",
        waypoint_type: nextType,
      },
      { successMessage: nextType === "narrative" ? "Waypoint is now public" : "Waypoint is now technical" }
    );
  }, [updateWaypoint]);

  const createWaypointPopupContent = useCallback(
    (waypoint: VoyageWaypoint, index: number, total: number, popup: maplibregl.Popup) => {
      const isStart = index === 0;
      const isEnd = total > 1 && index === total - 1;
      const effectiveType = getWaypointEffectiveType(waypoint, index, total);
      const defaultNames = buildWaypointDefaultLocalizedNames(index, waypoint.lat, waypoint.lng);
      const selectedVisibilityValue = waypoint.visibility_mode === "manual" ? waypoint.waypoint_type : "auto";
      const statusLabel = waypoint.visibility_mode === "manual"
        ? effectiveType === "narrative" ? "Visible" : "Hidden"
        : effectiveType === "narrative" ? (index === 0 ? "Auto start" : "Auto end") : "Auto hidden";
      const wrapper = document.createElement("form");
      wrapper.style.cssText = "width:min(360px,calc(100vw - 40px));max-height:min(72vh,620px);overflow-y:auto;overflow-x:hidden;padding:2px 2px 6px;box-sizing:border-box;font-family:var(--font-sans);display:grid;gap:12px;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch;";
      ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "touchstart"].forEach((eventName) => {
        wrapper.addEventListener(eventName, (event) => event.stopPropagation());
      });
      wrapper.addEventListener("wheel", (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrapper.scrollTop += event.deltaY;
      }, { passive: false });

      const heading = isStart ? "Start" : isEnd ? "Arrival" : `Waypoint ${String(index + 1).padStart(2, "0")}`;
      const coords = formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng);
      const mediaMarkup = waypoint.media.length
        ? waypoint.media.map((mediaItem, mediaIndex) => {
            const safeUrl = escapeHtml(mediaItem.url);
            const safeName = escapeHtml(mediaItem.name || `Asset ${mediaIndex + 1}`);
            const preview = mediaItem.kind === "image"
              ? `<img src="${safeUrl}" alt="" style="width:100%;height:84px;object-fit:cover;border:1px solid hsl(var(--border));" />`
              : mediaItem.kind === "video"
                ? `<video src="${safeUrl}" muted playsinline style="width:100%;height:84px;object-fit:cover;border:1px solid hsl(var(--border));"></video>`
                : `<div style="display:flex;align-items:center;justify-content:center;height:84px;border:1px solid hsl(var(--border));background:hsl(var(--muted));font-size:11px;color:hsl(220,10%,45%);">File</div>`;

            return `
              <div style="display:grid;gap:6px;">
                ${preview}
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:hsl(var(--foreground));text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${safeName}</a>
                  <button type="button" data-action="delete-media" data-media-index="${mediaIndex}" style="padding:4px 6px;border:1px solid hsl(var(--border));background:hsl(var(--background));font-size:10px;cursor:pointer;">Remove</button>
                </div>
              </div>
            `;
          }).join("")
        : `<p style="margin:0;font-size:11px;color:hsl(220,10%,45%);">No media attached yet.</p>`;

      wrapper.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:hsl(220,10%,45%);">${heading}</p>
            <p style="${popupMetaStyle}">${coords}</p>
          </div>
          <span style="font-size:11px;padding:4px 7px;background:${effectiveType === "technical" ? "hsla(220,10%,60%,0.12)" : "hsla(180,40%,35%,0.12)"};color:${effectiveType === "technical" ? "hsl(220,10%,40%)" : "hsl(180,40%,28%)"};">
            ${statusLabel}
          </span>
        </div>
        <section style="${popupSectionStyle}">
          <p style="${popupSectionTitleStyle}">Identity</p>
          ${popupLanguageOptions.map(({ code, label }) => `
            <div>
              <label style="${popupLabelStyle}">Name · ${label}</label>
              <input
                name="name_${code}"
                type="text"
                value="${escapeHtml((code === "it" ? waypoint.name_it : waypoint.name_en) || defaultNames[code])}"
                style="${popupInputStyle}"
              />
            </div>
          `).join("")}
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:10px;">
            <div>
              <label style="${popupLabelStyle}">Date</label>
              <input name="event_date" type="date" value="${escapeHtml(waypoint.event_date || "")}" style="${popupInputStyle}" />
            </div>
            <div>
              <label style="${popupLabelStyle}">Time</label>
              <input name="event_time" type="time" value="${escapeHtml(waypoint.event_time ? waypoint.event_time.slice(0, 5) : "")}" style="${popupInputStyle}" />
            </div>
          </div>
          <div>
            <label style="${popupLabelStyle}">Visibility</label>
            <select name="visibility_mode" style="${popupInputStyle}">
              <option value="auto"${selectedVisibilityValue === "auto" ? " selected" : ""}>Auto (start and end are public)</option>
              <option value="technical"${selectedVisibilityValue === "technical" ? " selected" : ""}>Technical / hidden</option>
              <option value="narrative"${selectedVisibilityValue === "narrative" ? " selected" : ""}>Narrative / public</option>
            </select>
          </div>
        </section>
        <section style="${popupSectionStyle}">
          <p style="${popupSectionTitleStyle}">Descriptions</p>
          ${popupLanguageOptions.map(({ code, label }) => `
            <div>
              <label style="${popupLabelStyle}">Description · ${label}</label>
              <textarea
                name="description_${code}"
                rows="4"
                style="${popupTextareaStyle}"
              >${escapeHtml((code === "it" ? waypoint.description_it : waypoint.description_en) || "")}</textarea>
            </div>
          `).join("")}
        </section>
        <section style="${popupSectionStyle}">
          <p style="${popupSectionTitleStyle}">Media</p>
          <div style="display:grid;gap:10px;">${mediaMarkup}</div>
          <input name="media_upload" type="file" multiple style="${popupInputStyle}padding:6px 10px;" />
        </section>
        <div style="position:sticky;bottom:-6px;display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;background:linear-gradient(to top,hsl(var(--background)) 70%,transparent);">
          <button type="button" data-action="relocate" style="flex:1 1 100%;padding:9px 10px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));font-size:12px;font-weight:600;cursor:pointer;">Move on map</button>
          <button type="submit" style="flex:1;padding:9px 10px;border:none;background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-size:12px;font-weight:600;cursor:pointer;">Save</button>
          <button type="button" data-action="delete" style="padding:9px 10px;border:1px solid hsl(var(--border));background:hsl(var(--background));color:hsl(var(--foreground));font-size:12px;font-weight:600;cursor:pointer;">Delete</button>
        </div>
      `;

      const nameItInput = wrapper.querySelector('input[name="name_it"]') as HTMLInputElement | null;
      const nameEnInput = wrapper.querySelector('input[name="name_en"]') as HTMLInputElement | null;
      const descriptionItInput = wrapper.querySelector('textarea[name="description_it"]') as HTMLTextAreaElement | null;
      const descriptionEnInput = wrapper.querySelector('textarea[name="description_en"]') as HTMLTextAreaElement | null;
      const eventDateInput = wrapper.querySelector('input[name="event_date"]') as HTMLInputElement | null;
      const eventTimeInput = wrapper.querySelector('input[name="event_time"]') as HTMLInputElement | null;
      const visibilitySelect = wrapper.querySelector('select[name="visibility_mode"]') as HTMLSelectElement | null;
      const mediaUploadInput = wrapper.querySelector('input[name="media_upload"]') as HTMLInputElement | null;
      const deleteButton = wrapper.querySelector('[data-action="delete"]') as HTMLButtonElement | null;
      const relocateButton = wrapper.querySelector('[data-action="relocate"]') as HTMLButtonElement | null;
      const mediaDeleteButtons = wrapper.querySelectorAll('[data-action="delete-media"]');

      const refreshPopup = () => {
        const nextWaypoint = (waypointsRef.current[waypoint.voyage_id] || []).find((item) => item.id === waypoint.id);
        if (!nextWaypoint) return;
        popup.setDOMContent(createWaypointPopupContent(nextWaypoint, index, total, popup));
      };

      wrapper.addEventListener("submit", (event) => {
        event.preventDefault();
        const name_it = nameItInput?.value.trim() || defaultNames.it;
        const name_en = nameEnInput?.value.trim() || defaultNames.en;
        const visibilityValue = visibilitySelect?.value === "narrative" || visibilitySelect?.value === "technical"
          ? visibilitySelect.value
          : "auto";
        const visibility_mode = visibilityValue === "auto" ? "auto" : "manual";
        const waypoint_type = visibilityValue === "narrative" ? "narrative" : "technical";
        const legacyName = (lang === "it" ? name_it : name_en) || name_it || name_en || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng);

        void (async () => {
          const success = await updateWaypoint(
            waypoint.voyage_id,
            waypoint.id,
            {
              name: legacyName,
              name_it,
              name_en,
              description_it: descriptionItInput?.value.trim() || null,
              description_en: descriptionEnInput?.value.trim() || null,
              event_date: eventDateInput?.value || null,
              event_time: eventTimeInput?.value || null,
              visibility_mode,
              waypoint_type,
            },
            { successMessage: "Waypoint updated" }
          );
          if (success) refreshPopup();
        })();
      });

      deleteButton?.addEventListener("click", () => {
        popup.remove();
        void deleteWaypoint(waypoint.voyage_id, waypoint.id);
      });

      relocateButton?.addEventListener("click", () => {
        startWaypointRelocation(waypoint.voyage_id, waypoint.id);
      });

      mediaDeleteButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const mediaIndex = Number((button as HTMLButtonElement).dataset.mediaIndex);
          if (!Number.isInteger(mediaIndex) || !waypoint.media[mediaIndex]) return;

          void (async () => {
            await deleteWaypointMediaAsset(waypoint.media[mediaIndex]);
            const nextMedia = waypoint.media.filter((_, indexValue) => indexValue !== mediaIndex);
            const success = await updateWaypoint(
              waypoint.voyage_id,
              waypoint.id,
              { media: nextMedia },
              { successMessage: "Media removed" }
            );
            if (success) refreshPopup();
          })();
        });
      });

      mediaUploadInput?.addEventListener("change", () => {
        const files = Array.from(mediaUploadInput.files || []);
        if (!files.length) return;

        void (async () => {
          const uploaded = (await Promise.all(files.map((file) => uploadWaypointMediaAsset(waypoint.id, file))))
            .filter(Boolean) as VoyageWaypointMediaItem[];
          mediaUploadInput.value = "";
          if (!uploaded.length) return;

          const success = await updateWaypoint(
            waypoint.voyage_id,
            waypoint.id,
            { media: [...waypoint.media, ...uploaded] },
            { successMessage: uploaded.length === 1 ? "Media added" : `${uploaded.length} media added` }
          );
          if (success) refreshPopup();
        })();
      });

      return wrapper;
    },
    [deleteWaypoint, deleteWaypointMediaAsset, lang, startWaypointRelocation, updateWaypoint, uploadWaypointMediaAsset]
  );

  const createWaypointMarkerEl = useCallback((waypoint: VoyageWaypoint, index: number, total: number) => {
    const el = document.createElement("button");
    const isNarrative = getWaypointEffectiveType(waypoint, index, total) === "narrative";
    const isStart = index === 0;
    const isEnd = total > 1 && index === total - 1;
    const size = isNarrative ? 16 : 10;

    el.type = "button";
    el.className = "voyage-admin-marker";
    el.title = `${getLocalizedWaypointName(waypoint, lang, index)} · Drag to move`;
    el.style.cssText = `
      width:${size}px;
      height:${size}px;
      border-radius:999px;
      border:2px solid white;
      background:${isStart ? "hsl(136, 42%, 42%)" : isEnd ? "hsl(8, 65%, 54%)" : isNarrative ? "hsl(210, 60%, 45%)" : "hsl(215, 12%, 65%)"};
      box-shadow:0 2px 10px rgba(0,0,0,0.22);
      cursor:grab;
      padding:0;
    `;

    el.addEventListener("click", (event) => event.stopPropagation());
    el.addEventListener("mousedown", (event) => event.stopPropagation());

    return el;
  }, [lang]);

  const drawRouteOnMap = useCallback((map: maplibregl.Map) => {
    const openedPopupWaypointId = pendingPopupOpenWaypointIdRef.current || openedWaypointPopupIdRef.current;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    markersByWaypointRef.current = {};

    const style = map.getStyle();
    if (style) {
      if (routeLineMouseDownRef.current) {
        map.off("mousedown", "admin-route-line", routeLineMouseDownRef.current);
        routeLineMouseDownRef.current = null;
      }
      if (routeLineMouseEnterRef.current) {
        map.off("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
        routeLineMouseEnterRef.current = null;
      }
      if (routeLineMouseLeaveRef.current) {
        map.off("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
        routeLineMouseLeaveRef.current = null;
      }
      style.layers.forEach((layer) => {
        if (layer.id.startsWith("admin-route-")) map.removeLayer(layer.id);
      });
      Object.keys(style.sources).forEach((source) => {
        if (source.startsWith("admin-route-")) map.removeSource(source);
      });
    }

    if (!selectedVoyageRef.current) return;

    const selectedVoyage = voyagesRef.current.find((voyage) => voyage.id === selectedVoyageRef.current);
    const selectedWaypoints = waypointsRef.current[selectedVoyageRef.current] || [];
    if (!selectedWaypoints.length) return;

    const geometry =
      geometryOverrideRef.current[selectedVoyageRef.current] ||
      getCachedGeometryCoordinates(selectedVoyage) ||
      getStraightVoyageGeometry(selectedWaypoints);
    const routeWidth = Math.max(1, 3.4 * getVoyageLineWidthScale(selectedVoyage || { start_date: null }));

    if (geometry.length >= 2) {
      map.addSource("admin-route-line", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: geometry },
          properties: {},
        },
      });

      map.addLayer({
        id: "admin-route-line",
        type: "line",
        source: "admin-route-line",
        paint: {
          "line-color": getVoyageRouteColor(selectedVoyage?.type === "water" ? "water" : "land"),
          "line-width": routeWidth,
          "line-opacity": 0.9,
        },
      });

      routeLineMouseDownRef.current = (event: maplibregl.MapLayerMouseEvent) => {
        if (!selectedVoyageRef.current) return;
        const currentWaypoints = waypointsRef.current[selectedVoyageRef.current] || [];
        const nearestSegmentIndex = getNearestSegmentIndex(map, event.point, currentWaypoints);
        if (nearestSegmentIndex == null) return;

        event.preventDefault();
        suppressMapClickUntilRef.current = Date.now() + 250;
        segmentInsertRef.current = {
          voyageId: selectedVoyageRef.current,
          insertIndex: nearestSegmentIndex + 1,
        };
        ensureSegmentPreviewMarker(map, event.lngLat.lng, event.lngLat.lat);
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
      };
      routeLineMouseEnterRef.current = () => {
        if (!segmentInsertRef.current) {
          map.getCanvas().style.cursor = "grab";
        }
      };
      routeLineMouseLeaveRef.current = () => {
        if (!segmentInsertRef.current) {
          map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
        }
      };

      map.on("mousedown", "admin-route-line", routeLineMouseDownRef.current);
      map.on("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
      map.on("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
    }

    selectedWaypoints.forEach((waypoint, index) => {
      const markerEl = createWaypointMarkerEl(waypoint, index, selectedWaypoints.length);
      const popup = new maplibregl.Popup({ offset: 14, closeButton: true, closeOnClick: false, closeOnMove: false, maxWidth: "380px" });
      popup.setDOMContent(createWaypointPopupContent(waypoint, index, selectedWaypoints.length, popup));
      popup.on("open", () => {
        if (openedWaypointPopupIdRef.current && openedWaypointPopupIdRef.current !== waypoint.id) {
          const openedMarker = markersByWaypointRef.current[openedWaypointPopupIdRef.current];
          openedMarker?.getPopup()?.remove();
        }
        openedWaypointPopupIdRef.current = waypoint.id;
      });
      popup.on("close", () => {
        if (openedWaypointPopupIdRef.current === waypoint.id) {
          openedWaypointPopupIdRef.current = null;
        }
      });

      const marker = new maplibregl.Marker({ element: markerEl, draggable: true })
        .setLngLat([waypoint.lng, waypoint.lat])
        .setPopup(popup)
        .addTo(map);

      marker.on("dragend", () => {
        const position = marker.getLngLat();
        void updateWaypoint(
          waypoint.voyage_id,
          waypoint.id,
          { lat: position.lat, lng: position.lng },
          { successMessage: "Waypoint moved", syncGeometry: true }
        );
      });

      markersRef.current.push(marker);
      markersByWaypointRef.current[waypoint.id] = marker;

      if (openedPopupWaypointId === waypoint.id) {
        requestAnimationFrame(() => {
          const nextPopup = marker.getPopup();
          if (nextPopup && !nextPopup.isOpen()) {
            marker.togglePopup();
            if (pendingPopupOpenWaypointIdRef.current === waypoint.id) {
              pendingPopupOpenWaypointIdRef.current = null;
            }
          }
        });
      }
    });
  }, [createWaypointMarkerEl, createWaypointPopupContent, ensureSegmentPreviewMarker, updateWaypoint]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
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
      zoom: 5,
      attributionControl: false,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    mapRef.current.once("load", () => {
      requestAnimationFrame(() => mapRef.current?.resize());
    });

    mapRef.current.on("mousemove", (event) => {
      if (!segmentInsertRef.current) return;
      ensureSegmentPreviewMarker(mapRef.current!, event.lngLat.lng, event.lngLat.lat);
    });

    mapRef.current.on("mouseup", (event) => {
      const activeInsert = segmentInsertRef.current;
      if (!activeInsert) return;
      suppressMapClickUntilRef.current = Date.now() + 250;
      resetSegmentInsertState();

      void insertWaypointAtIndex(
        activeInsert.voyageId,
        event.lngLat.lat,
        event.lngLat.lng,
        activeInsert.insertIndex
      );
    });

    const handleWindowMouseUp = () => {
      if (!segmentInsertRef.current) return;
      resetSegmentInsertState();
    };

    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowMouseUp);

    mapRef.current.on("click", (event) => {
      const voyageId = selectedVoyageRef.current;
      if (!voyageId) return;
      if (Date.now() < suppressMapClickUntilRef.current) return;

      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest(".voyage-admin-marker") || target?.closest(".maplibregl-popup")) return;

      const activeRelocation = waypointRelocationRef.current;
      if (activeRelocation) {
        waypointRelocationRef.current = null;
        pendingPopupOpenWaypointIdRef.current = activeRelocation.waypointId;

        void (async () => {
          const success = await updateWaypoint(
            activeRelocation.voyageId,
            activeRelocation.waypointId,
            { lat: event.lngLat.lat, lng: event.lngLat.lng },
            { successMessage: "Waypoint moved", syncGeometry: true }
          );

          if (!success) {
            pendingPopupOpenWaypointIdRef.current = null;
          }
          const map = mapRef.current;
          if (map && !segmentInsertRef.current) {
            map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
          }
        })();
        return;
      }

      const openedPopupMarker = Object.values(markersByWaypointRef.current).find((marker) =>
        marker.getPopup()?.isOpen()
      );
      if (openedPopupMarker) {
        openedPopupMarker.getPopup()?.remove();
        return;
      }

      void insertWaypointAtIndex(
        voyageId,
        event.lngLat.lat,
        event.lngLat.lng,
        waypointsRef.current[voyageId]?.length || 0
      );
    });

    return () => {
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("blur", handleWindowMouseUp);
      resetSegmentInsertState();
      clearSearchResultMarker();
      if (routeLineMouseDownRef.current) {
        mapRef.current?.off("mousedown", "admin-route-line", routeLineMouseDownRef.current);
        routeLineMouseDownRef.current = null;
      }
      if (routeLineMouseEnterRef.current) {
        mapRef.current?.off("mouseenter", "admin-route-line", routeLineMouseEnterRef.current);
        routeLineMouseEnterRef.current = null;
      }
      if (routeLineMouseLeaveRef.current) {
        mapRef.current?.off("mouseleave", "admin-route-line", routeLineMouseLeaveRef.current);
        routeLineMouseLeaveRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearSearchResultMarker, ensureSegmentPreviewMarker, insertWaypointAtIndex, resetSegmentInsertState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => drawRouteOnMap(map);
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [drawRouteOnMap, selectedVoyageId, waypoints]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = selectedVoyageId ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [selectedVoyageId]);

  const selectVoyage = useCallback(async (voyageId: string) => {
    cancelWaypointRelocation();
    setSelectedVoyageId(voyageId);
    const loadedWaypoints = waypointsRef.current[voyageId] || await fetchWaypoints(voyageId);
    fitMapToWaypoints(loadedWaypoints);
  }, [cancelWaypointRelocation, fetchWaypoints, fitMapToWaypoints]);

  useEffect(() => {
    if (!selectedVoyageId) return;
    if (waypointsRef.current[selectedVoyageId]?.length) return;
    void (async () => {
      const loadedWaypoints = await fetchWaypoints(selectedVoyageId);
      fitMapToWaypoints(loadedWaypoints);
    })();
  }, [fetchWaypoints, fitMapToWaypoints, selectedVoyageId]);

  const openVoyageForm = useCallback((voyage?: Voyage) => {
    if (voyage) {
      const nextForm: VoyageFormState = {
        name_it: voyage.name_it || voyage.name || "",
        name_en: voyage.name_en || voyage.name || "",
        description_it: voyage.description_it || voyage.description || "",
        description_en: voyage.description_en || voyage.description || "",
        type: voyage.type,
        status: voyage.status,
        is_published: voyage.is_published,
        start_date: voyage.start_date || "",
        start_time: voyage.start_time ? voyage.start_time.slice(0, 5) : "",
        end_date: voyage.end_date || "",
        end_time: voyage.end_time ? voyage.end_time.slice(0, 5) : "",
      };
      setEditingVoyage(voyage);
      initialVoyageFormSnapshotRef.current = serializeVoyageForm(nextForm);
      setVoyageForm(nextForm);
    } else {
      setEditingVoyage(null);
      initialVoyageFormSnapshotRef.current = serializeVoyageForm(emptyVoyageForm);
      setVoyageForm(emptyVoyageForm);
    }
    setShowVoyageForm(true);
  }, []);

  const saveVoyage = useCallback(async () => {
    const nameIt = voyageForm.name_it.trim();
    const nameEn = voyageForm.name_en.trim();
    const descriptionIt = voyageForm.description_it.trim();
    const descriptionEn = voyageForm.description_en.trim();
    const legacyName = nameEn || nameIt || "Untitled voyage";
    const legacyDescription = descriptionEn || descriptionIt || null;
    const data: TablesInsert<"voyages"> = {
      name: legacyName,
      name_it: nameIt || null,
      name_en: nameEn || null,
      description: legacyDescription,
      description_it: descriptionIt || null,
      description_en: descriptionEn || null,
      type: voyageForm.type,
      status: voyageForm.status,
      is_published: voyageForm.is_published,
      start_date: voyageForm.start_date || null,
      start_time: voyageForm.start_time || null,
      end_date: voyageForm.end_date || null,
      end_time: voyageForm.end_time || null,
      sort_order: editingVoyage ? editingVoyage.sort_order : voyagesRef.current.length,
    };
    const legacyData: Pick<TablesInsert<"voyages">, "name" | "description" | "type" | "status" | "sort_order"> = {
      name: data.name,
      description: data.description,
      type: data.type,
      status: data.status,
      sort_order: data.sort_order,
    };

    if (editingVoyage) {
      let appliedData: Partial<Voyage> = data as unknown as Partial<Voyage>;
      let { error } = await supabase.from("voyages").update(data).eq("id", editingVoyage.id);
      if (error && isMissingVoyageDateColumnError(error)) {
        const fallbackResult = await supabase.from("voyages").update(legacyData).eq("id", editingVoyage.id);
        error = fallbackResult.error;
        appliedData = legacyData;
      }
      if (error) {
        toast.error(getErrorMessage(error, "Unable to update voyage"));
        return false;
      }

      const nextVoyages = voyagesRef.current.map((voyage) =>
        voyage.id === editingVoyage.id ? normalizeVoyage({ ...voyage, ...appliedData }) : voyage
      );
      commitVoyages(nextVoyages);
      if ((waypointsRef.current[editingVoyage.id] || []).length >= 2) {
        void syncVoyageGeometry(editingVoyage.id, waypointsRef.current[editingVoyage.id]);
      }
      toast.success("Voyage updated");
    } else {
      let { data: newVoyage, error } = await supabase.from("voyages").insert(data).select().single();
      if ((error || !newVoyage) && isMissingVoyageDateColumnError(error)) {
        ({ data: newVoyage, error } = await supabase.from("voyages").insert(legacyData).select().single());
      }
      if (error || !newVoyage) {
        toast.error(getErrorMessage(error, "Unable to create voyage"));
        return false;
      }

      const normalizedVoyage = normalizeVoyage(newVoyage);
      commitVoyages([...voyagesRef.current, normalizedVoyage]);
      setSelectedVoyageId(normalizedVoyage.id);
      toast.success("Voyage created");
    }

    initialVoyageFormSnapshotRef.current = serializeVoyageForm(voyageForm);
    setShowVoyageForm(false);
    return true;
  }, [commitVoyages, editingVoyage, syncVoyageGeometry, voyageForm]);

  const closeVoyageForm = useCallback(() => {
    if (isVoyageFormDirty && !confirm("Ci sono modifiche non salvate. Vuoi davvero chiudere senza salvare?")) {
      return;
    }

    setShowVoyageForm(false);
  }, [isVoyageFormDirty]);

  const deleteVoyage = useCallback(async (voyageId: string, name: string) => {
    if (!confirm(`Delete voyage "${name}" and all its waypoints?`)) return;

    const { error } = await supabase.from("voyages").delete().eq("id", voyageId);
    if (error) {
      toast.error(getErrorMessage(error, "Unable to delete voyage"));
      return;
    }

    const { [voyageId]: _removedWaypoints, ...remainingWaypoints } = waypointsRef.current;
    waypointsRef.current = remainingWaypoints;
    setWaypoints(remainingWaypoints);
    const { [voyageId]: _removedPersistedWaypoints, ...remainingPersistedWaypoints } = persistedWaypointsRef.current;
    persistedWaypointsRef.current = remainingPersistedWaypoints;

    const nextVoyages = voyagesRef.current.filter((voyage) => voyage.id !== voyageId);
    commitVoyages(nextVoyages);
    delete geometryOverrideRef.current[voyageId];
    delete geometryRequestRef.current[voyageId];

    if (selectedVoyageRef.current === voyageId) {
      setSelectedVoyageId(null);
    }

    toast.success("Voyage deleted");
  }, [commitVoyages]);

  const reorderWaypoint = useCallback(async (voyageId: string, fromIndex: number, toIndex: number) => {
    const currentWaypoints = waypointsRef.current[voyageId] || [];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= currentWaypoints.length || toIndex >= currentWaypoints.length) {
      return false;
    }

    const nextWaypoints = [...currentWaypoints];
    const [movedWaypoint] = nextWaypoints.splice(fromIndex, 1);
    nextWaypoints.splice(toIndex, 0, movedWaypoint);

    const committedWaypoints = commitWaypoints(
      voyageId,
      nextWaypoints.map((waypoint, index) => normalizeWaypoint({ ...waypoint, sort_order: index }))
    );

    geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(committedWaypoints);
    void refreshVoyageGeometryPreview(voyageId, committedWaypoints);
    return true;
  }, [commitWaypoints, refreshVoyageGeometryPreview]);

  const moveWaypoint = useCallback(async (waypoint: VoyageWaypoint, direction: "up" | "down") => {
    const currentWaypoints = waypointsRef.current[waypoint.voyage_id] || [];
    const index = currentWaypoints.findIndex((item) => item.id === waypoint.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    await reorderWaypoint(waypoint.voyage_id, index, targetIndex);
  }, [reorderWaypoint]);

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId);
  const selectedWaypoints = selectedVoyageId ? (waypoints[selectedVoyageId] || []) : [];
  const persistedSelectedWaypoints = selectedVoyageId ? (persistedWaypointsRef.current[selectedVoyageId] || []) : [];
  const isRouteDraftDirty = Boolean(
    selectedVoyageId && serializeWaypointDrafts(selectedWaypoints) !== serializeWaypointDrafts(persistedSelectedWaypoints)
  );
  const distance = selectedWaypoints.length >= 2 ? totalWaypointDistance(selectedWaypoints) : 0;
  const voyageDates = selectedVoyage ? formatVoyageDateRange(selectedVoyage) : null;
  const filteredVoyages = useMemo(
    () =>
      voyages.filter((voyage) => {
        if (listFilters.type !== "all" && voyage.type !== listFilters.type) return false;

        if (listFilters.publicationStatus === "published" && !voyage.is_published) return false;
        if (listFilters.publicationStatus === "draft" && voyage.is_published) return false;

        const createdDate = getDateOnlyValue(voyage.created_at);
        if (!isDateWithinRange(createdDate, listFilters.createdFrom, listFilters.createdTo)) return false;

        const departureDate = getDateOnlyValue(voyage.start_date);
        if (!isDateWithinRange(departureDate, listFilters.departureFrom, listFilters.departureTo)) return false;

        return true;
      }),
    [listFilters, voyages]
  );
  const visibleVoyages = useMemo(() => {
    const directionMultiplier = listSort.direction === "asc" ? 1 : -1;

    return [...filteredVoyages].sort((left, right) => {
      let comparison = 0;

      if (listSort.field === "created_at") {
        comparison = (left.created_at || "").localeCompare(right.created_at || "");
      } else if (listSort.field === "start_date") {
        comparison = (left.start_date || "").localeCompare(right.start_date || "");
      } else if (listSort.field === "type") {
        comparison = left.type.localeCompare(right.type);
      } else if (listSort.field === "publicationStatus") {
        comparison = Number(left.is_published) - Number(right.is_published);
      }

      if (comparison === 0) {
        comparison = (left.sort_order ?? 0) - (right.sort_order ?? 0);
      }

      return comparison * directionMultiplier;
    });
  }, [filteredVoyages, listSort.direction, listSort.field]);
  const hasActiveFilters = Object.values(listFilters).some(Boolean);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selectedVoyageId && isRouteDraftDirty) {
      const payload = {
        selectedVoyageId,
        waypoints: selectedWaypoints,
      };
      window.sessionStorage.setItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      storedRouteDraftRef.current = {
        selectedVoyageId,
        waypoints: selectedWaypoints,
      };
      return;
    }

    window.sessionStorage.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
    storedRouteDraftRef.current = null;
  }, [isRouteDraftDirty, selectedVoyageId, selectedWaypoints]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (showVoyageForm) {
      const payload = {
        editingVoyageId: editingVoyage?.id ?? null,
        voyageForm,
      };
      window.sessionStorage.setItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      storedVoyageFormDraftRef.current = payload;
      return;
    }

    window.sessionStorage.removeItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
    storedVoyageFormDraftRef.current = null;
  }, [editingVoyage?.id, showVoyageForm, voyageForm]);

  useEffect(() => {
    if (selectedVoyage?.type === "land") return;
    setLandSearchQuery("");
    setLandSearchResults([]);
    setLandSearchLoading(false);
    clearSearchResultMarker();
  }, [clearSearchResultMarker, selectedVoyage?.type]);

  useEffect(() => {
    if (!selectedVoyageId) {
      cancelWaypointRelocation();
    }
  }, [cancelWaypointRelocation, selectedVoyageId]);

  useEffect(() => {
    setDraggedWaypointId(null);
    setDragOverWaypointId(null);
  }, [selectedVoyageId]);

  const discardSelectedRouteChanges = useCallback(() => {
    if (!selectedVoyageId) return;
    const persistedWaypoints = persistedWaypointsRef.current[selectedVoyageId] || [];
    commitWaypoints(selectedVoyageId, persistedWaypoints);
    delete geometryOverrideRef.current[selectedVoyageId];
    cancelWaypointRelocation();
    setDraggedWaypointId(null);
    setDragOverWaypointId(null);
  }, [cancelWaypointRelocation, commitWaypoints, selectedVoyageId]);

  const saveSelectedRouteDraft = useCallback(async () => {
    if (!selectedVoyageId || !selectedVoyage) return true;
    if (!isRouteDraftDirty) return true;

    setIsSavingRouteDraft(true);
    const draftWaypoints = sortWaypoints(waypointsRef.current[selectedVoyageId] || []);
    const persistedWaypoints = sortWaypoints(persistedWaypointsRef.current[selectedVoyageId] || []);
    const draftExistingIds = new Set(draftWaypoints.filter((waypoint) => !isLocalWaypointId(waypoint.id)).map((waypoint) => waypoint.id));

    for (const removedWaypoint of persistedWaypoints) {
      if (!draftExistingIds.has(removedWaypoint.id)) {
        const { error } = await supabase.from("voyage_waypoints").delete().eq("id", removedWaypoint.id);
        if (error) {
          setIsSavingRouteDraft(false);
          toast.error(getErrorMessage(error, "Unable to delete waypoint"));
          return false;
        }
      }
    }

    for (const [index, waypoint] of draftWaypoints.entries()) {
      const sort_order = index;
      if (isLocalWaypointId(waypoint.id)) {
        const insertedWaypoint = await persistWaypointInsert(selectedVoyageId, waypoint, sort_order);
        if (!insertedWaypoint) {
          setIsSavingRouteDraft(false);
          return false;
        }
        continue;
      }

      const persistedWaypoint = persistedWaypoints.find((item) => item.id === waypoint.id);
      if (!persistedWaypoint) continue;
      const changes: Partial<VoyageWaypoint> = {};
      ([
        "lat",
        "lng",
        "name",
        "name_it",
        "name_en",
        "description_it",
        "description_en",
        "event_date",
        "event_time",
        "waypoint_type",
        "visibility_mode",
        "sort_order",
        "media",
      ] as const).forEach((key) => {
        const nextValue = key === "sort_order" ? sort_order : waypoint[key];
        const previousValue = key === "sort_order" ? persistedWaypoint.sort_order : persistedWaypoint[key];
        if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
          (changes as Record<string, unknown>)[key] = nextValue;
        }
      });
      if (!Object.keys(changes).length) continue;

      const result = await persistWaypointPatch(waypoint.id, changes);
      if (!result.success) {
        setIsSavingRouteDraft(false);
        return false;
      }
    }

    await fetchWaypoints(selectedVoyageId);
    await syncVoyageGeometry(selectedVoyageId, waypointsRef.current[selectedVoyageId] || []);
    setIsSavingRouteDraft(false);
    toast.success("Route saved");
    return true;
  }, [fetchWaypoints, isRouteDraftDirty, persistWaypointInsert, persistWaypointPatch, selectedVoyage, selectedVoyageId, syncVoyageGeometry]);

  const guardedSelectVoyage = useCallback(async (voyageId: string) => {
    if (selectedVoyageRef.current && selectedVoyageRef.current !== voyageId && isRouteDraftDirty) {
      const shouldSave = window.confirm(
        "Hai modifiche locali non salvate alla rotta corrente. Premi OK per salvarle prima di cambiare rotta."
      );
      if (shouldSave) {
        const saved = await saveSelectedRouteDraft();
        if (!saved) return;
      } else {
        const shouldDiscard = window.confirm("Vuoi scartare le modifiche locali e cambiare rotta?");
        if (!shouldDiscard) return;
        discardSelectedRouteChanges();
      }
    }

    await selectVoyage(voyageId);
  }, [discardSelectedRouteChanges, isRouteDraftDirty, saveSelectedRouteDraft, selectVoyage]);

  const handleSaveBeforeLeave = useCallback(async () => {
    if (!isVoyageFormDirty && !isRouteDraftDirty) return true;

    if (isVoyageFormDirty) {
      const shouldSaveVoyage = window.confirm(
        "Hai modifiche non salvate nella scheda della rotta. Premi OK per salvarle prima di uscire, oppure Annulla per restare qui."
      );
      if (!shouldSaveVoyage) return false;
      const savedVoyage = await saveVoyage();
      if (!savedVoyage) return false;
    }

    if (isRouteDraftDirty) {
      const shouldSaveRoute = window.confirm(
        "Hai modifiche locali non salvate ai waypoint. Premi OK per salvarle prima di uscire, oppure Annulla per restare qui."
      );
      if (!shouldSaveRoute) return false;
      return saveSelectedRouteDraft();
    }

    return true;
  }, [isRouteDraftDirty, isVoyageFormDirty, saveSelectedRouteDraft, saveVoyage]);

  useEffect(() => {
    onRegisterLeaveGuard?.(handleSaveBeforeLeave);
    return () => onRegisterLeaveGuard?.(null);
  }, [handleSaveBeforeLeave, onRegisterLeaveGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isVoyageFormDirty && !isRouteDraftDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isRouteDraftDirty, isVoyageFormDirty]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isVoyageFormDirty && !isRouteDraftDirty) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;

      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentUrl === nextPath) return;

      event.preventDefault();
      void (async () => {
        if (!(await handleSaveBeforeLeave())) return;
        navigate(nextPath);
      })();
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [handleSaveBeforeLeave, isRouteDraftDirty, isVoyageFormDirty, location.hash, location.pathname, location.search, navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="editorial-heading text-lg">Voyages</h3>
        <button
          onClick={() => openVoyageForm()}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> New Voyage
        </button>
      </div>

      {showVoyageForm && (
        <div className="border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-sans font-medium">{editingVoyage ? "Edit Voyage" : "New Voyage"}</h4>
            <button onClick={closeVoyageForm} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {popupLanguageOptions.map(({ code, label }) => (
                <div key={`voyage-name-${code}`}>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                    Name · {label}
                  </label>
                  <input
                    type="text"
                    value={code === "it" ? voyageForm.name_it : voyageForm.name_en}
                    onChange={(event) => setVoyageForm((form) => ({
                      ...form,
                      [code === "it" ? "name_it" : "name_en"]: event.target.value,
                    }))}
                    className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Type</label>
                <select
                  value={voyageForm.type}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, type: event.target.value as Voyage["type"] }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                >
                  <option value="water">🚢 Water</option>
                  <option value="land">🚐 Land</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Status</label>
                <select
                  value={voyageForm.status}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, status: event.target.value as Voyage["status"] }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-[20px] border border-border px-4 py-3">
              <input
                type="checkbox"
                checked={voyageForm.is_published}
                onChange={(event) => setVoyageForm((form) => ({ ...form, is_published: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
              />
              <span className="min-w-0">
                <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
                  {voyageForm.is_published ? "Published route" : "Draft route"}
                </span>
                <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
                  {voyageForm.is_published
                    ? "Visible on public maps and included in mileage totals."
                    : "Hidden from public maps, voyage pages, and mileage counters until published."}
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {popupLanguageOptions.map(({ code, label }) => (
              <div key={`voyage-description-${code}`}>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                  Description · {label}
                </label>
                <textarea
                  value={code === "it" ? voyageForm.description_it : voyageForm.description_en}
                  onChange={(event) => setVoyageForm((form) => ({
                    ...form,
                    [code === "it" ? "description_it" : "description_en"]: event.target.value,
                  }))}
                  rows={3}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Start</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.start_date}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, start_date: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={voyageForm.start_time}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, start_time: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">Time is optional.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">End</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.end_date}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, end_date: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={voyageForm.end_time}
                  onChange={(event) => setVoyageForm((form) => ({ ...form, end_time: event.target.value }))}
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-[11px] text-muted-foreground font-sans">Leave blank if the arrival is still open.</p>
            </div>
          </div>

          <button
            onClick={() => void saveVoyage()}
            className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:opacity-90 transition-opacity"
          >
            {editingVoyage ? "Update" : "Create"}
          </button>
        </div>
      )}

      <div className="rounded-[24px] border border-border/70 bg-muted/10 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-sans font-medium">Filtri rotte</h4>
            <p className="text-xs text-muted-foreground font-sans">
              Filtra per tipologia, data di creazione, data di partenza e stato pubblicazione.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => setListFilters(emptyVoyageListFilters)}
              className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Tipologia</label>
            <select
              value={listFilters.type}
              onChange={(event) => setListFilters((current) => ({ ...current, type: event.target.value as VoyageListFilters["type"] }))}
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="all">Tutte</option>
              <option value="water">Acqua</option>
              <option value="land">Terra</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Stato</label>
            <select
              value={listFilters.publicationStatus}
              onChange={(event) =>
                setListFilters((current) => ({
                  ...current,
                  publicationStatus: event.target.value as VoyageListFilters["publicationStatus"],
                }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="all">Tutte</option>
              <option value="published">Pubblicate</option>
              <option value="draft">Bozze</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Creazione</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={listFilters.createdFrom}
                onChange={(event) => setListFilters((current) => ({ ...current, createdFrom: event.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
              />
              <input
                type="date"
                value={listFilters.createdTo}
                onChange={(event) => setListFilters((current) => ({ ...current, createdTo: event.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Partenza viaggio</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={listFilters.departureFrom}
                onChange={(event) => setListFilters((current) => ({ ...current, departureFrom: event.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
              />
              <input
                type="date"
                value={listFilters.departureTo}
                onChange={(event) => setListFilters((current) => ({ ...current, departureTo: event.target.value }))}
                className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Ordina per</label>
            <select
              value={listSort.field}
              onChange={(event) =>
                setListSort((current) => ({ ...current, field: event.target.value as VoyageListSort["field"] }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="created_at">Data creazione</option>
              <option value="start_date">Data partenza</option>
              <option value="type">Tipologia</option>
              <option value="publicationStatus">Stato</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Direzione</label>
            <select
              value={listSort.direction}
              onChange={(event) =>
                setListSort((current) => ({ ...current, direction: event.target.value as VoyageListSort["direction"] }))
              }
              className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground font-sans">
          {visibleVoyages.length} {visibleVoyages.length === 1 ? "rotta visibile" : "rotte visibili"} su {voyages.length}
        </p>
      </div>

      <div className="space-y-0">
        {visibleVoyages.map((voyage) => {
          const dateRange = formatVoyageDateRange(voyage);
          const displayName = getLocalizedVoyageName(voyage, lang);
          return (
            <div
              key={voyage.id}
              className={`flex items-center justify-between py-3 px-3 border-b border-border group cursor-pointer transition-colors ${
                selectedVoyageId === voyage.id ? "bg-accent/10" : "hover:bg-muted/30"
              }`}
              onClick={() => void guardedSelectVoyage(voyage.id)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {voyage.type === "water" ? (
                  <Ship size={14} className="text-blue-500 shrink-0" />
                ) : (
                  <Mountain size={14} className="text-amber-600 shrink-0" />
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-sans font-medium truncate">{displayName}</h4>
                  <div className="flex items-center gap-2 text-[10px] font-sans uppercase tracking-wider text-muted-foreground">
                    <span>{voyage.status}</span>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                    <span className="inline-flex items-center gap-1">
                      {voyage.is_published ? (
                        <Eye size={10} className="text-accent shrink-0" />
                      ) : (
                        <EyeOff size={10} className="shrink-0" />
                      )}
                      {voyage.is_published ? "published" : "draft"}
                    </span>
                    {dateRange && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                        <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                          <Clock3 size={10} /> {dateRange}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openVoyageForm(voyage);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Edit size={12} />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteVoyage(voyage.id, displayName);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {visibleVoyages.length === 0 && voyages.length > 0 && (
          <div className="py-8 px-4 text-center text-sm text-muted-foreground border-b border-border">
            Nessuna rotta corrisponde ai filtri correnti.
          </div>
        )}
      </div>

      <div className="border border-border">
        <div className="relative" style={{ height: "420px" }}>
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[240px]" />
        </div>

        {!selectedVoyageId && (
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            Seleziona un voyage dalla lista. Da quel momento, ogni click sulla mappa crea subito un waypoint: start e arrivo restano pubblici di default, gli intermedi diventano tecnici.
          </p>
        )}

        {selectedVoyageId && (
          <div className="p-4 border-t border-border space-y-4">
            {selectedVoyage?.type === "land" && (
              <div className="rounded-[22px] border border-border/70 bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-sans font-medium">Cerca indirizzi e POI</h4>
                    <p className="text-xs text-muted-foreground font-sans">
                      Cerca un luogo, centrati sulla mappa e aggiungilo direttamente come waypoint.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={landSearchQuery}
                    onChange={(event) => setLandSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void runLandSearch();
                    }}
                    placeholder="Indirizzo, città, POI, stazione..."
                    className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void runLandSearch()}
                    disabled={landSearchLoading}
                    className="inline-flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm font-sans text-muted-foreground hover:text-foreground disabled:opacity-60"
                    title="Cerca sulla mappa"
                  >
                    {landSearchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  </button>
                </div>

                {landSearchResults.length > 0 && (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {landSearchResults.map((result, index) => (
                      <div
                        key={`${result.lat}-${result.lng}-${index}`}
                        className="flex items-start gap-2 rounded-[18px] border border-border/60 bg-background/60 px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => focusSearchResult(result)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <span className="block text-sm font-sans text-foreground truncate">{result.name.split(",")[0]}</span>
                          <span className="block text-[11px] text-muted-foreground font-sans break-words">{result.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void addSearchResultWaypoint(result)}
                          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] font-sans text-foreground hover:border-accent hover:text-accent"
                        >
                          Aggiungi
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-sans font-medium">Waypoints ({selectedWaypoints.length})</h4>
                <p className="text-xs text-muted-foreground font-sans">
                  {selectedWaypoints.length >= 2
                    ? `${Math.round(distance)} NM traced${voyageDates ? ` · ${voyageDates}` : ""}`
                    : voyageDates || (selectedVoyage?.type === "land"
                      ? "I waypoint fuori carreggiata vengono instradati verso il tratto stradale più vicino."
                      : "The first and last waypoints stay public by default. Intermediate ones are technical.")}
                </p>
                {isRouteDraftDirty && (
                  <p className="mt-1 text-[11px] font-sans text-amber-700">
                    Modifiche locali non ancora salvate.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isRouteDraftDirty && (
                  <button
                    type="button"
                    onClick={discardSelectedRouteChanges}
                    className="border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground"
                  >
                    Discard
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveSelectedRouteDraft()}
                  disabled={!isRouteDraftDirty || isSavingRouteDraft}
                  className="bg-primary text-primary-foreground px-3 py-2 text-xs font-sans font-medium disabled:opacity-50"
                >
                  {isSavingRouteDraft ? "Saving..." : "Save route"}
                </button>
              </div>
            </div>

            <div className="space-y-0 max-h-[260px] overflow-y-auto">
              {selectedWaypoints.map((waypoint, index) => {
                const effectiveType = getWaypointEffectiveType(waypoint, index, selectedWaypoints.length);
                const displayName = getLocalizedWaypointName(waypoint, lang, index);
                const visibilityLabel = waypoint.visibility_mode === "manual"
                  ? effectiveType === "narrative"
                    ? "Manual narrative waypoint"
                    : "Manual technical waypoint"
                  : effectiveType === "narrative"
                    ? "Auto public end waypoint"
                    : "Auto technical waypoint";
                const eventLabel = [waypoint.event_date, waypoint.event_time?.slice(0, 5)].filter(Boolean).join(" · ");

                return (
                  <div
                    key={waypoint.id}
                    onDragOver={(event) => {
                      if (!draggedWaypointId || draggedWaypointId === waypoint.id) return;
                      event.preventDefault();
                      if (dragOverWaypointId !== waypoint.id) {
                        setDragOverWaypointId(waypoint.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggedWaypointId || draggedWaypointId === waypoint.id) return;
                      const fromIndex = selectedWaypoints.findIndex((item) => item.id === draggedWaypointId);
                      const toIndex = selectedWaypoints.findIndex((item) => item.id === waypoint.id);
                      setDraggedWaypointId(null);
                      setDragOverWaypointId(null);
                      void reorderWaypoint(waypoint.voyage_id, fromIndex, toIndex);
                    }}
                    onDragLeave={(event) => {
                      if (!(event.currentTarget as HTMLDivElement).contains(event.relatedTarget as Node | null)) {
                        setDragOverWaypointId((current) => (current === waypoint.id ? null : current));
                      }
                    }}
                    className={`flex items-center gap-2 py-2 px-2 border-b border-border/50 group text-xs transition-colors ${
                      dragOverWaypointId === waypoint.id ? "bg-accent/10" : ""
                    } ${draggedWaypointId === waypoint.id ? "opacity-50" : ""}`}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", waypoint.id);
                        setDraggedWaypointId(waypoint.id);
                        setDragOverWaypointId(waypoint.id);
                      }}
                      onDragEnd={() => {
                        setDraggedWaypointId(null);
                        setDragOverWaypointId(null);
                      }}
                      className="p-0.5 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
                      title="Drag to reorder waypoint"
                    >
                      <GripVertical size={12} />
                    </button>
                    <span className="text-muted-foreground/40 w-5 shrink-0 font-sans">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleWaypointVisibility(waypoint, index, selectedWaypoints.length)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      title={`${visibilityLabel}. Click to toggle quickly.`}
                    >
                      {effectiveType === "technical" ? (
                        <EyeOff size={10} className="text-muted-foreground shrink-0" />
                      ) : (
                        <Eye size={10} className="text-accent shrink-0" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      {editingWaypointNameId === waypoint.id ? (
                        <input
                          type="text"
                          value={editingWaypointNameValue}
                          onChange={(event) => setEditingWaypointNameValue(event.target.value)}
                          onBlur={() => void submitWaypointNameEdit(waypoint, index)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void submitWaypointNameEdit(waypoint, index);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelWaypointNameEdit();
                            }
                          }}
                          autoFocus
                          disabled={savingWaypointNameId === waypoint.id}
                          className="block w-full border border-border bg-background px-2 py-1 font-sans text-xs text-foreground outline-none focus:border-foreground"
                        />
                      ) : (
                        <button
                          type="button"
                          onDoubleClick={() => beginWaypointNameEdit(waypoint, index)}
                          className="font-sans truncate block w-full text-left hover:text-foreground transition-colors"
                          title="Double click to rename"
                        >
                          {displayName || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openWaypointPopup(waypoint.id)}
                        className="text-[10px] text-muted-foreground font-sans text-left hover:text-foreground transition-colors"
                      >
                        {formatWaypointCoordinateLabel(waypoint.lat, waypoint.lng)}
                        {eventLabel ? ` · ${eventLabel}` : ""}
                      </button>
                    </div>
                    <button
                      onClick={() => void deleteWaypoint(waypoint.voyage_id, waypoint.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      title="Delete waypoint"
                    >
                      <Trash2 size={12} />
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openWaypointPopup(waypoint.id)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        title="Edit waypoint"
                      >
                        <Edit size={12} />
                      </button>
                      <button
                        onClick={() => moveWaypoint(waypoint, "up")}
                        disabled={index === 0}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveWaypoint(waypoint, "down")}
                        disabled={index === selectedWaypoints.length - 1}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        onClick={() => {
                          focusWaypointOnMap(waypoint.id);
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        title="Center waypoint on map"
                      >
                        <LocateFixed size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedWaypoints.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                The next click on the map will create the first waypoint.
              </p>
            )}
          </div>
        )}
      </div>

      {voyages.length === 0 && !showVoyageForm && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No voyages yet.</p>
          <button
            onClick={() => openVoyageForm()}
            className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors"
          >
            <Plus size={16} /> Create your first voyage
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminVoyageManager;
