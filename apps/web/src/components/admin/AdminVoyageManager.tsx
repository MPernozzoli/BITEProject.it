import { useState, useEffect, useRef, useCallback, useMemo, type SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_STOP_DEPARTURE_TIME,
  STOP_DEPARTURE_PRESETS,
  estimateStopMinutes,
  getEffectiveStopHoursDefault,
  getWaypointStopUiMode,
} from "@/lib/booking-utils";
import { useI18n } from "@/lib/i18n";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Plus,
  Ship,
  Mountain,
  LocateFixed,
  Clock3,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bindMapToTheme,
  createThemedCartoStyle } from "@/lib/maplibre";
import {
  totalWaypointDistance,
  totalCoordinateDistanceKm,
  reverseGeocodePlaceLocalized,
  buildWaypointDefaultName,
  buildWaypointDefaultLocalizedNames,
  isWaypointCoordinateLabel,
  buildVoyageGeometry,
  geocodePlaces,
  haversineNM,
  getLocalizedWaypointName,
  getWaypointEffectiveType,
  getWaypointSequenceHeading,
  getStraightVoyageGeometry,
  hasVoyageDatesTbd,
  normalizeWaypointMedia,
  slugifyVoyageName,
} from "@/lib/voyage-utils";
import type { GeocodedPlace, Voyage, VoyageWaypoint, VoyageWaypointMediaItem } from "@/lib/voyage-utils";
import WaypointEditorPanel from "@/components/admin/WaypointEditorPanel";
import VoyageListPanel from "@/components/admin/VoyageListPanel";
import VoyageAddressSearchPanel from "@/components/admin/VoyageAddressSearchPanel";
import VoyageFormPanel from "@/components/admin/VoyageFormPanel";
import WaypointListPanel from "@/components/admin/WaypointListPanel";
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
import { useBeforeUnloadPrompt } from "@/hooks/useBeforeUnloadPrompt";

export interface VoyageFormState {
  name_it: string;
  name_en: string;
  slug: string;
  slug_it: string;
  slug_en: string;
  description_it: string;
  description_en: string;
  type: "water" | "land";
  /** BRouter river profile; only applies when type is water; stored separately from voyage_type. */
  waterway_autoroute: boolean;
  /** Effective status, derived by the database. Read-only here; the form never writes it. */
  status: "planned" | "active" | "completed";
  /** Forces the status. Empty string means automatic, i.e. status_override = null. */
  status_override: "" | "planned" | "active" | "completed";
  is_published: boolean;
  booking_enabled: boolean;
  booking_max_guests: string;
  booking_planning_speed_kn: string;
  booking_contribution_per_nm_eur: string;
  dates_tbd: boolean;
  start_date: string;
  start_time: string;
  start_date_flex_days: string;
  end_date: string;
  end_time: string;
  end_date_flex_days: string;
}

export interface VoyageListFilters {
  type: "all" | Voyage["type"];
  publicationStatus: "all" | "published" | "draft";
  /** Quale campo usare per il filtro date (stesso intervallo Da / A). */
  dateFilterMode: "created" | "departure";
  dateFrom: string;
  dateTo: string;
}

export interface VoyageListSort {
  field: "created_at" | "start_date" | "type" | "publicationStatus";
  direction: "asc" | "desc";
}

interface PendingWaypointDelete {
  voyageId: string;
  waypointId: string;
  label: string;
}

const emptyVoyageForm: VoyageFormState = {
  name_it: "",
  name_en: "",
  slug: "",
  slug_it: "",
  slug_en: "",
  description_it: "",
  description_en: "",
  type: "water",
  waterway_autoroute: false,
  status: "planned",
  status_override: "",
  is_published: true,
  booking_enabled: false,
  booking_max_guests: "2",
  booking_planning_speed_kn: "5",
  booking_contribution_per_nm_eur: "0.90",
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

const getPlanningSpeedKn = (value?: number | string | null) => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
};

const getStopDepartureDate = (arrival: Date, waypoint: VoyageWaypoint) => {
  const parseStopDepartureTime = (value: string | null | undefined) => {
    const [hoursPart, minutesPart] = (value || DEFAULT_STOP_DEPARTURE_TIME).slice(0, 5).split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? { hours, minutes } : null;
  };

  if (waypoint.stop_mode === "hours" && waypoint.stop_departure_time) {
    const time = parseStopDepartureTime(waypoint.stop_departure_time);
    if (time) {
      const departure = new Date(arrival);
      departure.setHours(time.hours, time.minutes, 0, 0);
      if (departure.getTime() <= arrival.getTime()) {
        departure.setDate(departure.getDate() + 1);
      }
      return departure;
    }
  }

  if (waypoint.stop_mode === "nights") {
    const time = parseStopDepartureTime(waypoint.stop_departure_time);
    const nights = Math.max(0, Number(waypoint.stop_nights ?? 1));
    if (time) {
      const departure = new Date(arrival);
      departure.setDate(departure.getDate() + nights);
      departure.setHours(time.hours, time.minutes, 0, 0);
      if (departure.getTime() < arrival.getTime()) {
        departure.setDate(departure.getDate() + 1);
      }
      return departure;
    }
  }

  const minutes = estimateStopMinutes(waypoint);
  return new Date(arrival.getTime() + minutes * 60 * 1000);
};

const deriveWaypointLegEstimates = (waypoints: VoyageWaypoint[], speedKn: number) =>
  Object.fromEntries(
    waypoints.map((waypoint, index) => {
      if (index === 0) return [waypoint.id, null];
      const previousWaypoint = waypoints[index - 1];
      const hours = haversineNM(previousWaypoint.lat, previousWaypoint.lng, waypoint.lat, waypoint.lng) / getPlanningSpeedKn(speedKn);
      return [
        waypoint.id,
        {
          hours,
          label: formatEstimatedLegDuration(hours),
        } satisfies WaypointLegEstimate,
      ];
    })
  ) as Record<string, WaypointLegEstimate | null>;

