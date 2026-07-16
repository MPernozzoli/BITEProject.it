import { describe, expect, it } from "vitest";
import {
  getActualStopHours,
  getCurrentLegIndex,
  getLegDelayHours,
  getLegPhase,
  getPendingActual,
  getVoyagePhase,
  isLegBookableNow,
  isLegDelayed,
  shouldShowLiveWidget,
  type PhaseLeg,
} from "@/lib/voyage-schedule";
import { formatBookingWindow } from "@/lib/booking-utils";

/** 12:00 Rome, so a test never straddles a day boundary by accident. */
const at = (iso: string) => new Date(`${iso}T12:00:00+02:00`);
const NOW = at("2026-09-14");

const leg = (overrides: Partial<PhaseLeg> = {}): PhaseLeg => ({
  starts_at_window_start: "2026-09-20T05:30:00Z",
  ends_at_window_end: "2026-09-21T05:30:00Z",
  ...overrides,
});

describe("getLegPhase", () => {
  it("treats a recorded arrival as completed, whatever the plan says", () => {
    const future = leg({
      starts_at_window_start: "2026-12-01T05:30:00Z",
      ends_at_window_end: "2026-12-02T05:30:00Z",
      actual_departure_at: "2026-09-10T05:30:00Z",
      actual_arrival_at: "2026-09-11T05:30:00Z",
    });
    expect(getLegPhase(future, NOW)).toBe("completed");
  });

  it("treats a departure without an arrival as active, even before the planned date", () => {
    const future = leg({
      starts_at_window_start: "2026-12-01T05:30:00Z",
      actual_departure_at: "2026-09-14T05:30:00Z",
    });
    expect(getLegPhase(future, NOW)).toBe("active");
  });

  it("falls back to the clock when no actual was recorded", () => {
    expect(getLegPhase(leg(), NOW)).toBe("planned");
    expect(
      getLegPhase(
        leg({ starts_at_window_start: "2026-09-10T05:30:00Z", ends_at_window_end: "2026-09-12T05:30:00Z" }),
        NOW
      )
    ).toBe("completed");
    expect(
      getLegPhase(
        leg({ starts_at_window_start: "2026-09-13T05:30:00Z", ends_at_window_end: "2026-09-16T05:30:00Z" }),
        NOW
      )
    ).toBe("active");
  });

  it("counts a leg departing later today as already started, not as tomorrow's leg", () => {
    const today = leg({
      starts_at_window_start: "2026-09-14T20:00:00Z",
      ends_at_window_end: "2026-09-16T05:30:00Z",
    });
    expect(getLegPhase(today, NOW)).toBe("active");
  });

  it("stays planned when the schedule is unknown", () => {
    expect(getLegPhase({ starts_at_window_start: null, ends_at_window_end: null }, NOW)).toBe("planned");
  });
});

describe("isLegBookableNow", () => {
  it("refuses a leg that has actually departed", () => {
    expect(isLegBookableNow(leg({ actual_departure_at: "2026-09-14T05:30:00Z" }), NOW)).toBe(false);
  });

  it("refuses a leg in progress and a leg already over", () => {
    expect(isLegBookableNow(leg({ starts_at_window_start: "2026-09-13T05:30:00Z" }), NOW)).toBe(false);
    expect(
      isLegBookableNow(
        leg({ starts_at_window_start: "2026-09-10T05:30:00Z", ends_at_window_end: "2026-09-12T05:30:00Z" }),
        NOW
      )
    ).toBe(false);
  });

  it("allows a leg still in the future", () => {
    expect(isLegBookableNow(leg(), NOW)).toBe(true);
  });
});

