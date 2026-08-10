import type { Language } from "./language.js";
import { getDangerReasonLabels } from "./danger-reasons.js";

export type VoyageBookingStatus =
  /** Application submitted but the contribution has not been paid: invisible to admin review. */
  | "pending_payment"
  | "requested"
  | "waitlisted"
  | "admin_approved"
  | "user_confirmed"
  | "cancelled"
  | "rejected"
  | "expired";

export interface BookingVoyage {
  id: string;
  name: string;
  name_it: string | null;
  name_en: string | null;
  type?: "water" | "land";
  status: "planned" | "active" | "completed";
  booking_enabled?: boolean;
  booking_max_guests?: number;
  booking_planning_speed_kn?: number;
  booking_contribution_per_nm_eur?: number;
  departure_window_start?: string | null;
  departure_window_end?: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface BookingWaypoint {
  id: string;
  voyage_id: string;
  name: string | null;
  name_it: string | null;
  name_en: string | null;
  sort_order: number;
  lat?: number | null;
  lng?: number | null;
  waypoint_type?: "technical" | "narrative";
  visibility_mode?: "auto" | "manual";
  planned_stop_duration_minutes?: number;
  stop_mode?: StopMode | null;
  stop_hours?: number | null;
  stop_nights?: number | null;
  stop_departure_time?: string | null;
  date_start: string | null;
  date_end: string | null;
}

export type StopMode = "legacy" | "hours" | "nights";

/** Suggested short-stop durations (hours) and day counts offered in the editor. */
export const STOP_HOURS_PRESETS = [8, 12] as const;
export const STOP_NIGHTS_PRESETS = [1, 2, 3] as const;
/** Suggested departure times of day; the editor also allows a free custom value. */
export const STOP_DEPARTURE_PRESETS = ["07:30", "19:00"] as const;
/** Default departure time for a "nights" stop: the morning after arrival. */
export const DEFAULT_STOP_DEPARTURE_TIME = "07:30";
/** Default departure time for a stop preceding an offshore leg (typically sailed overnight). */
export const OPEN_SEA_STOP_DEPARTURE_TIME = "19:00";

/** Suggested default departure time for a new stop, based on whether the outbound leg is offshore. */
export function getDefaultStopDepartureTime(outboundLegIsOpenSea: boolean) {
  return outboundLegIsOpenSea ? OPEN_SEA_STOP_DEPARTURE_TIME : DEFAULT_STOP_DEPARTURE_TIME;
}

export interface BookableLeg {
  id: string;
  voyage_id: string;
  from_waypoint_id: string;
  to_waypoint_id: string;
  sort_order: number;
  starts_at_window_start: string | null;
  starts_at_window_end: string | null;
  ends_at_window_start: string | null;
  ends_at_window_end: string | null;
  is_bookable: boolean;
  /** Planned straight-line distance for contribution calculation, in nautical miles. */
  planned_nautical_miles?: number | null;
  /** Manual external-hazard rating, 0 (minimo) … 3 (consistente). */
  danger_level?: number | null;
  /** Specific hazards behind the danger rating (see {@link DangerReasonKey}), e.g. "piracy". */
  danger_reasons?: string[] | null;
  /** Manual flag: offshore navigation (>12 nm from coast); feeds auto complexity and contribution modifiers. */
  open_sea?: boolean | null;
  /** Manual complexity override, 1 … 5; null means use the auto value. */
  complexity_override?: number | null;
}

export interface BookingRequest {
  id: string;
  voyage_id: string;
  profile_id: string;
  party_size: number;
  status: VoyageBookingStatus;
  message: string | null;
  candidate_info?: Record<string, unknown> | null;
  admin_notes: string | null;
  requested_at: string;
  expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
  plan_change_status?: "none" | "pending_user_approval" | "pending_admin_approval" | "auto_accepted";
  plan_change_metadata?: Record<string, unknown> | null;
  plan_change_requested_at?: string | null;
  plan_change_resolved_at?: string | null;
  /** True for the two fixed crew members auto-booked when a voyage's booking goes live. */
  is_crew?: boolean;
  /** Admin-granted "omaggio": the booking is exempt from the contribution payment gate. */
  is_comped?: boolean;
  payment_mode?: "lead_pays_all" | "each_pays_own";
  contribution_proposal_status?: "none" | "pending_admin_review" | "pending_user_approval" | "accepted" | "rejected";
  contribution_proposal_metadata?: Record<string, unknown> | null;
  /** True while a contribution/workaway proposal is unresolved: only the €20 fixed minimum is collected up front. */
  contribution_fixed_only_payment?: boolean;
  /** The variable contribution actually agreed after negotiation (0 for a pure workaway trade). */
  contribution_resolved_variable_cents?: number | null;
}

export interface BookingRequestLeg {
  booking_request_id: string;
  bookable_leg_id: string;
}

/** Row returned by the `list_voyage_booking_occupancy` RPC for the public booking matrix. */
export interface VoyageBookingOccupancyRow {
  booking_request_id: string;
  leg_ids: string[];
  party_size: number;
  status: VoyageBookingStatus;
  is_own: boolean;
  is_crew: boolean;
  /** Only populated for requests overlapping the caller's own CONFIRMED legs, once both sides are confirmed. */
  display_name: string | null;
}

export interface BookableLegAvailability extends BookableLeg {
  occupied: number;
  capacity: number;
  remaining: number;
  available: boolean;
}

export interface BookingProfile {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface BookingSettings {
  voyage_id: string;
  confirmation_deadline_hours: number;
  predeparture_info_it: string | null;
  predeparture_info_en: string | null;
  briefing_content_it: string | null;
  briefing_content_en: string | null;
  first_briefing_content_it?: string | null;
  first_briefing_content_en?: string | null;
  second_briefing_content_it?: string | null;
  second_briefing_content_en?: string | null;
  terms_content_it: string | null;
  terms_content_en: string | null;
  contribution_proposal_enabled: boolean;
  contribution_proposal_min_percent: number;
  contribution_proposal_max_percent: number;
  workaway_enabled: boolean;
  workaway_role_keys: string[];
}

export interface WorkawayRole {
  id: string;
  key: string;
  label_it: string;
  label_en: string;
  active: boolean;
  sort_order: number;
}

export interface BookingTask {
  id: string;
  voyage_id: string;
  title_it: string;
  title_en: string | null;
  description_it: string | null;
  description_en: string | null;
  required: boolean;
  sort_order: number;
}

export interface BookingTaskCompletion {
  booking_request_id: string;
  task_id: string;
  completed_at: string;
}

const statusClassMap: Record<VoyageBookingStatus, string> = {
  pending_payment: "border-orange-300/70 bg-orange-100/75 text-orange-800",
  requested: "border-amber-300/70 bg-amber-100/70 text-amber-800",
  waitlisted: "border-sky-300/70 bg-sky-100/75 text-sky-800",
  admin_approved: "border-yellow-300/70 bg-yellow-100/75 text-yellow-800",
  user_confirmed: "border-emerald-300/75 bg-emerald-100/80 text-emerald-800",
  cancelled: "border-red-300/70 bg-red-100/75 text-red-800",
  rejected: "border-red-300/70 bg-red-100/75 text-red-800",
  expired: "border-stone-300/70 bg-stone-100/80 text-stone-700",
};

export const capacityBlockingStatuses = new Set<VoyageBookingStatus>([
  "admin_approved",
  "user_confirmed",
]);

export function getBookingStatusLabel(status: VoyageBookingStatus, lang: Language | "it" | "en" = "it") {
  const italian = lang === "it";
  const labels: Record<VoyageBookingStatus, string> = {
    pending_payment: italian ? "Pagamento da completare" : "Payment pending",
    requested: italian ? "Richiesta inviata" : "Requested",
    waitlisted: italian ? "Waiting list" : "Waitlisted",
    admin_approved: italian ? "Da confermare" : "Ready to confirm",
    user_confirmed: italian ? "Confermato" : "Confirmed",
    cancelled: italian ? "Annullato" : "Cancelled",
    rejected: italian ? "Rifiutato" : "Rejected",
    expired: italian ? "Scaduto" : "Expired",
  };
  return labels[status];
}

export function getBookingStatusClass(status: VoyageBookingStatus) {
  return statusClassMap[status];
}

export function getBookingStatusShortLabel(status: VoyageBookingStatus) {
  const labels: Record<VoyageBookingStatus, string> = {
    pending_payment: "PAY",
    requested: "REQ",
    waitlisted: "WAIT",
    admin_approved: "OK?",
    user_confirmed: "CONF",
    cancelled: "CANC",
    rejected: "NO",
    expired: "EXP",
  };
  return labels[status];
}

export function getLocalizedBookingVoyageName(voyage: BookingVoyage | null | undefined, lang: Language | "it" | "en") {
  if (!voyage) return "";
  return lang === "it"
    ? voyage.name_it || voyage.name_en || voyage.name
    : voyage.name_en || voyage.name_it || voyage.name;
}

export function getLocalizedBookingWaypointName(
  waypoint: BookingWaypoint | null | undefined,
  lang: Language | "it" | "en"
) {
  if (!waypoint) return "";
  return lang === "it"
    ? waypoint.name_it || waypoint.name_en || waypoint.name || "Tappa"
    : waypoint.name_en || waypoint.name_it || waypoint.name || "Stop";
}

export function formatBookingDate(value?: string | null, locale = "it-IT") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getBookingLocale(lang: Language | "it" | "en" = "it") {
  return lang === "it" ? "it-IT" : "en-GB";
}

/**
 * Formats a planning window (an earliest→latest pair sharing the same time-of-day)
 * as a compact range, e.g. "10–13 set h 20:10". Because the departure flexibility
 * only shifts the date, `start` and `end` normally carry the same time; when they
 * don't (or one is missing) it degrades gracefully to a full range or single value.
 */
export function formatBookingWindow(
  startValue?: string | null,
  endValue?: string | null,
  locale = "it-IT"
) {
  const start = startValue ? new Date(startValue) : null;
  const end = endValue ? new Date(endValue) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;

  if (!validStart && !validEnd) return null;
  if (!validStart) return formatBookingWindowSingle(validEnd!, locale);
  if (!validEnd) return formatBookingWindowSingle(validStart, locale);

  const sameDay =
    validStart.getFullYear() === validEnd.getFullYear() &&
    validStart.getMonth() === validEnd.getMonth() &&
    validStart.getDate() === validEnd.getDate();
  if (sameDay || validStart.getTime() === validEnd.getTime()) {
    return formatBookingWindowSingle(validStart, locale);
  }

  const dayFmt = new Intl.DateTimeFormat(locale, { day: "2-digit" });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
  const time = formatBookingWindowTime(validStart, locale);
  const sameTime =
    validStart.getHours() === validEnd.getHours() && validStart.getMinutes() === validEnd.getMinutes();

  // Identical time-of-day → collapse to a single "day–day month h HH:MM".
  if (sameTime) {
    const sameMonth =
      validStart.getFullYear() === validEnd.getFullYear() && validStart.getMonth() === validEnd.getMonth();
    if (sameMonth) {
      return `${dayFmt.format(validStart)}–${dayFmt.format(validEnd)} ${monthFmt.format(validStart)} h ${time}`;
    }
    return `${dayFmt.format(validStart)} ${monthFmt.format(validStart)}–${dayFmt.format(validEnd)} ${monthFmt.format(validEnd)} h ${time}`;
  }

  // Different times → show both endpoints in full.
  return `${formatBookingWindowSingle(validStart, locale)} – ${formatBookingWindowSingle(validEnd, locale)}`;
}

function formatBookingWindowTime(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBookingWindowSingle(date: Date, locale: string) {
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(date);
  return `${dayMonth} h ${formatBookingWindowTime(date, locale)}`;
}

export function getLegEffectiveDate(leg: BookableLeg) {
  return leg.starts_at_window_end || leg.starts_at_window_start || leg.ends_at_window_end || leg.ends_at_window_start || null;
}

function isDateCurrentOrFuture(value?: string | null) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const today = new Date();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const valueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return valueDay >= currentDay;
}

export function isLegCurrentOrFuture(leg: BookableLeg) {
  return isDateCurrentOrFuture(getLegEffectiveDate(leg));
}

export function isLegSelectable(leg: BookableLeg) {
  return leg.is_bookable && isLegCurrentOrFuture(leg);
}

export function isVoyageBookableNow(
  voyage: Pick<
    BookingVoyage,
    "booking_enabled" | "start_date" | "end_date" | "departure_window_start" | "departure_window_end"
  > | null | undefined
) {
  if (!voyage?.booking_enabled) return false;
  const effectiveEnd = voyage.end_date || voyage.departure_window_end || voyage.start_date || voyage.departure_window_start;
  return isDateCurrentOrFuture(effectiveEnd);
}

export function getLegAvailability(
  leg: BookableLeg,
  occupied: number,
  capacity: number,
  partySize = 1
): BookableLegAvailability {
  const safeCapacity = Math.max(1, Number(capacity) || 1);
  const safeOccupied = Math.max(0, Number(occupied) || 0);
  const remaining = Math.max(0, safeCapacity - safeOccupied);
  return {
    ...leg,
    occupied: safeOccupied,
    capacity: safeCapacity,
    remaining,
    available: isLegSelectable(leg) && remaining >= Math.max(1, partySize),
  };
}

export function buildLegCapacityMap(requests: BookingRequest[], requestLegs: BookingRequestLeg[]) {
  const map: Record<string, number> = {};
  for (const request of requests) {
    if (!capacityBlockingStatuses.has(request.status)) continue;
    for (const link of requestLegs) {
      if (link.booking_request_id === request.id) {
        map[link.bookable_leg_id] = (map[link.bookable_leg_id] || 0) + request.party_size;
      }
    }
  }
  return map;
}

export function getLegRangeBetweenWaypoints<T extends Pick<BookableLeg, "from_waypoint_id" | "to_waypoint_id">>(
  waypointIds: string[],
  legs: T[],
  fromWaypointId: string,
  toWaypointId: string
): T[] {
  const fromIndex = waypointIds.indexOf(fromWaypointId);
  const toIndex = waypointIds.indexOf(toWaypointId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];

  const startIndex = Math.min(fromIndex, toIndex);
  const endIndex = Math.max(fromIndex, toIndex);
  const legsByPair = new Map(legs.map((leg) => [`${leg.from_waypoint_id}:${leg.to_waypoint_id}`, leg]));
  const selected: T[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const from = waypointIds[index];
    const to = waypointIds[index + 1];
    const leg = legsByPair.get(`${from}:${to}`);
    if (leg) selected.push(leg);
  }

  return selected;
}

export function getLegLabel(
  leg: BookableLeg,
  waypointsById: Record<string, BookingWaypoint>,
  lang: Language | "it" | "en"
) {
  const from = getLocalizedBookingWaypointName(waypointsById[leg.from_waypoint_id], lang);
  const to = getLocalizedBookingWaypointName(waypointsById[leg.to_waypoint_id], lang);
  return `${from} → ${to}`;
}

export function formatLegScheduleSummary(
  leg: Pick<BookableLeg, "starts_at_window_start" | "starts_at_window_end" | "ends_at_window_start" | "ends_at_window_end">,
  lang: Language | "it" | "en" = "it"
): string | null {
  const locale = getBookingLocale(lang);
  const departure = formatBookingWindow(leg.starts_at_window_start, leg.starts_at_window_end, locale);
  const arrival = formatBookingWindow(leg.ends_at_window_start, leg.ends_at_window_end, locale);
  if (!departure && !arrival) return null;

  const labels = lang === "it"
    ? { departure: "Partenza", arrival: "Arrivo" }
    : { departure: "Departure", arrival: "Arrival" };
  return [
    departure ? `${labels.departure} ${departure}` : "",
    arrival ? `${labels.arrival} ${arrival}` : "",
  ].filter(Boolean).join(" · ");
}

// --- Leg complexity & danger -----------------------------------------------------------

export const COMPLEXITY_LEVELS = [1, 2, 3, 4, 5] as const;
export const COMPLEXITY_MAX = 5;
export const DANGER_LEVELS = [0, 1, 2, 3] as const;
export const DANGER_MAX = 3;
/** Danger level at/above which a leg is forced to maximum complexity. */
export const DANGER_COMPLEXITY_THRESHOLD = 2;

const complexityClassMap: Record<number, string> = {
  1: "border-emerald-300/70 bg-emerald-100/70 text-emerald-800",
  2: "border-lime-300/70 bg-lime-100/70 text-lime-800",
  3: "border-amber-300/70 bg-amber-100/70 text-amber-800",
  4: "border-orange-300/70 bg-orange-100/70 text-orange-800",
  5: "border-red-300/70 bg-red-100/75 text-red-800",
};

const dangerClassMap: Record<number, string> = {
  0: "border-stone-300/70 bg-stone-100/70 text-stone-700",
  1: "border-sky-300/70 bg-sky-100/70 text-sky-800",
  2: "border-orange-300/70 bg-orange-100/70 text-orange-800",
  3: "border-red-300/70 bg-red-100/75 text-red-800",
};

function clampLevel(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getComplexityLabel(level: number, lang: Language | "it" | "en" = "it") {
  const idx = clampLevel(level, 1, 5) - 1;
  const it = ["Semplice", "Facile", "Media", "Impegnativa", "Molto difficile"];
  const en = ["Simple", "Easy", "Moderate", "Challenging", "Very hard"];
  return (lang === "it" ? it : en)[idx];
}

export function getComplexityClass(level: number) {
  return complexityClassMap[clampLevel(level, 1, 5)];
}

export function getDangerLabel(level: number, lang: Language | "it" | "en" = "it") {
  const idx = clampLevel(level, 0, 3);
  const it = ["Minimo", "Basso", "Elevato", "Consistente"];
  const en = ["Minimal", "Low", "High", "Serious"];
  return (lang === "it" ? it : en)[idx];
}

export function getDangerClass(level: number) {
  return dangerClassMap[clampLevel(level, 0, 3)];
}

/** Short heading used above the complexity disclaimer. */
export function getComplexityTitle(lang: Language | "it" | "en" = "it") {
  return lang === "it" ? "Complessità della tratta" : "Leg complexity";
}

/**
 * Disclaimer shown wherever the complexity estimate appears: it is only an estimate and
 * the real difficulty at sea depends on factors that cannot be predicted in advance.
 */
export function getComplexityDisclaimer(lang: Language | "it" | "en" = "it") {
  return lang === "it"
    ? "Stima orientativa calcolata da durata, navigazione notturna e altri fattori. La complessità reale durante la navigazione dipende da condizioni non prevedibili in anticipo — meteo e stato del mare, traffico marittimo e altro — e può variare sensibilmente nella realtà. Va intesa come indicazione generica e approssimativa."
    : "A rough estimate based on duration, night navigation and other factors. The real complexity while sailing depends on conditions that cannot be predicted in advance — weather and sea state, traffic and more — and may vary significantly in reality. Treat it as a generic, approximate indication.";
}

function joinReasonsList(items: string[], lang: Language | "it" | "en" = "it") {
  if (items.length === 1) return items[0];
  const and = lang === "it" ? "e" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/**
 * Human-readable reasons behind the auto-computed complexity, most impactful first —
 * mirrors the factors weighed by {@link computeAutoLegComplexity}. Empty when the level was
 * manually overridden, since the auto factors may no longer explain it.
 */
export function getComplexityReasons(
  leg: Pick<
    BookableLeg,
    "complexity_override" | "danger_level" | "danger_reasons" | "open_sea" | "starts_at_window_start" | "ends_at_window_start"
  >,
  lang: Language | "it" | "en" = "it"
): string[] {
  if (!isLegComplexityAuto(leg as BookableLeg)) return [];
  const it = lang === "it";
  const reasons: string[] = [];
  const duration = getLegDurationHours(leg);
  const danger = getLegDangerLevel(leg);

  if (danger >= DANGER_COMPLEXITY_THRESHOLD) {
    reasons.push(
      it ? "livello di pericolo segnalato come elevato per questa tratta" : "a danger level flagged as high for this leg"
    );
  }
  if (leg.open_sea) {
    reasons.push(it ? "include navigazione d'altura, lontano dalla costa" : "includes offshore navigation, far from the coast");
  }
  if (duration != null && duration > 40) {
    reasons.push(
      it
        ? `una traversata molto lunga (circa ${Math.round(duration)} ore)`
        : `a very long crossing (about ${Math.round(duration)} hours)`
    );
  } else if (duration != null && duration > 20) {
    reasons.push(
      it ? `una traversata lunga (circa ${Math.round(duration)} ore)` : `a long crossing (about ${Math.round(duration)} hours)`
    );
  }
  if (legHasNightNavigation(leg)) {
    reasons.push(it ? "include navigazione notturna" : "includes night navigation");
  }
  return reasons;
}

/**
 * Full tooltip explanation for a leg's complexity: a sentence naming the specific factors
 * behind it (offshore navigation, duration, night navigation, danger level) when available, falling
 * back to a generic line, followed by the short "this is only an estimate" disclaimer.
 */
export function getComplexityExplanation(
  leg: Pick<
    BookableLeg,
    | "complexity_override"
    | "danger_level"
    | "danger_reasons"
    | "open_sea"
    | "starts_at_window_start"
    | "ends_at_window_start"
  >,
  lang: Language | "it" | "en" = "it"
): string {
  const it = lang === "it";
  const shortDisclaimer = it
    ? "È una stima orientativa: la complessità reale in mare dipende da condizioni non prevedibili in anticipo (meteo, stato del mare, traffico marittimo) e può variare."
    : "It's a rough estimate: real complexity at sea depends on conditions that can't be predicted in advance (weather, sea state, traffic) and may vary.";

  // Specific hazard tags (orcas, piracy, …) are always spelled out when present, regardless
  // of whether the numeric danger level was high enough to also bump the complexity score.
  const dangerLabels = getDangerReasonLabels(leg.danger_reasons, lang);
  const dangerSentence =
    dangerLabels.length > 0
      ? it
        ? `Pericolo segnalato per: ${joinReasonsList(dangerLabels, lang)}.`
        : `Flagged danger: ${joinReasonsList(dangerLabels, lang)}.`
      : "";

  if (!isLegComplexityAuto(leg as BookableLeg)) {
    const manualLine = it ? "Livello impostato manualmente dall'organizzatore." : "Level set manually by the organizer.";
    return [manualLine, dangerSentence, shortDisclaimer].filter(Boolean).join(" ");
  }

  const reasons = getComplexityReasons(leg, lang);
  const introLine =
    reasons.length === 0
      ? it
        ? "Tratta breve e senza fattori di rischio particolari."
        : "A short leg with no particular risk factors."
      : it
        ? `Complessità più alta perché ${joinReasonsList(reasons, lang)}.`
        : `Higher complexity because ${joinReasonsList(reasons, lang)}.`;

  return [introLine, dangerSentence, shortDisclaimer].filter(Boolean).join(" ");
}

export function getLegDangerLevel(leg: Pick<BookableLeg, "danger_level">) {
  return clampLevel(Number(leg.danger_level ?? 0), 0, 3);
}

/** Duration of the leg in hours, using the "early" scenario window consistently. */
export function getLegDurationHours(
  leg: Pick<BookableLeg, "starts_at_window_start" | "ends_at_window_start">
): number | null {
  const dep = leg.starts_at_window_start;
  const arr = leg.ends_at_window_start;
  if (!dep || !arr) return null;
  const depMs = new Date(dep).getTime();
  const arrMs = new Date(arr).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(arrMs)) return null;
  return Math.max(0, (arrMs - depMs) / 3_600_000);
}

/**
 * Estimated leg duration in whole/half days for the matrix header, e.g. "1 gg" or "2,5 gg" —
 * never finer-grained values like "2,7 gg". Returns null when the duration is unknown.
 */
export function formatLegDurationDays(
  hours: number | null | undefined,
  lang: Language | "it" | "en" = "it"
): string | null {
  if (hours == null || Number.isNaN(hours) || hours <= 0) return null;
  const days = Math.round((hours / 24) * 2) / 2;
  if (days <= 0) return null;
  const numberLabel = Number.isInteger(days)
    ? `${days}`
    : days.toFixed(1).replace(".", lang === "it" ? "," : ".");
  return lang === "it" ? `${numberLabel} gg` : `${numberLabel} d`;
}

/** Fractional local (Europe/Rome) hour of an instant, e.g. 19.5 for 19:30. */
function romeHourFraction(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return (hour % 24) + minute / 60;
}

/**
 * Whether the passage sails during the night band (23:00–06:00 Europe/Rome) at any point.
 * A leg is night-free only if it fits entirely inside the 06:00–23:00 daytime window.
 */
export function legHasNightNavigation(
  leg: Pick<BookableLeg, "starts_at_window_start" | "ends_at_window_start">
): boolean {
  const duration = getLegDurationHours(leg);
  if (duration == null) return false;
  if (duration >= 24) return true;
  const depHour = leg.starts_at_window_start ? romeHourFraction(leg.starts_at_window_start) : null;
  if (depHour == null) return false;
  const nightFree = depHour >= 6 && depHour + duration <= 23;
  return !nightFree;
}

/**
 * Auto complexity (1–5) from duration, night navigation, offshore navigation and danger. Danger at or
 * above {@link DANGER_COMPLEXITY_THRESHOLD} pins the leg to the maximum.
 */
/** Leg fields consulted when deriving complexity, danger and duration. */
type ComplexityLeg = Pick<
  BookableLeg,
  "complexity_override" | "danger_level" | "open_sea" | "starts_at_window_start" | "ends_at_window_start"
>;

export function computeAutoLegComplexity(leg: ComplexityLeg): number {
  let level = 1;
  const duration = getLegDurationHours(leg);
  if (legHasNightNavigation(leg)) level = Math.max(level, 2);
  if (duration != null && duration > 20) level = Math.max(level, 3);
  if (duration != null && duration > 40) level = Math.max(level, 4);
  if (leg.open_sea) level += 1;
  if (getLegDangerLevel(leg) >= DANGER_COMPLEXITY_THRESHOLD) level = 5;
  return clampLevel(level, 1, 5);
}

/** Effective complexity: the manual override when set, otherwise the auto value. */
export function getLegComplexity(leg: ComplexityLeg): number {
  const override = leg.complexity_override;
  if (override != null && override >= 1 && override <= 5) return clampLevel(Number(override), 1, 5);
  return computeAutoLegComplexity(leg);
}

/** Is the leg currently showing an auto (non-overridden) complexity? */
export function isLegComplexityAuto(leg: Pick<BookableLeg, "complexity_override">): boolean {
  const override = leg.complexity_override;
  return !(override != null && override >= 1 && override <= 5);
}

// --- Stop configuration ----------------------------------------------------------------

export function getWaypointStopMode(waypoint: Pick<BookingWaypoint, "stop_mode">): StopMode {
  const mode = waypoint.stop_mode;
  return mode === "hours" || mode === "nights" ? mode : "legacy";
}

/**
 * Tri-state UI mode for the stop editor: "hours" with stop_hours=0 (or an untouched
 * legacy waypoint with no minutes) reads as "no stop", not as an hours stop of zero length.
 */
export function getWaypointStopUiMode(
  waypoint: Pick<BookingWaypoint, "stop_mode" | "stop_hours" | "planned_stop_duration_minutes">
): "none" | "hours" | "nights" {
  if (waypoint.stop_mode === "nights") return "nights";
  if (waypoint.stop_mode === "hours") {
    return Math.max(0, Number(waypoint.stop_hours ?? 0)) > 0 ? "hours" : "none";
  }
  return Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0)) > 0 ? "hours" : "none";
}

/** Sensible "hours" value to pre-fill when switching a waypoint into hours-stop mode. */
export function getEffectiveStopHoursDefault(
  waypoint: Pick<BookingWaypoint, "stop_mode" | "stop_hours" | "planned_stop_duration_minutes">
): number {
  if (waypoint.stop_mode === "hours") {
    return Math.max(0, Number(waypoint.stop_hours ?? 0)) || 12;
  }
  const legacyMinutes = Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0));
  return legacyMinutes > 0 ? Math.max(1, Math.round(legacyMinutes / 60)) : 12;
}

