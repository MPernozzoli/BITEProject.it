import { describe, it, expect } from "vitest";
import {
  buildValueScale,
  buildVoyageColorMap,
  formatValue,
  valueScaleExpression,
  VOYAGE_COLORS,
} from "@/lib/observation-scale";
import type { Observation, ObservationParameter } from "@/hooks/use-observations";

const parameter = (over: Partial<ObservationParameter> = {}): ObservationParameter => ({
  code: "sst",
  unit_code: "degc",
  label_en: "Sea surface temperature",
  label_it: null,
  unit: "°C",
  description_en: null,
  accuracy: null,
  value_type: "numeric",
  scale_min: 10,
  scale_max: 30,
  color_ramp: "sequential",
  sort_order: 10,
  ...over,
});

const observation = (values: Record<string, number>): Observation => ({
  id: Math.random().toString(36).slice(2),
  voyage_id: "v1",
  recorded_at: "2025-08-12T08:31:06.000Z",
  lat: 39,
  lng: 19,
  depth_m: null,
  gps_accuracy_m: null,
  source: "sensor",
  qc_flag: 1,
  notes: null,
  device_code: "d1",
  device_label: "Logger",
  measurements: Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { value: v, text: null, qc: 1 }]),
  ),
});

describe("buildValueScale", () => {
  it("spans the range present in the data, not the catalog's wider plausible range", () => {
    // The catalog allows 10–30 °C, but a summer leg only spans ~20–27: colouring against
    // 10–30 would flatten every point onto the same few steps.
    const scale = buildValueScale(parameter(), [
      observation({ sst: 20.4 }),
      observation({ sst: 24 }),
      observation({ sst: 27.5 }),
    ]);
    expect(scale).not.toBeNull();
    expect(scale!.min).toBe(20.4);
    expect(scale!.max).toBe(27.5);
  });

  it("pins a cyclic parameter to the catalog range so a bearing keeps its colour", () => {
    const scale = buildValueScale(
      parameter({ code: "wind_direction", color_ramp: "cyclic", scale_min: 0, scale_max: 360 }),
      [observation({ wind_direction: 90 }), observation({ wind_direction: 120 })],
    );
    expect(scale!.min).toBe(0);
    expect(scale!.max).toBe(360);
  });

  it("wraps the cyclic ramp back to its starting colour", () => {
    const scale = buildValueScale(
      parameter({ code: "wind_direction", color_ramp: "cyclic", scale_min: 0, scale_max: 360 }),
      [observation({ wind_direction: 0 }), observation({ wind_direction: 360 })],
    );
    expect(scale!.colorAt(0)).toBe(scale!.colorAt(360));
  });

  it("falls back to the catalog range when every value is identical", () => {
    const scale = buildValueScale(parameter(), [observation({ sst: 22 }), observation({ sst: 22 })]);
    expect(scale!.min).toBe(10);
    expect(scale!.max).toBe(30);
  });

  it("returns null for a categorical parameter and for a parameter with no readings", () => {
    expect(buildValueScale(parameter({ value_type: "categorical" }), [observation({ sst: 22 })])).toBeNull();
    expect(buildValueScale(parameter(), [observation({ humidity: 80 })])).toBeNull();
  });

  it("darkens monotonically across the sequential ramp", () => {
    const scale = buildValueScale(parameter(), [observation({ sst: 0 }), observation({ sst: 100 })])!;
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const samples = [0, 25, 50, 75, 100].map((v) => luminance(scale.colorAt(v)));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeLessThan(samples[i - 1]);
    }
  });

  it("clamps values outside the range instead of extrapolating", () => {
    const scale = buildValueScale(parameter(), [observation({ sst: 20 }), observation({ sst: 25 })])!;
    expect(scale.colorAt(-999)).toBe(scale.colorAt(20));
    expect(scale.colorAt(999)).toBe(scale.colorAt(25));
  });
});

describe("valueScaleExpression", () => {
  it("emits a maplibre interpolate expression covering the whole range", () => {
    const scale = buildValueScale(parameter(), [observation({ sst: 20 }), observation({ sst: 30 })])!;
    const expression = valueScaleExpression(scale);
    expect(expression[0]).toBe("interpolate");
    expect(expression[2]).toEqual(["get", "value"]);
    const breakpoints = expression.slice(3).filter((_, i) => i % 2 === 0);
    expect(breakpoints[0]).toBe(20);
    expect(breakpoints[breakpoints.length - 1]).toBe(30);
  });
});

describe("buildVoyageColorMap", () => {
  it("keeps a voyage's colour when other voyages are filtered out", () => {
    const all = buildVoyageColorMap(["a", "b", "c"]);
    // The page always builds the map from the full voyage list, so dropping "a" from the
    // view must not promote "b" to the first hue.
    expect(all.get("b")).toBe(VOYAGE_COLORS[1]);
    expect(buildVoyageColorMap(["a", "b", "c"]).get("b")).toBe(all.get("b"));
  });
});

describe("formatValue", () => {
  it("picks precision from the size of the variable's range", () => {
    expect(formatValue(38.04, parameter({ code: "salinity", scale_min: 33, scale_max: 40 }))).toBe("38.04");
    expect(formatValue(866, parameter({ code: "plankton_density", scale_min: 0, scale_max: 5000 }))).toBe("866");
    expect(formatValue(1012.04, parameter({ code: "pressure", scale_min: 980, scale_max: 1040 }))).toBe("1012.0");
  });
});
