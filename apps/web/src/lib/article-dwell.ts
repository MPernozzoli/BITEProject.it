import { getCachedAccessToken, postRpcKeepalive } from "@/lib/tracking-beacon";

// Reading time below this is treated as an accidental/bounce view and skipped.
const MIN_DWELL_MS = 1_500;
// Never report an implausibly long session (matches the DB-side 6h cap).
const MAX_DWELL_MS = 6 * 60 * 60 * 1000;

export { getCachedAccessToken };

/**
 * Sends the accumulated visible reading time for an article to the
 * `record_article_read_dwell` RPC.
 *
 * The request goes out through the keepalive beacon in `lib/tracking-beacon`,
 * because the flush usually happens while the page is being torn down.
 */
export function sendArticleDwell(params: {
  articleId: string;
  visitorKey: string | null;
  dwellMs: number;
  accessToken?: string | null;
}): void {
  const { articleId, visitorKey, dwellMs, accessToken } = params;
  const clamped = Math.round(Math.min(Math.max(dwellMs, 0), MAX_DWELL_MS));
  if (!articleId || clamped < MIN_DWELL_MS) return;

  postRpcKeepalive(
    "record_article_read_dwell",
    {
      _article_id: articleId,
      _visitor_key: visitorKey,
      _dwell_ms: clamped,
    },
    accessToken
  );
}
