import { describe, expect, it } from "vitest";
import { type BookableLeg } from "@/lib/booking-utils";
import {
  CONTRIBUTION_FIXED_MINIMUM_EUR,
  DEFAULT_CONTRIBUTION_PER_NM_EUR,
  DEPOSIT_CAP_EUR,
  depositForPayerEur,
  depositTargetEur,
  legDepositEur,
  perPersonDepositEur,
  totalDepositEur,
} from "@/lib/booking-deposit";

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
  planned_nautical_miles: 10,
  ...partial,
});

describe("booking deposit", () => {
  it("charges planned nautical miles at the default coefficient", () => {
    expect(legDepositEur(makeLeg({ planned_nautical_miles: 10 }))).toBe(9);
  });

  it("uses a custom per-NM coefficient", () => {
    expect(legDepositEur(makeLeg({ planned_nautical_miles: 10 }), { contributionPerNmEur: 1.25 })).toBe(12.5);
  });

  it("adds the offshore modifier for navigazione d'altura", () => {
    expect(legDepositEur(makeLeg({ planned_nautical_miles: 10, open_sea: true }))).toBe(10.8);
  });

  it("adds the night-navigation modifier", () => {
    const leg = makeLeg({
      planned_nautical_miles: 10,
      starts_at_window_start: "2026-09-10T21:00:00Z",
      ends_at_window_start: "2026-09-11T02:00:00Z",
    });
    expect(legDepositEur(leg)).toBe(9.9);
  });

  it("adds the dangerous-navigation modifier for any danger level", () => {
    expect(legDepositEur(makeLeg({ planned_nautical_miles: 10, danger_level: 1 }))).toBe(10.8);
  });

  it("combines modifiers additively on the variable part", () => {
    const leg = makeLeg({
      planned_nautical_miles: 10,
      open_sea: true,
      danger_level: 2,
      starts_at_window_start: "2026-09-10T21:00:00Z",
      ends_at_window_start: "2026-09-11T02:00:00Z",
    });
    expect(legDepositEur(leg)).toBe(13.5);
  });

  it("adds the fixed minimum once per person", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 }), makeLeg({ planned_nautical_miles: 20 })];
    expect(perPersonDepositEur(legs)).toBe(CONTRIBUTION_FIXED_MINIMUM_EUR + (30 * DEFAULT_CONTRIBUTION_PER_NM_EUR));
  });

  it("can skip the fixed minimum when already applied on the voyage", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 }), makeLeg({ planned_nautical_miles: 20 })];
    expect(perPersonDepositEur(legs, { fixedMinimumEur: 0 })).toBe(30 * DEFAULT_CONTRIBUTION_PER_NM_EUR);
  });

  it("rounds the per-person amount up to the next whole euro", () => {
    const legs = [makeLeg({ planned_nautical_miles: 92.72 })]; // €20 + €83.45 = €103.45 -> €104
    expect(perPersonDepositEur(legs)).toBe(104);
  });

  it("multiplies the per-person amount by the party size", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 })]; // €20 + €9 = €29 per person
    expect(totalDepositEur(legs, 3)).toBe(87);
  });

  it("treats party size < 1 as 1", () => {
    expect(totalDepositEur([makeLeg({ planned_nautical_miles: 10 })], 0)).toBe(29);
  });

  it("charges the lead the whole party in lead_pays_all", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 })]; // €29 per person
    expect(depositForPayerEur(legs, { isLead: true, paymentMode: "lead_pays_all", partySize: 3 })).toBe(87);
  });

  it("does not multiply a skipped voyage fixed minimum in lead_pays_all", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 })]; // €9 per person without the fixed minimum
    expect(
      depositForPayerEur(
        legs,
        { isLead: true, paymentMode: "lead_pays_all", partySize: 3 },
        { fixedMinimumEur: 0 },
      ),
    ).toBe(27);
  });

  it("charges the lead only their share in each_pays_own", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 })];
    expect(depositForPayerEur(legs, { isLead: true, paymentMode: "each_pays_own", partySize: 3 })).toBe(29);
  });

  it("charges a guest only their own share regardless of mode", () => {
    const legs = [makeLeg({ planned_nautical_miles: 10 })]; // €29 per person
    expect(depositForPayerEur(legs, { isLead: false, paymentMode: "lead_pays_all", partySize: 4 })).toBe(29);
    expect(depositForPayerEur(legs, { isLead: false, paymentMode: "each_pays_own", partySize: 4 })).toBe(29);
  });
});

describe("deposit target (acconto)", () => {
  it("is 50% of the total contribution", () => {
    expect(depositTargetEur(100)).toBe(50);
    expect(depositTargetEur(29)).toBe(14.5);
  });

  it("is capped at €499 regardless of how large the total is", () => {
    expect(DEPOSIT_CAP_EUR).toBe(499);
    expect(depositTargetEur(1000)).toBe(499);
    expect(depositTargetEur(998)).toBe(499);
    expect(depositTargetEur(997)).toBeCloseTo(498.5);
  });

  it("never exceeds the total itself for small contributions", () => {
    expect(depositTargetEur(20)).toBe(10);
  });

  /**
   * Mirrors the phase decision in resolveDepositPayer (deposit-resolver.ts): the first
   * payment(s) collect up to the deposit target, and only once that is reached does a further
   * payment collect (the rest of) the balance.
   */
  function resolvePhase(totalDueEur: number, alreadyPaidEur: number) {
    const target = depositTargetEur(totalDueEur);
    const phase = alreadyPaidEur < target ? "deposit" : "balance";
    const amountEur = Math.round(((phase === "deposit" ? target : totalDueEur) - alreadyPaidEur) * 100) / 100;
    return { phase, amountEur };
  }

  it("collects the deposit first when nothing has been paid yet", () => {
    expect(resolvePhase(200, 0)).toEqual({ phase: "deposit", amountEur: 100 });
  });

  it("collects the balance once the deposit target has been met", () => {
    expect(resolvePhase(200, 100)).toEqual({ phase: "balance", amountEur: 100 });
  });

  it("collects the remainder of a still-short deposit before ever asking for the balance", () => {
    // A route change raised the total after a partial deposit payment: still short of the
    // (now higher) deposit target, so the next payment tops up the deposit, not the balance.
    expect(resolvePhase(300, 100)).toEqual({ phase: "deposit", amountEur: 50 });
  });

  it("caps the deposit at €499 even for a large lead_pays_all party", () => {
    expect(resolvePhase(1200, 0)).toEqual({ phase: "deposit", amountEur: 499 });
    expect(resolvePhase(1200, 499)).toEqual({ phase: "balance", amountEur: 701 });
  });
});
