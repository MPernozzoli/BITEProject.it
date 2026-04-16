import { addDays, format, startOfDay } from "date-fns";

export type EditorialArticleType = "pillar" | "support" | "utility_reflection";

export type EditorialChannelCode = "site" | "youtube" | "tiktok" | "instagram_bite" | "instagram_dogs";

/** UUID fissi (allineati a supabase/migrations/20260417120000_editorial_channels_and_social.sql) */
export const EDITORIAL_CHANNEL_IDS: Record<EditorialChannelCode, string> = {
  site: "11111111-1111-4111-8111-111111110001",
  youtube: "11111111-1111-4111-8111-111111110002",
  tiktok: "11111111-1111-4111-8111-111111110003",
  instagram_bite: "11111111-1111-4111-8111-111111110004",
  instagram_dogs: "11111111-1111-4111-8111-111111110005",
};

export const EDITORIAL_CHANNEL_ORDER: EditorialChannelCode[] = [
  "site",
  "youtube",
  "tiktok",
  "instagram_bite",
  "instagram_dogs",
];

export const EDITORIAL_CHANNEL_LABELS: Record<EditorialChannelCode, string> = {
  site: "Sito",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram_bite: "Instagram BITE",
  instagram_dogs: "Instagram cani",
};

/** Valore `provider` consigliato per `social_oauth_connections` (allineato alla UI impostazioni). */
export function oauthProviderForChannel(code: EditorialChannelCode): string {
  if (code === "youtube") return "google_youtube";
  if (code === "tiktok") return "tiktok";
  if (code === "instagram_bite" || code === "instagram_dogs") return "meta_instagram";
  return "site";
}

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
  channel_id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  suggested_type: EditorialArticleType | null;
  override_type: EditorialArticleType | null;
  assigned_article_id: string | null;
  template_id: string | null;
  content_format: string | null;
  counts_toward_mix: boolean;
};

export type WeeklyTemplate = {
  id: string;
  channel_id: string;
  day_of_week: number;
  time_of_day: string;
  sort_order: number;
  content_format: string | null;
};

export type PublishTargetForMix = {
  id: string;
  status: string;
  editorial_plan_slot_id: string | null;
  editorial_type: EditorialArticleType | null;
};

function mixForType(type: EditorialArticleType, mix: EditorialMix): number {
  if (type === "pillar") return mix.mix_pillar;
  if (type === "support") return mix.mix_support;
  return mix.mix_utility;
}

export function defaultCountsTowardMix(contentFormat: string | null): boolean {
  if (contentFormat === "ig_story") return false;
  return true;
}

/** Conteggi da articoli pubblicati/programmati + bozze assegnate a slot (solo slot che contano nel mix). */
export function computeTypeDistribution(articles: ArticleForPlan[], slots: SlotForPlan[]): Record<EditorialArticleType, number> {
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
    if (s.counts_toward_mix === false) continue;
    if (s.status !== "assigned" || !s.assigned_article_id) continue;
    if (countedArticleIds.has(s.assigned_article_id)) continue;
    const art = articles.find((x) => x.id === s.assigned_article_id);
    const eff =
      (art?.editorial_type as EditorialArticleType | null | undefined) ?? s.override_type ?? s.suggested_type;
    if (eff) {
      counts[eff]++;
      countedArticleIds.add(s.assigned_article_id);
    }
  }

  return counts;
}

/** Mix social: target non cancellati con tipo asset; esclude slot legati con counts_toward_mix false. */
export function computeSocialTypeDistribution(
  targets: PublishTargetForMix[],
  slotsById: Map<string, SlotForPlan>
): Record<EditorialArticleType, number> {
  const counts: Record<EditorialArticleType, number> = {
    pillar: 0,
    support: 0,
    utility_reflection: 0,
  };
  for (const t of targets) {
    if (t.status === "cancelled") continue;
    if (!t.editorial_type) continue;
    if (t.editorial_plan_slot_id) {
      const slot = slotsById.get(t.editorial_plan_slot_id);
      if (slot && slot.counts_toward_mix === false) continue;
    }
    counts[t.editorial_type]++;
  }
  return counts;
}

export function pickSuggestedType(counts: Record<EditorialArticleType, number>, mix: EditorialMix): EditorialArticleType {
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
    (article?.editorial_type as EditorialArticleType | null | undefined) ?? slot.override_type ?? slot.suggested_type
  );
}

/** Ricalcola suggested_type per slot aperti senza override, in ordine cronologico (solo slot che contano nel mix). */
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
    if (s.counts_toward_mix === false) continue;
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

