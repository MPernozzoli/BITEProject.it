import { describe, expect, it } from "vitest";
import {
  getVoyageJoinCta,
  getVoyageJoinSteps,
  summarizeLegSelection,
} from "@/lib/voyage-join-flow";

const leg = (id: string, from: string, to: string, nm: number) => ({
  id,
  from_waypoint_id: from,
  to_waypoint_id: to,
  planned_nautical_miles: nm,
});

const legs = [
  leg("a", "w1", "w2", 120),
  leg("b", "w2", "w3", 80.4),
  leg("c", "w3", "w4", 40),
];

const label = (waypointId: string) =>
  ({ w1: "Atene", w2: "Kalamata", w3: "Siracusa", w4: "Palermo" })[waypointId] ?? "?";

describe("getVoyageJoinCta", () => {
  it("offers to open the selection before anything is tapped", () => {
    const cta = getVoyageJoinCta(
      { stage: "intro", selectedCount: 0, anchorOpen: false, hasSelectableLegs: true },
      "it"
    );
    expect(cta.kind).toBe("start");
    expect(cta.enabled).toBe(true);
    expect(cta.label).toBe("Partecipa");
  });

  it("refuses to move on with nothing selected, but says what is missing", () => {
    const cta = getVoyageJoinCta(
      { stage: "picking", selectedCount: 0, anchorOpen: false, hasSelectableLegs: true },
      "it"
    );
    expect(cta.kind).toBe("continue");
    expect(cta.enabled).toBe(false);
    expect(cta.helper).toContain("imbarcarti");
  });

  it("lets an open range continue while still inviting the second tap", () => {
    const cta = getVoyageJoinCta(
      { stage: "picking", selectedCount: 1, anchorOpen: true, hasSelectableLegs: true },
      "it"
    );
    expect(cta.enabled).toBe(true);
    expect(cta.label).toContain("1 tratta");
    expect(cta.helper).toContain("sbarcare");
  });

  it("counts the legs of a closed range in the label", () => {
    const cta = getVoyageJoinCta(
      { stage: "picking", selectedCount: 3, anchorOpen: false, hasSelectableLegs: true },
      "en"
    );
    expect(cta.enabled).toBe(true);
    expect(cta.label).toBe("Next · 3 legs");
  });

  it("closes the flow when no leg can be booked at all", () => {
    const cta = getVoyageJoinCta(
      { stage: "intro", selectedCount: 0, anchorOpen: false, hasSelectableLegs: false },
      "it"
    );
    expect(cta.kind).toBe("closed");
    expect(cta.enabled).toBe(false);
  });

  it("always explains itself, whatever the state", () => {
    const states = [
      { stage: "intro" as const, selectedCount: 0, anchorOpen: false, hasSelectableLegs: true },
      { stage: "picking" as const, selectedCount: 0, anchorOpen: false, hasSelectableLegs: true },
      { stage: "picking" as const, selectedCount: 1, anchorOpen: true, hasSelectableLegs: true },
      { stage: "picking" as const, selectedCount: 2, anchorOpen: false, hasSelectableLegs: true },
      { stage: "picking" as const, selectedCount: 0, anchorOpen: false, hasSelectableLegs: false },
    ];
    for (const lang of ["it", "en"] as const) {
      for (const state of states) {
        const cta = getVoyageJoinCta(state, lang);
        expect(cta.label.length).toBeGreaterThan(0);
        expect(cta.helper.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getVoyageJoinSteps", () => {
  it("marks the past steps done and the rest still to do", () => {
    const steps = getVoyageJoinSteps(2, "it");
    expect(steps.map((step) => step.state)).toEqual(["done", "active", "todo"]);
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3]);
  });
});

describe("summarizeLegSelection", () => {
  it("reads in the direction of travel even when the range was tapped backwards", () => {
    const summary = summarizeLegSelection(legs, ["c", "b"], label);
    expect(summary.count).toBe(2);
    expect(summary.fromLabel).toBe("Kalamata");
    expect(summary.toLabel).toBe("Palermo");
    expect(summary.nauticalMiles).toBe(120);
  });

  it("returns an empty summary when nothing is selected", () => {
    expect(summarizeLegSelection(legs, [], label)).toEqual({
      count: 0,
      fromLabel: null,
      toLabel: null,
      nauticalMiles: 0,
    });
  });

  it("ignores ids that are not on this voyage", () => {
    const summary = summarizeLegSelection(legs, ["a", "does-not-exist"], label);
    expect(summary.count).toBe(1);
    expect(summary.fromLabel).toBe("Atene");
    expect(summary.toLabel).toBe("Kalamata");
  });
});
