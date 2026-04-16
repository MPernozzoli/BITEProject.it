import { describe, expect, it } from "vitest";

import { buildMapPresenceMarkers, mergeMapPresenceTrackers } from "@/lib/map-presence";

describe("buildMapPresenceMarkers", () => {
  it("shows boat and crew markers when both are visible and separate", () => {
    const trackerMap = mergeMapPresenceTrackers([]);
    trackerMap.boat.latitude = 45.44;
    trackerMap.boat.longitude = 12.33;
    trackerMap.crew.latitude = 45.45;
    trackerMap.crew.longitude = 12.34;

    const markers = buildMapPresenceMarkers([trackerMap.boat, trackerMap.crew], "it");

    expect(markers).toHaveLength(2);
    expect(markers[0]?.kind).toBe("boat");
    expect(markers[1]?.kind).toBe("crew");
  });

  it("hides the crew marker and switches the boat variant when the crew is onboard", () => {
    const trackerMap = mergeMapPresenceTrackers([]);
    trackerMap.boat.latitude = 45.44;
    trackerMap.boat.longitude = 12.33;
    trackerMap.crew.latitude = 45.45;
    trackerMap.crew.longitude = 12.34;
    trackerMap.crew.is_onboard = true;

    const markers = buildMapPresenceMarkers([trackerMap.boat, trackerMap.crew], "en");

    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("boat-aboard");
    expect(markers[0]?.description).toContain("Crew onboard.");
  });
});