export function slotChannelDateTimeKey(channel_id: string, slot_date: string, slot_time: string): string {
  return `${channel_id}|${slotDateTimeKey(slot_date, slot_time)}`;
}

/** Occorrenze (data, ora, formato template) da oggi fino a endDate incluso. */
export function enumerateSlotOccurrences(
  fromDay: Date,
  endDay: Date,
  templates: WeeklyTemplate[]
): { slot_date: string; slot_time: string; template_id: string; content_format: string | null; counts_toward_mix: boolean }[] {
  const sortedTemplates = [...templates].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return normalizeTime(a.time_of_day).localeCompare(normalizeTime(b.time_of_day));
  });

  const out: {
    slot_date: string;
    slot_time: string;
    template_id: string;
    content_format: string | null;
    counts_toward_mix: boolean;
  }[] = [];
  const start = startOfDay(fromDay);
  const end = startOfDay(endDay);

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = d.getDay();
    for (const t of sortedTemplates) {
      if (t.day_of_week !== dow) continue;
      const cf = t.content_format ?? null;
      out.push({
        slot_date: format(d, "yyyy-MM-dd"),
        slot_time: normalizeTime(t.time_of_day),
        template_id: t.id,
        content_format: cf,
        counts_toward_mix: defaultCountsTowardMix(cf),
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
  channel_id: string;
  content_format: string | null;
  counts_toward_mix: boolean;
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
  mix: EditorialMix,
  channelId: string
): NewSlotRow[] {
  if (templates.length === 0) return [];

  const channelSlots = existingSlots.filter((s) => s.channel_id === channelId);
  const fromStr = format(startOfDay(fromDay), "yyyy-MM-dd");
  const endDay = addDays(startOfDay(fromDay), horizonWeeks * 7 - 1);
  const candidates = enumerateSlotOccurrences(fromDay, endDay, templates);
  const existingKeys = new Set(channelSlots.map((s) => slotChannelDateTimeKey(s.channel_id, s.slot_date, s.slot_time)));

  const phantoms: SlotForPlan[] = [];
  for (const c of candidates) {
    const key = slotChannelDateTimeKey(channelId, c.slot_date, c.slot_time);
    if (existingKeys.has(key)) continue;
    if (c.slot_date < fromStr) continue;
    phantoms.push({
      id: `phantom-${key}`,
      channel_id: channelId,
      slot_date: c.slot_date,
      slot_time: c.slot_time,
      status: "open",
      suggested_type: null,
      override_type: null,
      assigned_article_id: null,
      template_id: c.template_id,
      content_format: c.content_format,
      counts_toward_mix: c.counts_toward_mix,
    });
  }

  if (phantoms.length === 0) return [];

  const allSorted = [...channelSlots, ...phantoms].sort((a, b) => {
    const dc = a.slot_date.localeCompare(b.slot_date);
    if (dc !== 0) return dc;
    return normalizeTime(a.slot_time).localeCompare(normalizeTime(b.slot_time));
  });

  const counts = { ...computeTypeDistribution(articles, channelSlots) };
  const newRows: NewSlotRow[] = [];

  for (const s of allSorted) {
    if (!s.id.startsWith("phantom-")) {
      if (s.counts_toward_mix === false) continue;
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

    const pick =
      s.counts_toward_mix === false ? ("support" as EditorialArticleType) : pickSuggestedType(counts, mix);
    if (s.counts_toward_mix !== false) {
      counts[pick]++;
    }
    newRows.push({
      slot_date: s.slot_date,
      slot_time: s.slot_time,
      template_id: s.template_id!,
      channel_id: channelId,
      content_format: s.content_format ?? null,
      counts_toward_mix: s.counts_toward_mix,
      suggested_type: pick,
      status: "open",
    });
  }

  return newRows;
}

export function contentFormatsForChannel(code: EditorialChannelCode): { value: string; label: string }[] {
  if (code === "youtube") {
    return [
      { value: "yt_short", label: "YouTube Short" },
      { value: "yt_long", label: "Video lungo" },
    ];
  }
  if (code === "tiktok") {
    return [{ value: "tiktok_video", label: "Video TikTok" }];
  }
  if (code === "instagram_bite" || code === "instagram_dogs") {
    return [
      { value: "ig_post", label: "Post" },
      { value: "ig_carousel", label: "Carosello" },
      { value: "ig_story", label: "Storia" },
      { value: "ig_reel", label: "Reel" },
    ];
  }
  return [];
}

export const EDITORIAL_TYPE_LABELS: Record<EditorialArticleType, string> = {
  pillar: "Pillar",
  support: "Support",
  utility_reflection: "Utility / Reflection",
};

export const WEEKDAY_LABELS_IT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
