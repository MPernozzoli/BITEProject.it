import { useState, useEffect, useRef, useCallback, useMemo, type SetStateAction } from "react";
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
  ChevronRight,
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
  totalCoordinateDistanceKm,
  reverseGeocodePlaceLocalized,
  buildWaypointDefaultName,
  buildWaypointDefaultLocalizedNames,
  formatWaypointCoordinateLabel,
  buildVoyageGeometry,
  geocodePlaces,
  haversineNM,
  getLocalizedWaypointName,
  getLocalizedVoyageName,
  getWaypointEffectiveType,
  getWaypointSequenceHeading,
  getStraightVoyageGeometry,
  hasVoyageDatesTbd,
  normalizeWaypointMedia,
} from "@/lib/voyage-utils";
import type { GeocodedPlace, Voyage, VoyageWaypoint, VoyageWaypointMediaItem } from "@/lib/voyage-utils";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { invokeTranslateEditorContent } from "@/lib/translate-editor-content";
import {
  getRouteWaypointTranslationGapLabels,
  waypointHasTranslationGap,
} from "@/lib/route-waypoint-translation-gaps";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface VoyageFormState {
  name_it: string;
  name_en: string;
  description_it: string;
  description_en: string;
  type: "water" | "land";
  /** BRouter river profile; only applies when type is water; stored separately from voyage_type. */
  waterway_autoroute: boolean;
  status: "planned" | "active" | "completed";
  is_published: boolean;
  booking_enabled: boolean;
  booking_max_guests: string;
  booking_planning_speed_kn: string;
  dates_tbd: boolean;
  start_date: string;
  start_time: string;
  start_date_flex_days: string;
  end_date: string;
  end_time: string;
  end_date_flex_days: string;
}

interface VoyageListFilters {
  type: "all" | Voyage["type"];
  publicationStatus: "all" | "published" | "draft";
  /** Quale campo usare per il filtro date (stesso intervallo Da / A). */
  dateFilterMode: "created" | "departure";
  dateFrom: string;
  dateTo: string;
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
  waterway_autoroute: false,
  status: "planned",
  is_published: true,
  booking_enabled: false,
  booking_max_guests: "2",
  booking_planning_speed_kn: "5",
  dates_tbd: true,
  start_date: "",
  start_time: "",
  start_date_flex_days: "0",
  end_date: "",
  end_time: "",
  end_date_flex_days: "0",
};

const emptyVoyageListFilters: VoyageListFilters = {
  type: "all",
  publicationStatus: "all",
  dateFilterMode: "created",
  dateFrom: "",
  dateTo: "",
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
const popupLangTabRowStyle = "display:flex;gap:6px;margin-bottom:10px;";
const popupHintStyle = "margin:6px 0 0;font-size:11px;color:hsl(220,10%,45%);line-height:1.45;";
const popupLangTabBaseStyle =
  "flex:1;padding:8px 10px;border:1px solid hsl(var(--border));font-size:11px;font-weight:600;font-family:var(--font-sans);cursor:pointer;transition:background 0.15s,border-color 0.15s,color 0.15s;";
const popupLangTabInactiveStyle = `${popupLangTabBaseStyle}background:hsl(var(--muted));color:hsl(var(--foreground));`;
const popupLangTabActiveStyle = `${popupLangTabBaseStyle}background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:transparent;`;
const popupLanguageOptions = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
] as const;

type WaypointEditorPanelHandle = {
  setDOMContent: (node: Node) => void;
  remove: () => void;
};

const sortWaypoints = (waypoints: VoyageWaypoint[]) =>
  [...waypoints].sort((a, b) => a.sort_order - b.sort_order);

type WaypointDateSuggestionSource = "estimated" | "voyage-start" | "voyage-end";

interface WaypointDateSuggestions {
  arrivalDate: string | null;
  arrivalTime: string | null;
  arrivalSource: WaypointDateSuggestionSource | null;
  departureDate: string | null;
  departureTime: string | null;
  departureSource: WaypointDateSuggestionSource | null;
}

interface WaypointLegEstimate {
  hours: number;
  label: string;
}

const createEmptyWaypointDateSuggestion = (): WaypointDateSuggestions => ({
  arrivalDate: null,
  arrivalTime: null,
  arrivalSource: null,
  departureDate: null,
  departureTime: null,
  departureSource: null,
});

const formatDateInputValue = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

const formatTimeInputValue = (value: Date) =>
  `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;

const formatDateTimeLocalInputValue = (value: Date) =>
  `${formatDateInputValue(value)}T${formatTimeInputValue(value)}`;

const parseStoredDateTime = (value?: string | null) => {
  if (!value) return null;
  const candidate = new Date(value);
  if (!Number.isNaN(candidate.getTime())) return candidate;
  return parseDateTimeInput(value);
};

const serializeDateTimeLocalInputValue = (value?: string | null) => {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart) return null;
  return timePart ? `${datePart}T${timePart}` : datePart;
};

const getStoredDateTimeInputValue = (value?: string | null) => {
  const parsed = parseStoredDateTime(value);
  return parsed ? formatDateTimeLocalInputValue(parsed) : "";
};

const parseNonNegativeInteger = (value?: string | null) => {
  if (!value?.trim()) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const parseDateTimeInput = (
  dateValue?: string | null,
  timeValue?: string | null,
  options?: { endOfDay?: boolean }
) => {
  if (!dateValue) return null;

  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return null;

  const fallbackTime = options?.endOfDay ? "23:59" : "00:00";
  const normalizedTime = (timeValue?.slice(0, 5) || fallbackTime).split(":");
  const hours = Number(normalizedTime[0] || 0);
  const minutes = Number(normalizedTime[1] || 0);
  const candidate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const clampDateWithinRange = (value: Date, min?: Date | null, max?: Date | null) => {
  const nextValue = new Date(value.getTime());
  if (min && nextValue.getTime() < min.getTime()) return new Date(min.getTime());
  if (max && nextValue.getTime() > max.getTime()) return new Date(max.getTime());
  return nextValue;
};

const formatEstimatedLegDuration = (hours: number) => {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const normalizedHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (normalizedHours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${normalizedHours} h`;
  return `${normalizedHours} h ${String(minutes).padStart(2, "0")} min`;
};

const deriveWaypointLegEstimates = (waypoints: VoyageWaypoint[]) =>
  Object.fromEntries(
    waypoints.map((waypoint, index) => {
      if (index === 0) return [waypoint.id, null];
      const previousWaypoint = waypoints[index - 1];
      const hours = haversineNM(previousWaypoint.lat, previousWaypoint.lng, waypoint.lat, waypoint.lng) / 5;
      return [
        waypoint.id,
        {
          hours,
          label: formatEstimatedLegDuration(hours),
        } satisfies WaypointLegEstimate,
      ];
    })
  ) as Record<string, WaypointLegEstimate | null>;

const formatVoyageDateWindowLabel = (value: string | null, flexDays: number | null | undefined) => {
  if (!value) return null;
  const parts = [value];
  if (Number.isFinite(flexDays) && Number(flexDays) > 0) {
    parts.push(`± ${Number(flexDays)} giorni`);
  }
  return parts.join(" ");
};

const getWaypointDateSuggestionNote = (
  dateValue: string | null,
  timeValue: string | null,
  source: WaypointDateSuggestionSource | null
) => {
  if (!dateValue || !source) return null;
  const stamp = [dateValue, timeValue].filter(Boolean).join(" · ");

  if (source === "voyage-start") return `Suggerita: ${stamp} dalla partenza della rotta.`;
  if (source === "voyage-end") return `Suggerita: ${stamp} dalla fine della rotta.`;
  return `Stimata: ${stamp} calcolando il tratto a 5 kn.`;
};

const buildWaypointDateTimeLabel = (
  dateTimeValue?: string | null,
  fallbackDate?: string | null,
  fallbackTime?: string | null
) => {
  const parsed = parseStoredDateTime(dateTimeValue);
  if (parsed) {
    const hasExplicitTime = Boolean(dateTimeValue && /[T\s]\d{2}:\d{2}/.test(dateTimeValue));
    return hasExplicitTime
      ? [formatDateInputValue(parsed), formatTimeInputValue(parsed)].join(" · ")
      : formatDateInputValue(parsed);
  }
  if (!fallbackDate) return null;
  return [fallbackDate, fallbackTime].filter(Boolean).join(" · ");
};