describe("getVoyagePhase", () => {
  const done = leg({ actual_arrival_at: "2026-09-11T05:30:00Z" });
  const running = leg({ actual_departure_at: "2026-09-13T05:30:00Z" });
  const todo = leg();

  it("honours an explicit override above everything else", () => {
    expect(getVoyagePhase({ status_override: "completed" }, [todo, todo], NOW)).toBe("completed");
  });

  it("derives from the leg phases when legs exist", () => {
    expect(getVoyagePhase({}, [todo, todo], NOW)).toBe("planned");
    expect(getVoyagePhase({}, [done, done], NOW)).toBe("completed");
    expect(getVoyagePhase({}, [done, running, todo], NOW)).toBe("active");
  });

  it("marks a voyage active once one leg is done and others are pending", () => {
    // The 14/09 case from the spec: A->B closed, the voyage itself still running.
    expect(getVoyagePhase({}, [done, todo], NOW)).toBe("active");
  });

  it("falls back to the voyage dates when there are no legs", () => {
    expect(getVoyagePhase({ start_date: "2026-09-01", end_date: "2026-09-10" }, [], NOW)).toBe("completed");
    expect(getVoyagePhase({ start_date: "2026-09-10", end_date: "2026-09-20" }, [], NOW)).toBe("active");
    expect(getVoyagePhase({ start_date: "2026-10-01", end_date: "2026-10-20" }, [], NOW)).toBe("planned");
    expect(getVoyagePhase({ start_date: null, end_date: null }, [], NOW)).toBe("planned");
  });
});

describe("getCurrentLegIndex", () => {
  it("points at the first leg not yet arrived at", () => {
    const legs = [
      leg({ actual_arrival_at: "2026-09-11T05:30:00Z" }),
      leg({ actual_departure_at: "2026-09-13T05:30:00Z" }),
      leg(),
    ];
    expect(getCurrentLegIndex(legs, NOW)).toBe(1);
  });

  it("returns -1 once every leg is closed", () => {
    expect(getCurrentLegIndex([leg({ actual_arrival_at: "2026-09-11T05:30:00Z" })], NOW)).toBe(-1);
  });
});

describe("getPendingActual", () => {
  const endpoints = { from_waypoint_id: "wp-a", to_waypoint_id: "wp-b" };

  it("asks for the departure, on the origin waypoint, before the leg leaves", () => {
    expect(getPendingActual({ ...leg(), ...endpoints }, NOW)).toEqual({
      kind: "departure",
      waypointId: "wp-a",
    });
  });

  it("asks for the arrival, on the destination waypoint, once under way", () => {
    expect(
      getPendingActual({ ...leg({ actual_departure_at: "2026-09-13T05:30:00Z" }), ...endpoints }, NOW)
    ).toEqual({ kind: "arrival", waypointId: "wp-b" });
  });

  it("still asks for the departure when the planned date passed unrecorded", () => {
    // Active by the clock alone: nobody pressed "parti ora", so the departure is
    // still the open question — asking for the arrival would silently lose it.
    const overdue = { ...leg({ starts_at_window_start: "2026-09-13T05:30:00Z" }), ...endpoints };
    expect(getLegPhase(overdue, NOW)).toBe("active");
    expect(getPendingActual(overdue, NOW)).toEqual({ kind: "departure", waypointId: "wp-a" });
  });

  it("asks for nothing once the leg is closed", () => {
    expect(
      getPendingActual({ ...leg({ actual_arrival_at: "2026-09-13T05:30:00Z" }), ...endpoints }, NOW)
    ).toBeNull();
  });
});

describe("isLegDelayed", () => {
  const baseline = {
    baseline_starts_at_window_start: "2026-09-10T05:30:00Z",
    baseline_starts_at_window_end: "2026-09-13T05:30:00Z",
  };

  it("stays silent while the shift is inside the planned window", () => {
    // Window 10 -> 13, actually leaving on the 12th: late, but as planned for.
    const shifted = { ...baseline, starts_at_window_start: "2026-09-12T05:30:00Z" };
    expect(isLegDelayed(shifted)).toBe(false);
    expect(getLegDelayHours(shifted)).toBe(0);
  });

  it("does not fire when the window boundary is hit exactly", () => {
    expect(isLegDelayed({ ...baseline, starts_at_window_start: "2026-09-13T05:30:00Z" })).toBe(false);
  });

  it("fires once the departure slips past the window", () => {
    const late = { ...baseline, starts_at_window_start: "2026-09-15T05:30:00Z" };
    expect(isLegDelayed(late)).toBe(true);
    expect(getLegDelayHours(late)).toBe(48);
  });

  it("never reports an early departure as a delay", () => {
    expect(isLegDelayed({ ...baseline, starts_at_window_start: "2026-09-09T05:30:00Z" })).toBe(false);
  });

  it("reports nothing without a baseline to compare against", () => {
    expect(isLegDelayed({ starts_at_window_start: "2026-09-15T05:30:00Z" })).toBe(false);
  });
});

