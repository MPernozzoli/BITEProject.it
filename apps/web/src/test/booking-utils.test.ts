import { describe, expect, it } from "vitest";
import {
  type BookableLeg,
  type BookingWaypoint,
  computeAutoLegComplexity,
  formatLegScheduleSummary,
  formatStopSummary,
  formatWaypointStopDates,
  getLegComplexity,
  legHasNightNavigation,
} from "@/lib/booking-utils";

const makeLeg = (partial: Partial<BookableLeg>): BookableLeg => ({
  id: "leg",
  voyage_id: "voyage",
  from_waypoint_id: "a",
  to_waypoint_id: "b",
  sort_order: 0,
  starts_at_window_start: null,
  starts_at_window_end: null,
  ends_at_window_start: null,
  ends_at_window_end: null,
  is_bookable: true,
  ...partial,
});

// Rome is CEST (+2h) in September, so 06:00Z == 08:00 local.
const dayLeg = (fromUtc: string, hours: number, extra: Partial<BookableLeg> = {}) =>
  makeLeg({
    starts_at_window_start: fromUtc,
    ends_at_window_start: new Date(new Date(fromUtc).getTime() + hours * 3_600_000).toISOString(),
    ...extra,
  });

describe("legHasNightNavigation", () => {
  it("is false for a passage entirely inside 06:00–23:00 local", () => {
    // depart 08:00 local, 6h -> arrive 14:00 local
    expect(legHasNightNavigation(dayLeg("2026-09-10T06:00:00Z", 6))).toBe(false);
  });

  it("is true when the passage runs past 23:00 local", () => {
    // depart 20:00 local, 4h -> arrive 00:00 local
    expect(legHasNightNavigation(dayLeg("2026-09-10T18:00:00Z", 4))).toBe(true);
  });

  it("is true for any passage of 24h or more", () => {
    expect(legHasNightNavigation(dayLeg("2026-09-10T06:00:00Z", 26))).toBe(true);
  });
});

describe("computeAutoLegComplexity", () => {
  it("rates a short daytime hop as level 1", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T06:00:00Z", 6))).toBe(1);
  });

  it("bumps to at least 2 for night navigation", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T18:00:00Z", 4))).toBe(2);
  });

  it("reaches level 3 beyond 20 hours", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T06:00:00Z", 22))).toBe(3);
  });

  it("reaches level 4 beyond 40 hours", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T06:00:00Z", 42))).toBe(4);
  });

  it("adds one for offshore passages", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T06:00:00Z", 6, { open_sea: true }))).toBe(2);
  });

  it("pins to level 5 when danger is elevated", () => {
    expect(computeAutoLegComplexity(dayLeg("2026-09-10T06:00:00Z", 6, { danger_level: 2 }))).toBe(5);
  });
});

describe("getLegComplexity", () => {
  it("uses the manual override when set", () => {
    expect(getLegComplexity(dayLeg("2026-09-10T06:00:00Z", 6, { complexity_override: 4 }))).toBe(4);
  });

  it("falls back to the auto value when the override is null", () => {
    expect(getLegComplexity(dayLeg("2026-09-10T18:00:00Z", 4, { complexity_override: null }))).toBe(2);
  });
});

describe("formatStopSummary", () => {
  const waypoint = (partial: Partial<BookingWaypoint>): BookingWaypoint => ({
    id: "wp",
    voyage_id: "voyage",
    name: "Palermo",
    name_it: null,
    name_en: null,
    sort_order: 0,
    date_start: null,
    date_end: null,
    ...partial,
  });

  it("summarises an hours stop", () => {
    expect(formatStopSummary(waypoint({ stop_mode: "hours", stop_hours: 8 }), "it")).toBe("Sosta 8h");
  });

  it("summarises a nights stop with a departure time", () => {
    expect(
      formatStopSummary(waypoint({ stop_mode: "nights", stop_nights: 2, stop_departure_time: "19:00" }), "it")
    ).toBe("Sosta 2 giorni, ripartenza h 19:00");
  });

  it("returns null when there is no stop", () => {
    expect(formatStopSummary(waypoint({ stop_mode: "hours", stop_hours: 0 }), "it")).toBeNull();
  });
});

describe("booking schedule formatting", () => {
  it("formats a leg departure and arrival range", () => {
    expect(
      formatLegScheduleSummary(
        makeLeg({
          starts_at_window_start: "2026-09-10T06:00:00Z",
          starts_at_window_end: "2026-09-10T06:00:00Z",
          ends_at_window_start: "2026-09-10T14:00:00Z",
          ends_at_window_end: "2026-09-10T14:00:00Z",
        }),
        "it"
      )
    ).toContain("Partenza");
  });

  it("formats waypoint stop arrival and departure dates", () => {
    expect(
      formatWaypointStopDates(
        {
          date_end: "2026-09-10T14:00:00Z",
          date_start: "2026-09-11T06:00:00Z",
        },
        "it"
      )
    ).toContain("Ripartenza");
  });
});
