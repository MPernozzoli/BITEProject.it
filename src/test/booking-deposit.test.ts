import { describe, expect, it } from "vitest";
import { type BookableLeg } from "@/lib/booking-utils";
import {
  DEPOSIT_COMPLEX_EUR,
  DEPOSIT_NORMAL_EUR,
  DEPOSIT_PER_PERSON_CAP_EUR,
  isDepositCapped,
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
  ...partial,
});

describe("booking deposit", () => {
  it("charges the normal amount for a simple leg", () => {
    expect(legDepositEur(makeLeg({}))).toBe(DEPOSIT_NORMAL_EUR);
  });

  it("charges the higher amount for an open-sea leg", () => {
    expect(legDepositEur(makeLeg({ open_sea: true }))).toBe(DEPOSIT_COMPLEX_EUR);
  });

  it("charges the higher amount when complexity is overridden to high (>= 4)", () => {
    expect(legDepositEur(makeLeg({ complexity_override: 4 }))).toBe(DEPOSIT_COMPLEX_EUR);
    expect(legDepositEur(makeLeg({ complexity_override: 3 }))).toBe(DEPOSIT_NORMAL_EUR);
  });

  it("sums per-person amounts across legs", () => {
    const legs = [makeLeg({}), makeLeg({ open_sea: true })];
    expect(perPersonDepositEur(legs)).toBe(DEPOSIT_NORMAL_EUR + DEPOSIT_COMPLEX_EUR);
  });

  it("caps the per-person amount at €250", () => {
    const legs = [
      makeLeg({ open_sea: true }),
      makeLeg({ open_sea: true }),
      makeLeg({ open_sea: true }),
    ]; // 3 × €100 = €300 → capped
    expect(perPersonDepositEur(legs)).toBe(DEPOSIT_PER_PERSON_CAP_EUR);
    expect(isDepositCapped(legs)).toBe(true);
  });

  it("multiplies the per-person amount by the party size", () => {
    const legs = [makeLeg({}), makeLeg({})]; // €50 + €50 = €100 per person
    expect(totalDepositEur(legs, 3)).toBe(300); // €100 × 3
  });

  it("treats party size < 1 as 1", () => {
    expect(totalDepositEur([makeLeg({})], 0)).toBe(DEPOSIT_NORMAL_EUR);
  });
});
