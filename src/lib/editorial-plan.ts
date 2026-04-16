import { addDays, format, startOfDay } from "date-fns";

export type EditorialArticleType = "pillar" | "support" | "utility_reflection";

export const EDITORIAL_PLAN_SETTINGS_ID = "a0000000-0000-4000-8000-000000000001";

export const EDITORIAL_TYPE_ORDER: EditorialArticleType[] = ["pillar", "support", "utility_reflection"];

export type EditorialMix = {
  mix_pillar: number;
  mix_support: number;
  mix_utility: number;
};

export type ArticleForPlan = {
  id: string;
  status: "draft" | "scheduled" | "published";
  editorial_type: EditorialArticleType | null;
};

export type SlotForPlan = {
  id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  suggested_type: EditorialArticleType | null;
  override_type: EditorialArticleType | null;
  assigned_article_id: string | null;
  template_id: string | null;
};

export type WeeklyTemplate = {
  id: string;
  day_of_week: number;
  time_of_day: string;
  sort_order: number;
};

function mixForType(type: EditorialArticleType, mix: EditorialMix): number {
  if (type === "pillar") return mix.mix_pillar;
  if (type === "support") return mix.mix_support;
  return mix.mix_utility;
}

/** Conteggi da articoli pubblicati/programmati + bozze assegnate a slot (non doppiando id già contati). */
export function computeTypeDistribution(
  articles: ArticleForPlan[],
  slots: SlotForPlan[]
): Record<EditorialArticleType, number> {
  const counts: Record<EditorialArticleType, number> = {
    pillar: 0,
    support: 0,
    utility_reflection: 0,
  };
  const countedArticleIds = new Set<string>();

  for (const a of articles) {
    if ((a.status === "published" || a.status === "scheduled") && a.editorial_type) {
      counts[a.editorial_type]++;
      countedArticleIds.add(a.id);
    }
  }

  for (const s of slots) {
    if (s.status !== "assigned" || !s.assigned_article_id) continue;
    if (countedArticleIds.has(s.assigned_article_id)) continue;
    const art = articles.find((x) => x.id === s.assigned_article_id);
    const eff =
      (art?.editorial_type as EditorialArticleType | null | undefined) ??
      s.override_type ??
      s.suggested_type;
    if (eff) {
      counts[eff]++;
      countedArticleIds.add(s.assigned_article_id);
    }
  }

  return counts;
}

export function pickSuggestedType(
  counts: Record<EditorialArticleType, number>,
  mix: EditorialMix
): EditorialArticleType {
  const total = counts.pillar + counts.support + counts.utility_reflection;
  const n = Math.max(total, 1);

  const gaps = EDITORIAL_TYPE_ORDER.map((t) => {
    const ideal = (mixForType(t, mix) / 100) * n;
    const actual = counts[t];
    return { type: t, gap: ideal - actual };
  });

  gaps.sort((a, b) => b.gap - a.gap);
  const best = gaps[0]?.gap ?? 0;
  const tied = gaps.filter((g) => Math.abs(g.gap - best) < 1e-9).map((g) => g.type);
  for (const t of EDITORIAL_TYPE_ORDER) {
    if (tied.includes(t)) return t;
  }
  return "support";
}

export function effectiveSlotType(slot: SlotForPlan, article?: ArticleForPlan | null): EditorialArticleType | null {
  return (
    (article?.editorial_type as EditorialArticleType | null | undefined) ??
    slot.override_type ??
    slot.suggested_type
  );
}

/** Ricalcola suggested_type per slot aperti senza override, in ordine cronologico. */
export function recomputeOpenSlotSuggestions(
  slots: SlotForPlan[],
  articles: ArticleForPlan[],
  mix: EditorialMix
): { id: string; suggested_type: EditorialArticleType }[] {
  const base = { ...computeTypeDistribution(articles, slots) };
  const sorted = [...slots].sort((a, b) => {
    const dc = a.slot_date.localeCompare(b.slot_date);
    if (dc !== 0) return dc;
    return normalizeTime(a.slot_time).localeCompare(normalizeTime(b.slot_time));
  });

  const updates: { id: string; suggested_type: EditorialArticleType }[] = [];

  for (const s of sorted) {
    if (s.status !== "open") continue;
    if (s.override_type) {
      base[s.override_type]++;
      continue;
    }
    const pick = pickSuggestedType(base, mix);
    base[pick]++;
    updates.push({ id: s.id, suggested_type: pick });
  }

  return updates;
}

