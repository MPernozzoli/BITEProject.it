/**
 * Cleaning, stop detection and metrics for a recorded voyage track.
 *
 * Input is a `ParsedGpx` (voyage-track-gpx.ts); output is a single flat,
 * time-ordered point array (`CleanTrack`) that every other step indexes into:
 * the matcher cuts it into legs, the editor moves the cuts, and
 * `computeRangeMetrics` turns any `[startIdx, endIdx]` into numbers.
 *
 * The cleaning is deterministic, so the same file always yields the same
 * indices; the database still stores cut *timestamps* as the authority, so a
 * future change to these thresholds cannot silently shift a confirmed cut.
 *
 * Three decisions carry the credibility of the numbers:
 * - **Stops are spatial, not a speed threshold.** A boat at anchor swings on
 *   its chain and the GPS wanders: with a speed threshold that noise becomes
 *   miles "sailed" all night. A stop here is "stayed within `radiusM` for at
 *   least `minMinutes`", and distance inside a stop is not counted.
 * - **Spikes are dropped only when both sides are impossible**, so a genuine
 *   fast stretch after a gap is not eaten.
 * - **Recorded speed is trusted only after its unit is identified** against
 *   the speed derived from positions/time (GPX says m/s; apps write knots or
 *   km/h too). If it matches nothing, the derived speed is used instead.
 */
import type { GpxPoint, ParsedGpx } from "@/lib/voyage-track-gpx";

export const METERS_PER_NM = 1852;
const MS_TO_KN = 3600 / METERS_PER_NM;

export interface TrackPoint {
  /** Epoch ms, null when the file has no time. */
  t: number | null;
  lat: number;
  lng: number;
  /** Speed over ground in knots: recorded (unit-corrected) or derived. */
  sogKn: number | null;
  cogDeg: number | null;
  ele: number | null;
  extras: Record<string, number> | null;
  /** True when the recording was interrupted right before this point (new trkseg or time gap). */
  breakBefore: boolean;
}

export type SpeedUnit = "m/s" | "kn" | "km/h";

export interface CleanTrack {
  points: TrackPoint[];
  hasTime: boolean;
  speedSource: "recorded" | "derived" | "none";
  /** Unit detected for the recorded speed; null when the file has none or it was rejected. */
  recordedSpeedUnit: SpeedUnit | null;
  extrasKeys: string[];
  quality: {
    inputPoints: number;
    keptPoints: number;
    droppedDuplicates: number;
    droppedSpikes: number;
    /** Interruptions inside the file: segment breaks plus time gaps. */
    breaks: number;
    /** Seconds spent inside those interruptions. */
    breakSeconds: number;
  };
}

export interface CleanOptions {
  /** Anything faster is a GPS spike, not a sailing boat. */
  maxSpeedKn?: number;
  /** A silence longer than this is a recording break. */
  gapMinutes?: number;
}

export interface TrackStop {
  startIdx: number;
  endIdx: number;
  startAt: number | null;
  endAt: number | null;
  lat: number;
  lng: number;
  durationSec: number;
}

export interface StopOptions {
  radiusM?: number;
  minMinutes?: number;
}

const DEFAULT_CLEAN: Required<CleanOptions> = { maxSpeedKn: 35, gapMinutes: 10 };
const DEFAULT_STOPS: Required<StopOptions> = { radiusM: 300, minMinutes: 20 };

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const distanceNm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  distanceM(a, b) / METERS_PER_NM;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

interface RawPoint extends GpxPoint {
  breakBefore: boolean;
}

/** Drops points whose implied speed is impossible on both sides (single-point GPS jumps). */
function removeSpikes(points: RawPoint[], maxSpeedKn: number): { kept: RawPoint[]; dropped: number } {
  const maxMs = maxSpeedKn / MS_TO_KN;
  let current = points;
  let dropped = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const implied = (a: RawPoint, b: RawPoint) => {
      if (a.t === null || b.t === null) return 0;
      const dt = (b.t - a.t) / 1000;
      const d = distanceM(a, b);
      if (dt <= 0) return d > 50 ? Infinity : 0;
      return d / dt;
    };
    const next: RawPoint[] = [];
    let changed = false;
    for (let i = 0; i < current.length; i += 1) {
      const prev = next.length ? next[next.length - 1] : null;
      const following = current[i + 1] ?? null;
      const inTooFast = prev ? implied(prev, current[i]) > maxMs : false;
      const outTooFast = following ? implied(current[i], following) > maxMs : false;
      const isSpike = prev && following ? inTooFast && outTooFast : !prev ? outTooFast && current.length > 2 && implied(current[i + 1], current[i + 2]) <= maxMs : inTooFast;
      if (isSpike) {
        dropped += 1;
        changed = true;
        // Keep the break marker: a dropped first point of a segment must not glue two recordings together.
        if (current[i].breakBefore && following) current[i + 1] = { ...following, breakBefore: true };
        continue;
      }
      next.push(current[i]);
    }
    current = next;
    if (!changed) break;
  }
  return { kept: current, dropped };
}