/** Rough total stop duration in minutes, for display/estimation purposes only. */
export function estimateStopMinutes(
  waypoint: Pick<BookingWaypoint, "stop_mode" | "stop_hours" | "stop_nights" | "planned_stop_duration_minutes">
): number {
  if (waypoint.stop_mode === "nights") {
    return Math.max(0, Number(waypoint.stop_nights ?? 1)) * 24 * 60;
  }
  if (waypoint.stop_mode === "hours") {
    return Math.max(0, Number(waypoint.stop_hours ?? 0)) * 60;
  }
  return Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0));
}

/** Human-readable summary of a waypoint's stop, or null when there is no stop. */
export function formatStopSummary(
  waypoint: Pick<
    BookingWaypoint,
    "stop_mode" | "stop_hours" | "stop_nights" | "stop_departure_time" | "planned_stop_duration_minutes"
  >,
  lang: Language | "it" | "en" = "it"
): string | null {
  const italian = lang === "it";
  const mode = getWaypointStopMode(waypoint);

  if (mode === "hours") {
    const hours = Math.max(0, Number(waypoint.stop_hours ?? 0));
    if (!hours) return null;
    const departureTime = waypoint.stop_departure_time?.slice(0, 5);
    if (departureTime) {
      return italian ? `Sosta ${hours}h, ripartenza h ${departureTime}` : `${hours}h stop, departs ${departureTime}`;
    }
    return italian ? `Sosta ${hours}h` : `${hours}h stop`;
  }

  if (mode === "nights") {
    const nights = Math.max(0, Number(waypoint.stop_nights ?? 1));
    const time = (waypoint.stop_departure_time ?? DEFAULT_STOP_DEPARTURE_TIME).slice(0, 5);
    const dayWord = italian ? (nights === 1 ? "giorno" : "giorni") : nights === 1 ? "day" : "days";
    return italian
      ? `Sosta ${nights} ${dayWord}, ripartenza h ${time}`
      : `${nights}-${dayWord} stop, departs ${time}`;
  }

  const minutes = Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0));
  if (!minutes) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [days ? `${days}g` : "", hours ? `${hours}h` : "", mins ? `${mins}m` : ""].filter(Boolean);
  return italian ? `Sosta ${parts.join(" ")}` : `${parts.join(" ")} stop`;
}

