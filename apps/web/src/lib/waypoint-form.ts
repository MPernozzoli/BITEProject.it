import { buildWaypointDefaultName, type VoyageWaypoint } from "@/lib/voyage-utils";
import {
  DEFAULT_STOP_DEPARTURE_TIME,
  getEffectiveStopHoursDefault,
  getWaypointStopUiMode,
} from "@/lib/booking-utils";
import type { Language } from "@/lib/language";

export type VisibilityChoice = "auto" | "technical" | "narrative";
export type StopUiMode = "none" | "hours" | "nights";

export type WaypointFormState = {
  nameIt: string;
  nameEn: string;
  descriptionIt: string;
  descriptionEn: string;
  visibility: VisibilityChoice;
  arrivalLocal: string;
  departureLocal: string;
  stopMode: StopUiMode;
  stopHours: string;
  stopNights: string;
  stopDeparture: string;
  eventDate: string;
  eventTime: string;
};

export interface WaypointFormContext {
  defaultNames: { it: string; en: string };
  currentNameIt: string | null;
  currentNameEn: string | null;
  datesTbd: boolean;
  lang: Language;
  index: number;
  lat: number;
  lng: number;
}

// Self-contained twins of the parent's datetime-local helpers. date_start/date_end are
// stored as timestamps, for which new Date(...) round-trips faithfully.
export const toDateTimeLocalValue = (value?: string | null): string => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
};

export const serializeDateTimeLocalValue = (value: string): string | null => {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart) return null;
  return timePart ? `${datePart}T${timePart}` : datePart;
};

export const parseNonNegativeInteger = (value: string): number => {
  if (!value.trim()) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

export const buildWaypointFormState = (waypoint: VoyageWaypoint): WaypointFormState => ({
  nameIt: waypoint.name_it ?? "",
  nameEn: waypoint.name_en ?? "",
  descriptionIt: waypoint.description_it ?? "",
  descriptionEn: waypoint.description_en ?? "",
  visibility: waypoint.visibility_mode === "manual" ? waypoint.waypoint_type : "auto",
  arrivalLocal: toDateTimeLocalValue(waypoint.date_end),
  departureLocal: toDateTimeLocalValue(waypoint.date_start),
  stopMode: getWaypointStopUiMode(waypoint),
  stopHours: String(getEffectiveStopHoursDefault(waypoint)),
  stopNights: String(Math.max(1, Number(waypoint.stop_nights ?? 1))),
  stopDeparture: (waypoint.stop_departure_time ?? DEFAULT_STOP_DEPARTURE_TIME).slice(0, 5),
  eventDate: waypoint.event_date ?? "",
  eventTime: waypoint.event_time ? waypoint.event_time.slice(0, 5) : "",
});

// Faithful, pure port of the original submit transform (the old
// createWaypointPopupContent submit handler in AdminVoyageManager). Exported so it can
// be unit-tested: the auto-promote-to-narrative rule is the subtle part worth locking down.
export function computeWaypointFormChanges(
  state: WaypointFormState,
  ctx: WaypointFormContext
): Partial<VoyageWaypoint> {
  const nameIt = state.nameIt.trim() || ctx.defaultNames.it;
  const nameEn = state.nameEn.trim() || ctx.defaultNames.en;
  const hasCustomName =
    nameIt !== (ctx.currentNameIt || ctx.defaultNames.it) || nameEn !== (ctx.currentNameEn || ctx.defaultNames.en);
  const stopHours = parseNonNegativeInteger(state.stopHours);
  const stopNights = Math.max(1, parseNonNegativeInteger(state.stopNights));
  const hasPlannedStop =
    state.stopMode === "hours" ? stopHours > 0 : state.stopMode === "nights" ? stopNights > 0 : false;
  const shouldAutoPromoteToNarrative = state.visibility === "auto" && (hasCustomName || hasPlannedStop);
  const visibility_mode = state.visibility === "auto" && !shouldAutoPromoteToNarrative ? "auto" : "manual";
  const waypoint_type: "narrative" | "technical" =
    state.visibility === "narrative" || shouldAutoPromoteToNarrative ? "narrative" : "technical";
  const legacyName =
    (ctx.lang === "it" ? nameIt : nameEn) ||
    nameIt ||
    nameEn ||
    buildWaypointDefaultName(ctx.index, ctx.lat, ctx.lng);

  const changes: Partial<VoyageWaypoint> = {
    name: legacyName,
    name_it: nameIt,
    name_en: nameEn,
    description_it: state.descriptionIt.trim() || null,
    description_en: state.descriptionEn.trim() || null,
    visibility_mode,
    waypoint_type,
  };

  const applyNoStop = () => {
    changes.stop_mode = "hours";
    changes.stop_hours = 0;
    changes.stop_nights = null;
    changes.stop_departure_time = null;
    changes.planned_stop_duration_minutes = 0;
  };

  if (waypoint_type === "narrative") {
    changes.date_end = ctx.datesTbd ? null : serializeDateTimeLocalValue(state.arrivalLocal);
    changes.date_start = ctx.datesTbd ? null : serializeDateTimeLocalValue(state.departureLocal);
    changes.event_date = null;
    changes.event_time = null;

    if (state.stopMode === "hours") {
      changes.stop_mode = "hours";
      changes.stop_hours = stopHours;
      changes.stop_nights = null;
      changes.stop_departure_time = null;
      changes.planned_stop_duration_minutes = stopHours * 60;
    } else if (state.stopMode === "nights") {
      const time = (state.stopDeparture || DEFAULT_STOP_DEPARTURE_TIME).slice(0, 5);
      changes.stop_mode = "nights";
      changes.stop_nights = stopNights;
      changes.stop_departure_time = time;
      changes.stop_hours = null;
      changes.planned_stop_duration_minutes = 0;
    } else {
      applyNoStop();
    }
  } else {
    applyNoStop();
    changes.event_date = ctx.datesTbd ? null : state.eventDate || null;
    changes.event_time = ctx.datesTbd ? null : state.eventTime || null;
    changes.date_start = null;
    changes.date_end = null;
  }

  return changes;
}
