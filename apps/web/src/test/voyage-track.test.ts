import { describe, expect, it } from "vitest";

import { parseGpx, GpxParseError } from "@/lib/voyage-track-gpx";
import {
  cleanTrack,
  computeRangeMetrics,
  detectStops,
  distanceNm,
  indexAtTime,
  simplifyRange,
  buildSpeedProfile,
} from "@/lib/voyage-track-analysis";
import { buildMatchChain, labelStop, matchTrackToChain, segmentEndGaps } from "@/lib/voyage-track-matching";
import { formatTrackDuration, summarizeTrackSegments, type TrackSegmentRow } from "@/lib/voyage-track-summary";
import {
  addSegment,
  assignLeg,
  buildSegmentRows,
  duplicateLegIndices,
  mergeWithNext,
  segmentsFromProposal,
  segmentsFromSaved,
  setSegmentBounds,
  splitSegment,
  uncoveredRanges,
} from "@/lib/voyage-track-editor";
import { buildParticipantVoyageTicket } from "@/lib/voyage-tickets";

// Real coordinates of "Atlantic Bound!" (see the live DB).
const BARI = { lat: 41.1305, lng: 16.8686 };
const OTRANTO = { lat: 40.14654, lng: 18.49627 };
const SMDL = { lat: 39.7946, lng: 18.3543 };
const CROTONE = { lat: 39.0738, lng: 17.135 };

interface SimPoint {
  lat: number;
  lng: number;
  t: number;
  speed?: number;
}

const T0 = Date.parse("2026-09-15T11:20:00Z");

/** Straight sail from a to b at `kn`, one fix every `stepSec`. */
function sail(from: { lat: number; lng: number }, to: { lat: number; lng: number }, startMs: number, kn: number, stepSec = 30): SimPoint[] {
  const nm = distanceNm(from, to);
  const seconds = (nm / kn) * 3600;
  const steps = Math.max(1, Math.round(seconds / stepSec));
  const out: SimPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const f = i / steps;
    out.push({
      lat: from.lat + (to.lat - from.lat) * f,
      lng: from.lng + (to.lng - from.lng) * f,
      t: startMs + (i * seconds * 1000) / steps,
      speed: kn * 0.514444,
    });
  }
  return out;
}

/** Anchor swing: wandering ~40 m around a point for `minutes`. */
function anchor(at: { lat: number; lng: number }, startMs: number, minutes: number, stepSec = 30): SimPoint[] {
  const out: SimPoint[] = [];
  for (let s = stepSec; s <= minutes * 60; s += stepSec) {
    const angle = (s / 600) * Math.PI;
    out.push({ lat: at.lat + 0.0004 * Math.sin(angle), lng: at.lng + 0.0004 * Math.cos(angle * 1.3), t: startMs + s * 1000, speed: 0.2 });
  }
  return out;
}

