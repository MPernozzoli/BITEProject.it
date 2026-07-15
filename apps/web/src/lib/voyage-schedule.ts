/**
 * The single source of truth for "where is this voyage right now".
 *
 * Mirrors the SQL in 20260715130000_voyage_schedule_phases_and_actuals.sql
 * (`voyage_leg_phase`, `voyage_derived_status`, `voyage_leg_is_bookable_now`).
 * The database keeps `voyages.status` as a cache refreshed by trigger and cron;
 * the UI calls these functions instead, so a phase that turns over by the clock
 * is correct on screen without waiting for the next cron run.
 *
 * Keep both sides in step: any change here needs the same change in that
 * migration, and vice versa. `src/test/voyage-schedule.test.ts` pins the rules.
 */

export type SchedulePhase = "planned" | "active" | "completed";

/** The fields of a bookable leg that decide its phase. */
export interface PhaseLeg {
  actual_departure_at?: string | null;
  actual_arrival_at?: string | null;
  starts_at_window_start?: string | null;
  ends_at_window_end?: string | null;
}

/** A leg carrying both schedules, for delay reporting. */
export interface ScheduledLeg extends PhaseLeg {
  baseline_starts_at_window_start?: string | null;
  baseline_starts_at_window_end?: string | null;
  baseline_ends_at_window_start?: string | null;
  baseline_ends_at_window_end?: string | null;
}

export interface PhaseVoyage {
  status_override?: SchedulePhase | null;
  start_date?: string | null;
  end_date?: string | null;
}

/**
 * Days since the epoch in Europe/Rome. Phases are compared by calendar day, not
 * by instant, matching the SQL (`(timezone('Europe/Rome', x))::date`) and the
 * existing `booking_leg_effective_date` convention: a leg departing later today
 * has already started, it is not still "tomorrow's leg".
 */
function romeDayNumber(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Calendar day of a bare `YYYY-MM-DD` string, which carries no timezone. */
function plainDayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return romeDayNumber(value);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/**
 * Phase of a single leg. A recorded actual always beats the clock: once someone
 * pressed "arriva ora" the leg is done, whatever the plan said.
 */
export function getLegPhase(leg: PhaseLeg, now: Date = new Date()): SchedulePhase {
  if (leg.actual_arrival_at) return "completed";
  if (leg.actual_departure_at) return "active";

  const today = romeDayNumber(now);
  const start = romeDayNumber(leg.starts_at_window_start);
  if (start == null || today == null) return "planned";

  const end = romeDayNumber(leg.ends_at_window_end);
  if (end != null && end < today) return "completed";
  if (start <= today) return "active";
  return "planned";
}

/** Only a leg that has not started can be booked. */
export function isLegBookableNow(leg: PhaseLeg, now: Date = new Date()): boolean {
  return getLegPhase(leg, now) === "planned";
}

/**
 * Phase of the voyage: an explicit override wins, otherwise the leg phases
 * decide, otherwise the voyage's own dates (the historical voyages carry no
 * legs at all).
 */
export function getVoyagePhase(
  voyage: PhaseVoyage,
  legs: PhaseLeg[] = [],
  now: Date = new Date()
): SchedulePhase {
  if (voyage.status_override) return voyage.status_override;

  if (legs.length > 0) {
    let completed = 0;
    let planned = 0;
    for (const leg of legs) {
      const phase = getLegPhase(leg, now);
      if (phase === "completed") completed += 1;
      else if (phase === "planned") planned += 1;
    }
    if (completed === legs.length) return "completed";
    if (planned === legs.length) return "planned";
    return "active";
  }

  const today = romeDayNumber(now);
  const start = plainDayNumber(voyage.start_date);
  const end = plainDayNumber(voyage.end_date);
  if (start == null || today == null) return "planned";
  if (end != null && end < today) return "completed";
  if (start <= today) return "active";
  return "planned";
}

/** The next leg the crew has to close out: the first one not yet arrived at. */
export function getCurrentLegIndex(legs: PhaseLeg[], now: Date = new Date()): number {
  return legs.findIndex((leg) => getLegPhase(leg, now) !== "completed");
}

/** A leg carrying the two waypoints an actual can be recorded against. */
export interface LegEndpoints extends PhaseLeg {
  from_waypoint_id: string;
  to_waypoint_id: string;
}

/**
 * Which actual the crew still owes on this leg, and the waypoint that carries it.
 * Before departure the open question is leaving the origin; once under way it is
 * arriving at the far end. Returns null for a leg that is already closed.
 */
export function getPendingActual(
  leg: LegEndpoints,
  now: Date = new Date()
): { kind: "arrival" | "departure"; waypointId: string } | null {
  const phase = getLegPhase(leg, now);
  if (phase === "completed") return null;
  return leg.actual_departure_at
    ? { kind: "arrival", waypointId: leg.to_waypoint_id }
    : { kind: "departure", waypointId: leg.from_waypoint_id };
}

/**
 * True once a leg's effective departure has slipped past the latest departure
 * the baseline allowed. This is the line between a silent update and a
 * traveller-facing delay: inside the planned window the dates just firm up.
 */
export function isLegDelayed(leg: ScheduledLeg): boolean {
  const effective = leg.starts_at_window_start;
  const baselineEnd = leg.baseline_starts_at_window_end;
  if (!effective || !baselineEnd) return false;
  const effectiveMs = new Date(effective).getTime();
  const baselineMs = new Date(baselineEnd).getTime();
  if (Number.isNaN(effectiveMs) || Number.isNaN(baselineMs)) return false;
  return effectiveMs > baselineMs;
}

/** How late the leg is versus its baseline window, in hours. 0 when on time. */
export function getLegDelayHours(leg: ScheduledLeg): number {
  if (!isLegDelayed(leg)) return 0;
  const effectiveMs = new Date(leg.starts_at_window_start as string).getTime();
  const baselineMs = new Date(leg.baseline_starts_at_window_end as string).getTime();
  return (effectiveMs - baselineMs) / 3_600_000;
}

/**
 * The real stop at a waypoint: arrival there to departure from there. Returns
 * null until both are recorded.
 */
export function getActualStopHours(
  waypoint: { actual_arrival_at?: string | null; actual_departure_at?: string | null }
): number | null {
  if (!waypoint.actual_arrival_at || !waypoint.actual_departure_at) return null;
  const arrivalMs = new Date(waypoint.actual_arrival_at).getTime();
  const departureMs = new Date(waypoint.actual_departure_at).getTime();
  if (Number.isNaN(arrivalMs) || Number.isNaN(departureMs)) return null;
  return Math.max(0, (departureMs - arrivalMs) / 3_600_000);
}

/** Days before the planned departure at which the live widget appears. */
export const VOYAGE_WIDGET_LEAD_DAYS = 7;

/**
 * Whether the dashboard widget should show this voyage: from a week before the
 * planned start until the voyage is over.
 */
export function shouldShowLiveWidget(
  voyage: PhaseVoyage,
  legs: PhaseLeg[] = [],
  now: Date = new Date()
): boolean {
  const phase = getVoyagePhase(voyage, legs, now);
  if (phase === "completed") return false;
  if (phase === "active") return true;

  const today = romeDayNumber(now);
  const firstLegStart = legs.length > 0 ? romeDayNumber(legs[0]?.starts_at_window_start) : null;
  const start = firstLegStart ?? plainDayNumber(voyage.start_date);
  if (start == null || today == null) return false;
  return start - today <= VOYAGE_WIDGET_LEAD_DAYS;
}
