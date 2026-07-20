import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import { getCachedAccessToken, sendArticleDwell } from "@/lib/article-dwell";

const READ_RETRY_MS = 5_000;

function isLegacyIncrementRpcError(error: { code?: string; message?: string; details?: string } | null) {
  if (!error) return false;

  const haystack = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("pgrst")
    && (
      haystack.includes("_visitor_key")
      || haystack.includes("increment_article_view_count")
      || haystack.includes("function")
      || haystack.includes("signature")
    );
}

function patchArticleViewCountInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  articleId: string,
  count: number,
  articleSlug?: string
) {
  if (articleSlug) {
    queryClient.setQueryData(["article", articleSlug], (old: unknown) =>
      old && typeof old === "object"
        ? { ...(old as Record<string, unknown>), view_count: count, viewCount: count }
        : old
    );
  }

  queryClient.setQueryData(["logbook-articles-geo"], (old: unknown) => {
    if (!Array.isArray(old)) return old;

    return old.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const item = entry as Record<string, unknown>;
      if (item.id !== articleId) return entry;

      return {
        ...item,
        view_count: count,
        viewCount: count,
      };
    });
  });

  queryClient.setQueryData(["public-content-snapshot"], (old: unknown) => {
    if (!old || typeof old !== "object") return old;

    const snapshot = old as {
      articles?: Array<Record<string, unknown>>;
    };

    if (!Array.isArray(snapshot.articles)) return old;

    return {
      ...snapshot,
      articles: snapshot.articles.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        if (entry.id !== articleId) return entry;

        return {
          ...entry,
          view_count: count,
          viewCount: count,
        };
      }),
    };
  });
}

async function dismissArticlePublicationNotifications(articleId: string, userId?: string) {
  if (!userId) return;

  const { error } = await supabase
    .from("engagement_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_profile_id", userId)
    .eq("article_id", articleId)
    .eq("notification_category", "publication")
    .is("read_at", null);

  if (error) {
    console.error("Failed to dismiss article publication notifications", { articleId, error });
  }
}

export function useArticleReads() {
  const { session } = useAuth();
  const userId = session?.user?.id;

  const { data: readArticleIds = [] } = useQuery({
    queryKey: ["article-reads", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("article_reads")
        .select("article_id")
        .eq("profile_id", userId!);
      return (data || []).map((r) => r.article_id);
    },
  });

  const isRead = (articleId: string) => readArticleIds.includes(articleId);

  return { readArticleIds, isRead };
}

type RegisterArticleReadVars = { articleId: string; lang?: string | null };

export function useRegisterArticleRead(articleSlug?: string) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  return useMutation({
    mutationFn: async ({ articleId, lang }: RegisterArticleReadVars) => {
      const { data, error } = await supabase.rpc("increment_article_view_count", {
        _article_id: articleId,
        _visitor_key: getOrCreateVisitorKey(),
        _lang: lang ?? undefined,
      });

      if (!error) {
        return Number(data ?? 0);
      }

      if (isLegacyIncrementRpcError(error)) {
        const legacyResult = await supabase.rpc("increment_article_view_count", {
          _article_id: articleId,
        });

        if (legacyResult.error) throw legacyResult.error;
        return Number(legacyResult.data ?? 0);
      }

      throw error;
    },
    onSuccess: (count, { articleId }) => {
      patchArticleViewCountInCache(queryClient, articleId, count, articleSlug);
      void dismissArticlePublicationNotifications(articleId, userId);

      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["article-reads", userId] });
      }
    },
    onError: (error, { articleId }) => {
      console.error("Failed to register qualified article read", { articleId, error });
    },
  });
}

export function useQualifiedArticleRead(
  articleId?: string | null,
  articleSlug?: string,
  lang?: string | null
) {
  const { mutateAsync: registerArticleRead } = useRegisterArticleRead(articleSlug);
  const trackedReadFor = useRef<string | null>(null);
  const readRequestInFlightFor = useRef<string | null>(null);
  // Keep the latest language without re-registering the read when it changes.
  const langRef = useRef<string | null | undefined>(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!articleId) return;
    trackedReadFor.current = null;
    readRequestInFlightFor.current = null;

    let retryTimeoutId: number | null = null;

    const registerRead = async () => {
      if (trackedReadFor.current === articleId) return;
      if (readRequestInFlightFor.current === articleId) return;

      readRequestInFlightFor.current = articleId;

      try {
        await registerArticleRead({ articleId, lang: langRef.current });
        trackedReadFor.current = articleId;
      } catch {
        readRequestInFlightFor.current = null;
        retryTimeoutId = window.setTimeout(() => {
          retryTimeoutId = null;
          void registerRead();
        }, READ_RETRY_MS);
        return;
      }

      readRequestInFlightFor.current = null;
    };

    void registerRead();

    return () => {
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [articleId, registerArticleRead]);
}

/**
 * Measures how long an article stays visible on screen and reports the total
 * reading time to the backend. The timer accumulates only while the tab is
 * visible, and the value is flushed when the reader hides the tab, navigates
 * away, or switches to a different article.
 */
export function useArticleDwellTracking(articleId?: string | null) {
  useEffect(() => {
    if (!articleId) return;
    if (typeof document === "undefined") return;

    const visitorKey = getOrCreateVisitorKey();
    let accessToken: string | null = null;
    void getCachedAccessToken().then((token) => {
      accessToken = token;
    });

    let accumulatedMs = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;

    const accumulate = () => {
      if (visibleSince !== null) {
        accumulatedMs += performance.now() - visibleSince;
        visibleSince = null;
      }
    };

    const flush = () => {
      accumulate();
      sendArticleDwell({ articleId, visitorKey, dwellMs: accumulatedMs, accessToken });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (visibleSince === null) visibleSince = performance.now();
      } else {
        flush();
      }
    };

    const handlePageHide = () => {
      flush();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      // Flush the reading time accrued for this article before switching away.
      flush();
    };
  }, [articleId]);
}

export function useSyncArticleViewCount(articleId?: string | null, articleSlug?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!articleId) return;

    // Polling lazy on visibility change: il view count si aggiorna quando
    // l'utente torna alla tab senza mantenere un canale realtime persistente.
    const refreshViewCount = async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("view_count")
        .eq("id", articleId)
        .maybeSingle();

      if (error || !data) return;
      const nextViewCount = Number(data.view_count ?? 0);
      if (Number.isNaN(nextViewCount)) return;
      patchArticleViewCountInCache(queryClient, articleId, nextViewCount, articleSlug);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshViewCount();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [articleId, articleSlug, queryClient]);
}
