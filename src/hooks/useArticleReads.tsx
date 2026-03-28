import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

const READ_QUALIFICATION_MS = 30_000;

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

export function useRegisterArticleRead(articleSlug?: string) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  return useMutation({
    mutationFn: async (articleId: string) => {
      const { data, error } = await supabase.rpc("increment_article_view_count", {
        _article_id: articleId,
        _visitor_key: getOrCreateVisitorKey(),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (count, articleId) => {
      patchArticleViewCountInCache(queryClient, articleId, count, articleSlug);

      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["article-reads", userId] });
      }
    },
  });
}

export function useQualifiedArticleRead(articleId?: string | null, articleSlug?: string) {
  const { mutate: registerArticleRead } = useRegisterArticleRead(articleSlug);
  const trackedReadFor = useRef<string | null>(null);

  useEffect(() => {
    if (!articleId) return;
    trackedReadFor.current = null;

    let timeoutId: number | null = null;
    let activeSince: number | null = null;
    let accumulatedMs = 0;

    const clearTimer = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const pauseTracking = () => {
      if (activeSince !== null) {
        accumulatedMs += Date.now() - activeSince;
        activeSince = null;
      }
      clearTimer();
    };

    const registerRead = () => {
      if (trackedReadFor.current === articleId) return;
      trackedReadFor.current = articleId;
      pauseTracking();
      registerArticleRead(articleId);
    };

    const resumeTracking = () => {
      if (trackedReadFor.current === articleId) return;
      if (document.visibilityState !== "visible") return;
      if (activeSince !== null) return;

      const remainingMs = READ_QUALIFICATION_MS - accumulatedMs;
      if (remainingMs <= 0) {
        registerRead();
        return;
      }

      activeSince = Date.now();
      timeoutId = window.setTimeout(() => {
        accumulatedMs = READ_QUALIFICATION_MS;
        activeSince = null;
        timeoutId = null;
        registerRead();
      }, remainingMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeTracking();
        return;
      }

      pauseTracking();
    };

    resumeTracking();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", pauseTracking);

    return () => {
      pauseTracking();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", pauseTracking);
    };
  }, [articleId, registerArticleRead]);
}

export function useSyncArticleViewCount(articleId?: string | null, articleSlug?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!articleId) return;

    const channel = supabase
      .channel(`article-live-reads:${articleId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "logbook_articles",
          filter: `id=eq.${articleId}`,
        },
        (payload) => {
          const nextViewCount =
            typeof payload.new === "object" && payload.new !== null && "view_count" in payload.new
              ? Number(payload.new.view_count ?? 0)
              : null;

          if (nextViewCount === null || Number.isNaN(nextViewCount)) return;
          patchArticleViewCountInCache(queryClient, articleId, nextViewCount, articleSlug);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [articleId, articleSlug, queryClient]);
}
