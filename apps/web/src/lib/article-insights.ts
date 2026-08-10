/** Shared types + formatters for the admin article-view insight panels. */

export type ArticleViewInsightRow = {
  article_id: string;
  title_it: string | null;
  title_en: string | null;
  story_id: string | null;
  status: string | null;
  published_at: string | null;
  view_count: number;
  tracked_views: number;
  registered_views: number;
  anonymous_views: number;
  distinct_visitors: number;
  distinct_registered: number;
  avg_dwell_ms: number | null;
  measured_dwell_count: number;
  views_it: number;
  views_en: number;
  top_lang: string | null;
  last_view_at: string | null;
  like_count: number;
  registered_likes: number;
  anonymous_likes: number;
  comment_count: number;
};

export type ArticleViewInsightDetail = {
  article_id: string;
  title_it: string | null;
  title_en: string | null;
  story_id: string | null;
  status: string | null;
  published_at: string | null;
  view_count: number;
  summary: {
    tracked_views: number;
    registered_views: number;
    anonymous_views: number;
    distinct_visitors: number;
    distinct_registered: number;
    avg_dwell_ms: number | null;
    measured_dwell_count: number;
    views_it: number;
    views_en: number;
    views_unknown_lang: number;
    first_view_at: string | null;
    last_view_at: string | null;
    like_count: number;
    registered_likes: number;
    anonymous_likes: number;
    comment_count: number;
  };
  daily: Array<{ day: string; views: number; registered: number }>;
};

export const LANG_LABELS: Record<string, string> = {
  it: "Italiano",
  en: "Inglese",
};

export function langLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return LANG_LABELS[code] ?? code.toUpperCase();
}

/** Formats a millisecond reading time as a compact human string (it-IT). */
export function formatDwell(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("it-IT");
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function insightArticleTitle(row: {
  title_it: string | null;
  title_en: string | null;
}): string {
  return row.title_it || row.title_en || "Senza titolo";
}
