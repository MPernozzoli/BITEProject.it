import type { Observation, ObservationParameter } from "@/hooks/use-observations";

/**
 * Colour rules for the observation map. Only one colour job is ever on screen:
 * with no parameter selected the points carry voyage identity (categorical), and
 * with one parameter selected they carry its magnitude (sequential).
 */

/** Categorical hues, fixed order, never cycled. Assigned by voyage, never by rank. */
export const VOYAGE_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"];

/** Routes are context, not data: they recede when the points carry a value scale. */
export const ROUTE_MUTED = "#9a9a94";

/**
 * Sequential ramp: one hue, light -> dark. Starts at ramp step 250 rather than the
 * lightest step because these are marks on a light basemap, not a heatmap fill —
 * the low end still has to be visible against the tiles.
 */
export const SEQUENTIAL_STOPS = ["#86b6ef", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

/**
 * Wind direction wraps: 0° and 360° are the same bearing, so a light->dark ramp would
 * split north into the two ends of the scale. Angles get a wrap-around scale built from
 * the same validated hues, returning to its starting colour.
 */
export const CYCLIC_STOPS = ["#2a78d6", "#1baf7a", "#eda100", "#e34948", "#2a78d6"];

export const QC_LABELS: Record<number, string> = {
  0: "no QC performed",
  1: "good",
  2: "probably good",
  3: "probably bad",
  4: "bad",
  9: "missing",
};

/** Stable colour per voyage: derived from the full voyage list, so filtering never repaints survivors. */
export const buildVoyageColorMap = (voyageIds: string[]) => {
  const map = new Map<string, string>();
  voyageIds.forEach((id, i) => map.set(id, VOYAGE_COLORS[i % VOYAGE_COLORS.length]));
  return map;
};

export interface ValueScale {
  min: number;
  max: number;
  stops: string[];
  /** Colour for a value in [min, max], used by the legend gradient and by tests. */
  colorAt: (value: number) => string;
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`;
};

/**
 * The scale for a parameter.
 *
 * Sequential scales span the range actually present in the filtered points, because the
 * point of colouring by value is reading the distribution: the catalog's plausible range
 * is far wider than any one voyage (SST is catalogued 10–30 °C but a summer leg only spans
 * ~20–27 °C), which would flatten every point to the same step. The legend always prints
 * the range in use, so a shifting scale is stated rather than implied.
 *
 * Cyclic scales are the exception: an angle's scale is fixed to the catalog's 0–360, since
 * stretching it to the observed range would rotate the meaning of every colour.
 */
export const buildValueScale = (
  parameter: ObservationParameter,
  observations: Observation[],
): ValueScale | null => {
  if (parameter.value_type !== "numeric") return null;

  const cyclic = parameter.color_ramp === "cyclic";
  const stops = cyclic ? CYCLIC_STOPS : SEQUENTIAL_STOPS;

  const values = observations
    .map((o) => o.measurements[parameter.code]?.value)
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;

  let min: number;
  let max: number;

  if (cyclic) {
    min = parameter.scale_min ?? 0;
    max = parameter.scale_max ?? 360;
  } else {
    min = Math.min(...values);
    max = Math.max(...values);
  }

  // A single distinct value has no range to stretch; fall back to the catalog's.
  if (min === max) {
    min = parameter.scale_min ?? min - 1;
    max = parameter.scale_max ?? max + 1;
  }
  if (min === max) max = min + 1;

  const colorAt = (value: number) => {
    const t = Math.min(1, Math.max(0, (value - min!) / (max! - min!)));
    const span = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(span));
    return mix(stops[i], stops[i + 1], span - i);
  };

  return { min, max, stops, colorAt };
};

/** MapLibre paint expression matching buildValueScale. */
export const valueScaleExpression = (scale: ValueScale) => {
  const expression: (string | number | string[])[] = ["interpolate", ["linear"], ["get", "value"]];
  scale.stops.forEach((color, i) => {
    expression.push(scale.min + ((scale.max - scale.min) * i) / (scale.stops.length - 1), color);
  });
  return expression;
};

/** Significant-ish formatting: plankton counts and salinity need very different precision. */
export const formatValue = (value: number, parameter: ObservationParameter) => {
  const span = Math.abs((parameter.scale_max ?? 100) - (parameter.scale_min ?? 0));
  const digits = span >= 500 ? 0 : span >= 50 ? 1 : 2;
  return value.toFixed(digits);
};
