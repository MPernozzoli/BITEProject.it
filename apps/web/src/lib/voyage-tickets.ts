/**
 * "Biglietto ricordo": a per-participant recap of the leg(s) of a voyage a
 * traveller actually booked, comparing planned distance/stops against what
 * was actually logged (`actual_arrival_at` on the leg — see
 * lib/voyage-schedule.ts). There is no recorded GPS track, so "actual
 * nautical miles" is the sum of `planned_nautical_miles` for legs an admin
 * has marked arrived; it is a proxy, not a measured distance.
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

export interface VoyageTicketStop {
  waypointId: string;
  name: string;
  /** True once the traveller's arrival here has been logged as actual. */
  reached: boolean;
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
}): ParticipantVoyageTicket | null {
  const { bookingRequestId, voyage, ownLegsSortedByOrder, waypointsById, lang } = params;
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
  for (const leg of ownLegsSortedByOrder) {
    plannedNauticalMiles += leg.planned_nautical_miles || 0;
    const reached = getLegPhase(leg) === "completed";
    if (reached) {
      actualNauticalMiles += leg.planned_nautical_miles || 0;
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
    completedLegs,
    totalLegs: ownLegsSortedByOrder.length,
    isFullyTravelled: completedLegs === ownLegsSortedByOrder.length,
  };
}