export function formatWaypointStopDates(
  waypoint: Pick<BookingWaypoint, "date_start" | "date_end">,
  lang: Language | "it" | "en" = "it"
): string | null {
  const locale = getBookingLocale(lang);
  const arrival = formatBookingDate(waypoint.date_end, locale);
  const departure = formatBookingDate(waypoint.date_start, locale);
  if (!arrival && !departure) return null;

  const labels = lang === "it"
    ? { arrival: "Arrivo", departure: "Ripartenza" }
    : { arrival: "Arrival", departure: "Departure" };
  return [
    arrival ? `${labels.arrival} ${arrival}` : "",
    departure ? `${labels.departure} ${departure}` : "",
  ].filter(Boolean).join(" · ");
}

export function formatWaypointStopScheduleSummary(
  schedule: {
    arrivalWindowStart?: string | null;
    arrivalWindowEnd?: string | null;
    departureWindowStart?: string | null;
    departureWindowEnd?: string | null;
    fallbackArrivalDate?: string | null;
    fallbackDepartureDate?: string | null;
  },
  lang: Language | "it" | "en" = "it"
): string | null {
  const locale = getBookingLocale(lang);
  const arrival =
    formatBookingWindow(schedule.arrivalWindowStart, schedule.arrivalWindowEnd, locale) ||
    formatBookingDate(schedule.fallbackArrivalDate, locale);
  const departure =
    formatBookingWindow(schedule.departureWindowStart, schedule.departureWindowEnd, locale) ||
    formatBookingDate(schedule.fallbackDepartureDate, locale);
  if (!arrival && !departure) return null;

  const labels = lang === "it"
    ? { arrival: "Arrivo", departure: "Ripartenza" }
    : { arrival: "Arrival", departure: "Departure" };
  return [
    arrival ? `${labels.arrival} ${arrival}` : "",
    departure ? `${labels.departure} ${departure}` : "",
  ].filter(Boolean).join(" · ");
}
