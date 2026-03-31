import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

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
    onSuccess: (count, articleId) => {
      patchArticleViewCountInCache(queryClient, articleId, count, articleSlug);

      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["article-reads", userId] });
      }
    },
    onError: (error, articleId) => {
      console.error("Failed to register qualified article read", { articleId, error });
    },
  });
}

export function useQualifiedArticleRead(articleId?: string | null, articleSlug?: string) {
  const { mutateAsync: registerArticleRead } = useRegisterArticleRead(articleSlug);
  const trackedReadFor = useRef<string | null>(null);
  const readRequestInFlightFor = useRef<string | null>(null);

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
        await registerArticleRead(articleId);
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
