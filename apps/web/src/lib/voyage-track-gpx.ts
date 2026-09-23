/**
 * GPX parser for recorded voyage tracks (plotter / phone exports).
 *
 * Reads everything a GPX can carry, not only the path:
 * - `<trk>/<trkseg>/<trkpt>` (the recording) — each `<trkseg>` kept separate,
 *   because a segment break is the recorder saying "I stopped here";
 * - `<rte>/<rtept>` as a fallback when a file has no track (some apps export
 *   the recording as a route);
 * - per point: `<time>`, `<ele>`, GPX 1.0 `<speed>`/`<course>`, fix quality
 *   (`<sat>`, `<hdop>`), and **every numeric leaf inside `<extensions>`**
 *   (Garmin TrackPointExtension `speed`/`course`/`depth`/`wtemp`/`atemp`,
 *   OpenCPN, Navionics, Raymarine…). Known names are normalised to
 *   `sogKn`/`cogDeg`; anything else lands in `extras` under its local name, so
 *   a file that carries depth or water temperature is exploited without a
 *   parser change.
 *
 * Speed units are not standard across apps (GPX says m/s, some write knots or
 * km/h). The raw value is kept here; `voyage-track-analysis.ts` detects the
 * unit by comparing it with the speed derived from positions and time.
 *
 * Pure and dependency-free (its own linear XML tokenizer), so it runs
 * identically in any browser, under jsdom and in Deno.
 */

export interface GpxPoint {
  /** Epoch milliseconds; null when the file has no timestamp for the point. */
  t: number | null;
  lat: number;
  lng: number;
  ele: number | null;
  /** Raw recorded speed, unit unknown until analysis (GPX standard is m/s). */
  speedRaw: number | null;
  cogDeg: number | null;
  hdop: number | null;
  sat: number | null;
  /** Other numeric extension values, keyed by lower-cased local element name. */
  extras: Record<string, number> | null;
}

export interface GpxMarker {
  lat: number;
  lng: number;
  name: string | null;
  t: number | null;
}

export type GpxTimezoneMode =
  /** Every timestamp carried an explicit `Z` or offset. */
  | "explicit"
  /** At least one timestamp had no zone: read as UTC, which is what GPX mandates. */
  | "assumed-utc"
  /** No timestamps at all. */
  | "none";

export interface ParsedGpx {
  creator: string | null;
  name: string | null;
  description: string | null;
  /** One array per `<trkseg>` (or per `<rte>` when there is no track). */
  segments: GpxPoint[][];
  /** `<wpt>` marks saved on the plotter, useful as hints but never authoritative. */
  markers: GpxMarker[];
  source: "track" | "route";
  timezone: GpxTimezoneMode;
  /** What the file actually carries, to show the admin and to decide what to compute. */
  fields: {
    time: boolean;
    elevation: boolean;
    speed: boolean;
    course: boolean;
    hdop: boolean;
    sat: boolean;
    extras: string[];
  };
  pointCount: number;
}

export class GpxParseError extends Error {}

/** Extension element names that mean speed over ground / course over ground. */
const SPEED_NAMES = new Set(["speed", "sog", "speedoverground", "gpsspeed"]);
const COURSE_NAMES = new Set(["course", "cog", "courseoverground", "bearing"]);
/** Structural wrappers whose own name is not a measure (their children are). */
const WRAPPER_NAMES = new Set(["trackpointextension", "trackextension", "extensions", "gpxtpx", "gpxx"]);

const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Minimal XML tree. DOMParser is quadratic on large files under jsdom and its
 * speed varies across browsers; a plotter export easily has 100k points, so
 * the file is tokenised here in one linear pass instead. GPX needs no more
 * than elements, attributes and text.
 */
interface XmlNode {
  /** Local name, lower-cased (namespace prefixes dropped: `gpxtpx:speed` → `speed`). */
  localName: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (value: string) =>
  value.includes("&")
    ? value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
        if (code[0] === "#") {
          const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : match;
        }
        return ENTITIES[code.toLowerCase()] ?? match;
      })
    : value;

const localNameOf = (qualified: string) => {
  const colon = qualified.indexOf(":");
  return (colon >= 0 ? qualified.slice(colon + 1) : qualified).toLowerCase();
};

const ATTR_RE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/gi;

function parseXml(xml: string): XmlNode | null {
  const root: XmlNode = { localName: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(xml))) {
    const [, cdata, closing, name, rawAttrs, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined || cdata !== undefined) {
      top.text += cdata !== undefined ? cdata : decodeEntities(text);
      continue;
    }
    if (!name) continue; // comment, processing instruction, doctype
    const localName = localNameOf(name);
    if (closing) {
      // Tolerate sloppy exports: pop up to the matching element if it is open.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].localName === localName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    if (rawAttrs) {
      ATTR_RE.lastIndex = 0;
      let attr: RegExpExecArray | null;
      while ((attr = ATTR_RE.exec(rawAttrs))) attrs[localNameOf(attr[1])] = decodeEntities(attr[3] ?? attr[4] ?? "");
    }
    const node: XmlNode = { localName, attrs, children: [], text: "" };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children.find((child) => child.localName !== "#text") ?? null;
}

const childrenByLocalName = (parent: XmlNode, localName: string): XmlNode[] =>
  parent.children.filter((child) => child.localName === localName);

