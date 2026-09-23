/**
 * "Biglietto ricordo": a per-participant recap of the leg(s) of a voyage a
 * traveller actually booked, comparing planned distance/stops against what
 * was actually logged (`actual_arrival_at` on the leg — see
 * lib/voyage-schedule.ts).
 *
 * "Actual nautical miles" come from the recorded GPX track when an admin has
 * confirmed one for the leg (lib/voyage-track-summary.ts): measured distance,
 * plus the unrecorded ends as straight lines when the recording started late
 * or stopped early. Completed legs without a track fall back to their planned
 * miles, and `milesSource` says which mix the number is, so the card never
 * passes a proxy off as a measurement.
 *
 * The ticket only exists once the traveller's journey is truly over: not when
 * they arrive at their disembarkation stop, but the day the voyage actually
 * departs *from* it (`voyage_waypoints.actual_departure_at` on the `to_waypoint`
 * of their last booked leg) — arriving doesn't close the chapter, the boat
 * leaving without them does.
 */
import type { Language } from "@/lib/i18n";
import { getLegPhase } from "@/lib/voyage-schedule";
import type { BookableLeg, BookingWaypoint } from "@/lib/booking-utils";
import { geometryRuns, summariesForLegs, type LegTrackSummary } from "@/lib/voyage-track-summary";

export interface VoyageTicketStop {
  waypointId: string;
  name: string;
  /** True once the traveller's arrival here has been logged as actual. */
  reached: boolean;
}

/** What the confirmed GPX tracks add to the ticket; null when none of the traveller's legs has one. */
export interface VoyageTicketTrack {
  /** Traveller's legs with a confirmed track, out of `totalLegs`. */
  trackedLegs: number;
  /** True when a tracked leg misses a start or an end (recording started late / stopped early). */
  partial: boolean;
  movingSeconds: number | null;
  avgSogKn: number | null;
  maxSogKn: number | null;
  /** Stops found on the track that match no stop of the voyage. */
  unplannedStops: number;
  /** [lng, lat] runs of the real route, split at recording breaks. */
  actualRuns: [number, number][][];
  /** [lng, lat] of the planned route over the traveller's legs. */
  plannedRoute: [number, number][];
}

export interface ParticipantVoyageTicket {
  bookingRequestId: string;
  voyageId: string;
  voyageName: string;
  voyageSlug: string;
  voyageType: "water" | "land";
  startDate: string | null;
  endDate: string | null;
  stops: VoyageTicketStop[];
  plannedNauticalMiles: number;
  actualNauticalMiles: number;
  /** "track": every completed leg measured; "planned": none; "mixed": some measured, some planned proxy. */
  milesSource: "track" | "planned" | "mixed";
  track: VoyageTicketTrack | null;
  completedLegs: number;
  totalLegs: number;
  isFullyTravelled: boolean;
}

const nameForLang = (
  lang: Language,
  fallback: string | null,
  it: string | null,
  en: string | null
): string => (lang === "en" ? en || fallback || "" : it || fallback || "");

/** The waypoint where the traveller got off: the `to_waypoint` of their last booked leg. */
export function getDisembarkationWaypointId(ownLegsSortedByOrder: BookableLeg[]): string | null {
  if (!ownLegsSortedByOrder.length) return null;
  return ownLegsSortedByOrder[ownLegsSortedByOrder.length - 1].to_waypoint_id;
}

/**
 * The ticket is ready once the voyage has actually moved on without the
 * traveller — i.e. the vessel departed their disembarkation stop. Arrival
 * there is not enough: only `actual_departure_at` on that waypoint closes it.
 */
export function isVoyageTicketReady(
  ownLegsSortedByOrder: BookableLeg[],
  waypointsById: Record<string, BookingWaypoint>
): boolean {
  const disembarkationWaypointId = getDisembarkationWaypointId(ownLegsSortedByOrder);
  if (!disembarkationWaypointId) return false;
  return Boolean(waypointsById[disembarkationWaypointId]?.actual_departure_at);
}

