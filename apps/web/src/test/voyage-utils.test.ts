import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPublicVoyageGeometry, buildVoyageGeometry, buildVoyageSegmentGeometry, totalCoordinateDistanceKm, type VoyageWaypoint } from "@/lib/voyage-utils";

const createJsonResponse = (payload: unknown) =>
  Promise.resolve({
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("brouter.de/brouter");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("profile=river");
  });
});

describe("buildVoyageSegmentGeometry", () => {
  it("uses cached land geometry for article segments instead of straight waypoint chords", () => {
    const waypoints = [
      { id: "wp-1", voyage_id: "voyage-1", lat: 44.0, lng: 9.0, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 44.1, lng: 9.1, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "technical", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
      { id: "wp-3", voyage_id: "voyage-1", lat: 44.2, lng: 9.2, name: "", name_en: null, name_it: null, sort_order: 2, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
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
      { id: "wp-1", voyage_id: "voyage-1", lat: 44.0, lng: 9.0, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 44.2, lng: 9.2, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
    ] satisfies VoyageWaypoint[];

    expect(buildVoyageSegmentGeometry(waypoints, "land", 0, 1)).toEqual([]);
    expect(buildPublicVoyageGeometry(waypoints, "land")).toEqual([]);
  });

  it("slices cached waterway geometry between segment endpoints like land", () => {
    const waypoints = [
      { id: "wp-1", voyage_id: "voyage-1", lat: 48.57, lng: 7.95, name: "", name_en: null, name_it: null, sort_order: 0, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
      { id: "wp-2", voyage_id: "voyage-1", lat: 48.58, lng: 7.96, name: "", name_en: null, name_it: null, sort_order: 1, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
      { id: "wp-3", voyage_id: "voyage-1", lat: 48.59, lng: 7.97, name: "", name_en: null, name_it: null, sort_order: 2, waypoint_type: "narrative", visibility_mode: "auto", description_en: null, description_it: null, event_date: null, event_time: null, media: [], date_start: null, date_end: null, created_at: "" },
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
