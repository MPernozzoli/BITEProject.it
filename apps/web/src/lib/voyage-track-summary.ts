/**
 * Read side of recorded tracks: turns `voyage_track_segments` rows into
 * per-leg "actual" figures for the voyage ticket and the planned-vs-actual
 * comparison on the voyage page.
 *
 * A leg can be covered by several segments (a recording stopped and resumed),
 * so everything here aggregates by leg. Two honesty rules:
 * - when the recording started after casting off or ended before arriving
 *   (`start_gap_nm` / `end_gap_nm`), the recorded distance is a floor, not the
 *   leg: `estimatedNm` adds the missing ends as straight lines and `coverage`
 *   says "partial" so the UI can say "circa";
 * - nothing here is ever written back to the programming (see the migration
 *   `20260923095529_voyage_recorded_tracks.sql`).
 */
import type { TrackGeometry, SpeedSample } from "@/lib/voyage-track-analysis";

export interface TrackSegmentStop {
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  lat: number;
  lng: number;
  /** Real stop of the voyage it corresponds to; null = unplanned stop. */
  waypointId: string | null;
  name: string | null;
}

/** Public projection of `voyage_track_segments` (what the ticket and voyage page select). */
export interface TrackSegmentRow {
  id: string;
  track_id: string;
  voyage_id: string;
  leg_id: string | null;
  from_waypoint_id: string | null;
  to_waypoint_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  distance_nm: number | string | null;
  elapsed_seconds: number | null;
  moving_seconds: number | null;
  stopped_seconds: number | null;
  avg_sog_kn: number | string | null;
  max_sog_kn: number | string | null;
  start_gap_nm: number | string | null;
  end_gap_nm: number | string | null;
  stops: unknown;
  extras: unknown;
  geometry: unknown;
  speed_profile: unknown;
}

export const TRACK_SEGMENT_PUBLIC_COLUMNS =
  "id,track_id,voyage_id,leg_id,from_waypoint_id,to_waypoint_id,started_at,ended_at,distance_nm,elapsed_seconds,moving_seconds,stopped_seconds,avg_sog_kn,max_sog_kn,start_gap_nm,end_gap_nm,stops,extras,geometry,speed_profile";

/** Gaps below this are "the pin vs the actual berth", not missing track. */
export const PARTIAL_COVERAGE_GAP_NM = 1.5;

export interface LegTrackSummary {
  key: string;
  legId: string | null;
  fromWaypointId: string | null;
  toWaypointId: string | null;
  segmentCount: number;
  startedAt: string | null;
  endedAt: string | null;
  /** Measured on the recording. */
  recordedNm: number;
  /** Recorded plus the unrecorded ends as straight lines. */
  estimatedNm: number;
  coverage: "full" | "partial";
  startGapNm: number;
  endGapNm: number;
  elapsedSec: number | null;
  movingSec: number | null;
  stoppedSec: number | null;
  avgSogKn: number | null;
  maxSogKn: number | null;
  stops: TrackSegmentStop[];
  geometries: TrackGeometry[];
  speedProfile: SpeedSample[];
}

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const legTrackKey = (row: { leg_id: string | null; from_waypoint_id: string | null; to_waypoint_id: string | null }) =>
  row.leg_id ?? `${row.from_waypoint_id ?? "?"}>${row.to_waypoint_id ?? "?"}`;

export const parseTrackGeometry = (value: unknown): TrackGeometry | null => {
  if (!value || typeof value !== "object") return null;
  const g = value as Partial<TrackGeometry>;
  if (!Array.isArray(g.c) || g.c.length < 2) return null;
  return { c: g.c, t: Array.isArray(g.t) ? g.t : [], s: Array.isArray(g.s) ? g.s : [], b: Array.isArray(g.b) ? g.b : [] };
};

const parseStops = (value: unknown): TrackSegmentStop[] =>
  Array.isArray(value)
    ? value.filter((s): s is TrackSegmentStop => Boolean(s) && typeof s === "object" && typeof (s as TrackSegmentStop).lat === "number")
    : [];

