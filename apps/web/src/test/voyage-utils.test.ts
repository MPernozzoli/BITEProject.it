import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicVoyageGeometry,
  buildVoyageGeometry,
  getRiverLegFlags,
  getRiverMarkerRoles,
  buildVoyageSegmentGeometry,
  buildWaypointDefaultLocalizedNames,
  getActualVoyageWaypoints,
  getVoyageBoatPosition,
  getVoyageTravelledWaypointIndex,
  isWaypointCoordinateLabel,
  reverseGeocodePlaceLocalized,
  totalCoordinateDistanceKm,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";

const createJsonResponse = (payload: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response);

describe("buildVoyageGeometry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds land geometry segment by segment with snapped road points", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        createJsonResponse({ waypoints: [{ location: [10, 20], distance: 15 }] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ waypoints: [{ location: [11, 21], distance: 8 }] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          code: "Ok",
          routes: [{ distance: 1000, geometry: { coordinates: [[10, 20], [11, 21]] } }],
        })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ waypoints: [{ location: [12, 22], distance: 6 }] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          code: "Ok",
          routes: [{ distance: 1000, geometry: { coordinates: [[11, 21], [12, 22]] } }],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 20.001, lng: 10.001 },
        { lat: 21.001, lng: 11.001 },
        { lat: 22.001, lng: 12.001 },
      ],
      "land"
    );

    expect(geometry).toEqual([
      [10, 20],
      [11, 21],
      [12, 22],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/nearest/v1/driving/10.001,20.001");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/route/v1/driving/10,20;11,21");
    expect(fetchMock.mock.calls[4]?.[0]).toContain("/route/v1/driving/11,21;12,22");
  });

  it("falls back to the nearest-road segment when no drivable route exists", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        createJsonResponse({ waypoints: [{ location: [9.9, 44.1], distance: 42 }] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ waypoints: [{ location: [10.1, 44.2], distance: 37 }] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ code: "NoRoute", routes: [] })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ code: "NoRoute", routes: [] })
      );

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 44.11, lng: 9.91 },
        { lat: 44.19, lng: 10.12 },
      ],
      "land"
    );

    expect(geometry).toEqual([
      [9.9, 44.1],
      [10.1, 44.2],
    ]);
  });

  it("routes a stretch between two river_endpoint waypoints through BRouter's river profile", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      createJsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [7.95, 48.57],
                [7.955, 48.575],
                [7.96, 48.58],
              ],
            },
          },
        ],
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 48.57, lng: 7.95, river_endpoint: true },
        { lat: 48.58, lng: 7.96, river_endpoint: true },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    expect(geometry).toEqual([
      [7.95, 48.57],
      [7.955, 48.575],
      [7.96, 48.58],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("brouter.de/brouter");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("profile=river");
  });

  it("never asks BRouter about legs that are outside a river stretch", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes("overpass")) return createJsonResponse({ elements: [] });
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 40, lng: 10 },
        { lat: 40.2, lng: 10.3 },
        { lat: 40.4, lng: 10.6 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    expect(geometry).toEqual([
      [10, 40],
      [10.3, 40.2],
      [10.6, 40.4],
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("brouter.de"))).toBe(false);
  });

  it("treats intermediate waypoints of a stretch as river, in a single BRouter request", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      createJsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [7.95, 48.57],
                [7.955, 48.575],
                [7.96, 48.58],
                [7.97, 48.59],
              ],
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await buildVoyageGeometry(
      [
        { lat: 48.57, lng: 7.95, river_endpoint: true },
        { lat: 48.58, lng: 7.96 },
        { lat: 48.59, lng: 7.97, river_endpoint: true },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("lonlats")).toBe(
      "7.95,48.57|7.96,48.58|7.97,48.59"
    );
  });

  it("keeps river-sea-river as two separate stretches and falls back to sea when BRouter fails", async () => {
    const riverReply = (coordinates: number[][]) =>
      createJsonResponse({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "LineString", coordinates } }],
      });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes("overpass")) return createJsonResponse({ elements: [] });
      const lonlats = new URL(href).searchParams.get("lonlats") ?? "";
      // Second stretch (from 7.98,48.6) has no waterway → BRouter 400.
      if (lonlats.startsWith("7.98,48.6")) {
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }
      return riverReply([
        [7.95, 48.57],
        [7.955, 48.575],
        [7.96, 48.58],
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 48.57, lng: 7.95, river_endpoint: true },
        { lat: 48.58, lng: 7.96, river_endpoint: true },
        { lat: 48.59, lng: 7.97 },
        { lat: 48.6, lng: 7.98, river_endpoint: true },
        { lat: 48.61, lng: 7.99, river_endpoint: true },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    // Stretch 1 follows the waterway, the middle leg is open sea, stretch 2 falls back to sea.
    expect(geometry).toEqual([
      [7.95, 48.57],
      [7.955, 48.575],
      [7.96, 48.58],
      [7.97, 48.59],
      [7.98, 48.6],
      [7.99, 48.61],
    ]);
    const brouterCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("brouter.de"));
    // Stretch 1: one request. Stretch 2: one whole-run request + one per-leg retry, both failing.
    expect(brouterCalls).toHaveLength(3);
  });

  it("bulges an open-sea tratta around land it would otherwise cross", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes("brouter.de")) {
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }
      if (href.includes("overpass")) {
        return createJsonResponse({
          elements: [
            {
              type: "way",
              geometry: [
                { lat: -1, lon: 1 },
                { lat: 1, lon: 1 },
              ],
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 2 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    // The straight chord (lat 0, lng 0→2) crosses the mocked coastline at lng=1: expect a detour
    // that still starts/ends exactly on the waypoints.
    expect(geometry[0]).toEqual([0, 0]);
    expect(geometry[geometry.length - 1]).toEqual([2, 0]);
    expect(geometry.length).toBeGreaterThan(2);
    const midLats = geometry.slice(1, -1).map(([, lat]) => lat);
    expect(midLats.some((lat) => Math.abs(lat) > 0.01)).toBe(true);
  });

  it("keeps a straight open-sea chord when no coastline is nearby", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes("brouter.de")) {
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }
      if (href.includes("overpass")) {
        return createJsonResponse({ elements: [] });
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 40, lng: 10 },
        { lat: 40.2, lng: 10.3 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    expect(geometry).toEqual([
      [10, 40],
      [10.3, 40.2],
    ]);
  });
});

