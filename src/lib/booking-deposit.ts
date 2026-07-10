/**
 * Security-deposit ("caparra") computation, shared between the client (display) and the
 * server (authoritative amount charged via Bunq). Kept dependency-free apart from the
 * pure complexity helpers in booking-utils so it can be bundled into a Vercel function.
 *
 * Rules (agreed with the crew):
 *  - €50 per bookable leg by default.
 *  - €100 per leg when the leg is open-sea OR its effective complexity is "high" (>= 4).
 *  - Per-person amounts sum across the selected legs, capped at €250 per person.
 *  - The total charged is the per-person amount multiplied by the party size.
 *
 * The deposit is a refundable commitment, NOT a ticket or fare — see the disclaimer copy
 * surfaced in the booking confirmation modal.
 */
import { getLegComplexity, type BookableLeg } from "./booking-utils";

export const DEPOSIT_NORMAL_EUR = 50;
export const DEPOSIT_COMPLEX_EUR = 100;
export const DEPOSIT_PER_PERSON_CAP_EUR = 250;
/** Effective complexity at or above which a leg counts as "high complexity". */
export const DEPOSIT_HIGH_COMPLEXITY_MIN = 4;

/** Legs only need the fields that feed complexity + the open_sea flag. */
export type DepositLeg = Pick<
  BookableLeg,
  | "open_sea"
  | "complexity_override"
  | "danger_level"
  | "starts_at_window_start"
  | "starts_at_window_end"
  | "ends_at_window_start"
  | "ends_at_window_end"
>;

/** Deposit (EUR) attributable to a single leg, per person. */
export function legDepositEur(leg: DepositLeg): number {
  const highComplexity =
    leg.open_sea === true || getLegComplexity(leg as BookableLeg) >= DEPOSIT_HIGH_COMPLEXITY_MIN;
  return highComplexity ? DEPOSIT_COMPLEX_EUR : DEPOSIT_NORMAL_EUR;
}

/** Per-person deposit across the selected legs, capped at {@link DEPOSIT_PER_PERSON_CAP_EUR}. */
export function perPersonDepositEur(legs: DepositLeg[]): number {
  const sum = legs.reduce((acc, leg) => acc + legDepositEur(leg), 0);
  return Math.min(DEPOSIT_PER_PERSON_CAP_EUR, sum);
}

/** Total deposit charged to the booker: per-person amount × party size. */
export function totalDepositEur(legs: DepositLeg[], partySize: number): number {
  return perPersonDepositEur(legs) * Math.max(1, Math.floor(partySize) || 1);
}

export type PaymentMode = "lead_pays_all" | "each_pays_own";

/**
 * Deposit charged to a single payer given the payment mode:
 *  - the lead in "lead_pays_all" covers the whole party (× party size);
 *  - everyone else (the lead in "each_pays_own", or a guest) pays for one.
 */
export function depositForPayerEur(
  legs: DepositLeg[],
  opts: { isLead: boolean; paymentMode: PaymentMode; partySize: number },
): number {
  const perPerson = perPersonDepositEur(legs);
  const multiplier = opts.isLead && opts.paymentMode === "lead_pays_all"
    ? Math.max(1, Math.floor(opts.partySize) || 1)
    : 1;
  return perPerson * multiplier;
}

/** Whether the per-person deposit hit the cap (useful to explain the €250 ceiling in the UI). */
export function isDepositCapped(legs: DepositLeg[]): boolean {
  const rawSum = legs.reduce((acc, leg) => acc + legDepositEur(leg), 0);
  return rawSum > DEPOSIT_PER_PERSON_CAP_EUR;
}

/** Format an integer-EUR amount as "€50,00" (it) / "€50.00" (en). */
export function formatDepositEur(amountEur: number, lang: "it" | "en" = "it"): string {
  return new Intl.NumberFormat(lang === "it" ? "it-IT" : "en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(amountEur);
}
