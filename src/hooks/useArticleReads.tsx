import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useArticleReads() {
  const { user } = useAuth();

  const { data: readArticleIds = [] } = useQuery({
    queryKey: ["article-reads", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("article_reads" as any)
        .select("article_id")
        .eq("profile_id", user!.id);
      return (data || []).map((r: any) => r.article_id);
    },
  });

  const isRead = (articleId: string) => readArticleIds.includes(articleId);

  return { readArticleIds, isRead };
}

export function useMarkAsRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (articleId: string) => {
      if (!user) return;
      await supabase
        .from("article_reads" as any)
        .upsert({ article_id: articleId, profile_id: user.id }, { onConflict: "article_id,profile_id" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["article-reads"] });
    },
  });
}