const parseProfile = (value: unknown): SpeedSample[] =>
  Array.isArray(value) ? value.filter((s): s is SpeedSample => typeof s?.t === "number" && typeof s?.s === "number") : [];

export function summarizeTrackSegments(rows: TrackSegmentRow[]): Map<string, LegTrackSummary> {
  const grouped = new Map<string, TrackSegmentRow[]>();
  for (const row of rows) {
    const key = legTrackKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const result = new Map<string, LegTrackSummary>();
  for (const [key, group] of grouped) {
    const sorted = [...group].sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const sum = (pick: (r: TrackSegmentRow) => number | null) => {
      const values = sorted.map(pick).filter((v): v is number => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    const recordedNm = sum((r) => num(r.distance_nm)) ?? 0;
    const movingSec = sum((r) => r.moving_seconds);
    const startGapNm = num(first.start_gap_nm) ?? 0;
    const endGapNm = num(last.end_gap_nm) ?? 0;
    const startMs = first.started_at ? Date.parse(first.started_at) : NaN;
    const endMs = last.ended_at ? Date.parse(last.ended_at) : NaN;
    const maxValues = sorted.map((r) => num(r.max_sog_kn)).filter((v): v is number => v !== null);

    result.set(key, {
      key,
      legId: first.leg_id,
      fromWaypointId: first.from_waypoint_id,
      toWaypointId: first.to_waypoint_id,
      segmentCount: sorted.length,
      startedAt: first.started_at,
      endedAt: last.ended_at,
      recordedNm,
      estimatedNm: recordedNm + startGapNm + endGapNm,
      coverage: startGapNm > PARTIAL_COVERAGE_GAP_NM || endGapNm > PARTIAL_COVERAGE_GAP_NM ? "partial" : "full",
      startGapNm,
      endGapNm,
      // Across several recordings the leg's span is first start → last end: the unrecorded middle was still the leg.
      elapsedSec: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round((endMs - startMs) / 1000) : sum((r) => r.elapsed_seconds),
      movingSec,
      stoppedSec: sum((r) => r.stopped_seconds),
      avgSogKn: movingSec && movingSec > 0 ? recordedNm / (movingSec / 3600) : null,
      maxSogKn: maxValues.length ? Math.max(...maxValues) : null,
      stops: sorted.flatMap((r) => parseStops(r.stops)),
      geometries: sorted.map((r) => parseTrackGeometry(r.geometry)).filter((g): g is TrackGeometry => g !== null),
      speedProfile: sorted.flatMap((r) => parseProfile(r.speed_profile)),
    });
  }
  return result;
}

/** Summaries for an ordered list of legs; legs without a recording are simply absent. */
export function summariesForLegs(
  summaries: Map<string, LegTrackSummary>,
  legs: { id: string; from_waypoint_id: string; to_waypoint_id: string }[]
): LegTrackSummary[] {
  return legs
    .map((leg) => summaries.get(leg.id) ?? summaries.get(`${leg.from_waypoint_id}>${leg.to_waypoint_id}`) ?? null)
    .filter((s): s is LegTrackSummary => s !== null);
}

/** "3h 25m" / "1g 4h" style duration, bilingual. */
export function formatTrackDuration(seconds: number | null | undefined, lang: "it" | "en"): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const dayUnit = lang === "it" ? "g" : "d";
  if (days > 0) return `${days}${dayUnit} ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

/** Flattens geometries into [lng, lat] runs split at recording breaks, for drawing. */
export function geometryRuns(geometries: TrackGeometry[]): [number, number][][] {
  const runs: [number, number][][] = [];
  for (const g of geometries) {
    let current: [number, number][] = [];
    g.c.forEach((coord, i) => {
      if (g.b.includes(i) && current.length) {
        runs.push(current);
        current = [];
      }
      current.push(coord);
    });
    if (current.length > 1) runs.push(current);
  }
  return runs;
}