describe("buildVoyageSegmentGeometry", () => {
  it("uses cached land geometry for article segments instead of straight waypoint chords", () => {
    const waypoints = [
      { id: "wp-1", voyage_id: "voyage-1", lat: 44.0, lng: 9.0, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 44.1, lng: 9.1, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "technical", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
      { id: "wp-3", voyage_id: "voyage-1", lat: 44.2, lng: 9.2, name: "", name_en: null, name_it: null, sort_order: 2, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
    ] satisfies VoyageWaypoint[];

    const geometry = buildVoyageSegmentGeometry(waypoints, "land", 0, 2, [
      [9.0, 44.0],
      [9.03, 44.05],
      [9.07, 44.11],
      [9.14, 44.16],
      [9.2, 44.2],
    ]);

    expect(geometry).toEqual([
      [9.0, 44.0],
      [9.03, 44.05],
      [9.07, 44.11],
      [9.14, 44.16],
      [9.2, 44.2],
    ]);
  });

  it("does not synthesize straight land segments when cached geometry is missing", () => {
    const waypoints = [
      { id: "wp-1", voyage_id: "voyage-1", lat: 44.0, lng: 9.0, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 44.2, lng: 9.2, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
    ] satisfies VoyageWaypoint[];

    expect(buildVoyageSegmentGeometry(waypoints, "land", 0, 1)).toEqual([]);
    expect(buildPublicVoyageGeometry(waypoints, "land")).toEqual([]);
  });

  it("slices cached waterway geometry between segment endpoints like land", () => {
    const waypoints = [
      { id: "wp-1", voyage_id: "voyage-1", lat: 48.57, lng: 7.95, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 48.58, lng: 7.96, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
      { id: "wp-3", voyage_id: "voyage-1", lat: 48.59, lng: 7.97, name: "", name_en: null, name_it: null, sort_order: 2, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "", updated_at: "" },
    ] satisfies VoyageWaypoint[];

    const cached: [number, number][] = [
      [7.95, 48.57],
      [7.955, 48.575],
      [7.96, 48.58],
      [7.965, 48.585],
      [7.97, 48.59],
    ];

    const geometry = buildVoyageSegmentGeometry(waypoints, "water", 0, 2, cached);
    expect(geometry[0]).toEqual([7.95, 48.57]);
    expect(geometry[geometry.length - 1]).toEqual([7.97, 48.59]);
    expect(geometry.length).toBeGreaterThanOrEqual(3);
  });
});

describe("getVoyageTravelledWaypointIndex", () => {
  // visibility_mode "manual" + waypoint_type "narrative" is how a real, public stop is always
  // marked (see insert_voyage_leg_correction_stops / VoyageFormPanel), regardless of its position
  // in the array — unlike "auto" mode, whose effective type depends on position/stop-duration
  // (see getWaypointEffectiveType). These tests model a voyage made entirely of real stops.
  const makeWaypoint = (id: string, actualArrivalAt: string | null): VoyageWaypoint => ({
    id,
    voyage_id: "voyage-1",
    lat: 0,
    lng: 0,
    name: "",
    name_en: null,
    name_it: null,
    sort_order: 0,
    waypoint_type: "narrative",
    visibility_mode: "manual",
    description_en: null,
    description_it: null,
    event_date: null,
    event_time: null,
    media: [],
    date_start: null,
    date_end: null,
    actual_arrival_at: actualArrivalAt,
    created_at: "",
    updated_at: "",
  });

  const makeTechnicalWaypoint = (id: string): VoyageWaypoint => ({
    ...makeWaypoint(id, null),
    waypoint_type: "technical",
    visibility_mode: "auto",
  });

  it("is 0 when the voyage just started and nothing has been reached yet", () => {
    const waypoints = [makeWaypoint("wp-1", null), makeWaypoint("wp-2", null), makeWaypoint("wp-3", null)];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(0);
  });

  it("stops at the first waypoint without a recorded arrival", () => {
    const waypoints = [
      makeWaypoint("wp-1", null),
      makeWaypoint("wp-2", "2026-01-01T10:00:00Z"),
      makeWaypoint("wp-3", null),
      makeWaypoint("wp-4", "2026-01-03T10:00:00Z"),
    ];
    // wp-3 has no actual arrival, so the chain from the start breaks there
    // even though a later waypoint (wp-4) does have one recorded.
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(1);
  });

  it("reaches the last waypoint once every leg has an actual arrival", () => {
    const waypoints = [
      makeWaypoint("wp-1", null),
      makeWaypoint("wp-2", "2026-01-01T10:00:00Z"),
      makeWaypoint("wp-3", "2026-01-02T10:00:00Z"),
    ];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(2);
  });

  it("does not let a skipped stop block progress past it (tappe previste/effettive)", () => {
    // wp-2 was the planned stop but got marked skipped, so it never gets an actual
    // arrival — the chain must not stop there once wp-3 (the real next stop) has one.
    const waypoints = [
      makeWaypoint("wp-1", null),
      { ...makeWaypoint("wp-2", null), actual_status: "skipped" as const },
      makeWaypoint("wp-3", "2026-01-02T10:00:00Z"),
    ];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(2);
  });

  it("does not let an added stop (never wired to set_voyage_waypoint_actual) block progress", () => {
    const waypoints = [
      makeWaypoint("wp-1", null),
      { ...makeWaypoint("wp-2", null), actual_status: "added" as const },
      makeWaypoint("wp-3", "2026-01-02T10:00:00Z"),
    ];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(2);
  });

  it("still stops at an unreached planned stop, even counting a skipped one just before it as passed", () => {
    const waypoints = [
      makeWaypoint("wp-1", null),
      { ...makeWaypoint("wp-2", null), actual_status: "skipped" as const },
      makeWaypoint("wp-3", null),
    ];
    // wp-2 is transparent (skipped never gets its own arrival), so the index
    // advances through it; it only stops at wp-3, the first unreached *planned* stop.
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(1);
  });

  it("does not let a technical (route-shape-only) waypoint block progress", () => {
    // wp-2/wp-3 are technical via points (no public stop, e.g. "Borgagne" on the Otranto
    // approach): they never get their own actual_arrival_at, so they must not block the
    // chain even though they carry none — only the next real (narrative) stop can.
    const waypoints = [
      makeWaypoint("wp-1", null),
      makeTechnicalWaypoint("wp-2"),
      makeTechnicalWaypoint("wp-3"),
      makeWaypoint("wp-4", "2026-01-02T10:00:00Z"),
    ];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(3);
  });

  it("still stops at an unreached real stop that follows technical waypoints", () => {
    const waypoints = [
      makeWaypoint("wp-1", null),
      makeTechnicalWaypoint("wp-2"),
      makeWaypoint("wp-3", null),
      makeWaypoint("wp-4", "2026-01-02T10:00:00Z"),
    ];
    // wp-2 (technical) never blocks, but wp-3 is a real, unreached stop — the chain
    // stops there, at wp-2's index, even though wp-4 later does have an arrival.
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(1);
  });

  it("reaches a real stop reached via an added stop and technical via-points (Otranto/Crotone case)", () => {
    // Mirrors a real correction: an added narrative stop (Otranto) reached mid-route,
    // surrounded by technical via-points, with the originally planned stop skipped —
    // the whole stretch up to the next real, reached stop (Crotone) must count as travelled.
    const waypoints = [
      makeWaypoint("wp-departure", null),
      makeTechnicalWaypoint("wp-via-1"),
      { ...makeWaypoint("wp-added-stop", "2026-01-01T11:30:00Z"), actual_status: "added" as const },
      makeTechnicalWaypoint("wp-via-2"),
      { ...makeWaypoint("wp-skipped-stop", null), actual_status: "skipped" as const },
      makeTechnicalWaypoint("wp-via-3"),
      makeWaypoint("wp-crotone", "2026-01-02T12:30:00Z"),
    ];
    expect(getVoyageTravelledWaypointIndex(waypoints)).toBe(6);
  });
});

describe("getVoyageBoatPosition", () => {
  const makeWaypoint = (id: string, lat: number, lng: number, overrides: Partial<VoyageWaypoint> = {}): VoyageWaypoint => ({
    id,
    voyage_id: "voyage-1",
    lat,
    lng,
    name: "",
    name_en: null,
    name_it: null,
    sort_order: 0,
    waypoint_type: "narrative",
    visibility_mode: "manual",
    description_en: null,
    description_it: null,
    event_date: null,
    event_time: null,
    media: [],
    date_start: null,
    date_end: null,
    actual_arrival_at: null,
    actual_departure_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  });

  const makeTechnicalWaypoint = (id: string, lat: number, lng: number): VoyageWaypoint => ({
    ...makeWaypoint(id, lat, lng),
    waypoint_type: "technical",
    visibility_mode: "auto",
  });

  const activeVoyage = { type: "water" as const, cached_geometry: null, status: "active" as const };

  it("is null for a voyage that isn't active — planned hasn't left, completed is done travelling", () => {
    const waypoints = [makeWaypoint("wp-1", 40, 15), makeWaypoint("wp-2", 41, 16)];
    expect(getVoyageBoatPosition({ ...activeVoyage, status: "planned" }, waypoints)).toBeNull();
    expect(getVoyageBoatPosition({ ...activeVoyage, status: "completed" }, waypoints)).toBeNull();
  });

  it("is docked at the origin before it has departed", () => {
    const waypoints = [
      makeWaypoint("wp-1", 40, 15, { actual_arrival_at: "2026-01-01T09:00:00Z" }),
      makeWaypoint("wp-2", 41, 16),
    ];
    expect(getVoyageBoatPosition(activeVoyage, waypoints)).toEqual({
      status: "docked",
      lat: 40,
      lng: 15,
      waypointId: "wp-1",
    });
  });

  it("interpolates along the leg proportional to elapsed time vs. the planned ETA", () => {
    const waypoints = [
      makeWaypoint("wp-1", 40, 10, {
        actual_arrival_at: "2026-01-01T08:00:00Z",
        actual_departure_at: "2026-01-01T10:00:00Z",
      }),
      makeWaypoint("wp-2", 40, 14, { date_end: "2026-01-01T14:00:00Z" }), // 4h planned leg
    ];
    // 1h elapsed of a 4h leg => 25% of the way there.
    const position = getVoyageBoatPosition(activeVoyage, waypoints, new Date("2026-01-01T11:00:00Z"));
    expect(position?.status).toBe("in-transit");
    if (position?.status !== "in-transit") throw new Error("expected in-transit");
    expect(position.fromWaypointId).toBe("wp-1");
    expect(position.toWaypointId).toBe("wp-2");
    expect(position.fraction).toBeCloseTo(0.25, 5);
    expect(position.lat).toBeCloseTo(40, 5);
    expect(position.lng).toBeCloseTo(11, 5);
  });

  it("falls back to the midpoint when there's no usable ETA", () => {
    const waypoints = [
      makeWaypoint("wp-1", 40, 10, { actual_departure_at: "2026-01-01T10:00:00Z" }),
      makeWaypoint("wp-2", 40, 14), // no date_end
    ];
    const position = getVoyageBoatPosition(activeVoyage, waypoints, new Date("2026-01-01T11:00:00Z"));
    if (position?.status !== "in-transit") throw new Error("expected in-transit");
    expect(position.fraction).toBe(0.5);
    expect(position.lng).toBeCloseTo(12, 5);
  });

  it("stays docked at the final stop once every leg is closed", () => {
    const waypoints = [
      makeWaypoint("wp-1", 40, 10, {
        actual_arrival_at: "2026-01-01T08:00:00Z",
        actual_departure_at: "2026-01-01T10:00:00Z",
      }),
      makeWaypoint("wp-2", 41, 12, { actual_arrival_at: "2026-01-01T14:00:00Z" }),
    ];
    expect(getVoyageBoatPosition(activeVoyage, waypoints)).toEqual({
      status: "docked",
      lat: 41,
      lng: 12,
      waypointId: "wp-2",
    });
  });

  it("does not let a technical waypoint become the current leg's origin/destination", () => {
    const waypoints = [
      makeWaypoint("wp-1", 40, 10, {
        actual_arrival_at: "2026-01-01T08:00:00Z",
        actual_departure_at: "2026-01-01T10:00:00Z",
      }),
      makeTechnicalWaypoint("wp-via", 40, 12),
      makeWaypoint("wp-2", 40, 14, { date_end: "2026-01-01T14:00:00Z" }),
    ];
    const position = getVoyageBoatPosition(activeVoyage, waypoints, new Date("2026-01-01T12:00:00Z"));
    if (position?.status !== "in-transit") throw new Error("expected in-transit");
    expect(position.fromWaypointId).toBe("wp-1");
    expect(position.toWaypointId).toBe("wp-2");
  });
});

describe("getActualVoyageWaypoints", () => {
  const makeWaypoint = (id: string, actualStatus?: VoyageWaypoint["actual_status"]): VoyageWaypoint => ({
    id,
    voyage_id: "voyage-1",
    lat: 0,
    lng: 0,
    name: "",
    name_en: null,
    name_it: null,
    sort_order: 0,
    waypoint_type: "narrative",
    visibility_mode: "auto",
    description_en: null,
    description_it: null,
    event_date: null,
    event_time: null,
    media: [],
    date_start: null,
    date_end: null,
    actual_status: actualStatus,
    created_at: "",
    updated_at: "",
  });

  it("keeps planned and added stops, drops skipped ones", () => {
    const waypoints = [
      makeWaypoint("wp-1", "planned"),
      makeWaypoint("wp-2", "skipped"),
      makeWaypoint("wp-3", "added"),
      makeWaypoint("wp-4"),
    ];
    expect(getActualVoyageWaypoints(waypoints).map((w) => w.id)).toEqual(["wp-1", "wp-3", "wp-4"]);
  });
});

describe("totalCoordinateDistanceKm", () => {
  it("measures distance along the full polyline instead of the direct chord", () => {
    const directDistance = totalCoordinateDistanceKm([
      [9.0, 44.0],
      [9.2, 44.2],
    ]);
    const polylineDistance = totalCoordinateDistanceKm([
      [9.0, 44.0],
      [9.08, 44.05],
      [9.14, 44.12],
      [9.2, 44.2],
    ]);

    expect(polylineDistance).toBeGreaterThan(directDistance);
  });
});

describe("waypoint naming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a WPT fallback instead of storing coordinates as the default name", () => {
    expect(buildWaypointDefaultLocalizedNames(2, 40.1234, 18.5678)).toEqual({
      it: "WPT 03",
      en: "WPT 03",
    });
  });

  it("recognizes legacy coordinate labels so they can be treated as provisional names", () => {
    expect(isWaypointCoordinateLabel("40.12°N · 18.57°E")).toBe(true);
    expect(isWaypointCoordinateLabel("Bari")).toBe(false);
  });

  it("falls back to nearby settlements when reverse geocoding returns only generic geography", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        createJsonResponse({ address: { country: "Italia" }, display_name: "Italia" })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ address: { country: "Italy" }, display_name: "Italy" })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          elements: [
            {
              type: "node",
              lat: 41.1256,
              lon: 16.8667,
              tags: { place: "city", name: "Bari" },
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(reverseGeocodePlaceLocalized(41.05, 16.8, { maritime: true, maritimeLabelMode: "city" }))
      .resolves.toEqual({ it: "Bari", en: "Bari" });
  });
});

describe("river stretch pairing", () => {
  const flags = (...marks: boolean[]) => marks.map((river_endpoint) => ({ river_endpoint }));

  it("pairs flagged waypoints in route order and reports a trailing odd one as unpaired", () => {
    expect(getRiverMarkerRoles(flags(true, false, true, false, true, true, true))).toEqual([
      "start", null, "end", null, "start", "end", "unpaired",
    ]);
  });

  it("marks legs inside a stretch only, so river-sea-river is not one river", () => {
    // legs (into waypoint i): 0 none, 1 river, 2 river, 3 sea, 4 river
    expect(getRiverLegFlags(flags(true, false, true, false, true, true).slice(0, 5))).toEqual([
      false, true, true, false, false,
    ]);
    expect(getRiverLegFlags(flags(true, false, true, false, true, true))).toEqual([
      false, true, true, false, false, true,
    ]);
  });

  it("treats an unpaired marker as sea", () => {
    expect(getRiverLegFlags(flags(false, true, false, false))).toEqual([false, false, false, false]);
  });
});