const firstChildText = (parent: XmlNode, localName: string): string | null => {
  for (const child of parent.children) if (child.localName === localName) return child.text;
  return null;
};

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

const parseTime = (value: string | null, zoneTracker: { missing: boolean }): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let iso = trimmed;
  if (!HAS_ZONE.test(trimmed)) {
    zoneTracker.missing = true;
    iso = `${trimmed}Z`;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const collectExtensionLeaves = (element: XmlNode, out: Map<string, number>) => {
  for (const child of element.children) {
    if (child.children.length > 0) {
      collectExtensionLeaves(child, out);
      continue;
    }
    const name = child.localName;
    if (WRAPPER_NAMES.has(name)) continue;
    const value = toNumber(child.text);
    if (value === null) continue;
    if (!out.has(name)) out.set(name, value);
  }
};

const isValidCoordinate = (lat: number | null, lng: number | null): lat is number =>
  lat !== null &&
  lng !== null &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  // (0,0) is the classic "no fix yet" value written by recorders.
  !(lat === 0 && lng === 0);

const parsePoint = (element: XmlNode, zoneTracker: { missing: boolean }, seenExtras: Set<string>): GpxPoint | null => {
  const lat = toNumber(element.attrs.lat);
  const lng = toNumber(element.attrs.lon);
  if (!isValidCoordinate(lat, lng)) return null;

  let speedRaw = toNumber(firstChildText(element, "speed"));
  let cogDeg = toNumber(firstChildText(element, "course"));
  let extras: Record<string, number> | null = null;

  for (const extensions of childrenByLocalName(element, "extensions")) {
    const leaves = new Map<string, number>();
    collectExtensionLeaves(extensions, leaves);
    for (const [name, value] of leaves) {
      if (SPEED_NAMES.has(name)) {
        if (speedRaw === null) speedRaw = value;
        continue;
      }
      if (COURSE_NAMES.has(name)) {
        if (cogDeg === null) cogDeg = value;
        continue;
      }
      extras ??= {};
      extras[name] = value;
      seenExtras.add(name);
    }
  }

  return {
    t: parseTime(firstChildText(element, "time"), zoneTracker),
    lat,
    lng: lng as number,
    ele: toNumber(firstChildText(element, "ele")),
    speedRaw,
    cogDeg,
    hdop: toNumber(firstChildText(element, "hdop")),
    sat: toNumber(firstChildText(element, "sat")),
    extras,
  };
};

export function parseGpx(xml: string): ParsedGpx {
  const root = parseXml(xml);
  if (!root || root.localName !== "gpx") {
    throw new GpxParseError("Il file non è un GPX valido.");
  }

  const zoneTracker = { missing: false };
  const seenExtras = new Set<string>();

  const trackSegments: GpxPoint[][] = [];
  for (const trk of childrenByLocalName(root, "trk")) {
    for (const seg of childrenByLocalName(trk, "trkseg")) {
      const points = childrenByLocalName(seg, "trkpt")
        .map((pt) => parsePoint(pt, zoneTracker, seenExtras))
        .filter((pt): pt is GpxPoint => pt !== null);
      if (points.length) trackSegments.push(points);
    }
  }

  let source: ParsedGpx["source"] = "track";
  let segments = trackSegments;
  if (!segments.length) {
    source = "route";
    segments = childrenByLocalName(root, "rte")
      .map((rte) =>
        childrenByLocalName(rte, "rtept")
          .map((pt) => parsePoint(pt, zoneTracker, seenExtras))
          .filter((pt): pt is GpxPoint => pt !== null)
      )
      .filter((points) => points.length > 0);
  }
  if (!segments.length) {
    throw new GpxParseError("Il GPX non contiene punti di tracciato.");
  }

  const markers: GpxMarker[] = childrenByLocalName(root, "wpt")
    .map((wpt) => {
      const lat = toNumber(wpt.attrs.lat);
      const lng = toNumber(wpt.attrs.lon);
      if (!isValidCoordinate(lat, lng)) return null;
      return {
        lat,
        lng: lng as number,
        name: firstChildText(wpt, "name")?.trim() || null,
        t: parseTime(firstChildText(wpt, "time"), { missing: false }),
      };
    })
    .filter((marker): marker is GpxMarker => marker !== null);

  const metadata = childrenByLocalName(root, "metadata")[0] ?? null;
  const firstTrack = childrenByLocalName(root, "trk")[0] ?? null;
  const all = segments.flat();
  const any = (pick: (p: GpxPoint) => unknown) => all.some((p) => pick(p) !== null && pick(p) !== undefined);
  const hasTime = any((p) => p.t);

  return {
    creator: root.attrs.creator ?? null,
    name: (metadata && firstChildText(metadata, "name")?.trim()) || (firstTrack && firstChildText(firstTrack, "name")?.trim()) || null,
    description: (metadata && firstChildText(metadata, "desc")?.trim()) || null,
    segments,
    markers,
    source,
    timezone: !hasTime ? "none" : zoneTracker.missing ? "assumed-utc" : "explicit",
    fields: {
      time: hasTime,
      elevation: any((p) => p.ele),
      speed: any((p) => p.speedRaw),
      course: any((p) => p.cogDeg),
      hdop: any((p) => p.hdop),
      sat: any((p) => p.sat),
      extras: [...seenExtras].sort(),
    },
    pointCount: all.length,
  };
}