const buildWaypointAdminDateLabel = (
  waypoint: VoyageWaypoint,
  suggestion: WaypointDateSuggestions | undefined,
  effectiveType: "technical" | "narrative"
) => {
  if (effectiveType === "technical") {
    if (!waypoint.event_date) return null;
    return `Pass ${[waypoint.event_date, waypoint.event_time?.slice(0, 5)].filter(Boolean).join(" · ")}`;
  }

  const arrival = buildWaypointDateTimeLabel(waypoint.date_end, suggestion?.arrivalDate, suggestion?.arrivalTime);
  const departure = buildWaypointDateTimeLabel(waypoint.date_start, suggestion?.departureDate, suggestion?.departureTime);
  const parts = [
    arrival ? `Arr ${waypoint.date_end ? arrival : `~${arrival}`}` : null,
    departure ? `Part ${waypoint.date_start ? departure : `~${departure}`}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
};

const deriveWaypointDateSuggestions = (
  voyage: Pick<Voyage, "status" | "start_date" | "start_time" | "end_date" | "end_time"> | undefined,
  waypoints: VoyageWaypoint[]
) => {
  const suggestions = Object.fromEntries(
    waypoints.map((waypoint) => [waypoint.id, createEmptyWaypointDateSuggestion()])
  ) as Record<string, WaypointDateSuggestions>;

  if (!voyage || !waypoints.length || hasVoyageDatesTbd(voyage)) return suggestions;

  const voyageStart = parseDateTimeInput(voyage.start_date, voyage.start_time);
  const voyageEnd = parseDateTimeInput(voyage.end_date, voyage.end_time, { endOfDay: !voyage.end_time });
  const narrativeIndexes = waypoints.flatMap((waypoint, index) =>
    getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative" ? [index] : []
  );
  const firstNarrativeIndex = narrativeIndexes[0] ?? null;
  const lastNarrativeIndex = narrativeIndexes.length ? narrativeIndexes[narrativeIndexes.length - 1] : null;
  let anchor: { date: Date; waypoint: VoyageWaypoint } | null = null;

  if (firstNarrativeIndex != null && voyageStart) {
    const firstWaypoint = waypoints[firstNarrativeIndex];
    suggestions[firstWaypoint.id] = {
      ...suggestions[firstWaypoint.id],
      departureDate: voyage.start_date || formatDateInputValue(voyageStart),
      departureTime: voyage.start_time?.slice(0, 5) || formatTimeInputValue(voyageStart),
      departureSource: "voyage-start",
    };
    anchor = { date: voyageStart, waypoint: firstWaypoint };
  }

  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index];
    const isNarrative = getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative";
    const current = suggestions[waypoint.id] || createEmptyWaypointDateSuggestion();

    if (isNarrative) {
      if (index !== firstNarrativeIndex && anchor) {
        const hours = haversineNM(anchor.waypoint.lat, anchor.waypoint.lng, waypoint.lat, waypoint.lng) / 5;
        const estimatedDate = clampDateWithinRange(
          new Date(anchor.date.getTime() + hours * 60 * 60 * 1000),
          voyageStart,
          voyageEnd
        );
        current.arrivalDate = current.arrivalDate || formatDateInputValue(estimatedDate);
        current.arrivalTime = current.arrivalTime || formatTimeInputValue(estimatedDate);
        current.arrivalSource = current.arrivalSource || "estimated";
      }

      if (index === lastNarrativeIndex && voyage.end_date && !waypoint.date_end) {
        current.arrivalDate = voyage.end_date;
        current.arrivalTime = voyage.end_time?.slice(0, 5) || (voyageEnd ? formatTimeInputValue(voyageEnd) : null);
        current.arrivalSource = "voyage-end";
      }

      suggestions[waypoint.id] = current;

      const explicitDeparture = parseStoredDateTime(waypoint.date_start);
      const explicitArrival = parseStoredDateTime(waypoint.date_end);
      const suggestedDeparture =
        !explicitDeparture && current.departureDate
          ? parseDateTimeInput(
              current.departureDate,
              current.departureTime || (index === firstNarrativeIndex ? voyage.start_time : null)
            )
          : null;
      const suggestedArrival =
        !explicitArrival && current.arrivalDate
          ? parseDateTimeInput(
              current.arrivalDate,
              current.arrivalTime || (index === lastNarrativeIndex ? voyage.end_time : null)
            )
          : null;
      const nextAnchor = explicitDeparture || explicitArrival || suggestedDeparture || suggestedArrival;
      if (nextAnchor) {
        anchor = {
          date: clampDateWithinRange(nextAnchor, voyageStart, voyageEnd),
          waypoint,
        };
      }
      continue;
    }

    const explicitPassage = parseDateTimeInput(waypoint.event_date, waypoint.event_time);
    if (explicitPassage) {
      anchor = {
        date: clampDateWithinRange(explicitPassage, voyageStart, voyageEnd),
        waypoint,
      };
    }
  }

  return suggestions;
};

const WAYPOINT_PERSIST_PATCH_KEYS = [
  "lat",
  "lng",
  "name",
  "name_it",
  "name_en",
  "description_it",
  "description_en",
  "event_date",
  "event_time",
  "date_start",
  "date_end",
  "planned_stop_duration_minutes",
  "waypoint_type",
  "visibility_mode",
  "sort_order",
  "media",
] as const;

const computeWaypointPersistChanges = (
  waypoint: VoyageWaypoint,
  persistedWaypoint: VoyageWaypoint,
  sortOrder: number
): Partial<VoyageWaypoint> => {
  const changes: Partial<VoyageWaypoint> = {};
  WAYPOINT_PERSIST_PATCH_KEYS.forEach((key) => {
    const nextValue = key === "sort_order" ? sortOrder : waypoint[key];
    const previousValue = key === "sort_order" ? persistedWaypoint.sort_order : persistedWaypoint[key];
    if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
      (changes as Record<string, unknown>)[key] = nextValue;
    }
  });
  return changes;
};

/** Consente a React di dipingere aggiornamenti di progresso durante operazioni async lunghe. */
const yieldToUi = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
  return ["start_date", "start_time", "start_date_flex_days", "end_date", "end_time", "end_date_flex_days", "name_it", "name_en", "description_it", "description_en", "is_published", "waterway_autoroute", "booking_enabled", "booking_max_guests", "booking_planning_speed_kn"].some((column) => text.includes(column)) &&
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
  planned_stop_duration_minutes: Math.max(0, Number(waypoint?.planned_stop_duration_minutes ?? 0)),
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
  waterway_autoroute: Boolean(voyage?.waterway_autoroute),
  is_published: (voyage?.is_published ?? true) as boolean,
  booking_enabled: Boolean(voyage?.booking_enabled),
  booking_max_guests: Math.max(1, Number(voyage?.booking_max_guests ?? 2)),
  booking_planning_speed_kn: Math.max(0.1, Number(voyage?.booking_planning_speed_kn ?? 5)),
  departure_window_start: (voyage?.departure_window_start ?? null) as string | null,
  departure_window_end: (voyage?.departure_window_end ?? null) as string | null,
  start_date: (voyage?.start_date ?? null) as string | null,
  start_time: (voyage?.start_time ?? null) as string | null,
  start_date_flex_days: (voyage?.start_date_flex_days ?? 0) as number | null,
  end_date: (voyage?.end_date ?? null) as string | null,
  end_time: (voyage?.end_time ?? null) as string | null,
  end_date_flex_days: (voyage?.end_date_flex_days ?? 0) as number | null,
});

const formatVoyageDateRange = (voyage: Voyage) => {
  if (!voyage.start_date && !voyage.end_date) {
    return hasVoyageDatesTbd(voyage) ? "Da definirsi" : null;
  }
  const start = [formatVoyageDateWindowLabel(voyage.start_date, voyage.start_date_flex_days), voyage.start_time].filter(Boolean).join(" ");
  const end = [formatVoyageDateWindowLabel(voyage.end_date, voyage.end_date_flex_days), voyage.end_time].filter(Boolean).join(" ");
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
  selectedVoyageId?: string | null;
  onSelectedVoyageIdChange?: (voyageId: string | null) => void;
  /** Impostato dal parent (es. sidebar dashboard): apre il form info viaggio per quell'id, poi invoca onRequestEditVoyageConsumed. */
  requestEditVoyageId?: string | null;
  onRequestEditVoyageConsumed?: () => void;
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
    date_start: waypoint.date_start,
    date_end: waypoint.date_end,
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
    const parsed = JSON.parse(raw) as { editingVoyageId?: string | null; voyageForm?: Partial<VoyageFormState> };
    if (!parsed.voyageForm) return null;
    const voyageForm: VoyageFormState = {
      ...emptyVoyageForm,
      ...parsed.voyageForm,
      dates_tbd:
        parsed.voyageForm.dates_tbd ??
        ((parsed.voyageForm.status ?? "planned") === "planned" &&
          !parsed.voyageForm.start_date &&
          !parsed.voyageForm.end_date),
    };
    return {
      editingVoyageId: parsed.editingVoyageId ?? null,
      voyageForm,
    };
  } catch {
    return null;
  }
};

const AdminVoyageManager = ({
  onRegisterLeaveGuard,
  selectedVoyageId: controlledSelectedVoyageId,
  onSelectedVoyageIdChange,
  requestEditVoyageId = null,
  onRequestEditVoyageConsumed,
}: AdminVoyageManagerProps) => {
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
  const [voyageFormLang, setVoyageFormLang] = useState<"it" | "en">("it");
  const [listFilters, setListFilters] = useState<VoyageListFilters>(emptyVoyageListFilters);
  const [listSort, setListSort] = useState<VoyageListSort>(defaultVoyageListSort);
  const [routeListFiltersExpanded, setRouteListFiltersExpanded] = useState(false);
  const [routeListFiltersAdvanced, setRouteListFiltersAdvanced] = useState(false);
  const initialVoyageFormSnapshotRef = useRef(serializeVoyageForm(emptyVoyageForm));
  const isVoyageFormDirty = showVoyageForm && serializeVoyageForm(voyageForm) !== initialVoyageFormSnapshotRef.current;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markersByWaypointRef = useRef<Record<string, maplibregl.Marker>>({});
  const waypointPanelMountRef = useRef<HTMLDivElement | null>(null);
  const setWaypointEditorPanelIdRef = useRef<(value: SetStateAction<string | null>) => void>(() => {});
  const focusWaypointOnMapRef = useRef<(waypointId: string) => boolean>(() => false);
  const voyagesRef = useRef<Voyage[]>([]);
  const waypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const persistedWaypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const storedRouteDraftRef = useRef(initialStoredRouteDraft);
  const storedVoyageFormDraftRef = useRef(initialStoredVoyageFormDraft);
  const selectedVoyageRef = useRef<string | null>(null);
  const geometryRequestRef = useRef<Record<string, number>>({});
  const geometryOverrideRef = useRef<Record<string, [number, number][]>>({});
  const geometryDebounceTimersRef = useRef<Record<string, number>>({});
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
  const [routeSaveProgress, setRouteSaveProgress] = useState<{
    label: string;
    percent: number;
    step: number;
    totalSteps: number;
  } | null>(null);
  const [routeTranslationOfferOpen, setRouteTranslationOfferOpen] = useState(false);
  const [routeTranslationOfferBusy, setRouteTranslationOfferBusy] = useState(false);
  const [routeTranslationGapLabels, setRouteTranslationGapLabels] = useState<string[]>([]);
  const [isRegeneratingGeometry, setIsRegeneratingGeometry] = useState(false);
  /** Bumps when async route geometry (OSRM / BRouter) finishes so the map redraws even if waypoints state is unchanged. */
  const [routeGeometryTick, setRouteGeometryTick] = useState(0);
  const [waypointEditorPanelId, setWaypointEditorPanelId] = useState<string | null>(null);
  const waypointEditorPanelIdRef = useRef<string | null>(null);

  const setCurrentSelectedVoyageId = useCallback((nextVoyageId: string | null) => {
    setSelectedVoyageId(nextVoyageId);
    onSelectedVoyageIdChange?.(nextVoyageId);
  }, [onSelectedVoyageIdChange]);

  const commitVoyages = useCallback((nextVoyages: Voyage[]) => {
    voyagesRef.current = nextVoyages;
    setVoyages(nextVoyages);
  }, []);

  const commitWaypoints = useCallback((voyageId: string, nextWaypoints: VoyageWaypoint[]) => {
    const seen = new Set<string>();
    const uniqueOrdered: VoyageWaypoint[] = [];
    for (const waypoint of nextWaypoints) {
      if (seen.has(waypoint.id)) continue;
      seen.add(waypoint.id);
      uniqueOrdered.push(waypoint);
    }
    const sorted = sortWaypoints(uniqueOrdered).map((waypoint, index) =>
      normalizeWaypoint({ ...waypoint, sort_order: index })
    );
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

  useEffect(() => {
    if (controlledSelectedVoyageId === undefined) return;
    if (controlledSelectedVoyageId === selectedVoyageId) return;
    setSelectedVoyageId(controlledSelectedVoyageId);
  }, [controlledSelectedVoyageId, selectedVoyageId]);

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

  const voyageUsesWaterwayAutoroute = (voyageId: string) => {
    const voyage = voyagesRef.current.find((item) => item.id === voyageId);
    return Boolean(voyage && voyage.type === "water" && voyage.waterway_autoroute);
  };

  const refreshVoyageGeometryPreview = useCallback(
    async (voyageId: string, candidateWaypoints?: VoyageWaypoint[]): Promise<[number, number][] | null> => {
      const voyage = voyagesRef.current.find((item) => item.id === voyageId);
      if (!voyage) return null;

      const sortedWaypoints = sortWaypoints(candidateWaypoints || waypointsRef.current[voyageId] || []);
      const requestId = (geometryRequestRef.current[voyageId] || 0) + 1;
      geometryRequestRef.current[voyageId] = requestId;

      const coordinates = await buildVoyageGeometry(sortedWaypoints, voyage.type, {
        waterwayAutoroute: voyage.type === "water" && Boolean(voyage.waterway_autoroute),
      });
      if (geometryRequestRef.current[voyageId] !== requestId) return null;

      geometryOverrideRef.current[voyageId] = coordinates;
      setRouteGeometryTick((tick) => tick + 1);
      return coordinates;
    },
    []
  );

  const primeGeometryOverrideAfterWaypointEdit = useCallback(
    (voyageId: string, waypointList: VoyageWaypoint[]) => {
      if (voyageUsesWaterwayAutoroute(voyageId)) {
        const prev = geometryDebounceTimersRef.current[voyageId];
        if (prev !== undefined) window.clearTimeout(prev);
        geometryDebounceTimersRef.current[voyageId] = window.setTimeout(() => {
          delete geometryDebounceTimersRef.current[voyageId];
          void refreshVoyageGeometryPreview(voyageId, waypointList);
        }, 320);
        return;
      }
      geometryOverrideRef.current[voyageId] = getStraightVoyageGeometry(waypointList);
      void refreshVoyageGeometryPreview(voyageId, waypointList);
    },
    [refreshVoyageGeometryPreview]
  );

  const syncVoyageGeometry = useCallback(
    async (voyageId: string, candidateWaypoints?: VoyageWaypoint[]): Promise<boolean> => {
      const pendingTimer = geometryDebounceTimersRef.current[voyageId];
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        delete geometryDebounceTimersRef.current[voyageId];
      }

      const voyage = voyagesRef.current.find((item) => item.id === voyageId);
      const sortedWaypoints = sortWaypoints(candidateWaypoints || waypointsRef.current[voyageId] || []);

      let coordinates = await refreshVoyageGeometryPreview(voyageId, candidateWaypoints);
      if (!coordinates || coordinates.length < 2) {
        const fromRef = geometryOverrideRef.current[voyageId];
        if (fromRef && fromRef.length >= 2) {
          coordinates = fromRef;
        }
      }

      if (!coordinates || coordinates.length < 2) {
        if (!voyage) {
          toast.error("Voyage non trovato: geometria non salvata.");
          return false;
        }
        coordinates = await buildVoyageGeometry(sortedWaypoints, voyage.type, {
          waterwayAutoroute: voyage.type === "water" && Boolean(voyage.waterway_autoroute),
        });
        geometryOverrideRef.current[voyageId] = coordinates;
      }

      const cachedGeometry = coordinates.length >= 2 ? { type: "LineString" as const, coordinates } : null;
      const payload: TablesUpdate<"voyages"> = { cached_geometry: cachedGeometry };
      const { error } = await supabase.from("voyages").update(payload).eq("id", voyageId);

      if (error) {
        console.error("[AdminVoyageManager] syncVoyageGeometry failed", { voyageId, error });
        toast.error(getErrorMessage(error, "Impossibile salvare la geometria del percorso"));
        return false;
      }

      commitVoyages(
        voyagesRef.current.map((item) =>
          item.id === voyageId ? normalizeVoyage({ ...item, cached_geometry: cachedGeometry }) : item
        )
      );
      return true;
    },
    [commitVoyages, refreshVoyageGeometryPreview]
  );

  const syncBookableLegs = useCallback(async (voyageId: string) => {
    try {
      const { error } = await supabase.rpc("sync_voyage_bookable_legs" as never, { _voyage_id: voyageId } as never);
      if (error) {
        console.warn("[AdminVoyageManager] sync_voyage_bookable_legs skipped", error);
        return false;
      }
      return true;
    } catch (error) {
      console.warn("[AdminVoyageManager] sync_voyage_bookable_legs unavailable", error);
      return false;
    }
  }, []);

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

  const clearVoyageWaypointDates = useCallback(async (voyageId: string) => {
    const clearPayload: TablesUpdate<"voyage_waypoints"> = {
      event_date: null,
      event_time: null,
      date_start: null,
      date_end: null,
    };
    const { error } = await supabase.from("voyage_waypoints").update(clearPayload).eq("voyage_id", voyageId);
    if (error) {
      console.error("[AdminVoyageManager] clearVoyageWaypointDates failed", { voyageId, error });
      return false;
    }

    const normalizeClearedWaypoint = (waypoint: VoyageWaypoint) =>
      normalizeWaypoint({
        ...waypoint,
        event_date: null,
        event_time: null,
        date_start: null,
        date_end: null,
      });

    const localWaypoints = waypointsRef.current[voyageId] || [];
    if (localWaypoints.length) {
      commitWaypoints(voyageId, localWaypoints.map(normalizeClearedWaypoint));
    }

    const persistedWaypoints = persistedWaypointsRef.current[voyageId] || [];
    if (persistedWaypoints.length) {
      persistedWaypointsRef.current = {
        ...persistedWaypointsRef.current,
        [voyageId]: persistedWaypoints.map(normalizeClearedWaypoint),
      };
    }

    return true;
  }, [commitWaypoints]);

  const persistWaypointPatch = useCallback(
    async (
      waypointId: string,
      changes: Partial<VoyageWaypoint>,
      options?: { notify?: boolean }
    ): Promise<
      | { success: true; appliedChanges: Partial<VoyageWaypoint> }
      | { success: false; appliedChanges: null; error: { message?: string | null } | null }
    > => {
      const notify = options?.notify !== false;
      const payload = changes as unknown as TablesUpdate<"voyage_waypoints">;
      let appliedChanges = changes;
      let { error } = await supabase.from("voyage_waypoints").update(payload).eq("id", waypointId);

      if (error && isMissingWaypointMetadataColumnError(error)) {
        const legacyPayload = stripUnsupportedWaypointMetadata(payload as Record<string, unknown>) as TablesUpdate<"voyage_waypoints">;
        if (!Object.keys(legacyPayload).length) {
          const migrationMsg =
            "Applica le migration waypoint più recenti per salvare testi localizzati, date e media.";
          console.error("[AdminVoyageManager] persistWaypointPatch: migration required", { waypointId, error });
          if (notify) toast.error(migrationMsg);
          return { success: false, appliedChanges: null, error: { message: migrationMsg } };
        }

        const fallbackResult = await supabase.from("voyage_waypoints").update(legacyPayload).eq("id", waypointId);
        error = fallbackResult.error;
        appliedChanges = legacyPayload as unknown as Partial<VoyageWaypoint>;
      }

      if (error) {
        console.error("[AdminVoyageManager] persistWaypointPatch failed", { waypointId, changes, error });
        if (notify) toast.error(getErrorMessage(error, "Impossibile aggiornare il waypoint"));
        return { success: false, appliedChanges: null, error };
      }

      return { success: true, appliedChanges };
    },
    []
  );

  const persistWaypointInsert = useCallback(async (
    voyageId: string,
    waypoint: VoyageWaypoint,
    sortOrder: number,
    options?: { notify?: boolean }
  ) => {
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
      date_start: waypoint.date_start,
      date_end: waypoint.date_end,
      planned_stop_duration_minutes: Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0)),
      media: waypoint.media as unknown as import("@/integrations/supabase/types").Json,
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

    const notify = options?.notify !== false;
    if (error || !data) {
      console.error("[AdminVoyageManager] persistWaypointInsert failed", { voyageId, sortOrder, waypoint, error });
      if (notify) toast.error(getErrorMessage(error, "Impossibile creare il waypoint"));
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
        primeGeometryOverrideAfterWaypointEdit(voyageId, nextWaypoints);
      }

      if (options?.successMessage) {
        toast.success(options.successMessage);
      }

      return true;
    },
    [commitWaypoints, primeGeometryOverrideAfterWaypointEdit]
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
      primeGeometryOverrideAfterWaypointEdit(voyageId, committedWaypoints);

      setWaypointEditorPanelId(createdWaypoint.id);
      window.setTimeout(() => {
        void focusWaypointOnMapRef.current(createdWaypoint.id);
      }, 0);

      const suggestedPlace = await reverseGeocodePlaceLocalized(lat, lng);
      if (!suggestedPlace.it && !suggestedPlace.en) return true;

      const currentWaypoint = (waypointsRef.current[voyageId] || []).find((item) => item.id === createdWaypoint.id);
      if (!currentWaypoint) return true;

      const hasCustomLocalizedName = currentWaypoint.name_it !== provisionalNames.it || currentWaypoint.name_en !== provisionalNames.en;
      if (hasCustomLocalizedName) return true;

      const suggestedNames = buildWaypointDefaultLocalizedNames(boundedIndex, lat, lng, null, suggestedPlace);
      if (suggestedNames.it === provisionalNames.it && suggestedNames.en === provisionalNames.en) return true;

      await updateWaypoint(voyageId, createdWaypoint.id, {
        name: suggestedNames[lang],
        name_it: suggestedNames.it,
        name_en: suggestedNames.en,
      });
      return true;
    },
    [commitWaypoints, lang, primeGeometryOverrideAfterWaypointEdit, setWaypointEditorPanelId, updateWaypoint]
  );

  const deleteWaypoint = useCallback(
    async (voyageId: string, waypointId: string) => {
      if (!confirm("Delete this waypoint?")) return;

      const nextWaypoints = commitWaypoints(
        voyageId,
        (waypointsRef.current[voyageId] || []).filter((waypoint) => waypoint.id !== waypointId)
      );
      primeGeometryOverrideAfterWaypointEdit(voyageId, nextWaypoints);
    },
    [commitWaypoints, primeGeometryOverrideAfterWaypointEdit]
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

  useEffect(() => {
    waypointEditorPanelIdRef.current = waypointEditorPanelId;
  }, [waypointEditorPanelId]);

  useEffect(() => {
    setWaypointEditorPanelIdRef.current = setWaypointEditorPanelId;
    focusWaypointOnMapRef.current = focusWaypointOnMap;
  }, [focusWaypointOnMap]);

  const openWaypointPopup = useCallback((waypointId: string) => {
    setWaypointEditorPanelId((prev) => {
      if (prev === waypointId) return null;
      queueMicrotask(() => void focusWaypointOnMap(waypointId));
      return waypointId;
    });
  }, [focusWaypointOnMap]);

  const startWaypointRelocation = useCallback((voyageId: string, waypointId: string) => {
    waypointRelocationRef.current = { voyageId, waypointId };
    setWaypointEditorPanelId(null);
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

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId);
  const selectedWaypoints = selectedVoyageId ? (waypoints[selectedVoyageId] || []) : [];
  const selectedVoyageDatesTbd = Boolean(selectedVoyage && hasVoyageDatesTbd(selectedVoyage));
  const selectedWaypointDateSuggestions = useMemo(
    () => deriveWaypointDateSuggestions(selectedVoyage, selectedWaypoints),
    [selectedVoyage, selectedWaypoints]
  );
  const selectedWaypointLegEstimates = useMemo(
    () => deriveWaypointLegEstimates(selectedWaypoints),
    [selectedWaypoints]
  );

  const createWaypointPopupContent = useCallback(
    (waypoint: VoyageWaypoint, index: number, total: number, panel: WaypointEditorPanelHandle) => {
      const effectiveType = getWaypointEffectiveType(waypoint, index, total);
      const defaultNames = buildWaypointDefaultLocalizedNames(index, waypoint.lat, waypoint.lng);
      const dateSuggestions = selectedWaypointDateSuggestions[waypoint.id] || createEmptyWaypointDateSuggestion();
      const legEstimate = selectedWaypointLegEstimates[waypoint.id];
      const arrivalSuggestionNote = getWaypointDateSuggestionNote(
        dateSuggestions.arrivalDate,
        dateSuggestions.arrivalTime,
        dateSuggestions.arrivalSource
      );
      const departureSuggestionNote = getWaypointDateSuggestionNote(
        dateSuggestions.departureDate,
        dateSuggestions.departureTime,
        dateSuggestions.departureSource
      );
      const selectedVisibilityValue = waypoint.visibility_mode === "manual" ? waypoint.waypoint_type : "auto";
      const statusLabel = waypoint.visibility_mode === "manual"
        ? effectiveType === "narrative" ? "Visible" : "Hidden"
        : effectiveType === "narrative" ? (index === 0 ? "Auto start" : "Auto end") : "Auto hidden";
      const resolveDetailsType = (value: string) => {
        if (value === "narrative") return "narrative" as const;
        if (value === "technical") return "technical" as const;
        return index === 0 || index === total - 1 ? "narrative" as const : "technical" as const;
      };
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

      const heading = getWaypointSequenceHeading(index, total, lang);
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
          <p style="${popupSectionTitleStyle}">Testi</p>
          <button type="button" data-action="ai-translate" style="justify-self:start;padding:6px 10px;border:1px solid hsl(var(--border));background:hsl(var(--muted));color:hsl(var(--foreground));font-size:11px;font-weight:600;cursor:pointer;border-radius:2px;">
            Traduci campi vuoti (IT↔EN)
          </button>
          <div style="${popupLangTabRowStyle}" role="tablist" aria-label="Lingua contenuti waypoint">
            <button type="button" data-popup-lang="it" aria-selected="true" style="${popupLangTabActiveStyle}">Italiano</button>
            <button type="button" data-popup-lang="en" aria-selected="false" style="${popupLangTabInactiveStyle}">English</button>
          </div>
          <div data-popup-panel="it" style="display:grid;gap:10px;">
            <div>
              <label style="${popupLabelStyle}">Nome</label>
              <input
                name="name_it"
                type="text"
                value="${escapeHtml((waypoint.name_it || defaultNames.it))}"
                style="${popupInputStyle}"
              />
            </div>
            <div>
              <label style="${popupLabelStyle}">Descrizione</label>
              <textarea
                name="description_it"
                rows="4"
                style="${popupTextareaStyle}"
              >${escapeHtml(waypoint.description_it || "")}</textarea>
            </div>
          </div>
          <div data-popup-panel="en" style="display:none;grid;gap:10px;">
            <div>
              <label style="${popupLabelStyle}">Name</label>
              <input
                name="name_en"
                type="text"
                value="${escapeHtml((waypoint.name_en || defaultNames.en))}"
                style="${popupInputStyle}"
              />
            </div>
            <div>
              <label style="${popupLabelStyle}">Description</label>
              <textarea
                name="description_en"
                rows="4"
                style="${popupTextareaStyle}"
              >${escapeHtml(waypoint.description_en || "")}</textarea>
            </div>
          </div>
        </section>
        <section style="${popupSectionStyle}">
          <p style="${popupSectionTitleStyle}">Details</p>
          <div>
            <label style="${popupLabelStyle}">Visibility</label>
            <select name="visibility_mode" style="${popupInputStyle}">
              <option value="auto"${selectedVisibilityValue === "auto" ? " selected" : ""}>Auto (start and end are public)</option>
              <option value="technical"${selectedVisibilityValue === "technical" ? " selected" : ""}>Technical / hidden</option>
              <option value="narrative"${selectedVisibilityValue === "narrative" ? " selected" : ""}>Narrative / public</option>
            </select>
          </div>
          ${selectedVoyageDatesTbd ? `
            <div style="display:grid;gap:8px;">
              <p style="${popupHintStyle}margin:0;">
                Viaggio planned con date disattivate: nessuna data viene salvata sui waypoint.
              </p>
              <p style="${popupHintStyle}margin:0;">
                ${escapeHtml(
                  legEstimate
                    ? `Tempo stimato dal WPT precedente: ${legEstimate.label} a 5 kn.`
                    : "Primo waypoint: nessun tempo di percorrenza precedente da stimare."
                )}
              </p>
            </div>
          ` : `
          <div data-details-kind="narrative" style="display:${effectiveType === "narrative" ? "grid" : "none"};gap:10px;">
            <div>
              <label style="${popupLabelStyle}">Arrival</label>
              <input
                name="date_end"
                type="datetime-local"
                value="${escapeHtml(getStoredDateTimeInputValue(waypoint.date_end))}"
                placeholder="${escapeHtml(
                  dateSuggestions.arrivalDate ? `${dateSuggestions.arrivalDate}T${dateSuggestions.arrivalTime || "00:00"}` : ""
                )}"
                style="${popupInputStyle}"
              />
              ${arrivalSuggestionNote ? `<p style="${popupHintStyle}">${escapeHtml(arrivalSuggestionNote)}</p>` : ""}
            </div>
            <div>
              <label style="${popupLabelStyle}">Departure</label>
              <input
                name="date_start"
                type="datetime-local"
                value="${escapeHtml(getStoredDateTimeInputValue(waypoint.date_start))}"
                placeholder="${escapeHtml(
                  dateSuggestions.departureDate ? `${dateSuggestions.departureDate}T${dateSuggestions.departureTime || "00:00"}` : ""
                )}"
                style="${popupInputStyle}"
              />
              <p style="${popupHintStyle}">
                ${escapeHtml(departureSuggestionNote || "Opzionale. Se valorizzata, verrà usata per stimare le tappe successive.")}
              </p>
            </div>
            <div>
              <label style="${popupLabelStyle}">Sosta prevista</label>
              <input
                name="planned_stop_duration_minutes"
                type="number"
                min="0"
                step="30"
                value="${escapeHtml(String(Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0))))}"
                style="${popupInputStyle}"
              />
              <p style="${popupHintStyle}">Durata in minuti da considerare per le tappe successive e per il booking.</p>
            </div>
          </div>
          <div data-details-kind="technical" style="display:${effectiveType === "technical" ? "grid" : "none"};gap:10px;">
            <div style="display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:10px;">
              <div>
              <label style="${popupLabelStyle}">Passage date</label>
              <input
                name="event_date"
                type="date"
                value="${escapeHtml(waypoint.event_date || "")}"
                style="${popupInputStyle}"
              />
              </div>
              <div>
                <label style="${popupLabelStyle}">Time</label>
                <input
                  name="event_time"
                  type="time"
                  value="${escapeHtml(waypoint.event_time ? waypoint.event_time.slice(0, 5) : "")}"
                  style="${popupInputStyle}"
                />
              </div>
              <p style="${popupHintStyle}">Opzionale. Se inserita manualmente, verrà usata per stimare i waypoint successivi.</p>
            </div>
          </div>
          `}
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
      const arrivalDateInput = wrapper.querySelector('input[name="date_end"]') as HTMLInputElement | null;
      const departureDateInput = wrapper.querySelector('input[name="date_start"]') as HTMLInputElement | null;
      const eventDateInput = wrapper.querySelector('input[name="event_date"]') as HTMLInputElement | null;
      const eventTimeInput = wrapper.querySelector('input[name="event_time"]') as HTMLInputElement | null;
      const stopDurationInput = wrapper.querySelector('input[name="planned_stop_duration_minutes"]') as HTMLInputElement | null;
      const visibilitySelect = wrapper.querySelector('select[name="visibility_mode"]') as HTMLSelectElement | null;
      const mediaUploadInput = wrapper.querySelector('input[name="media_upload"]') as HTMLInputElement | null;
      const deleteButton = wrapper.querySelector('[data-action="delete"]') as HTMLButtonElement | null;
      const relocateButton = wrapper.querySelector('[data-action="relocate"]') as HTMLButtonElement | null;
      const aiTranslateButton = wrapper.querySelector('[data-action="ai-translate"]') as HTMLButtonElement | null;
      const mediaDeleteButtons = wrapper.querySelectorAll('[data-action="delete-media"]');
      const langTabButtons = wrapper.querySelectorAll<HTMLButtonElement>("[data-popup-lang]");
      const langPanels = wrapper.querySelectorAll<HTMLElement>("[data-popup-panel]");
      const detailsPanels = wrapper.querySelectorAll<HTMLElement>("[data-details-kind]");

      langTabButtons.forEach((tab) => {
        tab.addEventListener("click", () => {
          const code = tab.getAttribute("data-popup-lang");
          if (code !== "it" && code !== "en") return;
          langTabButtons.forEach((btn) => {
            const active = btn.getAttribute("data-popup-lang") === code;
            btn.setAttribute("aria-selected", active ? "true" : "false");
            btn.style.cssText = active ? popupLangTabActiveStyle : popupLangTabInactiveStyle;
          });
          langPanels.forEach((panel) => {
            const show = panel.getAttribute("data-popup-panel") === code;
            panel.style.display = show ? "grid" : "none";
          });
        });
      });

      const syncDetailsPanels = () => {
        const nextType = resolveDetailsType(visibilitySelect?.value || selectedVisibilityValue);
        detailsPanels.forEach((panelElement) => {
          panelElement.style.display = panelElement.getAttribute("data-details-kind") === nextType ? "grid" : "none";
        });
      };

      visibilitySelect?.addEventListener("change", syncDetailsPanels);
      syncDetailsPanels();

      aiTranslateButton?.addEventListener("click", () => {
        void (async () => {
          if (!aiTranslateButton) return;
          aiTranslateButton.disabled = true;
          try {
            const result = await invokeTranslateEditorContent({
              kind: "waypoint",
              name_it: nameItInput?.value ?? "",
              name_en: nameEnInput?.value ?? "",
              description_it: descriptionItInput?.value ?? "",
              description_en: descriptionEnInput?.value ?? "",
            });
            if (!result.ok) {
              toast.error("error" in result ? result.error : "Errore di traduzione");
              return;
            }
            if (result.skipped) {
              toast.message("Niente da tradurre: compila i campi in una lingua e lascia vuoti quelli nell’altra.");
              return;
            }
            const f = result.fields;
            if (typeof f.name_en === "string" && nameEnInput) nameEnInput.value = f.name_en;
            if (typeof f.name_it === "string" && nameItInput) nameItInput.value = f.name_it;
            if (typeof f.description_en === "string" && descriptionEnInput) descriptionEnInput.value = f.description_en;
            if (typeof f.description_it === "string" && descriptionItInput) descriptionItInput.value = f.description_it;
            toast.success("Traduzione applicata nei campi (salva per confermare).");
          } finally {
            aiTranslateButton.disabled = false;
          }
        })();
      });

      const refreshPopup = () => {
        const nextWaypoint = (waypointsRef.current[waypoint.voyage_id] || []).find((item) => item.id === waypoint.id);
        if (!nextWaypoint) return;
        panel.setDOMContent(createWaypointPopupContent(nextWaypoint, index, total, panel));
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
        const nextChanges: Partial<VoyageWaypoint> = {
          name: legacyName,
          name_it,
          name_en,
          description_it: descriptionItInput?.value.trim() || null,
          description_en: descriptionEnInput?.value.trim() || null,
          visibility_mode,
          waypoint_type,
          planned_stop_duration_minutes: waypoint_type === "narrative"
            ? parseNonNegativeInteger(stopDurationInput?.value || "0")
            : 0,
        };

        if (waypoint_type === "narrative") {
          nextChanges.date_end = selectedVoyageDatesTbd ? null : serializeDateTimeLocalInputValue(arrivalDateInput?.value || null);
          nextChanges.date_start = selectedVoyageDatesTbd ? null : serializeDateTimeLocalInputValue(departureDateInput?.value || null);
          nextChanges.event_date = null;
          nextChanges.event_time = null;
        } else {
          nextChanges.event_date = selectedVoyageDatesTbd ? null : eventDateInput?.value || null;
          nextChanges.event_time = selectedVoyageDatesTbd ? null : eventTimeInput?.value || null;
          nextChanges.date_start = null;
          nextChanges.date_end = null;
        }

        void (async () => {
          const success = await updateWaypoint(
            waypoint.voyage_id,
            waypoint.id,
            nextChanges,
            { successMessage: "Waypoint updated" }
          );
          if (success) refreshPopup();
        })();
      });

      deleteButton?.addEventListener("click", () => {
        panel.remove();
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
    [
      deleteWaypoint,
      deleteWaypointMediaAsset,
      lang,
      selectedWaypointDateSuggestions,
      selectedWaypointLegEstimates,
      selectedVoyageDatesTbd,
      startWaypointRelocation,
      updateWaypoint,
      uploadWaypointMediaAsset,
    ]
  );

  useEffect(() => {
    setWaypointEditorPanelId(null);
  }, [selectedVoyageId]);

  useEffect(() => {
    const mount = waypointPanelMountRef.current;
    if (!mount) return;

    if (!waypointEditorPanelId || !selectedVoyageId) {
      mount.replaceChildren();
      return;
    }

    const wps = waypoints[selectedVoyageId] || [];
    const index = wps.findIndex((w) => w.id === waypointEditorPanelId);
    if (index < 0) {
      setWaypointEditorPanelId(null);
      return;
    }

    const waypoint = wps[index];
    const total = wps.length;
    const handle: WaypointEditorPanelHandle = {
      setDOMContent: (node) => {
        mount.replaceChildren(node);
      },
      remove: () => {
        setWaypointEditorPanelId(null);
      },
    };
    mount.replaceChildren(createWaypointPopupContent(waypoint, index, total, handle));
  }, [waypointEditorPanelId, selectedVoyageId, waypoints, createWaypointPopupContent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(id);
  }, [waypointEditorPanelId]);

  const createWaypointMarkerEl = useCallback((waypoint: VoyageWaypoint, index: number, total: number) => {
    const el = document.createElement("button");
    const isNarrative = getWaypointEffectiveType(waypoint, index, total) === "narrative";
    const isStart = index === 0;
    const isEnd = total > 1 && index === total - 1;
    const size = isNarrative ? 16 : 10;

    el.type = "button";
    el.className = "voyage-admin-marker";
    el.title = `${getWaypointSequenceHeading(index, total, lang)} · ${getLocalizedWaypointName(waypoint, lang, index)} · Drag to move`;
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
      markerEl.addEventListener("click", (event) => {
        event.stopPropagation();
        setWaypointEditorPanelIdRef.current((prev) => {
          if (prev === waypoint.id) return null;
          queueMicrotask(() => void focusWaypointOnMapRef.current(waypoint.id));
          return waypoint.id;
        });
      });

      const marker = new maplibregl.Marker({ element: markerEl, draggable: true })
        .setLngLat([waypoint.lng, waypoint.lat])
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
    });
  }, [createWaypointMarkerEl, ensureSegmentPreviewMarker, updateWaypoint]);

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
      if (target?.closest(".voyage-admin-marker") || target?.closest("[data-waypoint-editor-panel]")) return;

      const activeRelocation = waypointRelocationRef.current;
      if (activeRelocation) {
        waypointRelocationRef.current = null;

        void (async () => {
          const success = await updateWaypoint(
            activeRelocation.voyageId,
            activeRelocation.waypointId,
            { lat: event.lngLat.lat, lng: event.lngLat.lng },
            { successMessage: "Waypoint moved", syncGeometry: true }
          );

          if (success) {
            setWaypointEditorPanelId(activeRelocation.waypointId);
          }
          const map = mapRef.current;
          if (map && !segmentInsertRef.current) {
            map.getCanvas().style.cursor = selectedVoyageRef.current ? "crosshair" : "";
          }
        })();
        return;
      }

      if (waypointEditorPanelIdRef.current) {
        setWaypointEditorPanelId(null);
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
  }, [drawRouteOnMap, routeGeometryTick, selectedVoyageId, waypoints]);

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
    setCurrentSelectedVoyageId(voyageId);
    const loadedWaypoints = waypointsRef.current[voyageId] || await fetchWaypoints(voyageId);
    fitMapToWaypoints(loadedWaypoints);
  }, [cancelWaypointRelocation, fetchWaypoints, fitMapToWaypoints, setCurrentSelectedVoyageId]);

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
        waterway_autoroute: voyage.type === "water" ? Boolean(voyage.waterway_autoroute) : false,
        status: voyage.status,
        is_published: voyage.is_published,
        booking_enabled: Boolean(voyage.booking_enabled),
        booking_max_guests: String(Math.max(1, Number(voyage.booking_max_guests ?? 2))),
        booking_planning_speed_kn: String(Math.max(0.1, Number(voyage.booking_planning_speed_kn ?? 5))),
        dates_tbd: hasVoyageDatesTbd(voyage),
        start_date: voyage.start_date || "",
        start_time: voyage.start_time ? voyage.start_time.slice(0, 5) : "",
        start_date_flex_days: String(Math.max(0, Number(voyage.start_date_flex_days ?? 0))),
        end_date: voyage.end_date || "",
        end_time: voyage.end_time ? voyage.end_time.slice(0, 5) : "",
        end_date_flex_days: String(Math.max(0, Number(voyage.end_date_flex_days ?? 0))),
      };
      setEditingVoyage(voyage);
      initialVoyageFormSnapshotRef.current = serializeVoyageForm(nextForm);
      setVoyageForm(nextForm);
    } else {
      setEditingVoyage(null);
      initialVoyageFormSnapshotRef.current = serializeVoyageForm(emptyVoyageForm);
      setVoyageForm(emptyVoyageForm);
    }
    setVoyageFormLang("it");
    setShowVoyageForm(true);
  }, []);

  useEffect(() => {
    if (!requestEditVoyageId) return;
    const voyage = voyages.find((v) => v.id === requestEditVoyageId);
    if (!voyage) return;
    openVoyageForm(voyage);
    onRequestEditVoyageConsumed?.();
  }, [requestEditVoyageId, voyages, openVoyageForm, onRequestEditVoyageConsumed]);

  const saveVoyage = useCallback(async () => {
    const nameIt = voyageForm.name_it.trim();
    const nameEn = voyageForm.name_en.trim();
    const descriptionIt = voyageForm.description_it.trim();
    const descriptionEn = voyageForm.description_en.trim();
    const datesTbd = voyageForm.status === "planned" && voyageForm.dates_tbd;
    const startFlexDays = datesTbd || voyageForm.status !== "planned" ? 0 : parseNonNegativeInteger(voyageForm.start_date_flex_days);
    const endFlexDays = datesTbd || voyageForm.status !== "planned" ? 0 : parseNonNegativeInteger(voyageForm.end_date_flex_days);
    const bookingMaxGuests = Math.max(1, parseNonNegativeInteger(voyageForm.booking_max_guests) || 2);
    const bookingPlanningSpeedKn = Math.max(0.1, Number.parseFloat(voyageForm.booking_planning_speed_kn) || 5);
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
      booking_enabled: voyageForm.booking_enabled,
      booking_max_guests: bookingMaxGuests,
      booking_planning_speed_kn: bookingPlanningSpeedKn,
      start_date: datesTbd ? null : voyageForm.start_date || null,
      start_time: datesTbd ? null : voyageForm.start_time || null,
      start_date_flex_days: datesTbd ? 0 : startFlexDays,
      end_date: datesTbd ? null : voyageForm.end_date || null,
      end_time: datesTbd ? null : voyageForm.end_time || null,
      end_date_flex_days: datesTbd ? 0 : endFlexDays,
      sort_order: editingVoyage ? editingVoyage.sort_order : voyagesRef.current.length,
      waterway_autoroute: voyageForm.type === "water" ? voyageForm.waterway_autoroute : false,
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
      if (datesTbd) {
        const cleared = await clearVoyageWaypointDates(editingVoyage.id);
        if (!cleared) {
          toast.error("Viaggio salvato, ma non sono riuscito a rimuovere le date dai waypoint.");
          return false;
        }
      }
      if ((waypointsRef.current[editingVoyage.id] || []).length >= 2) {
        await syncVoyageGeometry(editingVoyage.id, waypointsRef.current[editingVoyage.id]);
      }
      if (voyageForm.booking_enabled && (waypointsRef.current[editingVoyage.id] || []).length >= 2) {
        await syncBookableLegs(editingVoyage.id);
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
      setCurrentSelectedVoyageId(normalizedVoyage.id);
      toast.success("Voyage created");
    }

    initialVoyageFormSnapshotRef.current = serializeVoyageForm(voyageForm);
    setShowVoyageForm(false);
    return true;
  }, [clearVoyageWaypointDates, commitVoyages, editingVoyage, setCurrentSelectedVoyageId, syncBookableLegs, syncVoyageGeometry, voyageForm]);

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
      setCurrentSelectedVoyageId(null);
    }

    toast.success("Voyage deleted");
  }, [commitVoyages, setCurrentSelectedVoyageId]);

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

    primeGeometryOverrideAfterWaypointEdit(voyageId, committedWaypoints);
    return true;
  }, [commitWaypoints, primeGeometryOverrideAfterWaypointEdit]);

  const moveWaypoint = useCallback(async (waypoint: VoyageWaypoint, direction: "up" | "down") => {
    const currentWaypoints = waypointsRef.current[waypoint.voyage_id] || [];
    const index = currentWaypoints.findIndex((item) => item.id === waypoint.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    await reorderWaypoint(waypoint.voyage_id, index, targetIndex);
  }, [reorderWaypoint]);

  const persistedSelectedWaypoints = selectedVoyageId ? (persistedWaypointsRef.current[selectedVoyageId] || []) : [];
  const selectedVoyageHasCachedGeometry = getCachedGeometryCoordinates(selectedVoyage).length >= 2;
  const isRouteDraftDirty = Boolean(
    selectedVoyageId && serializeWaypointDrafts(selectedWaypoints) !== serializeWaypointDrafts(persistedSelectedWaypoints)
  );
  const distance = useMemo(() => {
    if (!selectedVoyage || selectedWaypoints.length < 2) return null;
    if (selectedVoyage.type === "land") {
      const routeGeometry =
        geometryOverrideRef.current[selectedVoyage.id] ||
        getCachedGeometryCoordinates(selectedVoyage);
      const distanceKm = routeGeometry.length >= 2 ? totalCoordinateDistanceKm(routeGeometry) : 0;
      return distanceKm > 0 ? { value: distanceKm, unit: "KM" as const } : null;
    }
    if (selectedVoyage.waterway_autoroute) {
      const routeGeometry =
        geometryOverrideRef.current[selectedVoyage.id] ||
        getCachedGeometryCoordinates(selectedVoyage);
      const distanceNm =
        routeGeometry.length >= 2 ? totalCoordinateDistanceKm(routeGeometry) / 1.852 : 0;
      return distanceNm > 0 ? { value: distanceNm, unit: "NM" as const } : null;
    }
    return { value: totalWaypointDistance(selectedWaypoints), unit: "NM" as const };
  }, [selectedVoyage, selectedWaypoints, waypoints]);
  const voyageDates = selectedVoyage ? formatVoyageDateRange(selectedVoyage) : null;
  const filteredVoyages = useMemo(
    () =>
      voyages.filter((voyage) => {
        if (listFilters.type !== "all" && voyage.type !== listFilters.type) return false;

        if (listFilters.publicationStatus === "published" && !voyage.is_published) return false;
        if (listFilters.publicationStatus === "draft" && voyage.is_published) return false;

        const dateValue =
          listFilters.dateFilterMode === "created"
            ? getDateOnlyValue(voyage.created_at)
            : getDateOnlyValue(voyage.start_date);
        if (!isDateWithinRange(dateValue, listFilters.dateFrom, listFilters.dateTo)) return false;

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
  const hasActiveFilters =
    listFilters.type !== "all" ||
    listFilters.publicationStatus !== "all" ||
    Boolean(listFilters.dateFrom) ||
    Boolean(listFilters.dateTo);

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

  const applyRouteWaypointTranslations = useCallback(async (): Promise<boolean> => {
    const vid = selectedVoyageId;
    if (!vid) return false;
    const list = sortWaypoints([...(waypointsRef.current[vid] || [])]);
    const next: VoyageWaypoint[] = [];
    for (let i = 0; i < list.length; i++) {
      const wp = list[i]!;
      if (!waypointHasTranslationGap(wp)) {
        next.push(wp);
        continue;
      }
      const result = await invokeTranslateEditorContent({
        kind: "waypoint",
        name_it: wp.name_it ?? "",
        name_en: wp.name_en ?? "",
        description_it: wp.description_it ?? "",
        description_en: wp.description_en ?? "",
      });
      if (!result.ok) {
        toast.error((result as { ok: false; error: string }).error);
        return false;
      }
      if (result.skipped) {
        next.push(wp);
        continue;
      }
      const f = result.fields;
      const name_it = typeof f.name_it === "string" ? f.name_it : (wp.name_it ?? "");
      const name_en = typeof f.name_en === "string" ? f.name_en : (wp.name_en ?? "");
      const description_it = typeof f.description_it === "string" ? f.description_it : wp.description_it;
      const description_en = typeof f.description_en === "string" ? f.description_en : wp.description_en;
      const legacyName = (lang === "it" ? name_it : name_en) || name_it || name_en || wp.name;
      next.push(
        normalizeWaypoint({
          ...wp,
          name: legacyName,
          name_it,
          name_en,
          description_it,
          description_en,
        } as WaypointRecord)
      );
    }
    commitWaypoints(vid, next);
    toast.success("Traduzioni waypoint applicate in bozza.");
    return true;
  }, [commitWaypoints, lang, selectedVoyageId]);

  const saveSelectedRouteDraft = useCallback(async (options?: { bypassTranslationPrompt?: boolean }) => {
    if (!selectedVoyageId || !selectedVoyage) return true;
    if (!isRouteDraftDirty) return true;

    if (!options?.bypassTranslationPrompt) {
      const draftSnapshot = sortWaypoints(waypointsRef.current[selectedVoyageId] || []);
      const gapLabels = getRouteWaypointTranslationGapLabels(draftSnapshot);
      if (gapLabels.length > 0) {
        setRouteTranslationGapLabels(gapLabels);
        setRouteTranslationOfferOpen(true);
        return false;
      }
    }

    setIsSavingRouteDraft(true);
    setRouteSaveProgress({ label: "Preparazione…", percent: 0, step: 0, totalSteps: 1 });
    await yieldToUi();

    try {
      const draftSnapshot = sortWaypoints(waypointsRef.current[selectedVoyageId] || []);
      const persistedWaypoints = sortWaypoints(persistedWaypointsRef.current[selectedVoyageId] || []);
      const draftExistingIds = new Set(
        draftSnapshot.filter((waypoint) => !isLocalWaypointId(waypoint.id)).map((waypoint) => waypoint.id)
      );

      const toDelete = persistedWaypoints.filter((w) => !draftExistingIds.has(w.id));
      let mutationSteps = 0;
      for (const [index, waypoint] of draftSnapshot.entries()) {
        if (isLocalWaypointId(waypoint.id)) {
          mutationSteps += 1;
          continue;
        }
        const persistedWaypoint = persistedWaypoints.find((item) => item.id === waypoint.id);
        if (!persistedWaypoint) continue;
        const changes = computeWaypointPersistChanges(waypoint, persistedWaypoint, index);
        if (Object.keys(changes).length) mutationSteps += 1;
      }

      const totalSteps = Math.max(1, toDelete.length + mutationSteps + 2 + (selectedVoyage.booking_enabled ? 1 : 0));
      let completed = 0;

      const reportProgress = async (label: string) => {
        completed += 1;
        const percent = Math.min(99, Math.round((completed / totalSteps) * 100));
        setRouteSaveProgress({ label, percent, step: completed, totalSteps });
        await yieldToUi();
      };

      setRouteSaveProgress((prev) =>
        prev
          ? { ...prev, label: "Applicazione modifiche waypoint…", totalSteps, step: 0, percent: 0 }
          : { label: "Applicazione modifiche waypoint…", totalSteps, step: 0, percent: 0 }
      );
      await yieldToUi();

      for (let di = 0; di < toDelete.length; di += 1) {
        const removedWaypoint = toDelete[di];
        await reportProgress(
          toDelete.length > 1
            ? `Rimozione waypoint dal server (${di + 1}/${toDelete.length})…`
            : "Rimozione waypoint rimosso dal server…"
        );
        const { error } = await supabase.from("voyage_waypoints").delete().eq("id", removedWaypoint.id);
        if (error) {
          console.error("[AdminVoyageManager] save route: delete waypoint failed", {
            voyageId: selectedVoyageId,
            waypointId: removedWaypoint.id,
            error,
          });
          toast.error(
            getErrorMessage(error, "Salvataggio rotta: impossibile eliminare un waypoint rimosso in modifica.")
          );
          return false;
        }
      }

      let insertOrdinal = 0;
      let patchOrdinal = 0;
      const patchTotal = draftSnapshot.filter((wp, idx) => {
        if (isLocalWaypointId(wp.id)) return false;
        const p = persistedWaypoints.find((item) => item.id === wp.id);
        return p ? Object.keys(computeWaypointPersistChanges(wp, p, idx)).length > 0 : false;
      }).length;
      const insertTotal = draftSnapshot.filter((wp) => isLocalWaypointId(wp.id)).length;

      for (const [index, waypoint] of draftSnapshot.entries()) {
        const sort_order = index;
        if (isLocalWaypointId(waypoint.id)) {
          insertOrdinal += 1;
          await reportProgress(
            insertTotal > 1
              ? `Creazione nuovi waypoint (${insertOrdinal}/${insertTotal})…`
              : "Creazione nuovo waypoint…"
          );
          const insertedWaypoint = await persistWaypointInsert(selectedVoyageId, waypoint, sort_order, { notify: false });
          if (!insertedWaypoint) {
            toast.error(
              "Salvataggio rotta: creazione di un nuovo waypoint non riuscita. Dettagli in console (persistWaypointInsert)."
            );
            return false;
          }
          const localId = waypoint.id;
          const listAfterInsert = sortWaypoints(waypointsRef.current[selectedVoyageId] || []);
          const merged = listAfterInsert.map((w) =>
            w.id === localId ? normalizeWaypoint({ ...insertedWaypoint, sort_order: w.sort_order }) : w
          );
          commitWaypoints(
            selectedVoyageId,
            merged.map((w, i) => normalizeWaypoint({ ...w, sort_order: i }))
          );
          setWaypointEditorPanelId((prev) => (prev === localId ? insertedWaypoint.id : prev));
          continue;
        }

        const persistedWaypoint = persistedWaypoints.find((item) => item.id === waypoint.id);
        if (!persistedWaypoint) continue;
        const changes = computeWaypointPersistChanges(waypoint, persistedWaypoint, sort_order);
        if (!Object.keys(changes).length) continue;

        patchOrdinal += 1;
        await reportProgress(
          patchTotal > 1
            ? `Aggiornamento waypoint esistenti (${patchOrdinal}/${patchTotal})…`
            : "Aggiornamento waypoint…"
        );

        const result = await persistWaypointPatch(waypoint.id, changes, { notify: false });
        if (!result.success) {
          const errorDetail = "error" in result ? result.error : undefined;
          const detail = getErrorMessage(errorDetail, "errore sconosciuto");
          console.error("[AdminVoyageManager] save route: patch waypoint failed", {
            voyageId: selectedVoyageId,
            waypointId: waypoint.id,
            changes,
            error: errorDetail,
          });
          toast.error(
            `Salvataggio rotta: aggiornamento waypoint non riuscito (${waypoint.name_it || waypoint.name_en || waypoint.id}). ${detail}`
          );
          return false;
        }
      }

      storedRouteDraftRef.current = null;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
      }

      await reportProgress("Sincronizzazione elenco dal database…");
      await fetchWaypoints(selectedVoyageId);

      await reportProgress(
        "Calcolo e salvataggio geometria (può richiedere diversi secondi se il routing è attivo)…"
      );
      const geoOk = await syncVoyageGeometry(selectedVoyageId, waypointsRef.current[selectedVoyageId] || []);
      if (selectedVoyage.booking_enabled) {
        await reportProgress("Sincronizzazione tratte prenotabili...");
        await syncBookableLegs(selectedVoyageId);
      }

      setRouteSaveProgress({ label: "Completato", percent: 100, step: totalSteps, totalSteps });
      await yieldToUi();

      if (!geoOk) {
        console.error("[AdminVoyageManager] save route: syncVoyageGeometry failed after waypoint save", {
          voyageId: selectedVoyageId,
        });
        toast.error(
          "Waypoint salvati sul database, ma la geometria della linea non è stata aggiornata. Usa «Rigenera geometria» o riprova il salvataggio."
        );
      } else {
        toast.success("Rotta salvata correttamente (waypoint e geometria).");
      }
      return true;
    } finally {
      setIsSavingRouteDraft(false);
      if (typeof window !== "undefined") {
        window.setTimeout(() => setRouteSaveProgress(null), 400);
      } else {
        setRouteSaveProgress(null);
      }
    }
  }, [
    commitWaypoints,
    fetchWaypoints,
    isRouteDraftDirty,
    persistWaypointInsert,
    persistWaypointPatch,
    selectedVoyage,
    selectedVoyageId,
    syncBookableLegs,
    syncVoyageGeometry,
    setWaypointEditorPanelId,
  ]);

  const handleRouteTranslationOfferClose = useCallback(() => {
    setRouteTranslationOfferOpen(false);
    setRouteTranslationGapLabels([]);
  }, []);

  const handleRouteTranslationTranslateAndSave = useCallback(async () => {
    setRouteTranslationOfferBusy(true);
    try {
      const ok = await applyRouteWaypointTranslations();
      if (!ok) return;
      setRouteTranslationOfferOpen(false);
      setRouteTranslationGapLabels([]);
      await saveSelectedRouteDraft({ bypassTranslationPrompt: true });
    } finally {
      setRouteTranslationOfferBusy(false);
    }
  }, [applyRouteWaypointTranslations, saveSelectedRouteDraft]);

  const handleRouteTranslationSkipAndSave = useCallback(async () => {
    setRouteTranslationOfferBusy(true);
    try {
      setRouteTranslationOfferOpen(false);
      setRouteTranslationGapLabels([]);
      await saveSelectedRouteDraft({ bypassTranslationPrompt: true });
    } finally {
      setRouteTranslationOfferBusy(false);
    }
  }, [saveSelectedRouteDraft]);

  const regenerateSelectedVoyageGeometry = useCallback(async () => {
    if (!selectedVoyageId || !selectedVoyage) return;
    const isLand = selectedVoyage.type === "land";
    const isWaterAutoroute = selectedVoyage.type === "water" && selectedVoyage.waterway_autoroute;
    if (!isLand && !isWaterAutoroute) return;
    if (isRouteDraftDirty) {
      toast.error(
        isLand
          ? "Salva prima i waypoint della rotta, poi rigenera la geometria stradale."
          : "Salva prima i waypoint della rotta, poi rigenera la geometria sulle vie d'acqua."
      );
      return;
    }
    if (persistedSelectedWaypoints.length < 2) {
      toast.error(
        isLand
          ? "Servono almeno due waypoint salvati per generare la geometria stradale."
          : "Servono almeno due waypoint salvati per il routing sulle vie d'acqua."
      );
      return;
    }

    setIsRegeneratingGeometry(true);
    try {
      const geoOk = await syncVoyageGeometry(selectedVoyageId, persistedSelectedWaypoints);
      if (geoOk) {
        toast.success(isLand ? "Geometria stradale rigenerata e salvata" : "Geometria vie navigabili rigenerata e salvata");
      }
    } finally {
      setIsRegeneratingGeometry(false);
    }
  }, [isRouteDraftDirty, persistedSelectedWaypoints, selectedVoyage, selectedVoyageId, syncVoyageGeometry]);

  const guardedSelectVoyage = useCallback(async (voyageId: string) => {
    if (selectedVoyageRef.current && selectedVoyageRef.current !== voyageId && isRouteDraftDirty) {
      const shouldSave = window.confirm(
        "Hai modifiche locali non salvate alla rotta corrente. Premi OK per salvarle prima di cambiare rotta."
      );
      if (shouldSave) {
        const saved = await saveSelectedRouteDraft({ bypassTranslationPrompt: true });
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
      return saveSelectedRouteDraft({ bypassTranslationPrompt: true });
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
    <>
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
              <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.14em] text-muted-foreground">Testi viaggio</p>
              <div className="flex gap-1.5 rounded-[14px] border border-border p-1 bg-muted/30">
                {popupLanguageOptions.map(({ code, label }) => (
                  <button
                    key={`voyage-lang-${code}`}
                    type="button"
                    onClick={() => setVoyageFormLang(code)}
                    className={`flex-1 rounded-[10px] px-3 py-2 text-xs font-sans font-semibold transition-colors ${
                      voyageFormLang === code
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {voyageFormLang === "it" ? (
                <>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Nome</label>
                    <input
                      type="text"
                      value={voyageForm.name_it}
                      onChange={(event) => setVoyageForm((form) => ({ ...form, name_it: event.target.value }))}
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Descrizione</label>
                    <textarea
                      value={voyageForm.description_it}
                      onChange={(event) => setVoyageForm((form) => ({ ...form, description_it: event.target.value }))}
                      rows={3}
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Name</label>
                    <input
                      type="text"
                      value={voyageForm.name_en}
                      onChange={(event) => setVoyageForm((form) => ({ ...form, name_en: event.target.value }))}
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description</label>
                    <textarea
                      value={voyageForm.description_en}
                      onChange={(event) => setVoyageForm((form) => ({ ...form, description_en: event.target.value }))}
                      rows={3}
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Type</label>
                <select
                  value={voyageForm.type}
                  onChange={(event) => {
                    const nextType = event.target.value as Voyage["type"];
                    setVoyageForm((form) => ({
                      ...form,
                      type: nextType,
                      waterway_autoroute: nextType === "land" ? false : form.waterway_autoroute,
                    }));
                  }}
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
                  onChange={(event) =>
                    setVoyageForm((form) => {
                      const nextStatus = event.target.value as Voyage["status"];
                      return {
                        ...form,
                        status: nextStatus,
                        dates_tbd: nextStatus === "planned" ? form.dates_tbd : false,
                      };
                    })
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>

            {voyageForm.type === "water" && (
              <label className="flex items-start gap-3 rounded-[20px] border border-border px-4 py-3">
                <input
                  type="checkbox"
                  checked={voyageForm.waterway_autoroute}
                  onChange={(event) =>
                    setVoyageForm((form) => ({ ...form, waterway_autoroute: event.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
                    Mare · autoroute vie navigabili
                  </span>
                  <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
                    Routing su canali/fiumi (OpenStreetMap tramite BRouter, profilo river). I waypoint devono essere
                    vicini all&apos;asse navigabile; dove non c&apos;è grafo utile resta il segmento in linea retta. Sul
                    sito il voyage resta acqua come gli altri (nessuna etichetta diversa).
                  </span>
                </span>
              </label>
            )}

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
                    ? "Visible on public maps and route pages."
                    : "Hidden from public maps and route pages until published."}
                </span>
              </span>
            </label>

            <div className="rounded-[20px] border border-border px-4 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={voyageForm.booking_enabled}
                  onChange={(event) =>
                    setVoyageForm((form) => ({ ...form, booking_enabled: event.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
                    {voyageForm.booking_enabled ? "Booking aperto" : "Booking disattivato"}
                  </span>
                  <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
                    Consente agli utenti registrati di richiedere imbarco sulle tratte pubbliche del viaggio.
                  </span>
                </span>
              </label>
              {voyageForm.booking_enabled && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                      Persone max
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={voyageForm.booking_max_guests}
                      onChange={(event) =>
                        setVoyageForm((form) => ({ ...form, booking_max_guests: event.target.value }))
                      }
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">
                      Velocità kn
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={voyageForm.booking_planning_speed_kn}
                      onChange={(event) =>
                        setVoyageForm((form) => ({ ...form, booking_planning_speed_kn: event.target.value }))
                      }
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-[20px] border border-border px-4 py-3">
            <input
              type="checkbox"
              checked={voyageForm.dates_tbd}
              disabled={voyageForm.status !== "planned"}
              onChange={(event) =>
                setVoyageForm((form) => ({
                  ...form,
                  dates_tbd: event.target.checked,
                  ...(event.target.checked
                    ? {
                        start_date: "",
                        start_time: "",
                        start_date_flex_days: "0",
                        end_date: "",
                        end_time: "",
                        end_date_flex_days: "0",
                      }
                    : {}),
                }))
              }
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))] disabled:opacity-50"
            />
            <span className="min-w-0">
              <span className="block text-xs font-sans uppercase tracking-[0.2em] text-foreground">
                Date da definirsi
              </span>
              <span className="mt-1 block text-[11px] font-sans text-muted-foreground">
                {voyageForm.status === "planned"
                  ? "Usalo per viaggi desiderati ma non ancora calendarizzati. Salva il viaggio senza date fissate."
                  : "Disponibile solo per viaggi con stato Planned."}
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">Start</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.start_date}
                  disabled={voyageForm.dates_tbd}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      dates_tbd: false,
                      start_date: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                />
                <input
                  type="time"
                  value={voyageForm.start_time}
                  disabled={voyageForm.dates_tbd}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      dates_tbd: false,
                      start_time: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                />
              </div>
              {voyageForm.status === "planned" && !voyageForm.dates_tbd && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div className="text-[11px] font-sans text-muted-foreground flex items-center">
                    Finestra partenza
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">±</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={voyageForm.start_date_flex_days}
                      onChange={(event) =>
                        setVoyageForm((form) => ({
                          ...form,
                          start_date_flex_days: event.target.value,
                        }))
                      }
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground font-sans">
                {voyageForm.dates_tbd
                  ? "Date e orario verranno definiti più avanti."
                  : voyageForm.status === "planned"
                    ? "Per i viaggi planned puoi indicare anche una flessibilità di ± giorni."
                    : "Time is optional."}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground block">End</label>
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <input
                  type="date"
                  value={voyageForm.end_date}
                  disabled={voyageForm.dates_tbd}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      dates_tbd: false,
                      end_date: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                />
                <input
                  type="time"
                  value={voyageForm.end_time}
                  disabled={voyageForm.dates_tbd}
                  onChange={(event) =>
                    setVoyageForm((form) => ({
                      ...form,
                      dates_tbd: false,
                      end_time: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                />
              </div>
              {voyageForm.status === "planned" && !voyageForm.dates_tbd && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div className="text-[11px] font-sans text-muted-foreground flex items-center">
                    Finestra arrivo
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">±</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={voyageForm.end_date_flex_days}
                      onChange={(event) =>
                        setVoyageForm((form) => ({
                          ...form,
                          end_date_flex_days: event.target.value,
                        }))
                      }
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground font-sans">
                {voyageForm.dates_tbd
                  ? "Anche la finestra di arrivo resta aperta finché non viene pianificata."
                  : voyageForm.status === "planned"
                    ? "Usa ± giorni per rappresentare una finestra flessibile."
                    : "Leave blank if the arrival is still open."}
              </p>
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

      <div className="rounded-[16px] border border-border/70 bg-muted/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setRouteListFiltersExpanded((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans hover:bg-muted/30 transition-colors"
          aria-expanded={routeListFiltersExpanded}
        >
          {routeListFiltersExpanded ? (
            <ChevronDown className="shrink-0 text-muted-foreground" size={16} aria-hidden />
          ) : (
            <ChevronRight className="shrink-0 text-muted-foreground" size={16} aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">Filtri rotte</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {visibleVoyages.length}/{voyages.length} visibili
              {hasActiveFilters ? " · filtri attivi" : ""}
            </span>
          </div>
          {hasActiveFilters ? (
            <span
              role="presentation"
              className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider text-foreground"
            >
              Attivi
            </span>
          ) : null}
        </button>

        {routeListFiltersExpanded ? (
          <div className="border-t border-border/60 px-3 pb-2.5 pt-1 space-y-2">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
              <div className="min-w-[7.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Tipologia
                </label>
                <select
                  value={listFilters.type}
                  onChange={(event) =>
                    setListFilters((current) => ({ ...current, type: event.target.value as VoyageListFilters["type"] }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="all">Tutte</option>
                  <option value="water">Acqua</option>
                  <option value="land">Terra</option>
                </select>
              </div>

              <div className="min-w-[7.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Stato
                </label>
                <select
                  value={listFilters.publicationStatus}
                  onChange={(event) =>
                    setListFilters((current) => ({
                      ...current,
                      publicationStatus: event.target.value as VoyageListFilters["publicationStatus"],
                    }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="all">Tutte</option>
                  <option value="published">Pubblicate</option>
                  <option value="draft">Bozze</option>
                </select>
              </div>

              <div className="min-w-[9.5rem] flex-1">
                <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                  Data (filtro)
                </label>
                <select
                  value={listFilters.dateFilterMode}
                  onChange={(event) =>
                    setListFilters((current) => ({
                      ...current,
                      dateFilterMode: event.target.value as VoyageListFilters["dateFilterMode"],
                    }))
                  }
                  className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                >
                  <option value="created">Creazione</option>
                  <option value="departure">Partenza viaggio</option>
                </select>
              </div>

              <div className="flex min-w-0 flex-[2] flex-wrap items-end gap-x-1.5 gap-y-1">
                <div className="min-w-[6.5rem] flex-1">
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Da
                  </label>
                  <input
                    type="date"
                    value={listFilters.dateFrom}
                    onChange={(event) => setListFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                    className="w-full min-w-0 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="min-w-[6.5rem] flex-1">
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    A
                  </label>
                  <input
                    type="date"
                    value={listFilters.dateTo}
                    onChange={(event) => setListFilters((current) => ({ ...current, dateTo: event.target.value }))}
                    className="w-full min-w-0 bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRouteListFiltersAdvanced((v) => !v)}
                className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
              >
                {routeListFiltersAdvanced ? "Nascondi avanzate" : "Avanzate"}
              </button>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => setListFilters(emptyVoyageListFilters)}
                  className="text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset filtri
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setRouteListFiltersExpanded(false)}
                className="ml-auto text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
              >
                Chiudi
              </button>
            </div>

            {routeListFiltersAdvanced ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/40">
                <div>
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Ordina per
                  </label>
                  <select
                    value={listSort.field}
                    onChange={(event) =>
                      setListSort((current) => ({ ...current, field: event.target.value as VoyageListSort["field"] }))
                    }
                    className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="created_at">Data creazione</option>
                    <option value="start_date">Data partenza</option>
                    <option value="type">Tipologia</option>
                    <option value="publicationStatus">Stato</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-sans tracking-[0.14em] uppercase text-muted-foreground mb-0.5 block">
                    Direzione
                  </label>
                  <select
                    value={listSort.direction}
                    onChange={(event) =>
                      setListSort((current) => ({
                        ...current,
                        direction: event.target.value as VoyageListSort["direction"],
                      }))
                    }
                    className="w-full bg-transparent border border-border px-2 py-1.5 text-xs font-sans focus:outline-none focus:border-accent"
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-[20px] border border-border/70 bg-background/40 p-3 space-y-2">
        <p className="text-xs font-sans font-medium text-foreground">Elenco rotte</p>
        {visibleVoyages.length === 0 ? (
          <p className="text-xs text-muted-foreground font-sans py-1">Nessuna rotta con i filtri attuali.</p>
        ) : (
          <div className="space-y-1.5 max-h-[min(240px,40vh)] overflow-y-auto pr-1">
            {visibleVoyages.map((voyage) => {
              const displayName = getLocalizedVoyageName(voyage, lang);
              const isActive = selectedVoyageId === voyage.id;
              return (
                <div key={voyage.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => void selectVoyage(voyage.id)}
                    className={`flex-1 min-w-0 rounded-[14px] border px-3 py-2 text-left text-sm font-sans transition-colors ${
                      isActive
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border/70 bg-background/60 hover:border-accent/50 text-foreground"
                    }`}
                  >
                    <span className="block truncate">{displayName}</span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {voyage.type} · {voyage.status}
                      {!voyage.is_published ? " · bozza" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openVoyageForm(voyage)}
                    className="shrink-0 self-stretch inline-flex items-center justify-center rounded-[14px] border border-border/70 bg-background/80 px-2.5 text-muted-foreground hover:border-accent hover:text-foreground transition-colors"
                    title="Modifica nome, descrizione e dettagli viaggio (non i waypoint)"
                    aria-label="Modifica info viaggio"
                  >
                    <Edit size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border border-border overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-stretch min-h-[min(420px,70vh)]">
            <div className="relative flex-1 min-w-0 min-h-[280px] lg:min-h-[420px]" style={{ height: "420px" }}>
              <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[240px]" />
            </div>
            <aside
              data-waypoint-editor-panel
              className={`flex flex-col shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-background/72 backdrop-blur-2xl shadow-[0_30px_90px_rgba(15,23,42,0.12)] transition-[transform,opacity,width] duration-300 ease-out-expo overflow-hidden ${
                waypointEditorPanelId
                  ? "max-h-[min(72vh,620px)] lg:max-h-none lg:w-[340px] xl:w-[390px] opacity-100"
                  : "max-h-0 lg:max-h-none lg:w-0 lg:opacity-0 lg:pointer-events-none border-t-0 lg:border-l-0"
              }`}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60 shrink-0">
                <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Waypoint
                </p>
                <button
                  type="button"
                  onClick={() => setWaypointEditorPanelId(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  aria-label="Chiudi pannello waypoint"
                >
                  <X size={16} />
                </button>
              </div>
              <div ref={waypointPanelMountRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2" />
            </aside>
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

                  <div className="rounded-[18px] border border-border/60 bg-background/60 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-sans text-foreground">
                          {selectedVoyageHasCachedGeometry ? "Geometria stradale salvata" : "Geometria stradale mancante"}
                        </p>
                        {distance?.unit === "KM" ? (
                          <p className="mt-1 text-xs font-sans text-foreground/80">
                            {Math.round(distance.value).toLocaleString()} KM calcolati sul percorso stradale
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] font-sans text-muted-foreground">
                          {selectedVoyageHasCachedGeometry
                            ? "Rigenera se hai bisogno di riallineare il percorso stradale salvato ai waypoint correnti."
                            : "Genera e salva la polyline stradale persistita da riusare nel logbook senza ricalcoli."}
                        </p>
                        {isRouteDraftDirty ? (
                          <p className="mt-2 text-[11px] font-sans text-amber-700">
                            Salva prima la rotta per rigenerare una geometria coerente con i waypoint persistiti.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void regenerateSelectedVoyageGeometry()}
                        disabled={isRegeneratingGeometry || isSavingRouteDraft || isRouteDraftDirty || persistedSelectedWaypoints.length < 2}
                        className="inline-flex shrink-0 items-center justify-center gap-2 border border-border px-3 py-2 text-xs font-sans text-foreground hover:border-accent hover:text-accent disabled:opacity-50"
                      >
                        {isRegeneratingGeometry ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
                        {selectedVoyageHasCachedGeometry ? "Rigenera geometria" : "Genera geometria"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedVoyage?.type === "water" && selectedVoyage.waterway_autoroute && (
                <div className="rounded-[22px] border border-border/70 bg-muted/20 p-3 space-y-3">
                  <div className="rounded-[18px] border border-border/60 bg-background/60 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-sans text-foreground">
                          {selectedVoyageHasCachedGeometry ? "Geometria vie navigabili salvata" : "Geometria vie navigabili mancante"}
                        </p>
                        {distance?.unit === "NM" && selectedVoyage.waterway_autoroute ? (
                          <p className="mt-1 text-xs font-sans text-foreground/80">
                            {Math.round(distance.value).toLocaleString()} NM sulla polyline instradata (stima)
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] font-sans text-muted-foreground">
                          {selectedVoyageHasCachedGeometry
                            ? "Rigenera se hai spostato i waypoint o vuoi riallinearti al grafo OSM aggiornato."
                            : "Genera e salva la linea sui canali/fiumi per la mappa pubblica (stesso tipo voyage: acqua)."}
                        </p>
                        {isRouteDraftDirty ? (
                          <p className="mt-2 text-[11px] font-sans text-amber-700">
                            Salva prima la rotta per rigenerare una geometria coerente con i waypoint persistiti.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void regenerateSelectedVoyageGeometry()}
                        disabled={isRegeneratingGeometry || isSavingRouteDraft || isRouteDraftDirty || persistedSelectedWaypoints.length < 2}
                        className="inline-flex shrink-0 items-center justify-center gap-2 border border-border px-3 py-2 text-xs font-sans text-foreground hover:border-accent hover:text-accent disabled:opacity-50"
                      >
                        {isRegeneratingGeometry ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
                        {selectedVoyageHasCachedGeometry ? "Rigenera geometria" : "Genera geometria"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-sans font-medium">Waypoints ({selectedWaypoints.length})</h4>
                    <p className="text-xs text-muted-foreground font-sans">
                      {selectedWaypoints.length >= 2 && distance
                        ? `${Math.round(distance.value)} ${distance.unit} traced${voyageDates ? ` · ${voyageDates}` : ""}`
                        : voyageDates || (selectedVoyage?.type === "land"
                          ? "I waypoint fuori carreggiata vengono instradati verso il tratto stradale più vicino."
                          : selectedVoyage?.waterway_autoroute
                            ? "Per l’autoroute acqua, avvicina i waypoint al canale; altrimenti il segmento resta retto."
                            : "The first and last waypoints stay public by default. Intermediate ones are technical.")}
                    </p>
                    {isRouteDraftDirty && (
                      <p className="mt-1 text-[11px] font-sans text-amber-700">
                        Modifiche locali non ancora salvate.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isRouteDraftDirty && (
                      <button
                        type="button"
                        onClick={discardSelectedRouteChanges}
                        disabled={isSavingRouteDraft}
                        className="border border-border px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Discard
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveSelectedRouteDraft()}
                      disabled={!isRouteDraftDirty || isSavingRouteDraft}
                      className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-3 py-2 text-xs font-sans font-medium disabled:opacity-50 min-w-[8.5rem]"
                    >
                      {isSavingRouteDraft ? <Loader2 size={14} className="animate-spin shrink-0" /> : null}
                      {isSavingRouteDraft ? "Salvataggio…" : "Salva rotta"}
                    </button>
                  </div>
                </div>

                {routeSaveProgress ? (
                  <div
                    className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5 space-y-2"
                    role="status"
                    aria-live="polite"
                    aria-busy={isSavingRouteDraft}
                  >
                    <div className="flex items-start justify-between gap-2 text-[11px] font-sans text-muted-foreground">
                      <span className="min-w-0 leading-snug">{routeSaveProgress.label}</span>
                      <span className="shrink-0 tabular-nums font-medium text-foreground/80">
                        {routeSaveProgress.percent}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted border border-border/40">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                        style={{ width: `${routeSaveProgress.percent}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-sans text-muted-foreground tabular-nums">
                      Passo {routeSaveProgress.step} di {routeSaveProgress.totalSteps}
                      {routeSaveProgress.label.includes("geometria") || routeSaveProgress.label.includes("routing")
                        ? " · attendi, il calcolo rete può essere lento"
                        : ""}
                    </p>
                  </div>
                ) : null}
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
                  const eventLabel = selectedVoyageDatesTbd
                    ? selectedWaypointLegEstimates[waypoint.id]?.label
                      ? `Dal WPT prec.: ${selectedWaypointLegEstimates[waypoint.id]?.label}`
                      : null
                    : buildWaypointAdminDateLabel(
                        waypoint,
                        selectedWaypointDateSuggestions[waypoint.id],
                        effectiveType
                      );

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

      <AlertDialog
        open={routeTranslationOfferOpen}
        onOpenChange={(open) => {
          if (!open) handleRouteTranslationOfferClose();
        }}
      >
        <AlertDialogContent className="max-w-[560px] rounded-[28px] border-border bg-card shadow-lg">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="editorial-heading text-2xl leading-tight">Waypoint: traduzioni mancanti</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="font-sans text-sm leading-relaxed text-foreground/72 space-y-3">
                <p>
                  Prima di salvare la rotta, alcuni waypoint hanno nome o descrizione solo in una lingua. Vuoi comporre
                  automaticamente le parti mancanti (come dal pulsante nel popup del waypoint) oppure salvare comunque?
                </p>
                {routeTranslationGapLabels.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-foreground/80">
                    {routeTranslationGapLabels.map((line, idx) => (
                      <li key={`${idx}-${line}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-2 sm:items-stretch">
            <AlertDialogAction
              type="button"
              className="w-full rounded-full"
              disabled={isSavingRouteDraft || routeTranslationOfferBusy}
              onClick={(event) => {
                event.preventDefault();
                void handleRouteTranslationTranslateAndSave();
              }}
            >
              {routeTranslationOfferBusy ? "Traduzione in corso…" : "Traduci e salva rotta"}
            </AlertDialogAction>
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full"
              disabled={isSavingRouteDraft || routeTranslationOfferBusy}
              onClick={() => void handleRouteTranslationSkipAndSave()}
            >
              Salva senza tradurre
            </Button>
            <AlertDialogCancel type="button" className="mt-0 w-full rounded-full">
              Annulla
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AdminVoyageManager;
