import type { VoyageWaypoint } from "@/lib/voyage-utils";
import { getLocalizedWaypointName } from "@/lib/voyage-utils";

/** Allineato alla edge function translate-editor-content (waypoint): testo solo in una lingua. */
export function waypointHasTranslationGap(wp: VoyageWaypoint): boolean {
  const ni = (wp.name_it ?? "").trim();
  const ne = (wp.name_en ?? "").trim();
  const di = (wp.description_it ?? "").trim();
  const de = (wp.description_en ?? "").trim();
  const nameGap = (ni !== "" && ne === "") || (ni === "" && ne !== "");
  const descGap = (di !== "" && de === "") || (di === "" && de !== "");
  return nameGap || descGap;
}

/** Waypoints già ordinati per `sort_order` (come in salvataggio rotta). */
export function getRouteWaypointTranslationGapLabels(sortedWaypoints: VoyageWaypoint[]): string[] {
  const labels: string[] = [];
  sortedWaypoints.forEach((wp, index) => {
    if (!waypointHasTranslationGap(wp)) return;
    const name = getLocalizedWaypointName(wp, "it", index);
    labels.push(`${index + 1}. ${name}`);
  });
  return labels;
}