/** Straight-line speed over a ~60 s window centred on each point, within one recording run. */
function deriveSpeeds(points: TrackPoint[]): (number | null)[] {
  const result: (number | null)[] = new Array(points.length).fill(null);
  const halfWindowMs = 30_000;
  let runStart = 0;
  for (let i = 0; i <= points.length; i += 1) {
    if (i < points.length && (i === 0 || !points[i].breakBefore)) continue;
    // [runStart, i) is one uninterrupted run.
    let lo = runStart;
    let hi = runStart;
    for (let k = runStart; k < i; k += 1) {
      const t = points[k].t;
      if (t === null) continue;
      while (lo < k && (points[lo].t ?? t) < t - halfWindowMs) lo += 1;
      if (hi < k) hi = k;
      while (hi + 1 < i && (points[hi + 1].t ?? t) <= t + halfWindowMs) hi += 1;
      // Sparse logging (plotters often write every 30–60 s): always reach at least one neighbour per side.
      const a = points[lo === k && k > runStart ? k - 1 : lo];
      const b = points[hi === k && k + 1 < i ? k + 1 : hi];
      if (a.t === null || b.t === null || b.t <= a.t) continue;
      result[k] = (distanceM(a, b) / ((b.t - a.t) / 1000)) * MS_TO_KN;
    }
    runStart = i;
  }
  return result;
}

const UNIT_FACTORS: Record<SpeedUnit, number> = { "m/s": 1, kn: 1 / MS_TO_KN, "km/h": 1 / 3.6 };

function detectRecordedUnit(points: TrackPoint[], raw: (number | null)[], derivedKn: (number | null)[]): SpeedUnit | null {
  const ratios: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const r = raw[i];
    const d = derivedKn[i];
    if (r === null || d === null || d < 1.5 || r <= 0) continue;
    ratios.push(r / (d / MS_TO_KN)); // raw value per m/s of real speed
  }
  if (ratios.length < 10) return null;
  const ratio = median(ratios)!;
  const candidates: [SpeedUnit, number][] = [
    ["m/s", 1],
    ["kn", MS_TO_KN],
    ["km/h", 3.6],
  ];
  const [unit, expected] = candidates.reduce((best, entry) =>
    Math.abs(Math.log(ratio / entry[1])) < Math.abs(Math.log(ratio / best[1])) ? entry : best
  );
  return Math.abs(Math.log(ratio / expected)) < Math.log(1.3) ? unit : null;
}

export function cleanTrack(parsed: ParsedGpx, options: CleanOptions = {}): CleanTrack {
  const opts = { ...DEFAULT_CLEAN, ...options };
  const raw: RawPoint[] = parsed.segments.flatMap((segment, segIndex) =>
    segment.map((point, index) => ({ ...point, breakBefore: segIndex > 0 && index === 0 }))
  );
  const inputPoints = raw.length;
  const hasTime = raw.some((p) => p.t !== null);

  let ordered = raw;
  let droppedDuplicates = 0;
  if (hasTime) {
    const timed = raw.filter((p) => p.t !== null);
    droppedDuplicates += raw.length - timed.length;
    // Stable sort: out-of-order exports (merged files) become chronological.
    ordered = timed
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.t! - b.p.t!) || a.i - b.i)
      .map(({ p }) => p);
    const deduped: RawPoint[] = [];
    for (const p of ordered) {
      const last = deduped[deduped.length - 1];
      if (last && last.t === p.t) {
        droppedDuplicates += 1;
        continue;
      }
      deduped.push(p);
    }
    ordered = deduped;
  }

  const { kept, dropped } = hasTime ? removeSpikes(ordered, opts.maxSpeedKn) : { kept: ordered, dropped: 0 };

  let breaks = 0;
  let breakSeconds = 0;
  const gapMs = opts.gapMinutes * 60_000;
  const points: TrackPoint[] = kept.map((p, i) => {
    const prev = kept[i - 1];
    let breakBefore = i > 0 && p.breakBefore;
    if (prev && p.t !== null && prev.t !== null && p.t - prev.t > gapMs) breakBefore = true;
    if (prev && !hasTime && distanceNm(prev, p) > 2) breakBefore = true;
    if (breakBefore) {
      breaks += 1;
      if (prev?.t != null && p.t !== null) breakSeconds += (p.t - prev.t) / 1000;
    }
    return {
      t: p.t,
      lat: p.lat,
      lng: p.lng,
      sogKn: null,
      cogDeg: p.cogDeg,
      ele: p.ele,
      extras: p.extras,
      breakBefore,
    };
  });

  const derived = hasTime ? deriveSpeeds(points) : points.map(() => null);
  const rawSpeeds = kept.map((p) => p.speedRaw);
  const unit = parsed.fields.speed && hasTime ? detectRecordedUnit(points, rawSpeeds, derived) : null;
  let speedSource: CleanTrack["speedSource"] = hasTime ? "derived" : "none";
  points.forEach((point, i) => {
    const recorded = rawSpeeds[i];
    if (unit && recorded !== null) {
      point.sogKn = recorded * UNIT_FACTORS[unit] * MS_TO_KN;
      speedSource = "recorded";
    } else {
      point.sogKn = derived[i];
    }
  });

  return {
    points,
    hasTime,
    speedSource,
    recordedSpeedUnit: unit,
    extrasKeys: parsed.fields.extras,
    quality: {
      inputPoints,
      keptPoints: points.length,
      droppedDuplicates,
      droppedSpikes: dropped,
      breaks,
      breakSeconds: Math.round(breakSeconds),
    },
  };
}

