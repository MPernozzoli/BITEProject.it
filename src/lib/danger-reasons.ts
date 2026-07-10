import { CloudFog, Fish, LifeBuoy, Radar, Skull, Waves, Wind, type LucideIcon } from "lucide-react";
import type { Language } from "@/lib/i18n";

/** Curated catalog of specific hazards that can justify a leg's danger rating. */
export type DangerReasonKey =
  | "orca_encounter"
  | "strong_currents"
  | "strong_winds"
  | "piracy"
  | "heavy_traffic"
  | "poor_visibility"
  | "remote_rescue";

export interface DangerReasonDef {
  key: DangerReasonKey;
  icon: LucideIcon;
  label_it: string;
  label_en: string;
}

export const DANGER_REASONS: DangerReasonDef[] = [
  { key: "orca_encounter", icon: Fish, label_it: "Rischio incontro con orche", label_en: "Orca encounter risk" },
  { key: "strong_currents", icon: Waves, label_it: "Correnti molto forti", label_en: "Very strong currents" },
  { key: "strong_winds", icon: Wind, label_it: "Venti molto forti", label_en: "Very strong winds" },
  { key: "piracy", icon: Skull, label_it: "Rischio pirateria", label_en: "Piracy risk" },
  { key: "heavy_traffic", icon: Radar, label_it: "Traffico marittimo intenso", label_en: "Heavy maritime traffic" },
  { key: "poor_visibility", icon: CloudFog, label_it: "Scarsa visibilità / nebbia", label_en: "Poor visibility / fog" },
  {
    key: "remote_rescue",
    icon: LifeBuoy,
    label_it: "Zona isolata, soccorsi lontani",
    label_en: "Remote area, far from rescue",
  },
];

export const DANGER_REASON_KEYS = DANGER_REASONS.map((reason) => reason.key);

const DANGER_REASON_BY_KEY = new Map(DANGER_REASONS.map((reason) => [reason.key, reason]));

export function getDangerReasonDef(key: string): DangerReasonDef | null {
  return DANGER_REASON_BY_KEY.get(key as DangerReasonKey) ?? null;
}

export function getDangerReasonLabel(key: string, lang: Language | "it" | "en" = "it"): string {
  const def = getDangerReasonDef(key);
  if (!def) return key;
  return lang === "it" ? def.label_it : def.label_en;
}

/** Localized labels for a set of danger reason keys, dropping any unrecognized key. */
export function getDangerReasonLabels(keys: string[] | null | undefined, lang: Language | "it" | "en" = "it"): string[] {
  if (!keys?.length) return [];
  return keys.map((key) => getDangerReasonDef(key)).filter((def): def is DangerReasonDef => def != null).map((def) =>
    lang === "it" ? def.label_it : def.label_en
  );
}