/**
 * Arrivo stimato all'ultima tappa = partenza + Σ(tratte a velocità di pianificazione) + Σ(soste intermedie).
 * La sosta della prima tappa non conta (la partenza è già `start`) né quella dell'ultima (è l'arrivo stesso).
 *
 * Cammina solo sui waypoint pubblici, gli stessi che `sync_voyage_bookable_legs_plan` usa come
 * estremi delle tratte: il tracciato tecnico è la polyline che la barca segue, non il calendario.
 * Camminarlo tutto dava un arrivo diverso da quello del piano, ed è così che `end_date` è finita
 * fuori sincrono con l'ultima tappa (vedi 20260830011821_voyage_arrival_date_from_plan.sql).
 */
const computeEstimatedArrivalDateTime = (
  waypoints: VoyageWaypoint[],
  startDate: string,
  startTime: string,
  speedKn: number
): { date: string; time: string } | null => {
  if (!startDate) return null;
  const publicWaypoints = waypoints.filter(
    (waypoint, index) => getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative"
  );
  if (publicWaypoints.length < 2) return null;
  const start = parseDateTimeInput(startDate, startTime || null);
  if (!start) return null;
  const speed = Number.isFinite(speedKn) && speedKn > 0 ? speedKn : 5;
  let totalMinutes = 0;
  for (let index = 1; index < publicWaypoints.length; index += 1) {
    const previous = publicWaypoints[index - 1];
    const current = publicWaypoints[index];
    totalMinutes += (haversineNM(previous.lat, previous.lng, current.lat, current.lng) / speed) * 60;
    if (index < publicWaypoints.length - 1) {
      const arrival = new Date(start.getTime() + totalMinutes * 60 * 1000);
      const departure = getStopDepartureDate(arrival, current);
      totalMinutes += Math.max(0, (departure.getTime() - arrival.getTime()) / 60_000);
    }
  }
  const arrival = new Date(start.getTime() + totalMinutes * 60 * 1000);
  if (Number.isNaN(arrival.getTime())) return null;
  return { date: formatDateInputValue(arrival), time: formatTimeInputValue(arrival) };
};

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
  voyage: Pick<Voyage, "status" | "start_date" | "start_time" | "end_date" | "end_time" | "booking_planning_speed_kn"> | undefined,
  waypoints: VoyageWaypoint[]
) => {
  const suggestions = Object.fromEntries(
    waypoints.map((waypoint) => [waypoint.id, createEmptyWaypointDateSuggestion()])
  ) as Record<string, WaypointDateSuggestions>;

  if (!voyage || !waypoints.length || hasVoyageDatesTbd(voyage)) return suggestions;

  const voyageStart = parseDateTimeInput(voyage.start_date, voyage.start_time);
  const voyageEnd = parseDateTimeInput(voyage.end_date, voyage.end_time, { endOfDay: !voyage.end_time });
  const speed = getPlanningSpeedKn(voyage.booking_planning_speed_kn);
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
        const hours = haversineNM(anchor.waypoint.lat, anchor.waypoint.lng, waypoint.lat, waypoint.lng) / speed;
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
      const arrivalForStop = explicitArrival || suggestedArrival;
      const estimatedStopDeparture = arrivalForStop ? getStopDepartureDate(arrivalForStop, waypoint) : null;
      const nextAnchor = explicitDeparture || estimatedStopDeparture || arrivalForStop || suggestedDeparture;
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
  "stop_mode",
  "stop_hours",
  "stop_nights",
  "stop_departure_time",
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

const isDuplicateVoyageSlugError = (error: { code?: string; message?: string | null } | null) =>
  error?.code === "23505" && Boolean(error.message?.includes("voyages_slug"));

const isMissingWaypointMetadataColumnError = (
  error: { message?: string | null; details?: string | null; hint?: string | null } | null
) => {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return ["waypoint_type", "date_start", "date_end", "visibility_mode", "name_it", "name_en", "description_it", "description_en", "event_date", "event_time", "media", "planned_stop_duration_minutes", "stop_mode", "stop_hours", "stop_nights", "stop_departure_time"].some((column) => text.includes(column)) &&
    (text.includes("column") || text.includes("schema cache"));
};

const isMissingVoyageDateColumnError = (
  error: { message?: string | null; details?: string | null; hint?: string | null } | null
) => {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return ["start_date", "start_time", "start_date_flex_days", "end_date", "end_time", "end_date_flex_days", "name_it", "name_en", "description_it", "description_en", "is_published", "waterway_autoroute", "booking_enabled", "booking_max_guests", "booking_planning_speed_kn", "booking_contribution_per_nm_eur"].some((column) => text.includes(column)) &&
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
  stop_mode:
    waypoint?.stop_mode === "hours" || waypoint?.stop_mode === "nights" ? waypoint.stop_mode : "legacy",
  stop_hours: waypoint?.stop_hours == null ? null : Math.max(0, Number(waypoint.stop_hours)),
  stop_nights: waypoint?.stop_nights == null ? null : Math.max(0, Number(waypoint.stop_nights)),
  stop_departure_time: (waypoint?.stop_departure_time ?? null) as string | null,
  date_start: (waypoint?.date_start ?? null) as string | null,
  date_end: (waypoint?.date_end ?? null) as string | null,
  // I waypoint creati localmente (drag sulla mappa, bozze ripristinate da localStorage) non hanno
  // ancora un updated_at dal DB: per loro vale created_at, che WaypointRecord richiede sempre.
  updated_at: (waypoint?.updated_at ?? waypoint.created_at) as string,
});

