/**
 * Pure state operations of the admin track editor, and the rows it saves.
 *
 * The editor works on point indices of the cleaned track (voyage-track-analysis.ts);
 * on save each segment becomes a `voyage_track_segments` row whose
 * `started_at`/`ended_at` are the authority (indices are only a cache).
 * Segments never overlap and are kept sorted by start.
 */
import {
  buildSpeedProfile,
  computeRangeMetrics,
  indexAtTime,
  simplifyRange,
  type CleanTrack,
  type TrackStop,
} from "@/lib/voyage-track-analysis";
import {
  labelStop,
  segmentEndGaps,
  type MatchChain,
  type MatchConfidence,
  type ProposedSegment,
} from "@/lib/voyage-track-matching";
import type { TablesInsert } from "@/integrations/supabase/types";

export interface EditorSegment {
  uid: string;
  legIndex: number | null;
  startIdx: number;
  endIdx: number;
  confidence: MatchConfidence | "manual";
}

let uidCounter = 0;
const nextUid = () => `seg-${Date.now().toString(36)}-${(uidCounter += 1)}`;

const sortSegments = (segments: EditorSegment[]) => [...segments].sort((a, b) => a.startIdx - b.startIdx);

export function segmentsFromProposal(proposal: ProposedSegment[]): EditorSegment[] {
  return sortSegments(
    proposal.map((p) => ({ uid: nextUid(), legIndex: p.legIndex, startIdx: p.startIdx, endIdx: p.endIdx, confidence: p.confidence }))
  );
}

/** Rebuilds editor segments from saved rows by mapping their timestamps back onto the re-parsed file. */
export function segmentsFromSaved(
  rows: { leg_id: string | null; from_waypoint_id: string | null; to_waypoint_id: string | null; started_at: string | null; ended_at: string | null; start_point_index: number | null; end_point_index: number | null; match_confidence: string }[],
  track: CleanTrack,
  chain: MatchChain
): EditorSegment[] {
  const legIndexFor = (row: (typeof rows)[number]) => {
    const byLeg = row.leg_id ? chain.legs.findIndex((l) => l.legId === row.leg_id) : -1;
    if (byLeg >= 0) return byLeg;
    const byPair = chain.legs.findIndex((l) => l.fromWaypointId === row.from_waypoint_id && l.toWaypointId === row.to_waypoint_id);
    return byPair >= 0 ? byPair : null;
  };
  const clampIdx = (value: number) => Math.max(0, Math.min(track.points.length - 1, value));
  return sortSegments(
    rows.map((row) => {
      const startIdx = row.started_at && track.hasTime ? indexAtTime(track.points, Date.parse(row.started_at)) : clampIdx(row.start_point_index ?? 0);
      const endIdx = row.ended_at && track.hasTime ? indexAtTime(track.points, Date.parse(row.ended_at)) : clampIdx(row.end_point_index ?? track.points.length - 1);
      return {
        uid: nextUid(),
        legIndex: legIndexFor(row),
        startIdx,
        endIdx,
        confidence: (["high", "medium", "low", "manual"].includes(row.match_confidence) ? row.match_confidence : "manual") as EditorSegment["confidence"],
      };
    })
  );
}

export function assignLeg(segments: EditorSegment[], uid: string, legIndex: number | null): EditorSegment[] {
  return segments.map((s) => (s.uid === uid ? { ...s, legIndex, confidence: "manual" } : s));
}

/** Moves a segment's cuts, clamped so it never overlaps its neighbours and keeps at least one step. */
export function setSegmentBounds(segments: EditorSegment[], uid: string, startIdx: number, endIdx: number, pointCount: number): EditorSegment[] {
  const sorted = sortSegments(segments);
  const i = sorted.findIndex((s) => s.uid === uid);
  if (i < 0) return segments;
  const lower = i > 0 ? sorted[i - 1].endIdx : 0;
  const upper = i < sorted.length - 1 ? sorted[i + 1].startIdx : pointCount - 1;
  const start = Math.max(lower, Math.min(startIdx, upper - 1));
  const end = Math.min(upper, Math.max(endIdx, start + 1));
  sorted[i] = { ...sorted[i], startIdx: start, endIdx: end, confidence: "manual" };
  return sorted;
}

/** Splits at `atIdx`: the first part keeps its leg, the second takes the next leg (the usual reason to split). */
export function splitSegment(segments: EditorSegment[], uid: string, atIdx: number, legCount: number): EditorSegment[] {
  const target = segments.find((s) => s.uid === uid);
  if (!target || atIdx <= target.startIdx || atIdx >= target.endIdx) return segments;
  const nextLeg = target.legIndex !== null && target.legIndex + 1 < legCount ? target.legIndex + 1 : target.legIndex;
  return sortSegments([
    ...segments.filter((s) => s.uid !== uid),
    { ...target, endIdx: atIdx, confidence: "manual" },
    { uid: nextUid(), legIndex: nextLeg, startIdx: atIdx, endIdx: target.endIdx, confidence: "manual" },
  ]);
}

