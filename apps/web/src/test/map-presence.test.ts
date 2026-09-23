import { describe, expect, it } from "vitest";

import { buildMapPresenceMarkers, mergeMapPresenceTrackers } from "@/lib/map-presence";

describe("buildMapPresenceMarkers", () => {
  it("shows only the crew marker — the boat marker is derived elsewhere from voyage actuals", () => {
    const trackerMap = mergeMapPresenceTrackers([]);
    trackerMap.boat.latitude = 45.44;
    trackerMap.boat.longitude = 12.33;
    trackerMap.crew.latitude = 45.45;
    trackerMap.crew.longitude = 12.34;

    const markers = buildMapPresenceMarkers([trackerMap.boat, trackerMap.crew], "it");

    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("crew");
  });

  it("hides the crew marker while the crew is onboard", () => {
    const trackerMap = mergeMapPresenceTrackers([]);
    trackerMap.crew.latitude = 45.45;
    trackerMap.crew.longitude = 12.34;
    trackerMap.crew.is_onboard = true;

    const markers = buildMapPresenceMarkers([trackerMap.crew], "en");

    expect(markers).toHaveLength(0);
  });
});