const normalizeVoyage = (voyage: VoyageRecord): Voyage => ({
  ...voyage,
  name: (voyage?.name ?? voyage?.name_it ?? voyage?.name_en ?? "") as string,
  name_it: (voyage?.name_it ?? voyage?.name ?? "") as string,
  name_en: (voyage?.name_en ?? voyage?.name ?? "") as string,
  slug: (voyage?.slug ?? "") as string,
  slug_it: (voyage?.slug_it ?? null) as string | null,
  slug_en: (voyage?.slug_en ?? null) as string | null,
  description: (voyage?.description ?? voyage?.description_it ?? voyage?.description_en ?? "") as string,
  description_it: (voyage?.description_it ?? voyage?.description ?? "") as string,
  description_en: (voyage?.description_en ?? voyage?.description ?? "") as string,
  cached_geometry: (voyage?.cached_geometry ?? null) as Voyage["cached_geometry"],
  waterway_autoroute: Boolean(voyage?.waterway_autoroute),
  is_published: (voyage?.is_published ?? true) as boolean,
  booking_enabled: Boolean(voyage?.booking_enabled),
  booking_max_guests: Math.max(1, Number(voyage?.booking_max_guests ?? 4)),
  booking_planning_speed_kn: Math.max(0.1, Number(voyage?.booking_planning_speed_kn ?? 5)),
  booking_contribution_per_nm_eur: Math.max(0, Number(voyage?.booking_contribution_per_nm_eur ?? 0.9)),
  departure_window_start: (voyage?.departure_window_start ?? null) as string | null,
  departure_window_end: (voyage?.departure_window_end ?? null) as string | null,
  status_override: (voyage?.status_override ?? null) as Voyage["status_override"],
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
const getAdminDraftStorage = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage;
};
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
    planned_stop_duration_minutes: waypoint.planned_stop_duration_minutes,
    stop_mode: waypoint.stop_mode,
    stop_hours: waypoint.stop_hours,
    stop_nights: waypoint.stop_nights,
    stop_departure_time: waypoint.stop_departure_time,
    waypoint_type: waypoint.waypoint_type,
    visibility_mode: waypoint.visibility_mode,
    media: waypoint.media,
  }))
);

