import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Reading time below this is treated as an accidental/bounce view and skipped.
const MIN_DWELL_MS = 1_500;
// Never report an implausibly long session (matches the DB-side 6h cap).
const MAX_DWELL_MS = 6 * 60 * 60 * 1000;

/**
 * Sends the accumulated visible reading time for an article to the
 * `record_article_read_dwell` RPC.
 *
 * On page unload we cannot rely on the supabase-js client completing an
 * in-flight request, so we issue a raw `fetch` with `keepalive: true`. Unlike
 * `navigator.sendBeacon`, this lets us set the `apikey`/`Authorization` headers
 * PostgREST requires. The cached access token is passed in by the caller so the
 * request stays authenticated even while the page is being torn down.
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
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const body = JSON.stringify({
    _article_id: articleId,
    _visitor_key: visitorKey,
    _dwell_ms: clamped,
  });

  try {
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/record_article_read_dwell`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      },
      body,
    });
  } catch {
    // Best-effort analytics: never surface an error to the reader.
  }
}

/** Reads the current access token synchronously from the cached session. */
export async function getCachedAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
