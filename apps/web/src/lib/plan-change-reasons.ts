/**
 * Reasons an admin can give when proposing a voyage plan change.
 *
 * Each reason is intrinsically either force majeure or not — the admin never ticks a separate
 * flag, so a contradictory combination (force majeure + "riorganizzazione equipaggio") cannot
 * exist. The refund owed on a declined change depends on it:
 *   - force majeure  -> the same tiers as a traveller withdrawal (100/50/0 by days to departure)
 *   - anything else  -> full refund
 *
 * The authoritative `force_majeure` boolean is derived and stored server-side by
 * `admin_propose_voyage_booking_legs` (see the migration adding `_change_reason`); the flags here
 * mirror it for the admin UI only. Keep the two lists in sync when adding a reason.
 */
export type PlanChangeReason =
  | "weather"
  | "safety"
  | "technical_failure"
  | "authority_order"
  | "health_emergency"
  | "crew_reorganization"
  | "logistics"
  | "other";

export type PlanChangeReasonOption = {
  value: PlanChangeReason;
  label: string;
  /** Mirrors the value stored server-side; drives the refund tier shown to the admin. */
  forceMajeure: boolean;
};

export const PLAN_CHANGE_REASONS: PlanChangeReasonOption[] = [
  { value: "weather", label: "Meteo o condizioni del mare avverse", forceMajeure: true },
  { value: "safety", label: "Sicurezza dell'equipaggio o dell'imbarcazione", forceMajeure: true },
  { value: "technical_failure", label: "Guasto tecnico dell'imbarcazione", forceMajeure: true },
  { value: "authority_order", label: "Provvedimento delle autorità", forceMajeure: true },
  { value: "health_emergency", label: "Emergenza sanitaria", forceMajeure: true },
  { value: "crew_reorganization", label: "Riorganizzazione dell'equipaggio", forceMajeure: false },
  { value: "logistics", label: "Esigenze logistiche o organizzative", forceMajeure: false },
  { value: "other", label: "Altro motivo non di forza maggiore", forceMajeure: false },
];

export function planChangeReasonOption(reason: string | null | undefined): PlanChangeReasonOption | null {
  if (!reason) return null;
  return PLAN_CHANGE_REASONS.find((option) => option.value === reason) ?? null;
}

export function isForceMajeureReason(reason: string | null | undefined): boolean {
  return planChangeReasonOption(reason)?.forceMajeure === true;
}