export function normalizeTime(t: string): string {
  if (t.length >= 8 && t.includes(":")) return t.slice(0, 8);
  if (t.length === 5) return `${t}:00`;
  return t;
}

export function slotDateTimeKey(slot_date: string, slot_time: string): string {
  return `${slot_date}T${normalizeTime(slot_time)}`;
}

/** Occorrenze (data, ora) da oggi fino a endDate incluso, da template settimanali. */
export function enumerateSlotOccurrences(
  fromDay: Date,
  endDay: Date,
  templates: WeeklyTemplate[]
): { slot_date: string; slot_time: string; template_id: string }[] {
  const sortedTemplates = [...templates].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return normalizeTime(a.time_of_day).localeCompare(normalizeTime(b.time_of_day));
  });

  const out: { slot_date: string; slot_time: string; template_id: string }[] = [];
  const start = startOfDay(fromDay);
  const end = startOfDay(endDay);

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    for (const t of sortedTemplates) {
      if (t.day_of_week !== dow) continue;
      out.push({
        slot_date: format(d, "yyyy-MM-dd"),
        slot_time: normalizeTime(t.time_of_day),
        template_id: t.id,
      });
    }
  }

  out.sort((a, b) => slotDateTimeKey(a.slot_date, a.slot_time).localeCompare(slotDateTimeKey(b.slot_date, b.slot_time)));
  return out;
}

export type NewSlotRow = {
  slot_date: string;
  slot_time: string;
  template_id: string;
  suggested_type: EditorialArticleType;
  status: "open";
};

/**
 * Calcola slot mancanti nel range [fromDay, fromDay + horizonWeeks settimane].
 * Non modifica il DB: restituisce righe da inserire.
 */
export function ensureSlotsForHorizon(
  fromDay: Date,
  horizonWeeks: number,
  templates: WeeklyTemplate[],
  existingSlots: SlotForPlan[],
  articles: ArticleForPlan[],
  mix: EditorialMix
): NewSlotRow[] {
  if (templates.length === 0) return [];

  const fromStr = format(startOfDay(fromDay), "yyyy-MM-dd");
  const endDay = addDays(startOfDay(fromDay), horizonWeeks * 7 - 1);
  const candidates = enumerateSlotOccurrences(fromDay, endDay, templates);
  const existingKeys = new Set(existingSlots.map((s) => slotDateTimeKey(s.slot_date, s.slot_time)));

  const phantoms: SlotForPlan[] = [];
  for (const c of candidates) {
    const key = slotDateTimeKey(c.slot_date, c.slot_time);
    if (existingKeys.has(key)) continue;
    if (c.slot_date < fromStr) continue;
    phantoms.push({
      id: `phantom-${key}`,
      slot_date: c.slot_date,
      slot_time: c.slot_time,
      status: "open",
      suggested_type: null,
      override_type: null,
      assigned_article_id: null,
      template_id: c.template_id,
    });
  }

  if (phantoms.length === 0) return [];

  const allSorted = [...existingSlots, ...phantoms].sort((a, b) => {
    const dc = a.slot_date.localeCompare(b.slot_date);
    if (dc !== 0) return dc;
    return normalizeTime(a.slot_time).localeCompare(normalizeTime(b.slot_time));
  });

  const counts = { ...computeTypeDistribution(articles, existingSlots) };
  const newRows: NewSlotRow[] = [];

  for (const s of allSorted) {
    if (!s.id.startsWith("phantom-")) {
      if (s.status === "assigned") {
        const art = articles.find((a) => a.id === s.assigned_article_id);
        const eff = effectiveSlotType(s, art ?? null);
        if (eff) counts[eff]++;
      } else if (s.status === "open") {
        const eff = s.override_type ?? s.suggested_type;
        if (eff) counts[eff]++;
      }
      continue;
    }

    const pick = pickSuggestedType(counts, mix);
    counts[pick]++;
    newRows.push({
      slot_date: s.slot_date,
      slot_time: s.slot_time,
      template_id: s.template_id!,
      suggested_type: pick,
      status: "open",
    });
  }

  return newRows;
}

export const EDITORIAL_TYPE_LABELS: Record<EditorialArticleType, string> = {
  pillar: "Pillar",
  support: "Support",
  utility_reflection: "Utility / Reflection",
};

export const WEEKDAY_LABELS_IT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