export function mergeWithNext(segments: EditorSegment[], uid: string): EditorSegment[] {
  const sorted = sortSegments(segments);
  const i = sorted.findIndex((s) => s.uid === uid);
  if (i < 0 || i === sorted.length - 1) return segments;
  const merged = { ...sorted[i], endIdx: sorted[i + 1].endIdx, confidence: "manual" as const };
  return [...sorted.slice(0, i), merged, ...sorted.slice(i + 2)];
}

export function removeSegment(segments: EditorSegment[], uid: string): EditorSegment[] {
  return segments.filter((s) => s.uid !== uid);
}

/** Stretches of the recording that no segment covers (port time, or parts the admin excluded). */
export function uncoveredRanges(segments: EditorSegment[], pointCount: number, minPoints = 2): { startIdx: number; endIdx: number }[] {
  const sorted = sortSegments(segments);
  const gaps: { startIdx: number; endIdx: number }[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.startIdx - cursor >= minPoints) gaps.push({ startIdx: cursor, endIdx: s.startIdx });
    cursor = Math.max(cursor, s.endIdx);
  }
  if (pointCount - 1 - cursor >= minPoints) gaps.push({ startIdx: cursor, endIdx: pointCount - 1 });
  return gaps;
}

export function addSegment(segments: EditorSegment[], startIdx: number, endIdx: number, legIndex: number | null): EditorSegment[] {
  return sortSegments([...segments, { uid: nextUid(), legIndex, startIdx, endIdx, confidence: "manual" }]);
}

/** Legs that appear in more than one segment of this track (legit when a recording was paused, but worth a look). */
export function duplicateLegIndices(segments: EditorSegment[]): Set<number> {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const s of segments) {
    if (s.legIndex === null) continue;
    if (seen.has(s.legIndex)) dupes.add(s.legIndex);
    seen.add(s.legIndex);
  }
  return dupes;
}

const round = (value: number | null, digits = 2) => (value === null ? null : Number(value.toFixed(digits)));
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export type TrackSegmentInsert = TablesInsert<"voyage_track_segments">;

export function buildSegmentRows(params: {
  track: CleanTrack;
  stops: TrackStop[];
  chain: MatchChain;
  segments: EditorSegment[];
  trackId: string;
  voyageId: string;
}): TrackSegmentInsert[] {
  const { track, stops, chain, segments, trackId, voyageId } = params;
  return sortSegments(segments).map((segment, order) => {
    const metrics = computeRangeMetrics(track.points, stops, segment.startIdx, segment.endIdx);
    const leg = segment.legIndex !== null ? chain.legs[segment.legIndex] : null;
    const gaps = segmentEndGaps(track.points, chain, segment);
    return {
      track_id: trackId,
      voyage_id: voyageId,
      leg_id: leg?.legId ?? null,
      from_waypoint_id: leg?.fromWaypointId ?? null,
      to_waypoint_id: leg?.toWaypointId ?? null,
      sort_order: order,
      started_at: iso(metrics.startAt),
      ended_at: iso(metrics.endAt),
      start_point_index: segment.startIdx,
      end_point_index: segment.endIdx,
      distance_nm: round(metrics.distanceNm),
      bridged_nm: round(metrics.bridgedNm),
      elapsed_seconds: metrics.elapsedSec,
      moving_seconds: metrics.movingSec,
      stopped_seconds: metrics.stoppedSec,
      avg_sog_kn: round(metrics.avgSogKn),
      max_sog_kn: round(metrics.maxSogKn),
      start_gap_nm: round(gaps.startGapNm),
      end_gap_nm: round(gaps.endGapNm),
      match_confidence: segment.confidence,
      stops: metrics.stops.map((stop) => {
        const landmark = labelStop(stop, chain);
        return {
          startedAt: iso(stop.startAt),
          endedAt: iso(stop.endAt),
          durationSec: stop.durationSec,
          lat: Number(stop.lat.toFixed(5)),
          lng: Number(stop.lng.toFixed(5)),
          waypointId: landmark?.waypointId ?? null,
          name: landmark?.name ?? null,
        };
      }),
      extras: Object.fromEntries(
        Object.entries(metrics.extras).map(([key, stat]) => [key, { min: round(stat.min), avg: round(stat.avg), max: round(stat.max) }])
      ),
      geometry: simplifyRange(track.points, stops, segment.startIdx, segment.endIdx) as unknown as TrackSegmentInsert["geometry"],
      speed_profile: buildSpeedProfile(track.points, stops, segment.startIdx, segment.endIdx) as unknown as TrackSegmentInsert["speed_profile"],
    };
  });
}