/**
 * Stops: maximal runs that stay within `radiusM` of their first point for at
 * least `minMinutes`. A recording break whose two sides are that close counts
 * as a stop too — the plotter switched off in port is the most common stop of all.
 */
export function detectStops(points: TrackPoint[], options: StopOptions = {}): TrackStop[] {
  const { radiusM, minMinutes } = { ...DEFAULT_STOPS, ...options };
  const minMs = minMinutes * 60_000;
  const stops: TrackStop[] = [];
  let i = 0;
  while (i < points.length) {
    const anchor = points[i];
    if (anchor.t === null) {
      i += 1;
      continue;
    }
    let j = i;
    let sumLat = anchor.lat;
    let sumLng = anchor.lng;
    while (j + 1 < points.length && distanceM(anchor, points[j + 1]) <= radiusM) {
      j += 1;
      sumLat += points[j].lat;
      sumLng += points[j].lng;
    }
    const end = points[j].t;
    if (end !== null && end - anchor.t >= minMs && j > i) {
      const count = j - i + 1;
      const previous = stops[stops.length - 1];
      const lat = sumLat / count;
      const lng = sumLng / count;
      // An anchor drag can split one night in two runs a few metres apart: glue them.
      if (previous && previous.endIdx === i - 1 && distanceM(previous, { lat, lng }) <= radiusM) {
        previous.endIdx = j;
        previous.endAt = end;
        previous.durationSec = Math.round((end - (previous.startAt ?? anchor.t)) / 1000);
      } else {
        stops.push({
          startIdx: i,
          endIdx: j,
          startAt: anchor.t,
          endAt: end,
          lat,
          lng,
          durationSec: Math.round((end - anchor.t) / 1000),
        });
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return stops;
}

export interface ExtraStat {
  min: number;
  avg: number;
  max: number;
}

export interface RangeMetrics {
  startAt: number | null;
  endAt: number | null;
  elapsedSec: number | null;
  movingSec: number | null;
  stoppedSec: number | null;
  distanceNm: number;
  /** Straight-line miles bridged across recording breaks (included in distanceNm). */
  bridgedNm: number;
  avgSogKn: number | null;
  maxSogKn: number | null;
  /** Stops fully or partly inside the range, clipped to it. */
  stops: TrackStop[];
  extras: Record<string, ExtraStat>;
}

const MIN_STEP_M = 12;

export function computeRangeMetrics(points: TrackPoint[], stops: TrackStop[], startIdx: number, endIdx: number): RangeMetrics {
  const a = Math.max(0, Math.min(startIdx, endIdx));
  const b = Math.min(points.length - 1, Math.max(startIdx, endIdx));
  const inStopInterior = new Uint8Array(points.length);
  const clipped: TrackStop[] = [];
  for (const stop of stops) {
    if (stop.endIdx < a || stop.startIdx > b) continue;
    const s = Math.max(stop.startIdx, a);
    const e = Math.min(stop.endIdx, b);
    // A stop that only touches the range edge (the arrival berth at the cut point) is not inside it.
    if (e <= s) continue;
    for (let k = s + 1; k <= e; k += 1) inStopInterior[k] = 1;
    const startAt = points[s].t;
    const endAt = points[e].t;
    clipped.push({
      ...stop,
      startIdx: s,
      endIdx: e,
      startAt,
      endAt,
      durationSec: startAt !== null && endAt !== null ? Math.round((endAt - startAt) / 1000) : 0,
    });
  }

  let distance = 0;
  let bridged = 0;
  let anchor = points[a];
  for (let k = a + 1; k <= b; k += 1) {
    const p = points[k];
    if (inStopInterior[k]) {
      anchor = p;
      continue;
    }
    const step = distanceM(anchor, p);
    if (p.breakBefore) {
      distance += step;
      bridged += step;
      anchor = p;
      continue;
    }
    if (step >= MIN_STEP_M || k === b) {
      distance += step;
      anchor = p;
    }
  }

  const startAt = points[a]?.t ?? null;
  const endAt = points[b]?.t ?? null;
  const elapsedSec = startAt !== null && endAt !== null ? Math.round((endAt - startAt) / 1000) : null;
  const stoppedSec = clipped.reduce((sum, stop) => sum + stop.durationSec, 0);
  const movingSec = elapsedSec !== null ? Math.max(0, elapsedSec - stoppedSec) : null;
  const distanceNm = distance / METERS_PER_NM;

  // Max speed on a 5-point rolling median: one noisy fix cannot set a record.
  let maxSogKn: number | null = null;
  for (let k = a; k <= b; k += 1) {
    if (inStopInterior[k]) continue;
    const windowValues: number[] = [];
    for (let w = Math.max(a, k - 2); w <= Math.min(b, k + 2); w += 1) {
      const v = points[w].sogKn;
      if (v !== null && !inStopInterior[w]) windowValues.push(v);
    }
    const m = windowValues.length >= 3 ? median(windowValues) : null;
    if (m !== null && (maxSogKn === null || m > maxSogKn)) maxSogKn = m;
  }

  const extrasAcc = new Map<string, { min: number; max: number; sum: number; n: number }>();
  for (let k = a; k <= b; k += 1) {
    const extras = points[k].extras;
    if (!extras) continue;
    for (const [key, value] of Object.entries(extras)) {
      const acc = extrasAcc.get(key) ?? { min: value, max: value, sum: 0, n: 0 };
      acc.min = Math.min(acc.min, value);
      acc.max = Math.max(acc.max, value);
      acc.sum += value;
      acc.n += 1;
      extrasAcc.set(key, acc);
    }
  }
  const extras: Record<string, ExtraStat> = {};
  for (const [key, acc] of extrasAcc) extras[key] = { min: acc.min, max: acc.max, avg: acc.sum / acc.n };

  return {
    startAt,
    endAt,
    elapsedSec,
    movingSec,
    stoppedSec: elapsedSec !== null ? stoppedSec : null,
    distanceNm,
    bridgedNm: bridged / METERS_PER_NM,
    avgSogKn: movingSec && movingSec > 0 ? distanceNm / (movingSec / 3600) : null,
    maxSogKn,
    stops: clipped,
    extras,
  };
}

/** Compact geometry stored on a segment: parallel arrays, breaks as start indices. */
export interface TrackGeometry {
  /** [lng, lat] like GeoJSON. */
  c: [number, number][];
  /** Epoch seconds per vertex (null without time). */
  t: (number | null)[];
  /** Knots per vertex, one decimal. */
  s: (number | null)[];
  /** Vertex indices where a recording break starts: draw no line into them. */
  b: number[];
}

function douglasPeucker(xy: [number, number][], tolerance: number): boolean[] {
  const keep = new Array(xy.length).fill(false);
  if (xy.length <= 2) return keep.fill(true);
  keep[0] = true;
  keep[xy.length - 1] = true;
  const stack: [number, number][] = [[0, xy.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = xy[s];
    const [x2, y2] = xy[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i += 1) {
      const [px, py] = xy[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - x1, py - y1);
      else {
        const u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
        d = Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
      }
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tolerance && maxI > 0) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return keep;
}

/**
 * Simplified geometry of `[startIdx, endIdx]`. Stop interiors collapse to their
 * centroid (a night at anchor is one dot, not a scribble), breaks are preserved,
 * and the tolerance grows until the vertex budget is met.
 */
export function simplifyRange(
  points: TrackPoint[],
  stops: TrackStop[],
  startIdx: number,
  endIdx: number,
  maxVertices = 600
): TrackGeometry {
  const a = Math.max(0, Math.min(startIdx, endIdx));
  const b = Math.min(points.length - 1, Math.max(startIdx, endIdx));
  const source: (TrackPoint & { forceKeep: boolean })[] = [];
  let k = a;
  while (k <= b) {
    const stop = stops.find((s) => s.startIdx <= k && s.endIdx > k && s.endIdx - s.startIdx > 1);
    if (stop) {
      const e = Math.min(stop.endIdx, b);
      source.push({ ...points[k], lat: stop.lat, lng: stop.lng, sogKn: 0, forceKeep: true });
      source.push({ ...points[e], lat: stop.lat, lng: stop.lng, sogKn: 0, forceKeep: true, breakBefore: false });
      k = e + 1;
      continue;
    }
    source.push({ ...points[k], forceKeep: points[k].breakBefore || (k > a && points[k - 1]?.breakBefore) || false });
    k += 1;
  }
  if (!source.length) return { c: [], t: [], s: [], b: [] };

  const lat0 = toRad(source[0].lat);
  const xy: [number, number][] = source.map((p) => [toRad(p.lng) * Math.cos(lat0) * 6371008.8, toRad(p.lat) * 6371008.8]);
  let tolerance = 15;
  let keep = douglasPeucker(xy, tolerance);
  const count = () => keep.reduce((n, flag, i) => n + (flag || source[i].forceKeep ? 1 : 0), 0);
  while (count() > maxVertices && tolerance < 20_000) {
    tolerance *= 1.6;
    keep = douglasPeucker(xy, tolerance);
  }

  const geometry: TrackGeometry = { c: [], t: [], s: [], b: [] };
  let pendingBreak = false;
  source.forEach((p, i) => {
    if (p.breakBefore) pendingBreak = true;
    if (!(keep[i] || p.forceKeep)) return;
    if (pendingBreak && geometry.c.length) geometry.b.push(geometry.c.length);
    pendingBreak = false;
    geometry.c.push([Number(p.lng.toFixed(5)), Number(p.lat.toFixed(5))]);
    geometry.t.push(p.t !== null ? Math.round(p.t / 1000) : null);
    geometry.s.push(p.sogKn !== null ? Math.round(p.sogKn * 10) / 10 : null);
  });
  return geometry;
}

export interface SpeedSample {
  /** Epoch seconds, bin centre. */
  t: number;
  /** Mean knots in the bin; 0 inside stops. */
  s: number;
}

/** Time-binned speed profile for charts: at most `maxSamples` bins over the range. */
export function buildSpeedProfile(
  points: TrackPoint[],
  stops: TrackStop[],
  startIdx: number,
  endIdx: number,
  maxSamples = 240
): SpeedSample[] {
  const a = Math.max(0, Math.min(startIdx, endIdx));
  const b = Math.min(points.length - 1, Math.max(startIdx, endIdx));
  const t0 = points[a]?.t;
  const t1 = points[b]?.t;
  if (t0 == null || t1 == null || t1 <= t0) return [];
  const binMs = Math.max(60_000, Math.ceil((t1 - t0) / maxSamples));
  const bins = Math.ceil((t1 - t0) / binMs) || 1;
  const sums = new Array(bins).fill(0);
  const counts = new Array(bins).fill(0);
  for (let k = a; k <= b; k += 1) {
    const p = points[k];
    if (p.t === null || p.sogKn === null) continue;
    const inStop = stops.some((s) => s.startIdx < k && k <= s.endIdx);
    const bin = Math.min(bins - 1, Math.floor((p.t - t0) / binMs));
    sums[bin] += inStop ? 0 : p.sogKn;
    counts[bin] += 1;
  }
  const samples: SpeedSample[] = [];
  for (let i = 0; i < bins; i += 1) {
    if (!counts[i]) continue;
    samples.push({ t: Math.round((t0 + (i + 0.5) * binMs) / 1000), s: Math.round((sums[i] / counts[i]) * 10) / 10 });
  }
  return samples;
}

/** Index of the point closest in time; used to map stored cut timestamps back onto a re-parsed file. */
export function indexAtTime(points: TrackPoint[], epochMs: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((points[mid].t ?? -Infinity) < epochMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((points[lo - 1].t ?? 0) - epochMs) < Math.abs((points[lo].t ?? 0) - epochMs)) return lo - 1;
  return lo;
}

/** Index of the point closest in space; used by "cut here" clicks on the editor map. */
export function nearestPointIndex(points: TrackPoint[], target: { lat: number; lng: number }, from = 0, to = points.length - 1): number {
  let best = -1;
  let bestD = Infinity;
  for (let k = Math.max(0, from); k <= Math.min(points.length - 1, to); k += 1) {
    const d = distanceM(points[k], target);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
