import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

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
    onSuccess: (count) => {
      if (articleSlug) {
        queryClient.setQueryData(["article", articleSlug], (old: unknown) =>
          old && typeof old === "object" ? { ...(old as Record<string, unknown>), view_count: count } : old
        );
      }

      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["article-reads", userId] });
      }
    },
  });
}