const loadStoredRouteDraft = () => {
  if (typeof window === "undefined") return null as null | { selectedVoyageId: string; waypoints: VoyageWaypoint[] };
  try {
    const storage = getAdminDraftStorage();
    let raw = storage?.getItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
    if (!raw) {
      raw = window.sessionStorage.getItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
      if (raw) {
        storage?.setItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY, raw);
        window.sessionStorage.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
      }
    }
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
    const storage = getAdminDraftStorage();
    let raw = storage?.getItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
    if (!raw) {
      raw = window.sessionStorage.getItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
      if (raw) {
        storage?.setItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY, raw);
        window.sessionStorage.removeItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { editingVoyageId?: string | null; voyageForm?: Partial<VoyageFormState> };
    if (!parsed.voyageForm) return null;
    const voyageForm: VoyageFormState = {
      ...emptyVoyageForm,
      ...parsed.voyageForm,
      dates_tbd:
        parsed.voyageForm.dates_tbd ??
        ((parsed.voyageForm.status_override || parsed.voyageForm.status || "planned") === "planned" &&
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
  const mapWorkspaceRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markersByWaypointRef = useRef<Record<string, maplibregl.Marker>>({});
  const setWaypointEditorPanelIdRef = useRef<(value: SetStateAction<string | null>) => void>(() => {});
  const focusWaypointOnMapRef = useRef<(waypointId: string) => boolean>(() => false);
  const voyagesRef = useRef<Voyage[]>([]);
  const waypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const persistedWaypointsRef = useRef<Record<string, VoyageWaypoint[]>>({});
  const storedRouteDraftRef = useRef(initialStoredRouteDraft);
  const storedVoyageFormDraftRef = useRef(initialStoredVoyageFormDraft);
  const selectedVoyageRef = useRef<string | null>(null);
  /** Mirrors `lang` for callbacks that must not change identity on language toggle (see effect below). */
  const langRef = useRef(lang);
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
  const [isSavingVoyage, setIsSavingVoyage] = useState(false);
  // Synchronous twin of isSavingVoyage: two clicks landing in the same tick would
  // both read a stale `false` from state and each insert a voyage.
  const savingVoyageRef = useRef(false);
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
  const [pendingWaypointDelete, setPendingWaypointDelete] = useState<PendingWaypointDelete | null>(null);
  const [isMapWorkspaceFullscreen, setIsMapWorkspaceFullscreen] = useState(false);
  const [isWaypointSidebarCollapsed, setIsWaypointSidebarCollapsed] = useState(false);
  const isWaypointSidebarCollapsedRef = useRef(false);
  const [autoOpenWaypointPanel, setAutoOpenWaypointPanel] = useState(true);

  const resizeMapAfterWorkspaceChange = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    window.requestAnimationFrame(() => {
      map.resize();
      window.setTimeout(() => map.resize(), 160);
      window.setTimeout(() => map.resize(), 360);
    });
  }, []);

  const toggleMapWorkspaceFullscreen = useCallback(async () => {
    const workspace = mapWorkspaceRef.current;
    const fullscreenElement = document.fullscreenElement;

    if (fullscreenElement === workspace) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.error("[AdminVoyageManager] exit fullscreen failed", error);
        setIsMapWorkspaceFullscreen(false);
        resizeMapAfterWorkspaceChange();
      }
      return;
    }

    if (workspace?.requestFullscreen) {
      try {
        await workspace.requestFullscreen();
        return;
      } catch (error) {
        console.error("[AdminVoyageManager] request fullscreen failed", error);
        toast.error("Fullscreen non disponibile in questo browser.");
      }
    }

    setIsMapWorkspaceFullscreen((value) => !value);
    resizeMapAfterWorkspaceChange();
  }, [resizeMapAfterWorkspaceChange]);

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
    langRef.current = lang;
  }, [lang]);

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

  /**
   * voyages.status is a derived cache, so after saving we ask the database for the
   * fresh value rather than guessing it client-side. Returns null when unavailable,
   * in which case the cron picks it up within the quarter hour.
   */
  const refreshVoyageStatus = useCallback(async (voyageId: string) => {
    try {
      const { data, error } = await supabase.rpc("refresh_voyage_status" as never, { _voyage_id: voyageId } as never);
      if (error) {
        console.warn("[AdminVoyageManager] refresh_voyage_status skipped", error);
        return null;
      }
      return (data ?? null) as Voyage["status"] | null;
    } catch (error) {
      console.warn("[AdminVoyageManager] refresh_voyage_status unavailable", error);
      return null;
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
      stop_mode: waypoint.stop_mode,
      stop_hours: waypoint.stop_mode === "hours" ? Math.max(0, Number(waypoint.stop_hours ?? 0)) : null,
      stop_nights: waypoint.stop_mode === "nights" ? Math.max(1, Number(waypoint.stop_nights ?? 1)) : null,
      stop_departure_time:
        waypoint.stop_mode === "hours" || waypoint.stop_mode === "nights" ? waypoint.stop_departure_time || null : null,
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
      const provisionalName = provisionalNames[langRef.current];
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

      setIsWaypointSidebarCollapsed(false);
      setWaypointEditorPanelId(createdWaypoint.id);
      window.setTimeout(() => {
        void focusWaypointOnMapRef.current(createdWaypoint.id);
      }, 0);

      const selectedVoyageForNaming = voyagesRef.current.find((voyage) => voyage.id === voyageId);
      const suggestedPlace = await reverseGeocodePlaceLocalized(lat, lng, {
        maritime: selectedVoyageForNaming?.type === "water",
      });
      if (!suggestedPlace.it && !suggestedPlace.en) return true;

      const currentWaypoint = (waypointsRef.current[voyageId] || []).find((item) => item.id === createdWaypoint.id);
      if (!currentWaypoint) return true;

      const currentNameIt = currentWaypoint.name_it?.trim() || null;
      const currentNameEn = currentWaypoint.name_en?.trim() || null;
      const hasCustomLocalizedName =
        (currentNameIt !== provisionalNames.it && !isWaypointCoordinateLabel(currentNameIt)) ||
        (currentNameEn !== provisionalNames.en && !isWaypointCoordinateLabel(currentNameEn));
      if (hasCustomLocalizedName) return true;

      const suggestedNames = buildWaypointDefaultLocalizedNames(boundedIndex, lat, lng, null, suggestedPlace);
      if (suggestedNames.it === provisionalNames.it && suggestedNames.en === provisionalNames.en) return true;

      await updateWaypoint(voyageId, createdWaypoint.id, {
        name: suggestedNames[langRef.current],
        name_it: suggestedNames.it,
        name_en: suggestedNames.en,
      });
      return true;
    },
    [commitWaypoints, primeGeometryOverrideAfterWaypointEdit, setWaypointEditorPanelId, updateWaypoint]
  );

  const deleteWaypoint = useCallback((voyageId: string, waypointId: string) => {
    const currentWaypoints = waypointsRef.current[voyageId] || [];
    const waypointIndex = currentWaypoints.findIndex((waypoint) => waypoint.id === waypointId);
    const waypoint = waypointIndex >= 0 ? currentWaypoints[waypointIndex] : null;
    setPendingWaypointDelete({
      voyageId,
      waypointId,
      label: waypoint
        ? getLocalizedWaypointName(waypoint, lang, waypointIndex)
        : "questo waypoint",
    });
  }, [lang]);

  const confirmWaypointDelete = useCallback(() => {
    const pending = pendingWaypointDelete;
    if (!pending) return;

    setPendingWaypointDelete(null);
    setWaypointEditorPanelId((current) => (current === pending.waypointId ? null : current));
    setEditingWaypointNameId((current) => (current === pending.waypointId ? null : current));
    setSavingWaypointNameId((current) => (current === pending.waypointId ? null : current));
    setDraggedWaypointId((current) => (current === pending.waypointId ? null : current));
    setDragOverWaypointId((current) => (current === pending.waypointId ? null : current));

    if (waypointRelocationRef.current?.waypointId === pending.waypointId) {
      cancelWaypointRelocation();
    }

    const nextWaypoints = commitWaypoints(
      pending.voyageId,
      (waypointsRef.current[pending.voyageId] || []).filter((waypoint) => waypoint.id !== pending.waypointId)
    );
    primeGeometryOverrideAfterWaypointEdit(pending.voyageId, nextWaypoints);
  }, [cancelWaypointRelocation, commitWaypoints, pendingWaypointDelete, primeGeometryOverrideAfterWaypointEdit]);

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

  // Read from the marker click handler, which must not depend on this state: doing so
  // would rebuild every marker on each collapse toggle.
  useEffect(() => {
    isWaypointSidebarCollapsedRef.current = isWaypointSidebarCollapsed;
  }, [isWaypointSidebarCollapsed]);

  useEffect(() => {
    setWaypointEditorPanelIdRef.current = setWaypointEditorPanelId;
    focusWaypointOnMapRef.current = focusWaypointOnMap;
  }, [focusWaypointOnMap]);

  const openWaypointPopup = useCallback((waypointId: string, options?: { automatic?: boolean }) => {
    if (options?.automatic && !autoOpenWaypointPanel) {
      queueMicrotask(() => void focusWaypointOnMap(waypointId));
      return;
    }
    setIsWaypointSidebarCollapsed(false);
    setWaypointEditorPanelId((prev) => {
      if (prev === waypointId) return null;
      queueMicrotask(() => void focusWaypointOnMap(waypointId));
      return waypointId;
    });
  }, [autoOpenWaypointPanel, focusWaypointOnMap]);

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
    const previousLocalizedName = getLocalizedWaypointName(waypoint, lang, index);
    const trimmedValue = editingWaypointNameValue.trim();
    const nextLocalizedName = trimmedValue || fallbackNames[lang];
    const nextNameIt = lang === "it" ? nextLocalizedName : (waypoint.name_it?.trim() || fallbackNames.it);
    const nextNameEn = lang === "en" ? nextLocalizedName : (waypoint.name_en?.trim() || fallbackNames.en);
    const legacyName = (lang === "it" ? nextNameIt : nextNameEn) || nextNameIt || nextNameEn || buildWaypointDefaultName(index, waypoint.lat, waypoint.lng);
    const shouldPromoteToNarrative =
      nextLocalizedName !== previousLocalizedName &&
      !(waypoint.visibility_mode === "manual" && waypoint.waypoint_type === "technical");

    setSavingWaypointNameId(waypoint.id);
    const success = await updateWaypoint(
      waypoint.voyage_id,
      waypoint.id,
      {
        name: legacyName,
        name_it: nextNameIt,
        name_en: nextNameEn,
        ...(shouldPromoteToNarrative
          ? {
              visibility_mode: "manual" as const,
              waypoint_type: "narrative" as const,
            }
          : {}),
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
  const selectedWaypoints = useMemo(
    () => (selectedVoyageId ? waypoints[selectedVoyageId] || [] : []),
    [selectedVoyageId, waypoints]
  );
  const selectedVoyageDatesTbd = Boolean(selectedVoyage && hasVoyageDatesTbd(selectedVoyage));
  const selectedWaypointDateSuggestions = useMemo(
    () => deriveWaypointDateSuggestions(selectedVoyage, selectedWaypoints),
    [selectedVoyage, selectedWaypoints]
  );
  const selectedWaypointLegEstimates = useMemo(
    () => deriveWaypointLegEstimates(selectedWaypoints, selectedVoyage?.booking_planning_speed_kn ?? 5),
    [selectedVoyage?.booking_planning_speed_kn, selectedWaypoints]
  );
  /** Pre-computed per-waypoint date/leg label, so WaypointListPanel doesn't need to import buildWaypointAdminDateLabel (module-private here) or the raw suggestion/estimate maps. */
  const selectedWaypointEventLabels = useMemo(
    () =>
      Object.fromEntries(
        selectedWaypoints.map((waypoint, index) => {
          const effectiveType = getWaypointEffectiveType(waypoint, index, selectedWaypoints.length);
          const label = selectedVoyageDatesTbd
            ? selectedWaypointLegEstimates[waypoint.id]?.label
              ? `Dal WPT prec.: ${selectedWaypointLegEstimates[waypoint.id]?.label}`
              : null
            : buildWaypointAdminDateLabel(
                waypoint,
                selectedWaypointDateSuggestions[waypoint.id],
                effectiveType
              );
          return [waypoint.id, label];
        })
      ) as Record<string, string | null>,
    [selectedWaypoints, selectedVoyageDatesTbd, selectedWaypointLegEstimates, selectedWaypointDateSuggestions]
  );

  // Resolves the waypoint currently open in the editor panel, with its index/total.
  const waypointEditorTarget = useMemo(() => {
    if (!waypointEditorPanelId) return null;
    const index = selectedWaypoints.findIndex((w) => w.id === waypointEditorPanelId);
    if (index < 0) return null;
    return { waypoint: selectedWaypoints[index], index, total: selectedWaypoints.length };
  }, [selectedWaypoints, waypointEditorPanelId]);

  // Waypoint del voyage attualmente in modifica nel form (indipendenti dalla selezione sulla mappa).
  const voyageFormWaypoints = useMemo(
    () => (editingVoyage ? sortWaypoints(waypoints[editingVoyage.id] || []) : []),
    [editingVoyage, waypoints]
  );
  const estimatedVoyageArrival = useMemo(
    () =>
      voyageForm.dates_tbd
        ? null
        : computeEstimatedArrivalDateTime(
            voyageFormWaypoints,
            voyageForm.start_date,
            voyageForm.start_time,
            Number(voyageForm.booking_planning_speed_kn)
          ),
    [
      voyageFormWaypoints,
      voyageForm.dates_tbd,
      voyageForm.start_date,
      voyageForm.start_time,
      voyageForm.booking_planning_speed_kn,
    ]
  );

  // Precompila la data di arrivo quando manca: l'arrivo è calcolato dai waypoint, ma resta editabile.
  useEffect(() => {
    if (!showVoyageForm || !estimatedVoyageArrival) return;
    setVoyageForm((form) =>
      form.dates_tbd || form.end_date
        ? form
        : { ...form, end_date: estimatedVoyageArrival.date, end_time: estimatedVoyageArrival.time }
    );
  }, [showVoyageForm, estimatedVoyageArrival]);

  useEffect(() => {
    setWaypointEditorPanelId(null);
  }, [selectedVoyageId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsMapWorkspaceFullscreen(document.fullscreenElement === mapWorkspaceRef.current);
      resizeMapAfterWorkspaceChange();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [resizeMapAfterWorkspaceChange]);

  // If the open waypoint disappears (deleted, or draft discarded), close the panel.
  useEffect(() => {
    if (!waypointEditorPanelId || !selectedVoyageId) return;
    const wps = waypoints[selectedVoyageId] || [];
    if (!wps.some((w) => w.id === waypointEditorPanelId)) {
      setWaypointEditorPanelId(null);
    }
  }, [waypointEditorPanelId, selectedVoyageId, waypoints]);

  useEffect(() => {
    if (!pendingWaypointDelete) return;
    const wps = waypoints[pendingWaypointDelete.voyageId] || [];
    if (!wps.some((w) => w.id === pendingWaypointDelete.waypointId)) {
      setPendingWaypointDelete(null);
    }
  }, [pendingWaypointDelete, waypoints]);

  useEffect(() => {
    if (!isMapWorkspaceFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        setIsMapWorkspaceFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMapWorkspaceFullscreen]);

  useEffect(() => {
    resizeMapAfterWorkspaceChange();
  }, [isMapWorkspaceFullscreen, isWaypointSidebarCollapsed, waypointEditorPanelId, resizeMapAfterWorkspaceChange]);

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
        queueMicrotask(() => void focusWaypointOnMapRef.current(waypoint.id));
        // Collapsing is an explicit "stop opening panels at me". Re-expanding here would
        // undo it on the very next marker click, so the collapse could never stick.
        if (!autoOpenWaypointPanel || isWaypointSidebarCollapsedRef.current) return;
        setWaypointEditorPanelIdRef.current((prev) => (prev === waypoint.id ? null : waypoint.id));
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
  }, [autoOpenWaypointPanel, createWaypointMarkerEl, ensureSegmentPreviewMarker, updateWaypoint]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: createThemedCartoStyle(),
      center: [15, 40],
      zoom: 5,
      attributionControl: false,
    });

    // La basemap segue il tema anche se cambia a mappa aperta.
    bindMapToTheme(mapRef.current);

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

    // drawRouteOnMap issues raw removeLayer/addSource/marker calls. When the browser
    // tears the map down mid-frame — e.g. a native confirm() dropping fullscreen during
    // a waypoint delete — those can throw; unguarded, the throw reaches the error
    // boundary and takes the whole panel down. Swallow it: the next state change redraws.
    const draw = () => {
      try {
        drawRouteOnMap(map);
      } catch (error) {
        console.error("[AdminVoyageManager] route redraw failed; retrying on next change", error);
      }
    };
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
        slug: voyage.slug || "",
        slug_it: voyage.slug_it || "",
        slug_en: voyage.slug_en || "",
        description_it: voyage.description_it || voyage.description || "",
        description_en: voyage.description_en || voyage.description || "",
        type: voyage.type,
        waterway_autoroute: voyage.type === "water" ? Boolean(voyage.waterway_autoroute) : false,
        status: voyage.status,
        status_override: voyage.status_override ?? "",
        is_published: voyage.is_published,
        booking_enabled: Boolean(voyage.booking_enabled),
        booking_max_guests: String(Math.max(1, Number(voyage.booking_max_guests ?? 4))),
        booking_planning_speed_kn: String(Math.max(0.1, Number(voyage.booking_planning_speed_kn ?? 5))),
        booking_contribution_per_nm_eur: String(Math.max(0, Number(voyage.booking_contribution_per_nm_eur ?? 0.9))),
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

  const performSaveVoyage = useCallback(async () => {
    const nameIt = voyageForm.name_it.trim();
    const nameEn = voyageForm.name_en.trim();
    const descriptionIt = voyageForm.description_it.trim();
    const descriptionEn = voyageForm.description_en.trim();
    const effectiveStatus = voyageForm.status_override || voyageForm.status;
    const datesTbd = effectiveStatus === "planned" && voyageForm.dates_tbd;
    const startFlexDays = datesTbd || effectiveStatus !== "planned" ? 0 : parseNonNegativeInteger(voyageForm.start_date_flex_days);
    const endFlexDays = datesTbd || effectiveStatus !== "planned" ? 0 : parseNonNegativeInteger(voyageForm.end_date_flex_days);
    const bookingMaxGuests = Math.max(1, parseNonNegativeInteger(voyageForm.booking_max_guests) || 2);
    const bookingPlanningSpeedKn = Math.max(0.1, Number.parseFloat(voyageForm.booking_planning_speed_kn) || 5);
    const parsedContributionPerNm = Number.parseFloat(voyageForm.booking_contribution_per_nm_eur);
    const bookingContributionPerNmEur = Number.isFinite(parsedContributionPerNm)
      ? Math.max(0, parsedContributionPerNm)
      : 0.9;
    const legacyName = nameEn || nameIt || "Untitled voyage";
    const legacyDescription = descriptionEn || descriptionIt || null;
    const slug = voyageForm.slug.trim() || slugifyVoyageName(legacyName);
    const slugIt = voyageForm.slug_it.trim() || null;
    const slugEn = voyageForm.slug_en.trim() || null;
    const data: TablesInsert<"voyages"> = {
      name: legacyName,
      name_it: nameIt || null,
      name_en: nameEn || null,
      slug,
      slug_it: slugIt,
      slug_en: slugEn,
      description: legacyDescription,
      description_it: descriptionIt || null,
      description_en: descriptionEn || null,
      type: voyageForm.type,
      // status is a derived cache the database maintains; only the override is ours to set.
      status_override: voyageForm.status_override || null,
      is_published: voyageForm.is_published,
      booking_enabled: voyageForm.booking_enabled,
      booking_max_guests: bookingMaxGuests,
      booking_planning_speed_kn: bookingPlanningSpeedKn,
      booking_contribution_per_nm_eur: bookingContributionPerNmEur,
      start_date: datesTbd ? null : voyageForm.start_date || null,
      start_time: datesTbd ? null : voyageForm.start_time || null,
      start_date_flex_days: datesTbd ? 0 : startFlexDays,
      end_date: datesTbd ? null : voyageForm.end_date || null,
      end_time: datesTbd ? null : voyageForm.end_time || null,
      end_date_flex_days: datesTbd ? 0 : endFlexDays,
      sort_order: editingVoyage ? editingVoyage.sort_order : voyagesRef.current.length,
      waterway_autoroute: voyageForm.type === "water" ? voyageForm.waterway_autoroute : false,
    };
    // Fallback for a database predating the date columns, where status was still
    // written by hand and status_override did not exist.
    const legacyData: Pick<TablesInsert<"voyages">, "name" | "slug" | "description" | "type" | "status" | "sort_order"> = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      type: data.type,
      status: voyageForm.status_override || voyageForm.status,
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
        toast.error(
          isDuplicateVoyageSlugError(error)
            ? "Slug già in uso da un altro viaggio: scegline uno diverso."
            : getErrorMessage(error, "Unable to update voyage")
        );
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
      const refreshedStatus = await refreshVoyageStatus(editingVoyage.id);
      if (refreshedStatus) {
        commitVoyages(
          voyagesRef.current.map((voyage) =>
            voyage.id === editingVoyage.id ? { ...voyage, status: refreshedStatus } : voyage
          )
        );
      }
      toast.success("Voyage updated");
    } else {
      let { data: newVoyage, error } = await supabase.from("voyages").insert(data).select().single();
      if ((error || !newVoyage) && isMissingVoyageDateColumnError(error)) {
        ({ data: newVoyage, error } = await supabase.from("voyages").insert(legacyData).select().single());
      }
      if (error || !newVoyage) {
        toast.error(
          isDuplicateVoyageSlugError(error)
            ? "Slug già in uso da un altro viaggio: scegline uno diverso."
            : getErrorMessage(error, "Unable to create voyage")
        );
        return false;
      }

      const normalizedVoyage = normalizeVoyage(newVoyage);
      const refreshedStatus = await refreshVoyageStatus(normalizedVoyage.id);
      commitVoyages([
        ...voyagesRef.current,
        refreshedStatus ? { ...normalizedVoyage, status: refreshedStatus } : normalizedVoyage,
      ]);
      setCurrentSelectedVoyageId(normalizedVoyage.id);
      toast.success("Voyage created");
    }

    initialVoyageFormSnapshotRef.current = serializeVoyageForm(voyageForm);
    setShowVoyageForm(false);
    return true;
  }, [clearVoyageWaypointDates, commitVoyages, editingVoyage, refreshVoyageStatus, setCurrentSelectedVoyageId, syncBookableLegs, syncVoyageGeometry, voyageForm]);

  // The create branch inserts unconditionally, so every concurrent call is a new
  // voyage row. Callers include both the Save button and the leave guard.
  const saveVoyage = useCallback(async () => {
    if (savingVoyageRef.current) return false;
    savingVoyageRef.current = true;
    setIsSavingVoyage(true);
    try {
      return await performSaveVoyage();
    } finally {
      savingVoyageRef.current = false;
      setIsSavingVoyage(false);
    }
  }, [performSaveVoyage]);

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
      getAdminDraftStorage()?.setItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      storedRouteDraftRef.current = {
        selectedVoyageId,
        waypoints: selectedWaypoints,
      };
      return;
    }

    getAdminDraftStorage()?.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
    storedRouteDraftRef.current = null;
  }, [isRouteDraftDirty, selectedVoyageId, selectedWaypoints]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (showVoyageForm) {
      const payload = {
        editingVoyageId: editingVoyage?.id ?? null,
        voyageForm,
      };
      getAdminDraftStorage()?.setItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      storedVoyageFormDraftRef.current = payload;
      return;
    }

    getAdminDraftStorage()?.removeItem(ADMIN_ROUTE_FORM_DRAFT_STORAGE_KEY);
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
    storedRouteDraftRef.current = null;
    getAdminDraftStorage()?.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
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
        getAdminDraftStorage()?.removeItem(ADMIN_ROUTE_DRAFT_STORAGE_KEY);
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
    if (!isVoyageFormDirty) return true;

    if (isVoyageFormDirty) {
      const shouldSaveVoyage = window.confirm(
        "Hai modifiche non salvate nella scheda della rotta. Premi OK per salvarle prima di uscire, oppure Annulla per restare qui."
      );
      if (!shouldSaveVoyage) return false;
      const savedVoyage = await saveVoyage();
      if (!savedVoyage) return false;
    }

    return true;
  }, [isVoyageFormDirty, saveVoyage]);

  useEffect(() => {
    onRegisterLeaveGuard?.(handleSaveBeforeLeave);
    return () => onRegisterLeaveGuard?.(null);
  }, [handleSaveBeforeLeave, onRegisterLeaveGuard]);

  useBeforeUnloadPrompt(isVoyageFormDirty);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isVoyageFormDirty) return;
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
  }, [handleSaveBeforeLeave, isVoyageFormDirty, location.hash, location.pathname, location.search, navigate]);

  const waypointListPanelProps = {
    selectedWaypoints,
    lang,
    eventLabels: selectedWaypointEventLabels,
    draggedWaypointId,
    setDraggedWaypointId,
    dragOverWaypointId,
    setDragOverWaypointId,
    editingWaypointNameId,
    editingWaypointNameValue,
    setEditingWaypointNameValue,
    savingWaypointNameId,
    onReorder: (voyageId: string, fromIndex: number, toIndex: number) => void reorderWaypoint(voyageId, fromIndex, toIndex),
    onToggleVisibility: (waypoint: VoyageWaypoint, index: number, total: number) =>
      void toggleWaypointVisibility(waypoint, index, total),
    onBeginNameEdit: beginWaypointNameEdit,
    onCancelNameEdit: cancelWaypointNameEdit,
    onSubmitNameEdit: (waypoint: VoyageWaypoint, index: number) => void submitWaypointNameEdit(waypoint, index),
    onOpenPopup: (waypointId: string) => openWaypointPopup(waypointId),
    onDelete: (voyageId: string, waypointId: string) => void deleteWaypoint(voyageId, waypointId),
    onMove: (waypoint: VoyageWaypoint, direction: "up" | "down") => moveWaypoint(waypoint, direction),
    onFocusOnMap: focusWaypointOnMap,
  };

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
        <VoyageFormPanel
          voyageForm={voyageForm}
          setVoyageForm={setVoyageForm}
          voyageFormLang={voyageFormLang}
          setVoyageFormLang={setVoyageFormLang}
          editingVoyage={editingVoyage}
          estimatedVoyageArrival={estimatedVoyageArrival}
          closeVoyageForm={closeVoyageForm}
          saveVoyage={() => void saveVoyage()}
          isSavingVoyage={isSavingVoyage}
        />
      )}

      <VoyageListPanel
        voyages={voyages}
        visibleVoyages={visibleVoyages}
        hasActiveFilters={hasActiveFilters}
        listFilters={listFilters}
        setListFilters={setListFilters}
        listSort={listSort}
        setListSort={setListSort}
        routeListFiltersExpanded={routeListFiltersExpanded}
        setRouteListFiltersExpanded={setRouteListFiltersExpanded}
        routeListFiltersAdvanced={routeListFiltersAdvanced}
        setRouteListFiltersAdvanced={setRouteListFiltersAdvanced}
        selectedVoyageId={selectedVoyageId}
        lang={lang}
        onSelectVoyage={(voyageId) => void selectVoyage(voyageId)}
        onEditVoyage={openVoyageForm}
        onResetFilters={() => setListFilters(emptyVoyageListFilters)}
      />

      <div
        ref={mapWorkspaceRef}
        className={`relative border border-border overflow-hidden bg-background ${
          isMapWorkspaceFullscreen
            ? "fixed inset-0 z-50 flex flex-col border-0"
            : ""
        }`}
      >
          {pendingWaypointDelete ? (
            <div className="absolute left-3 right-3 top-16 z-20 flex justify-center pointer-events-none">
              <div
                className="pointer-events-auto w-full max-w-md rounded-[18px] border border-destructive/25 bg-background/96 px-4 py-3 shadow-2xl backdrop-blur-xl"
                role="alertdialog"
                aria-modal="false"
                aria-labelledby="delete-waypoint-title"
                aria-describedby="delete-waypoint-description"
              >
                <p id="delete-waypoint-title" className="text-sm font-sans font-semibold text-foreground">
                  Eliminare waypoint?
                </p>
                <p id="delete-waypoint-description" className="mt-1 text-xs font-sans text-muted-foreground">
                  {pendingWaypointDelete.label} verrà rimosso dalla bozza della rotta. Salva la rotta per applicare la modifica al database.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingWaypointDelete(null)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-sans text-muted-foreground hover:text-foreground"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={confirmWaypointDelete}
                    className="rounded-full bg-destructive px-3 py-1.5 text-xs font-sans font-medium text-destructive-foreground hover:bg-destructive/90"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div
            className={`flex flex-col lg:flex-row lg:items-stretch ${
              isMapWorkspaceFullscreen
                ? "min-h-0 flex-1"
                : "min-h-[min(420px,70vh)]"
            }`}
          >
            <div
              className={`relative flex-1 min-w-0 min-h-[280px] ${
                isMapWorkspaceFullscreen ? "lg:min-h-0" : "lg:min-h-[420px]"
              }`}
              style={{ height: isMapWorkspaceFullscreen ? "auto" : "420px" }}
            >
              <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[240px]" />
              <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
                <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => void toggleMapWorkspaceFullscreen()}
                    className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-sans text-foreground hover:bg-muted transition-colors"
                    title={isMapWorkspaceFullscreen ? "Esci da mappa fullscreen" : "Apri mappa fullscreen"}
                  >
                    {isMapWorkspaceFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    <span>{isMapWorkspaceFullscreen ? "Esci" : "Fullscreen"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsWaypointSidebarCollapsed((value) => !value)}
                    className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-sans text-foreground hover:bg-muted transition-colors"
                    title={isWaypointSidebarCollapsed ? "Mostra sidebar waypoint" : "Collassa sidebar waypoint"}
                  >
                    {isWaypointSidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
                    <span>{isWaypointSidebarCollapsed ? "Dettagli" : "Collassa"}</span>
                  </button>
                </div>
                <label className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 text-xs font-sans text-foreground shadow-sm backdrop-blur-xl">
                  <input
                    type="checkbox"
                    checked={autoOpenWaypointPanel}
                    onChange={(event) => setAutoOpenWaypointPanel(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
                  />
                  <span>Auto dettagli</span>
                </label>
              </div>
            </div>
            <aside
              data-waypoint-editor-panel
              className={`flex flex-col shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-background/86 backdrop-blur-2xl shadow-[0_30px_90px_rgba(15,23,42,0.12)] transition-[max-height,width,opacity] duration-300 overflow-hidden ${
                selectedVoyageId && !isWaypointSidebarCollapsed
                  ? isMapWorkspaceFullscreen
                    ? "max-h-[45vh] lg:max-h-none lg:w-[390px] xl:w-[430px] opacity-100"
                    : "max-h-[min(72vh,620px)] lg:max-h-none lg:w-[340px] xl:w-[390px] opacity-100"
                  : "max-h-0 lg:max-h-none lg:w-0 lg:opacity-0 lg:pointer-events-none border-t-0 lg:border-l-0"
              }`}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60 shrink-0">
                <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Waypoint
                </p>
                <button
                  type="button"
                  onClick={() => setIsWaypointSidebarCollapsed(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  aria-label="Collassa pannello waypoint"
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2">
                {waypointEditorTarget ? (() => {
                  const { waypoint, index, total } = waypointEditorTarget;
                  const suggestion =
                    selectedWaypointDateSuggestions[waypoint.id] || createEmptyWaypointDateSuggestion();
                  const legEstimate = selectedWaypointLegEstimates[waypoint.id];
                  const placeholder = (date: string | null, time: string | null) =>
                    date ? `${date}T${time || "00:00"}` : "";
                  return (
                    <WaypointEditorPanel
                      key={waypoint.id}
                      waypoint={waypoint}
                      index={index}
                      total={total}
                      lang={lang}
                      voyageType={selectedVoyage?.type === "land" ? "land" : "water"}
                      datesTbd={selectedVoyageDatesTbd}
                      arrivalNote={getWaypointDateSuggestionNote(
                        suggestion.arrivalDate,
                        suggestion.arrivalTime,
                        suggestion.arrivalSource
                      )}
                      departureNote={getWaypointDateSuggestionNote(
                        suggestion.departureDate,
                        suggestion.departureTime,
                        suggestion.departureSource
                      )}
                      arrivalPlaceholder={placeholder(suggestion.arrivalDate, suggestion.arrivalTime)}
                      departurePlaceholder={placeholder(suggestion.departureDate, suggestion.departureTime)}
                      legEstimateLabel={
                        legEstimate
                          ? `Tempo stimato dal WPT precedente: ${legEstimate.label} a ${getPlanningSpeedKn(selectedVoyage?.booking_planning_speed_kn)} kn.`
                          : null
                      }
                      onUpdate={(changes, options) =>
                        updateWaypoint(waypoint.voyage_id, waypoint.id, changes, options)
                      }
                      onDelete={() => deleteWaypoint(waypoint.voyage_id, waypoint.id)}
                      onRelocate={() => startWaypointRelocation(waypoint.voyage_id, waypoint.id)}
                      onUploadMedia={async (files) =>
                        (await Promise.all(files.map((file) => uploadWaypointMediaAsset(waypoint.id, file)))).filter(
                          Boolean
                        ) as VoyageWaypointMediaItem[]
                      }
                      onDeleteMedia={(item) => deleteWaypointMediaAsset(item)}
                    />
                  );
                })() : (
                  <div className="grid gap-3 p-0.5 font-sans">
                    <div className="rounded-[18px] border border-border/60 bg-muted/20 px-3 py-3">
                      <p className="text-sm font-sans font-medium text-foreground">Seleziona un WPT</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Clicca un marker sulla mappa o una riga della lista per aprire l'inspector del waypoint.
                      </p>
                    </div>
                    <WaypointListPanel
                      {...waypointListPanelProps}
                      maxHeightClass={isMapWorkspaceFullscreen ? "max-h-[calc(45vh-132px)] lg:max-h-[calc(100vh-132px)]" : "max-h-[360px]"}
                    />
                  </div>
                )}
              </div>
            </aside>
          </div>

          {!isMapWorkspaceFullscreen && !selectedVoyageId && (
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              Seleziona un voyage dalla lista. Da quel momento, ogni click sulla mappa crea subito un waypoint: start e arrivo restano pubblici di default, gli intermedi diventano tecnici.
            </p>
          )}

          {!isMapWorkspaceFullscreen && selectedVoyageId && (
            <div className="p-4 border-t border-border space-y-4">
              {selectedVoyage?.type === "land" && (
                <div className="rounded-[22px] border border-border/70 bg-muted/20 p-3 space-y-3">
                  <VoyageAddressSearchPanel
                    landSearchQuery={landSearchQuery}
                    setLandSearchQuery={setLandSearchQuery}
                    landSearchResults={landSearchResults}
                    landSearchLoading={landSearchLoading}
                    onSearch={() => void runLandSearch()}
                    onFocusResult={focusSearchResult}
                    onAddResult={(result) => void addSearchResultWaypoint(result)}
                  />

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
                          <p className="mt-2 text-[11px] font-sans text-amber-700 dark:text-amber-300">
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
                          <p className="mt-2 text-[11px] font-sans text-amber-700 dark:text-amber-300">
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
                      <p className="mt-1 text-[11px] font-sans text-amber-700 dark:text-amber-300">
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

              <WaypointListPanel {...waypointListPanelProps} maxHeightClass="max-h-[260px]" />
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