describe("leg window display", () => {
  // Real Bari -> Santa Maria di Leuca bounds: a 21-hour hop on a voyage carrying
  // 3 flex days, so each bound spans three days. The widget shows the whole window
  // through formatBookingWindow, the same way the booking matrix does — showing one
  // bound alone would either hide the flex or fake a four-day crossing.
  const real = {
    starts_at_window_start: "2026-09-10T05:30:00Z",
    starts_at_window_end: "2026-09-13T05:30:00Z",
    ends_at_window_start: "2026-09-11T02:39:24Z",
    ends_at_window_end: "2026-09-14T02:39:24Z",
  };

  it("renders both ends of the flex window", () => {
    expect(formatBookingWindow(real.starts_at_window_start, real.starts_at_window_end, "it-IT")).toContain("–");
    expect(formatBookingWindow(real.ends_at_window_start, real.ends_at_window_end, "it-IT")).toContain("–");
  });

  it("collapses to one date once an actual pins both bounds", () => {
    // Recording an actual sets start === end, so the range becomes a single moment
    // with no extra work in the widget.
    const pinned = formatBookingWindow(real.starts_at_window_start, real.starts_at_window_start, "it-IT");
    expect(pinned).not.toContain("–");
    expect(pinned).toBeTruthy();
  });

  it("still uses the late arrival bound to decide the phase", () => {
    // Mid-window: the early bound has passed but the leg may not be over yet.
    expect(getLegPhase(real, at("2026-09-12"))).toBe("active");
    expect(getLegPhase(real, at("2026-09-15"))).toBe("completed");
  });
});

describe("getActualStopHours", () => {
  it("measures the real stop between arrival and departure", () => {
    expect(
      getActualStopHours({
        actual_arrival_at: "2026-09-12T06:00:00Z",
        actual_departure_at: "2026-09-13T06:00:00Z",
      })
    ).toBe(24);
  });

  it("returns null until both ends are recorded", () => {
    expect(getActualStopHours({ actual_arrival_at: "2026-09-12T06:00:00Z" })).toBeNull();
    expect(getActualStopHours({ actual_departure_at: "2026-09-13T06:00:00Z" })).toBeNull();
  });
});

describe("shouldShowLiveWidget", () => {
  it("appears exactly a week before the planned departure, not earlier", () => {
    // NOW is 14/09: the 22nd is 8 days out and still hidden, the 21st is 7 and shows.
    expect(shouldShowLiveWidget({}, [leg({ starts_at_window_start: "2026-09-22T05:30:00Z" })], NOW)).toBe(false);
    expect(shouldShowLiveWidget({}, [leg({ starts_at_window_start: "2026-09-21T05:30:00Z" })], NOW)).toBe(true);
  });

  it("stays up while the voyage runs and disappears once it is over", () => {
    expect(shouldShowLiveWidget({}, [leg({ actual_departure_at: "2026-09-13T05:30:00Z" })], NOW)).toBe(true);
    expect(shouldShowLiveWidget({}, [leg({ actual_arrival_at: "2026-09-13T05:30:00Z" })], NOW)).toBe(false);
  });

  it("respects an override that closes the voyage", () => {
    expect(
      shouldShowLiveWidget({ status_override: "completed" }, [leg({ starts_at_window_start: "2026-09-20T05:30:00Z" })], NOW)
    ).toBe(false);
  });
});
