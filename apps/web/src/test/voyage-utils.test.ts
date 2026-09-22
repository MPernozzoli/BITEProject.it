import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicVoyageGeometry,
  buildVoyageGeometry,
  buildVoyageSegmentGeometry,
  buildWaypointDefaultLocalizedNames,
  getActualVoyageWaypoints,
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

  it("builds water geometry from BRouter river segments when waterwayAutoroute is enabled", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("brouter.de")) {
        return createJsonResponse({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [7.95, 48.57],
                  [7.96, 48.58],
                ],
              },
            },
          ],
        });
      }
      // The full-chain reply has zero detail between these two vias (see patchWaterwayBeelines),
      // so it gets double-checked against coastline data; no coastline nearby here means the
      // straight chord is kept as-is.
      return createJsonResponse({ elements: [] });
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 48.57, lng: 7.95 },
        { lat: 48.58, lng: 7.96 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    expect(geometry).toEqual([
      [7.95, 48.57],
      [7.96, 48.58],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("brouter.de/brouter");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("profile=river");
  });

  it("patches a full-chain via pair that beelines across land instead of failing outright", async () => {
    // Simulates the real bug: BRouter's full-chain reply "succeeds" but has no detail at all
    // between two vias it couldn't actually connect via its river-profile graph, drawing a
    // straight line across land instead of erroring like an out-of-graph single point would.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes("brouter.de")) {
        return createJsonResponse({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                // Rich detail for leg 1 (a-b), then a bare, undetailed jump straight to c (leg 2).
                coordinates: [
                  [10, 40],
                  [10.05, 40.05],
                  [10.1, 40.1],
                  [10.4, 40.4],
                ],
              },
            },
          ],
        });
      }
      // Overpass coastline lookup for the suspect a→b beeline segment: one coastline way that the
      // straight chord from (10.1,40.1) to (10.4,40.4) crosses, forcing a detour around it.
      return createJsonResponse({
        elements: [
          {
            type: "way",
            geometry: [
              { lat: 40.3, lon: 10.15 },
              { lat: 40.15, lon: 10.3 },
            ],
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 40, lng: 10 },
        { lat: 40.1, lng: 10.1 },
        { lat: 40.4, lng: 10.4 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    // The well-detailed first leg is kept verbatim; the beelined second leg is replaced with a
    // detour (more than the original 2 bare points) instead of the land-crossing straight chord.
    expect(geometry.slice(0, 3)).toEqual([
      [10, 40],
      [10.05, 40.05],
      [10.1, 40.1],
    ]);
    expect(geometry.length).toBeGreaterThan(4);
    expect(geometry.at(-1)).toEqual([10.4, 40.4]);
  });

  it("routes waterway segment-by-segment when the full chain is not navigable in one request", async () => {
    const okSegment = {
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
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const lonlats = new URL(url).searchParams.get("lonlats") ?? "";
      const viaCount = lonlats.split("|").length;
      // Full-chain request (3 vias) is not navigable → BRouter 400.
      if (viaCount > 2) return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      // Second leg (7.96,48.58 → 7.97,48.59) has no waterway → 400; first leg routes fine.
      if (lonlats.startsWith("7.96,48.58")) {
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }
      return createJsonResponse(okSegment);
    });

    vi.stubGlobal("fetch", fetchMock);

    const geometry = await buildVoyageGeometry(
      [
        { lat: 48.57, lng: 7.95 },
        { lat: 48.58, lng: 7.96 },
        { lat: 48.59, lng: 7.97 },
      ],
      "water",
      { waterwayAutoroute: true }
    );

    // First leg follows the waterway; the un-navigable second leg falls back to open-sea routing,
    // which (no coastline data mocked here) resolves to a straight chord.
    expect(geometry).toEqual([
      [7.95, 48.57],
      [7.955, 48.575],
      [7.96, 48.58],
      [7.97, 48.59],
    ]);
    // 1 full-chain attempt + 2 per-segment BRouter requests + 1 Overpass coastline lookup for the
    // un-navigable second leg.
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
