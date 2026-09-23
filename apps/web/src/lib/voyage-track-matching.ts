/**
 * Automatic reconciliation of a recorded track with a voyage's legs.
 *
 * A recording rarely lines up with the plan: it can cover one leg, part of a
 * leg, or several legs; it usually starts a little after leaving port and ends
 * at an anchorage rather than on the planned pin. So the matcher works on
 * **boundaries** (the stops between legs) rather than on legs:
 *
 * 1. For every boundary it collects candidate moments on the track:
 *    - `stop` — a detected stop (voyage-track-analysis.ts) near the boundary:
 *      the boat was there, arrival = stop start, departure = stop end;
 *    - `pass` — the closest approach while sailing past it (a skipped port,
 *      or a leg change without stopping);
 *    - `trackStart` / `trackEnd` — the recording begins/ends near it (the
 *      "started recording just after casting off" case).
 *    A boundary's position set includes its alias (a skipped stop replaced by
 *    a real one, `alias_of_waypoint_id`), so "Messina" also matches a stop in
 *    Reggio Calabria.
 * 2. Each candidate is scored by distance and, when the programming already
 *    has actual times for that stop, by agreement with them.
 * 3. A dynamic programme picks the best sequence that is increasing both in
 *    boundary order and in time. Unmatched boundaries in between are cut at
 *    their closest approach and flagged low confidence.
 * 4. Consecutive hits become leg segments; movement before the first / after
 *    the last hit becomes a partial segment of the adjacent leg.
 *
 * The result is a **proposal**. Nothing here writes anywhere: the admin
 * editor shows it, lets the admin fix it, and only then saves.
 */
import { distanceNm, type TrackPoint, type TrackStop } from "@/lib/voyage-track-analysis";

export interface MatchPosition {
  waypointId: string;
  lat: number;
  lng: number;
}

export interface MatchBoundary {
  /** The planned waypoint id this boundary stands for. */
  waypointId: string;
  name: string;
  /** Planned pin plus alias targets / sources. */
  positions: MatchPosition[];
  /** Programming actuals (epoch ms), used only as a soft prior. */
  arrivalHint: number | null;
  departureHint: number | null;
}

export interface MatchLeg {
  /** `voyage_bookable_legs.id`, null for voyages without bookable legs. */
  legId: string | null;
  fromWaypointId: string;
  toWaypointId: string;
  /** Boundary index of the departure; the arrival is `fromBoundary + 1`. */
  fromBoundary: number;
  plannedNm: number | null;
  label: string;
}