function toGpx(segments: SimPoint[][], opts: { speedTag?: "speed-ms" | "gpxtpx-kn" | "none"; extras?: boolean } = {}): string {
  const { speedTag = "speed-ms", extras = false } = opts;
  const pts = (segment: SimPoint[]) =>
    segment
      .map((p) => {
        const ext: string[] = [];
        if (speedTag === "gpxtpx-kn" && p.speed !== undefined) ext.push(`<gpxtpx:speed>${(p.speed / 0.514444).toFixed(2)}</gpxtpx:speed>`);
        if (extras) ext.push(`<gpxtpx:depth>${(40 + Math.sin(p.t / 1e6) * 10).toFixed(1)}</gpxtpx:depth><gpxtpx:wtemp>24.5</gpxtpx:wtemp>`);
        return `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><ele>0</ele><time>${new Date(p.t).toISOString()}</time>${
          speedTag === "speed-ms" && p.speed !== undefined ? `<speed>${p.speed.toFixed(3)}</speed>` : ""
        }${ext.length ? `<extensions><gpxtpx:TrackPointExtension>${ext.join("")}</gpxtpx:TrackPointExtension></extensions>` : ""}</trkpt>`;
      })
      .join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="TestPlotter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><metadata><name>Leg test</name></metadata><trk><name>t</name>${segments
    .map((s) => `<trkseg>${pts(s)}</trkseg>`)
    .join("")}</trk></gpx>`;
}

/**
 * Bari → Otranto (stop 4h30) → past SMdL without stopping → Crotone (anchor 3h).
 * Recording starts 1.5 nm after leaving Bari, like "I start recording a bit after casting off".
 */
function atlanticBoundRecording(): SimPoint[] {
  const start = { lat: BARI.lat - 0.02, lng: BARI.lng + 0.015 };
  let t = T0;
  const out: SimPoint[] = [{ ...start, t, speed: 3 }];
  const leg1 = sail(start, OTRANTO, t, 6);
  out.push(...leg1);
  t = leg1[leg1.length - 1].t;
  const stop1 = anchor(OTRANTO, t, 270);
  out.push(...stop1);
  t = stop1[stop1.length - 1].t;
  const offLeuca = { lat: SMDL.lat - 0.01, lng: SMDL.lng + 0.01 }; // ~0.7 nm off the pin
  const leg2 = sail(OTRANTO, offLeuca, t, 6.5);
  out.push(...leg2);
  t = leg2[leg2.length - 1].t;
  const leg3 = sail(offLeuca, CROTONE, t, 5.5);
  out.push(...leg3);
  t = leg3[leg3.length - 1].t;
  out.push(...anchor(CROTONE, t, 180));
  return out;
}

const waypoints = [
  { id: "bari", name: "Bari", ...BARI, sort_order: 0, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "planned" },
  { id: "tech1", name: "t", lat: 40.6, lng: 17.9, sort_order: 1, waypoint_type: "technical", visibility_mode: "auto", actual_status: "planned" },
  { id: "otranto", name: "Otranto", ...OTRANTO, sort_order: 2, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "added" },
  { id: "smdl", name: "Santa Maria di Leuca", ...SMDL, sort_order: 3, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "skipped" },
  { id: "crotone", name: "Crotone", ...CROTONE, sort_order: 4, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "planned" },
];
const legs = [
  { id: "leg-bari-smdl", from_waypoint_id: "bari", to_waypoint_id: "smdl", sort_order: 0, planned_nautical_miles: 105.78 },
  { id: "leg-smdl-crotone", from_waypoint_id: "smdl", to_waypoint_id: "crotone", sort_order: 1, planned_nautical_miles: 71.21 },
];

describe("parseGpx", () => {
  it("reads time, speed, elevation and every numeric extension", () => {
    const parsed = parseGpx(toGpx([sail(BARI, OTRANTO, T0, 6).slice(0, 20)], { speedTag: "gpxtpx-kn", extras: true }));
    expect(parsed.creator).toBe("TestPlotter");
    expect(parsed.name).toBe("Leg test");
    expect(parsed.source).toBe("track");
    expect(parsed.timezone).toBe("explicit");
    expect(parsed.fields).toMatchObject({ time: true, speed: true, elevation: true });
    expect(parsed.fields.extras).toEqual(["depth", "wtemp"]);
    expect(parsed.segments[0][0].extras).toMatchObject({ wtemp: 24.5 });
  });

  it("flags timestamps without zone and falls back to <rte>", () => {
    const xml = `<gpx version="1.1"><rte><rtept lat="41" lon="16"><time>2026-09-15T11:00:00</time></rtept><rtept lat="41.1" lon="16.1"><time>2026-09-15T11:10:00</time></rtept></rte></gpx>`;
    const parsed = parseGpx(xml);
    expect(parsed.source).toBe("route");
    expect(parsed.timezone).toBe("assumed-utc");
    expect(parsed.segments[0][0].t).toBe(Date.parse("2026-09-15T11:00:00Z"));
  });

  it("rejects non-GPX input and (0,0) no-fix points", () => {
    expect(() => parseGpx("<kml></kml>")).toThrow(GpxParseError);
    const parsed = parseGpx(`<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="41" lon="16"/></trkseg></trk></gpx>`);
    expect(parsed.pointCount).toBe(1);
  });
});

describe("cleanTrack", () => {
  it("detects the unit of recorded speed (m/s vs knots)", () => {
    const pts = sail(BARI, OTRANTO, T0, 6).slice(0, 200);
    const ms = cleanTrack(parseGpx(toGpx([pts], { speedTag: "speed-ms" })));
    const kn = cleanTrack(parseGpx(toGpx([pts], { speedTag: "gpxtpx-kn" })));
    expect(ms.recordedSpeedUnit).toBe("m/s");
    expect(kn.recordedSpeedUnit).toBe("kn");
    expect(ms.points[100].sogKn).toBeCloseTo(6, 1);
    expect(kn.points[100].sogKn).toBeCloseTo(6, 1);
  });

  it("derives speed when the file has none, and drops single-fix GPS spikes", () => {
    const pts = sail(BARI, OTRANTO, T0, 6).slice(0, 100);
    pts[50] = { ...pts[50], lat: pts[50].lat + 0.5 }; // 30 nm jump in 30 s
    const clean = cleanTrack(parseGpx(toGpx([pts], { speedTag: "none" })));
    expect(clean.speedSource).toBe("derived");
    expect(clean.quality.droppedSpikes).toBe(1);
    expect(clean.points[60].sogKn).toBeCloseTo(6, 0);
  });

  it("marks trkseg splits and long silences as breaks", () => {
    const a = sail(BARI, OTRANTO, T0, 6).slice(0, 20);
    const b = sail(BARI, OTRANTO, T0, 6).slice(20, 40).map((p) => ({ ...p, t: p.t + 3_600_000 }));
    const clean = cleanTrack(parseGpx(toGpx([a, b])));
    expect(clean.quality.breaks).toBe(1);
    expect(clean.points[20].breakBefore).toBe(true);
  });
});

describe("stops and metrics", () => {
  const clean = cleanTrack(parseGpx(toGpx([atlanticBoundRecording()])));
  const stops = detectStops(clean.points);

  it("finds the Otranto and Crotone stops but not the pass off Leuca", () => {
    expect(stops).toHaveLength(2);
    expect(distanceNm(stops[0], OTRANTO)).toBeLessThan(0.1);
    expect(stops[0].durationSec).toBeGreaterThan(4 * 3600);
    expect(distanceNm(stops[1], CROTONE)).toBeLessThan(0.1);
  });

  it("does not count anchor swing as sailed miles", () => {
    const [otranto] = stops;
    const m = computeRangeMetrics(clean.points, stops, otranto.startIdx, otranto.endIdx);
    expect(m.distanceNm).toBeLessThan(0.05);
    expect(m.movingSec).toBe(0);
  });

  it("computes distance, times and speeds over a range", () => {
    const m = computeRangeMetrics(clean.points, stops, 0, stops[0].startIdx);
    const expected = distanceNm(clean.points[0], OTRANTO);
    expect(m.distanceNm).toBeCloseTo(expected, 0);
    expect(m.avgSogKn).toBeCloseTo(6, 0);
    expect(m.maxSogKn).toBeCloseTo(6, 0);
  });

  it("simplifies geometry and collapses stops to one point", () => {
    const g = simplifyRange(clean.points, stops, 0, clean.points.length - 1, 200);
    expect(g.c.length).toBeLessThanOrEqual(210);
    expect(g.c.length).toBe(g.t.length);
    const profile = buildSpeedProfile(clean.points, stops, 0, clean.points.length - 1, 100);
    expect(profile.length).toBeLessThanOrEqual(100);
    expect(profile.some((s) => s.s === 0)).toBe(true);
  });

  it("maps stored timestamps back to indices", () => {
    const idx = 1234;
    expect(indexAtTime(clean.points, clean.points[idx].t! + 1000)).toBe(idx);
  });
});

describe("matchTrackToChain", () => {
  const chain = buildMatchChain(waypoints, legs);
  const clean = cleanTrack(parseGpx(toGpx([atlanticBoundRecording()])));
  const stops = detectStops(clean.points);

  it("builds boundaries from the bookable legs, landmarks from every real stop", () => {
    expect(chain.boundaries.map((b) => b.waypointId)).toEqual(["bari", "smdl", "crotone"]);
    expect(chain.legs.map((l) => l.fromBoundary)).toEqual([0, 1]);
    expect(chain.landmarks.map((l) => l.waypointId)).toContain("otranto");
  });

  it("cuts a multi-leg recording at the pass off the skipped stop and the arrival stop", () => {
    const { segments, hits } = matchTrackToChain(clean.points, stops, chain);
    expect(hits.map((h) => [chain.boundaries[h.boundary].waypointId, h.kind])).toEqual([
      ["bari", "trackStart"],
      ["smdl", "pass"],
      ["crotone", "stop"],
    ]);
    expect(segments.map((s) => s.legIndex)).toEqual([0, 1]);
    const [first, second] = segments;
    expect(first.startIdx).toBe(0);
    expect(distanceNm(clean.points[first.endIdx], SMDL)).toBeLessThan(1);
    expect(second.startIdx).toBe(first.endIdx);
    expect(second.endIdx).toBe(stops[1].startIdx);
    expect(second.confidence).toBe("high");

    // The Otranto stop is inside leg 1 and gets its real name.
    const inner = computeRangeMetrics(clean.points, stops, first.startIdx, first.endIdx);
    expect(inner.stops).toHaveLength(1);
    expect(labelStop(inner.stops[0], chain)?.waypointId).toBe("otranto");

    // Recording started ~1.5 nm out of Bari: reported, not hidden.
    const gaps = segmentEndGaps(clean.points, chain, first);
    expect(gaps.startGapNm).toBeGreaterThan(1);
    expect(gaps.startGapNm).toBeLessThan(2);
  });

  it("a recording that starts mid-leg becomes a partial segment of that leg", () => {
    const all = atlanticBoundRecording();
    const fromMid = all.slice(Math.floor(all.length * 0.62));
    const c = cleanTrack(parseGpx(toGpx([fromMid])));
    const s = detectStops(c.points);
    const { segments } = matchTrackToChain(c.points, s, chain);
    expect(segments).toHaveLength(1);
    expect(segments[0].legIndex).toBe(1);
    expect(segmentEndGaps(c.points, chain, segments[0]).startGapNm).toBeGreaterThan(5);
  });

  it("uses the alias of a skipped stop (Messina → Reggio Calabria)", () => {
    const aliasChain = buildMatchChain(
      [
        { id: "a", name: "A", lat: 38.32, lng: 16.4, sort_order: 0, waypoint_type: "narrative", visibility_mode: "manual" },
        { id: "reggio", name: "Reggio", lat: 38.1105, lng: 15.6448, sort_order: 1, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "added" },
        { id: "messina", name: "Messina", lat: 38.193, lng: 15.5592, sort_order: 2, waypoint_type: "narrative", visibility_mode: "manual", actual_status: "skipped", alias_of_waypoint_id: "reggio" },
      ],
      [{ id: "l", from_waypoint_id: "a", to_waypoint_id: "messina", sort_order: 0 }]
    );
    expect(aliasChain.boundaries[1].positions.map((p) => p.waypointId).sort()).toEqual(["messina", "reggio"]);
  });

  it("uses programming actuals to break ties between two visits of the same port", () => {
    const chain2 = buildMatchChain(waypoints, legs);
    chain2.boundaries[2].arrivalHint = Date.parse("2030-01-01T00:00:00Z"); // wildly off
    const { hits } = matchTrackToChain(clean.points, stops, chain2);
    const crotone = hits.find((h) => h.boundary === 2);
    expect(crotone?.timeOffsetHours).toBeGreaterThan(24);
  });

  it("returns one unassigned segment when nothing is near the voyage", () => {
    const far = cleanTrack(parseGpx(toGpx([sail({ lat: 10, lng: 10 }, { lat: 10.5, lng: 10.5 }, T0, 6)])));
    const { segments } = matchTrackToChain(far.points, [], chain);
    expect(segments).toEqual([expect.objectContaining({ legIndex: null, confidence: "low" })]);
  });

  it("builds a chain from narrative stops when the voyage has no bookable legs", () => {
    const historical = buildMatchChain(waypoints, []);
    expect(historical.legs.map((l) => `${l.fromWaypointId}>${l.toWaypointId}`)).toEqual(["bari>otranto", "otranto>crotone"]);
  });
});

describe("summarizeTrackSegments", () => {
  const row = (over: Partial<TrackSegmentRow>): TrackSegmentRow => ({
    id: "s",
    track_id: "t",
    voyage_id: "v",
    leg_id: "leg",
    from_waypoint_id: "a",
    to_waypoint_id: "b",
    started_at: "2026-09-15T11:00:00Z",
    ended_at: "2026-09-15T15:00:00Z",
    distance_nm: "20.00",
    elapsed_seconds: 14400,
    moving_seconds: 14400,
    stopped_seconds: 0,
    avg_sog_kn: "5",
    max_sog_kn: "7.2",
    start_gap_nm: "0.3",
    end_gap_nm: "0",
    stops: [],
    extras: {},
    geometry: { c: [[16, 41], [16.1, 41.1]], t: [], s: [], b: [] },
    speed_profile: [],
    ...over,
  });

  it("aggregates two recordings of the same leg and flags partial coverage", () => {
    const summary = summarizeTrackSegments([
      row({ id: "1" }),
      row({ id: "2", started_at: "2026-09-15T17:00:00Z", ended_at: "2026-09-15T19:00:00Z", distance_nm: 10, moving_seconds: 7200, max_sog_kn: 8, end_gap_nm: 4 }),
    ]).get("leg")!;
    expect(summary.segmentCount).toBe(2);
    expect(summary.recordedNm).toBe(30);
    expect(summary.estimatedNm).toBeCloseTo(34.3);
    expect(summary.coverage).toBe("partial");
    expect(summary.maxSogKn).toBe(8);
    expect(summary.avgSogKn).toBe(5);
    expect(summary.elapsedSec).toBe(8 * 3600);
  });

  it("formats durations in both languages", () => {
    expect(formatTrackDuration(3 * 3600 + 25 * 60, "it")).toBe("3h 25m");
    expect(formatTrackDuration(28 * 3600, "it")).toBe("1g 4h");
    expect(formatTrackDuration(28 * 3600, "en")).toBe("1d 4h");
  });
});

describe("editor operations and saved rows", () => {
  const chain = buildMatchChain(waypoints, legs);
  const clean = cleanTrack(parseGpx(toGpx([atlanticBoundRecording()])));
  const stops = detectStops(clean.points);
  const initial = segmentsFromProposal(matchTrackToChain(clean.points, stops, chain).segments);

  it("splits, merges, reassigns and clamps without overlaps", () => {
    const [first] = initial;
    const mid = Math.floor((first.startIdx + first.endIdx) / 2);
    const split = splitSegment(initial, first.uid, mid, chain.legs.length);
    expect(split).toHaveLength(3);
    expect(split[0].endIdx).toBe(mid);
    expect(split[1]).toMatchObject({ startIdx: mid, legIndex: 1, confidence: "manual" });
    const merged = mergeWithNext(split, split[0].uid);
    expect(merged).toHaveLength(2);
    expect(merged[0].endIdx).toBe(split[1].endIdx);
    // Cannot be stretched over the next segment.
    const clamped = setSegmentBounds(initial, first.uid, 0, clean.points.length, clean.points.length);
    expect(clamped[0].endIdx).toBe(initial[1].startIdx);
    expect(assignLeg(initial, first.uid, null)[0].legIndex).toBeNull();
    expect(duplicateLegIndices(assignLeg(initial, initial[1].uid, 0)).has(0)).toBe(true);
  });

  it("lists uncovered stretches (port time after the arrival)", () => {
    const gaps = uncoveredRanges(initial, clean.points.length);
    expect(gaps).toEqual([{ startIdx: initial[1].endIdx, endIdx: clean.points.length - 1 }]);
    expect(addSegment(initial, gaps[0].startIdx, gaps[0].endIdx, null)).toHaveLength(3);
  });

  it("builds rows with timestamps as authority and restores them from a re-parsed file", () => {
    const rows = buildSegmentRows({ track: clean, stops, chain, segments: initial, trackId: "t1", voyageId: "v1" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ leg_id: "leg-bari-smdl", from_waypoint_id: "bari", to_waypoint_id: "smdl", sort_order: 0 });
    expect(Number(rows[0].distance_nm)).toBeGreaterThan(60);
    expect((rows[0].stops as { name: string | null }[])[0].name).toBe("Otranto");
    expect(Number(rows[0].start_gap_nm)).toBeGreaterThan(1);
    const restored = segmentsFromSaved(
      rows.map((r) => ({ ...r, start_point_index: null, end_point_index: null, match_confidence: String(r.match_confidence) })) as never,
      clean,
      chain
    );
    expect(restored.map((s) => [s.legIndex, s.startIdx, s.endIdx])).toEqual(initial.map((s) => [s.legIndex, s.startIdx, s.endIdx]));

    // …and they feed the ticket as measured miles.
    const summaries = summarizeTrackSegments(rows.map((r, i) => ({ ...r, id: String(i) })) as unknown as TrackSegmentRow[]);
    const ticket = buildParticipantVoyageTicket({
      bookingRequestId: "b",
      voyage: { id: "v1", name: "Atlantic Bound!", start_date: null, end_date: null },
      ownLegsSortedByOrder: legs.map((l) => ({
        ...l,
        voyage_id: "v1",
        actual_departure_at: "2026-09-15T11:00:00Z",
        actual_arrival_at: "2026-09-17T12:30:00Z",
      })) as never,
      waypointsById: Object.fromEntries(waypoints.map((w) => [w.id, { ...w, voyage_id: "v1", name_it: null, name_en: null, date_start: null, date_end: null }])) as never,
      lang: "it",
      trackSummaries: summaries,
    })!;
    expect(ticket.milesSource).toBe("track");
    expect(ticket.track?.trackedLegs).toBe(2);
    expect(ticket.track?.actualRuns.length).toBeGreaterThan(0);
    expect(ticket.track?.plannedRoute.length).toBe(4); // bari, tech1, smdl, crotone (Otranto is "added")
    expect(ticket.actualNauticalMiles).toBeGreaterThan(Number(rows[0].distance_nm));
  });
});
