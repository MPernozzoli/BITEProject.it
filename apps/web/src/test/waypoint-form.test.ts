import { describe, expect, it } from "vitest";
import {
  computeWaypointFormChanges,
  type WaypointFormContext,
  type WaypointFormState,
} from "@/lib/waypoint-form";

const baseState = (): WaypointFormState => ({
  nameIt: "",
  nameEn: "",
  descriptionIt: "",
  descriptionEn: "",
  visibility: "auto",
  arrivalLocal: "",
  departureLocal: "",
  stopMode: "none",
  stopHours: "0",
  stopNights: "1",
  stopDeparture: "07:30",
  eventDate: "",
  eventTime: "",
});

const baseCtx = (over: Partial<WaypointFormContext> = {}): WaypointFormContext => ({
  defaultNames: { it: "Punto IT", en: "Point EN" },
  currentNameIt: null,
  currentNameEn: null,
  datesTbd: false,
  lang: "it",
  index: 2,
  lat: 40,
  lng: 18,
  ...over,
});

describe("computeWaypointFormChanges", () => {
  it("keeps an untouched middle waypoint auto/technical and falls back to default names", () => {
    const changes = computeWaypointFormChanges(baseState(), baseCtx());
    expect(changes.visibility_mode).toBe("auto");
    expect(changes.waypoint_type).toBe("technical");
    expect(changes.name_it).toBe("Punto IT");
    expect(changes.name_en).toBe("Point EN");
    // legacyName follows lang="it"
    expect(changes.name).toBe("Punto IT");
    // technical branch clears narrative dates and any stop
    expect(changes.date_start).toBeNull();
    expect(changes.date_end).toBeNull();
    expect(changes.stop_hours).toBe(0);
    expect(changes.planned_stop_duration_minutes).toBe(0);
  });

  it("auto-promotes to narrative when a custom name is given", () => {
    const state = { ...baseState(), nameIt: "Cala Luna" };
    const changes = computeWaypointFormChanges(state, baseCtx());
    expect(changes.visibility_mode).toBe("manual");
    expect(changes.waypoint_type).toBe("narrative");
    expect(changes.name).toBe("Cala Luna");
  });

  it("auto-promotes to narrative when a planned stop is set, and records the stop", () => {
    const state = { ...baseState(), stopMode: "hours" as const, stopHours: "6" };
    const changes = computeWaypointFormChanges(state, baseCtx());
    expect(changes.waypoint_type).toBe("narrative");
    expect(changes.stop_mode).toBe("hours");
    expect(changes.stop_hours).toBe(6);
    expect(changes.planned_stop_duration_minutes).toBe(360);
    expect(changes.stop_nights).toBeNull();
  });

  it("records a nights stop with departure time on a narrative waypoint", () => {
    const state = {
      ...baseState(),
      visibility: "narrative" as const,
      stopMode: "nights" as const,
      stopNights: "2",
      stopDeparture: "19:00",
      arrivalLocal: "2026-09-10T15:00",
      departureLocal: "2026-09-12T19:00",
    };
    const changes = computeWaypointFormChanges(state, baseCtx());
    expect(changes.waypoint_type).toBe("narrative");
    expect(changes.stop_mode).toBe("nights");
    expect(changes.stop_nights).toBe(2);
    expect(changes.stop_departure_time).toBe("19:00");
    expect(changes.stop_hours).toBeNull();
    expect(changes.date_end).toBe("2026-09-10T15:00");
    expect(changes.date_start).toBe("2026-09-12T19:00");
  });

  it("keeps an explicit technical waypoint technical and stores its passage date", () => {
    const state = {
      ...baseState(),
      visibility: "technical" as const,
      nameIt: "Cala Luna", // custom name must NOT override an explicit technical choice
      eventDate: "2026-09-11",
      eventTime: "08:30",
    };
    const changes = computeWaypointFormChanges(state, baseCtx());
    expect(changes.visibility_mode).toBe("manual");
    expect(changes.waypoint_type).toBe("technical");
    expect(changes.event_date).toBe("2026-09-11");
    expect(changes.event_time).toBe("08:30");
    expect(changes.date_start).toBeNull();
    expect(changes.date_end).toBeNull();
  });

  it("never writes dates when the voyage has dates disabled (TBD)", () => {
    const state = {
      ...baseState(),
      visibility: "narrative" as const,
      arrivalLocal: "2026-09-10T15:00",
      departureLocal: "2026-09-12T19:00",
      eventDate: "2026-09-11",
    };
    const changes = computeWaypointFormChanges(state, baseCtx({ datesTbd: true }));
    expect(changes.date_start).toBeNull();
    expect(changes.date_end).toBeNull();
  });

  it("uses the English name as legacy name when lang is en", () => {
    const state = { ...baseState(), nameIt: "Cala Luna", nameEn: "Moon Cove" };
    const changes = computeWaypointFormChanges(state, baseCtx({ lang: "en" }));
    expect(changes.name).toBe("Moon Cove");
  });
});