export interface MatchLandmark {
  waypointId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface MatchChain {
  boundaries: MatchBoundary[];
  legs: MatchLeg[];
  /** Every real stop of the voyage (planned and added), to name the stops found inside a leg. */
  landmarks: MatchLandmark[];
}

export type HitKind = "stop" | "pass" | "trackStart" | "trackEnd" | "interpolated";

export interface BoundaryHit {
  boundary: number;
  kind: HitKind;
  /** Last point before the port time (arrival), and first point after it (departure). */
  arriveIdx: number;
  departIdx: number;
  distNm: number;
  /** Hours of disagreement with the programming actuals, when known. */
  timeOffsetHours: number | null;
  score: number;
}

export type MatchConfidence = "high" | "medium" | "low";

export interface ProposedSegment {
  /** Index into `chain.legs`; null when nothing plausible was found (the admin assigns it). */
  legIndex: number | null;
  startIdx: number;
  endIdx: number;
  confidence: MatchConfidence;
  from: BoundaryHit | null;
  to: BoundaryHit | null;
}

export interface MatchOptions {
  /** A stop within this distance of a boundary is "being there". */
  stopRadiusNm?: number;
  /** Sailing past within this distance counts as passing the boundary. */
  passRadiusNm?: number;
  /** Recording starting/ending within this distance is snapped to the boundary. */
  endpointRadiusNm?: number;
}

const DEFAULTS: Required<MatchOptions> = { stopRadiusNm: 3, passRadiusNm: 3, endpointRadiusNm: 8 };
const SKIP_PENALTY = 3;

// ---------------------------------------------------------------------------
// Chain construction from database rows
// ---------------------------------------------------------------------------

export interface ChainWaypointInput {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sort_order: number;
  waypoint_type?: string | null;
  visibility_mode?: string | null;
  actual_status?: string | null;
  alias_of_waypoint_id?: string | null;
  actual_arrival_at?: string | null;
  actual_departure_at?: string | null;
  planned_stop_duration_minutes?: number | null;
  stop_mode?: string | null;
  stop_hours?: number | null;
  stop_nights?: number | null;
}

export interface ChainLegInput {
  id: string;
  from_waypoint_id: string;
  to_waypoint_id: string;
  sort_order: number;
  planned_nautical_miles?: number | string | null;
}

const toMs = (value: string | null | undefined) => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** Same rule as `getWaypointEffectiveType` in voyage-utils, restated to keep this module dependency-free. */
const isNarrative = (w: ChainWaypointInput, index: number, total: number) => {
  if (w.visibility_mode === "manual") return w.waypoint_type === "narrative";
  if (
    Number(w.planned_stop_duration_minutes ?? 0) > 0 ||
    (w.stop_mode === "hours" && Number(w.stop_hours ?? 0) > 0) ||
    (w.stop_mode === "nights" && Number(w.stop_nights ?? 0) > 0)
  ) {
    return true;
  }
  return index === 0 || index === total - 1;
};

export function buildMatchChain(waypointsInput: ChainWaypointInput[], legsInput: ChainLegInput[]): MatchChain {
  const waypoints = [...waypointsInput].sort((a, b) => a.sort_order - b.sort_order);
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const narrative = waypoints.filter((w, i) => isNarrative(w, i, waypoints.length));

  const boundaryFor = (waypointId: string): MatchBoundary | null => {
    const w = byId.get(waypointId);
    if (!w) return null;
    const related = new Map<string, ChainWaypointInput>([[w.id, w]]);
    if (w.alias_of_waypoint_id && byId.has(w.alias_of_waypoint_id)) related.set(w.alias_of_waypoint_id, byId.get(w.alias_of_waypoint_id)!);
    for (const other of waypoints) if (other.alias_of_waypoint_id === w.id) related.set(other.id, other);
    const hintSource = [...related.values()];
    const firstHint = (pick: (x: ChainWaypointInput) => string | null | undefined) =>
      hintSource.map((x) => toMs(pick(x))).find((v) => v !== null) ?? null;
    return {
      waypointId: w.id,
      name: w.name,
      positions: [...related.values()].map((x) => ({ waypointId: x.id, lat: x.lat, lng: x.lng })),
      arrivalHint: firstHint((x) => x.actual_arrival_at),
      departureHint: firstHint((x) => x.actual_departure_at),
    };
  };

  const boundaries: MatchBoundary[] = [];
  const legs: MatchLeg[] = [];
  const pushBoundary = (waypointId: string) => {
    const last = boundaries[boundaries.length - 1];
    if (last?.waypointId === waypointId) return boundaries.length - 1;
    const boundary = boundaryFor(waypointId);
    if (!boundary) return -1;
    boundaries.push(boundary);
    return boundaries.length - 1;
  };

  const sortedLegs = [...legsInput].sort((a, b) => a.sort_order - b.sort_order);
  if (sortedLegs.length) {
    for (const leg of sortedLegs) {
      const from = pushBoundary(leg.from_waypoint_id);
      const to = pushBoundary(leg.to_waypoint_id);
      if (from < 0 || to !== from + 1) continue;
      legs.push({
        legId: leg.id,
        fromWaypointId: leg.from_waypoint_id,
        toWaypointId: leg.to_waypoint_id,
        fromBoundary: from,
        plannedNm: leg.planned_nautical_miles != null ? Number(leg.planned_nautical_miles) : null,
        label: `${byId.get(leg.from_waypoint_id)?.name ?? "?"} → ${byId.get(leg.to_waypoint_id)?.name ?? "?"}`,
      });
    }
  } else {
    // Historical voyages have no bookable legs: every consecutive pair of real stops is a leg.
    const real = narrative.filter((w) => w.actual_status !== "skipped");
    real.forEach((w, i) => {
      const index = pushBoundary(w.id);
      if (i === 0 || index < 1) return;
      legs.push({
        legId: null,
        fromWaypointId: real[i - 1].id,
        toWaypointId: w.id,
        fromBoundary: index - 1,
        plannedNm: null,
        label: `${real[i - 1].name} → ${w.name}`,
      });
    });
  }

  return {
    boundaries,
    legs,
    landmarks: narrative.map((w) => ({ waypointId: w.id, name: w.name, lat: w.lat, lng: w.lng })),
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Candidate extends BoundaryHit {
  prev: Candidate | null;
  best: number;
}

const nearestDistance = (point: { lat: number; lng: number }, positions: MatchPosition[]) =>
  positions.reduce((min, p) => Math.min(min, distanceNm(point, p)), Infinity);

function timeOffsetHours(points: TrackPoint[], hit: { arriveIdx: number; departIdx: number }, boundary: MatchBoundary) {
  const a = points[hit.arriveIdx]?.t;
  const d = points[hit.departIdx]?.t;
  const hintStart = boundary.arrivalHint ?? boundary.departureHint;
  const hintEnd = boundary.departureHint ?? boundary.arrivalHint;
  if (a == null || d == null || hintStart === null || hintEnd === null) return null;
  const lo = Math.min(hintStart, hintEnd);
  const hi = Math.max(hintStart, hintEnd);
  if (d < lo) return (lo - d) / 3_600_000;
  if (a > hi) return (a - hi) / 3_600_000;
  return 0;
}

function collectCandidates(
  points: TrackPoint[],
  stops: TrackStop[],
  boundary: MatchBoundary,
  boundaryIndex: number,
  opts: Required<MatchOptions>
): BoundaryHit[] {
  const n = points.length;
  const runRadius = Math.max(opts.endpointRadiusNm, opts.passRadiusNm);
  const hits: BoundaryHit[] = [];
  let k = 0;
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i += 1) dist[i] = nearestDistance(points[i], boundary.positions);

  while (k < n) {
    if (dist[k] > runRadius) {
      k += 1;
      continue;
    }
    let end = k;
    while (end + 1 < n && dist[end + 1] <= runRadius) end += 1;
    // [k, end] is one visit to the neighbourhood of the boundary.
    let argmin = k;
    for (let i = k; i <= end; i += 1) if (dist[i] < dist[argmin]) argmin = i;

    const nearStops = stops.filter(
      (s) => s.endIdx >= k && s.startIdx <= end && nearestDistance(s, boundary.positions) <= opts.stopRadiusNm
    );
    let hit: Omit<BoundaryHit, "score" | "timeOffsetHours"> | null = null;
    if (nearStops.length) {
      hit = {
        boundary: boundaryIndex,
        kind: "stop",
        arriveIdx: nearStops[0].startIdx,
        departIdx: nearStops[nearStops.length - 1].endIdx,
        distNm: Math.min(...nearStops.map((s) => nearestDistance(s, boundary.positions))),
      };
    } else if (argmin === 0 && dist[0] <= opts.endpointRadiusNm) {
      hit = { boundary: boundaryIndex, kind: "trackStart", arriveIdx: 0, departIdx: 0, distNm: dist[0] };
    } else if (argmin === n - 1 && dist[n - 1] <= opts.endpointRadiusNm) {
      hit = { boundary: boundaryIndex, kind: "trackEnd", arriveIdx: n - 1, departIdx: n - 1, distNm: dist[n - 1] };
    } else if (dist[argmin] <= opts.passRadiusNm) {
      hit = { boundary: boundaryIndex, kind: "pass", arriveIdx: argmin, departIdx: argmin, distNm: dist[argmin] };
    }

    if (hit) {
      const offset = timeOffsetHours(points, hit, boundary);
      const base =
        hit.kind === "stop" ? 10 - 1.5 * hit.distNm : hit.kind === "pass" ? 7 - 2 * hit.distNm : 5 - 0.5 * hit.distNm;
      const score = base - (offset === null ? 0 : Math.min(8, offset / 3));
      if (score > 0) hits.push({ ...hit, timeOffsetHours: offset, score });
    }
    k = end + 1;
  }
  return hits;
}

const hitConfidence = (hit: BoundaryHit | null): MatchConfidence => {
  if (!hit) return "low";
  const lateness = hit.timeOffsetHours ?? 0;
  let level: MatchConfidence;
  if (hit.kind === "stop") level = hit.distNm <= 1.5 ? "high" : "medium";
  else if (hit.kind === "pass") level = hit.distNm <= 1 ? "high" : "medium";
  else if (hit.kind === "interpolated") level = "low";
  else level = hit.distNm <= 2 ? "medium" : "low";
  if (lateness > 6 && level === "high") level = "medium";
  if (lateness > 24) level = "low";
  return level;
};

const minConfidence = (a: MatchConfidence, b: MatchConfidence): MatchConfidence => {
  const order: MatchConfidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
};

/** Did the boat actually move in `[from, to]` (vs. sitting in port before/after the recording)? */
function movedBetween(points: TrackPoint[], from: number, to: number, thresholdNm = 0.5) {
  if (to <= from) return false;
  const origin = points[from];
  for (let i = from + 1; i <= to; i += 1) if (distanceNm(origin, points[i]) > thresholdNm) return true;
  return false;
}

function closestIndex(points: TrackPoint[], positions: MatchPosition[], from: number, to: number) {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i <= to; i += 1) {
    const d = nearestDistance(points[i], positions);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distNm: bestD };
}

export function matchTrackToChain(
  points: TrackPoint[],
  stops: TrackStop[],
  chain: MatchChain,
  options: MatchOptions = {}
): { segments: ProposedSegment[]; hits: BoundaryHit[] } {
  const opts = { ...DEFAULTS, ...options };
  const n = points.length;
  if (n < 2) return { segments: [], hits: [] };

  const legByBoundary = new Map(chain.legs.map((leg, i) => [leg.fromBoundary, i]));
  const legIndexBetween = (b: number) => legByBoundary.get(b) ?? null;

  // Skip boundaries nowhere near the recording (cheap bbox test) before the per-point pass.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const margin = 0.25; // ~15 nm
  const nearBox = (b: MatchBoundary) =>
    b.positions.some((p) => p.lat >= minLat - margin && p.lat <= maxLat + margin && p.lng >= minLng - margin && p.lng <= maxLng + margin);

  const candidates: Candidate[] = [];
  chain.boundaries.forEach((boundary, index) => {
    if (!nearBox(boundary)) return;
    for (const hit of collectCandidates(points, stops, boundary, index, opts)) candidates.push({ ...hit, prev: null, best: hit.score });
  });
  candidates.sort((a, b) => a.boundary - b.boundary || a.arriveIdx - b.arriveIdx);

  // Longest-path DP over (boundary order, time order).
  let bestEnd: Candidate | null = null;
  for (const c of candidates) {
    for (const p of candidates) {
      if (p.boundary >= c.boundary) break;
      const ordered = p.kind === "pass" || c.kind === "pass" ? p.departIdx <= c.arriveIdx : p.departIdx < c.arriveIdx;
      if (!ordered) continue;
      const value = p.best - SKIP_PENALTY * (c.boundary - p.boundary - 1) + c.score;
      if (value > c.best) {
        c.best = value;
        c.prev = p;
      }
    }
    if (!bestEnd || c.best > bestEnd.best) bestEnd = c;
  }

  const chosen: BoundaryHit[] = [];
  for (let c = bestEnd; c; c = c.prev) {
    const { prev: _prev, best: _best, ...hit } = c;
    chosen.unshift(hit);
  }

  if (!chosen.length) {
    return { segments: [{ legIndex: null, startIdx: 0, endIdx: n - 1, confidence: "low", from: null, to: null }], hits: [] };
  }

  const segments: ProposedSegment[] = [];

  // Head: the boat was already under way when the recording started.
  const first = chosen[0];
  if (first.kind !== "trackStart" && first.arriveIdx > 0 && movedBetween(points, 0, first.arriveIdx)) {
    const legIndex = first.boundary > 0 ? legIndexBetween(first.boundary - 1) : null;
    segments.push({ legIndex, startIdx: 0, endIdx: first.arriveIdx, confidence: legIndex === null ? "low" : "medium", from: null, to: first });
  }

  for (let i = 1; i < chosen.length; i += 1) {
    const from = chosen[i - 1];
    const to = chosen[i];
    let cursorHit = from;
    // Boundaries skipped by the DP: cut at their closest approach, flagged low.
    for (let b = from.boundary + 1; b < to.boundary; b += 1) {
      const lo = cursorHit.departIdx;
      const hi = to.arriveIdx;
      if (hi <= lo) break;
      const { index, distNm } = closestIndex(points, chain.boundaries[b].positions, lo, hi);
      const cut: BoundaryHit = { boundary: b, kind: "interpolated", arriveIdx: index, departIdx: index, distNm, timeOffsetHours: null, score: 0 };
      segments.push({ legIndex: legIndexBetween(cursorHit.boundary), startIdx: lo, endIdx: index, confidence: "low", from: cursorHit, to: cut });
      cursorHit = cut;
    }
    segments.push({
      legIndex: legIndexBetween(cursorHit.boundary),
      startIdx: cursorHit.departIdx,
      endIdx: to.arriveIdx,
      confidence: minConfidence(hitConfidence(cursorHit), hitConfidence(to)),
      from: cursorHit,
      to,
    });
  }

  // Tail: the recording stopped before reaching the next stop.
  const last = chosen[chosen.length - 1];
  if (last.kind !== "trackEnd" && last.departIdx < n - 1 && movedBetween(points, last.departIdx, n - 1)) {
    const legIndex = legIndexBetween(last.boundary);
    segments.push({ legIndex, startIdx: last.departIdx, endIdx: n - 1, confidence: legIndex === null ? "low" : "medium", from: last, to: null });
  }

  return { segments: segments.filter((s) => s.endIdx > s.startIdx), hits: chosen };
}

/** How far the segment's first/last recorded point is from the planned stop (0 when it starts/ends there). */
export function segmentEndGaps(points: TrackPoint[], chain: MatchChain, segment: { legIndex: number | null; startIdx: number; endIdx: number }) {
  if (segment.legIndex === null) return { startGapNm: null, endGapNm: null };
  const leg = chain.legs[segment.legIndex];
  const fromB = chain.boundaries[leg.fromBoundary];
  const toB = chain.boundaries[leg.fromBoundary + 1];
  return {
    startGapNm: fromB ? nearestDistance(points[segment.startIdx], fromB.positions) : null,
    endGapNm: toB ? nearestDistance(points[segment.endIdx], toB.positions) : null,
  };
}

/** Names a stop found inside a leg: the nearest real stop of the voyage within `radiusNm`, else unplanned. */
export function labelStop(stop: { lat: number; lng: number }, chain: MatchChain, radiusNm = 3): MatchLandmark | null {
  let best: MatchLandmark | null = null;
  let bestD = Infinity;
  for (const landmark of chain.landmarks) {
    const d = distanceNm(stop, landmark);
    if (d < bestD) {
      bestD = d;
      best = landmark;
    }
  }
  return bestD <= radiusNm ? best : null;
}
