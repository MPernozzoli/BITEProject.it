/**
 * Voyage contribution computation, shared between the client (display) and the
 * server (authoritative amount charged via Bunq). Kept dependency-free apart from the
 * pure complexity helpers in booking-utils so it can be bundled into a Vercel function.
 *
 * Rules (agreed with the crew):
 *  - €20 fixed minimum per person, independent of how many legs are selected.
 *  - Variable part = planned nautical miles × configurable EUR/NM coefficient.
 *  - Modifiers are additive on each leg's variable part: night +10%, offshore +20%, danger +20%.
 *  - The total charged is the per-person amount multiplied by the party size.
 *
 * The contribution covers navigation and vessel operating expenses during the crossing.
 * Food expenses remain managed on board during the voyage and are not included here.
 */
import { getLegDangerLevel, legHasNightNavigation, type BookableLeg } from "./booking-utils.js";

export const CONTRIBUTION_FIXED_MINIMUM_EUR = 20;
export const DEFAULT_CONTRIBUTION_PER_NM_EUR = 0.9;
export const NIGHT_NAVIGATION_MODIFIER = 0.1;
export const OFFSHORE_NAVIGATION_MODIFIER = 0.2;
export const DANGEROUS_NAVIGATION_MODIFIER = 0.2;
export const BUNQ_SINGLE_TRANSACTION_LIMIT_EUR = 500;

/** Legs only need the fields that feed contribution calculation. */
export type DepositLeg = Pick<
  BookableLeg,
  | "open_sea"
  | "danger_level"
  | "planned_nautical_miles"
  | "starts_at_window_start"
  | "ends_at_window_start"
>;

export type ContributionOptions = {
  contributionPerNmEur?: number | null;
};

function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function contributionPerNmEur(value?: number | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CONTRIBUTION_PER_NM_EUR;
}

export function plannedNauticalMiles(leg: Pick<BookableLeg, "planned_nautical_miles">): number {
  const nm = Number(leg.planned_nautical_miles ?? 0);
  return Number.isFinite(nm) && nm > 0 ? nm : 0;
}

export function legContributionModifier(leg: DepositLeg): number {
  let modifier = 1;
  if (legHasNightNavigation(leg)) modifier += NIGHT_NAVIGATION_MODIFIER;
  if (leg.open_sea === true) modifier += OFFSHORE_NAVIGATION_MODIFIER;
  if (getLegDangerLevel(leg) > 0) modifier += DANGEROUS_NAVIGATION_MODIFIER;
  return modifier;
}

/** Variable contribution (EUR) attributable to a single leg, per person. */
export function legDepositEur(leg: DepositLeg, opts: ContributionOptions = {}): number {
  const rate = contributionPerNmEur(opts.contributionPerNmEur);
  return roundCurrency(plannedNauticalMiles(leg) * rate * legContributionModifier(leg));
}

/** Per-person voyage contribution across the selected legs. */
export function perPersonDepositEur(legs: DepositLeg[], opts: ContributionOptions = {}): number {
  if (legs.length === 0) return 0;
  const variable = legs.reduce((acc, leg) => acc + legDepositEur(leg, opts), 0);
  return roundCurrency(CONTRIBUTION_FIXED_MINIMUM_EUR + variable);
}

/** Total contribution charged to the booker: per-person amount × party size. */
export function totalDepositEur(legs: DepositLeg[], partySize: number, opts: ContributionOptions = {}): number {
  return roundCurrency(perPersonDepositEur(legs, opts) * Math.max(1, Math.floor(partySize) || 1));
}

export type PaymentMode = "lead_pays_all" | "each_pays_own";

/**
 * Contribution charged to a single payer given the payment mode:
 *  - the lead in "lead_pays_all" covers the whole party (× party size);
 *  - everyone else (the lead in "each_pays_own", or a guest) pays for one.
 */
export function depositForPayerEur(
  legs: DepositLeg[],
  opts: { isLead: boolean; paymentMode: PaymentMode; partySize: number },
  contributionOpts: ContributionOptions = {},
): number {
  const perPerson = perPersonDepositEur(legs, contributionOpts);
  const multiplier = opts.isLead && opts.paymentMode === "lead_pays_all"
    ? Math.max(1, Math.floor(opts.partySize) || 1)
    : 1;
  return roundCurrency(perPerson * multiplier);
}

export function getContributionExplanation(
  legs: DepositLeg[],
  opts: ContributionOptions & { lang?: "it" | "en" } = {},
): string {
  const lang = opts.lang ?? "it";
  const selectionLabel =
    legs.length > 1
      ? lang === "en"
        ? "the selected legs"
        : "le tratte selezionate"
      : lang === "en"
        ? "the selected leg"
        : "la tratta selezionata";

  if (lang === "en") {
    return `The contribution is estimated using a mileage coefficient applied to ${selectionLabel}, so the voyage's out-of-pocket costs can be shared evenly among all participants. It is not a ticket price, a service fee or a charter fare.`;
  }

  return `La quota viene stimata usando un coefficiente chilometrico applicato a ${selectionLabel}, così da ripartire in modo uniforme tra tutti i partecipanti le spese vive del viaggio. Non è il prezzo di un biglietto, di un servizio o di un'attività charter.`;
}

/** Format a EUR amount with the correct locale separators. */
export function formatDepositEur(amountEur: number, lang: "it" | "en" = "it"): string {
  return new Intl.NumberFormat(lang === "it" ? "it-IT" : "en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(amountEur);
}
