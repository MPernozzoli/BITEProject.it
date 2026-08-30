/** Tipi condivisi per i pannelli di performance delle pagine viaggio. */

export type VoyageViewInsightRow = {
  voyage_id: string;
  name_it: string | null;
  name_en: string | null;
  slug: string | null;
  slug_it: string | null;
  slug_en: string | null;
  status: string | null;
  is_published: boolean | null;
  booking_enabled: boolean | null;
  start_date: string | null;
  end_date: string | null;
  tracked_views: number;
  registered_views: number;
  anonymous_views: number;
  distinct_visitors: number;
  distinct_registered: number;
  avg_dwell_ms: number | null;
  measured_dwell_count: number;
  avg_scroll_pct: number | null;
  views_it: number;
  views_en: number;
  top_lang: string | null;
  last_view_at: string | null;
  watch_count: number;
  draft_count: number;
  request_count: number;
  confirmed_count: number;
};

export type VoyageScore = {
  reach: number;
  read: number;
  react: number;
  retain: number;
  revenue: number;
  total: number;
  reach_count: number;
  avg_dwell_ms: number;
  scroll_pct: number;
  watch_count: number;
  draft_count: number;
  request_count: number;
  confirmed_count: number;
  unique_visitors: number;
};

export type VoyageScoreRow = {
  voyage_id: string;
  name_it: string | null;
  name_en: string | null;
  slug: string | null;
  slug_it: string | null;
  slug_en: string | null;
  status: string | null;
  booking_enabled: boolean | null;
  start_date: string | null;
  end_date: string | null;
  view_count: number | null;
  score: VoyageScore;
};

/** Il nome mostrato in backoffice: italiano se c'è, altrimenti inglese. */
export function insightVoyageName(row: {
  name_it: string | null;
  name_en: string | null;
}): string {
  return row.name_it || row.name_en || "Senza nome";
}

/** Lo slug da usare per aprire la pagina pubblica italiana. */
export function voyagePublicSlug(row: {
  slug_it: string | null;
  slug: string | null;
  slug_en: string | null;
}): string | null {
  return row.slug_it || row.slug || row.slug_en || null;
}

/** Finestra del viaggio in forma compatta, per la riga di classifica. */
export function formatVoyageWindow(start: string | null, end: string | null): string {
  const fmt = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  };
  const from = fmt(start);
  const to = fmt(end);
  if (from && to) return `${from} – ${to}`;
  return from || to || "—";
}