export function buildParticipantVoyageTicket(params: {
  bookingRequestId: string;
  voyage: {
    id: string;
    name: string;
    name_it?: string | null;
    name_en?: string | null;
    slug?: string | null;
    type?: "water" | "land";
    start_date: string | null;
    end_date: string | null;
  };
  ownLegsSortedByOrder: BookableLeg[];
  waypointsById: Record<string, BookingWaypoint>;
  lang: Language;
  /** Confirmed track summaries of the voyage, keyed as in `summarizeTrackSegments`. */
  trackSummaries?: Map<string, LegTrackSummary>;
}): ParticipantVoyageTicket | null {
  const { bookingRequestId, voyage, ownLegsSortedByOrder, waypointsById, lang, trackSummaries } = params;
  if (!ownLegsSortedByOrder.length) return null;

  const stops: VoyageTicketStop[] = [];
  const firstLeg = ownLegsSortedByOrder[0];
  const startedFirstLeg = Boolean(firstLeg.actual_departure_at || firstLeg.actual_arrival_at);
  const firstWaypoint = waypointsById[firstLeg.from_waypoint_id];
  stops.push({
    waypointId: firstLeg.from_waypoint_id,
    name: firstWaypoint ? nameForLang(lang, firstWaypoint.name, firstWaypoint.name_it, firstWaypoint.name_en) : "",
    reached: startedFirstLeg,
  });

  let plannedNauticalMiles = 0;
  let actualNauticalMiles = 0;
  let completedLegs = 0;
  let measuredLegs = 0;
  let proxyLegs = 0;
  for (const leg of ownLegsSortedByOrder) {
    plannedNauticalMiles += leg.planned_nautical_miles || 0;
    const reached = getLegPhase(leg) === "completed";
    const recorded = trackSummaries ? summariesForLegs(trackSummaries, [leg])[0] : undefined;
    if (reached) {
      if (recorded) {
        actualNauticalMiles += recorded.estimatedNm;
        measuredLegs += 1;
      } else {
        actualNauticalMiles += leg.planned_nautical_miles || 0;
        proxyLegs += 1;
      }
      completedLegs += 1;
    }
    const toWaypoint = waypointsById[leg.to_waypoint_id];
    stops.push({
      waypointId: leg.to_waypoint_id,
      name: toWaypoint ? nameForLang(lang, toWaypoint.name, toWaypoint.name_it, toWaypoint.name_en) : "",
      reached,
    });
  }

  return {
    bookingRequestId,
    voyageId: voyage.id,
    voyageName: nameForLang(lang, voyage.name, voyage.name_it ?? null, voyage.name_en ?? null),
    voyageSlug: voyage.slug || voyage.id,
    voyageType: voyage.type || "water",
    startDate: voyage.start_date,
    endDate: voyage.end_date,
    stops,
    plannedNauticalMiles,
    actualNauticalMiles,
    milesSource: measuredLegs === 0 ? "planned" : proxyLegs === 0 ? "track" : "mixed",
    track: buildTicketTrack(ownLegsSortedByOrder, waypointsById, trackSummaries),
    completedLegs,
    totalLegs: ownLegsSortedByOrder.length,
    isFullyTravelled: completedLegs === ownLegsSortedByOrder.length,
  };
}

const sumOrNull = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/** Planned line over the traveller's legs: every non-"added" waypoint between first departure and last arrival. */
function plannedRouteFor(ownLegs: BookableLeg[], waypointsById: Record<string, BookingWaypoint>): [number, number][] {
  const first = waypointsById[ownLegs[0].from_waypoint_id];
  const last = waypointsById[ownLegs[ownLegs.length - 1].to_waypoint_id];
  if (!first || !last) return [];
  return Object.values(waypointsById)
    .filter(
      (w) =>
        w.voyage_id === first.voyage_id &&
        w.sort_order >= first.sort_order &&
        w.sort_order <= last.sort_order &&
        w.actual_status !== "added" &&
        typeof w.lat === "number" &&
        typeof w.lng === "number"
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((w) => [w.lng as number, w.lat as number]);
}

function buildTicketTrack(
  ownLegs: BookableLeg[],
  waypointsById: Record<string, BookingWaypoint>,
  trackSummaries: Map<string, LegTrackSummary> | undefined
): VoyageTicketTrack | null {
  if (!trackSummaries?.size) return null;
  const tracked = summariesForLegs(trackSummaries, ownLegs);
  if (!tracked.length) return null;
  const movingSeconds = sumOrNull(tracked.map((s) => s.movingSec));
  const recordedNm = tracked.reduce((sum, s) => sum + s.recordedNm, 0);
  const maxValues = tracked.map((s) => s.maxSogKn).filter((v): v is number => v !== null);
  return {
    trackedLegs: tracked.length,
    partial: tracked.some((s) => s.coverage === "partial"),
    movingSeconds,
    avgSogKn: movingSeconds ? recordedNm / (movingSeconds / 3600) : null,
    maxSogKn: maxValues.length ? Math.max(...maxValues) : null,
    unplannedStops: tracked.reduce((n, s) => n + s.stops.filter((stop) => !stop.waypointId).length, 0),
    actualRuns: geometryRuns(tracked.flatMap((s) => s.geometries)),
    plannedRoute: plannedRouteFor(ownLegs, waypointsById),
  };
}
