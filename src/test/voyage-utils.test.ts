import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVoyageGeometry } from "@/lib/voyage-utils";

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
});
