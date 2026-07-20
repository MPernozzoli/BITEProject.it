import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  formatCount,
  formatDwell,
  langLabel,
  pct,
  type ArticleViewInsightDetail,
} from "@/lib/article-insights";
import AdminArticleInsightDialog from "./AdminArticleInsightDialog";

type Props = {
  articleId: string;
  titleFallback?: string | null;
};

/**
 * Compact article-view summary shown inside the editorial slot dialog, with a
 * "Dettagli…" button that opens the full single-article insight modal. Shares
 * the react-query cache key with the detail dialog to avoid a double fetch.
 */
export default function AdminArticleInsightSummary({ articleId, titleFallback }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-article-insight", articleId],
    enabled: Boolean(articleId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_article_view_insight_one", {
        _article_id: articleId,
      });
      if (error) throw error;
      return data as unknown as ArticleViewInsightDetail | null;
    },
  });

  const s = data?.summary;
  const topLang =
    s == null ? null : s.views_it === 0 && s.views_en === 0 ? null : s.views_it >= s.views_en ? "it" : "en";

  return (
    <div className="rounded-[14px] border border-border/70 bg-background/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
          <BarChart3 className="size-3.5 text-accent" /> Visualizzazioni
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setDetailsOpen(true)}
        >
          Dettagli…
        </Button>
      </div>

      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-muted/50" />
      ) : error ? (
        <p className="text-xs text-destructive">Statistiche non disponibili.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div>
            <p className="font-sans text-lg font-semibold tabular-nums">{formatCount(data?.view_count)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Viste</p>
          </div>
          <div>
            <p className="font-sans text-lg font-semibold tabular-nums">
              {pct(s?.registered_views ?? 0, (s?.registered_views ?? 0) + (s?.anonymous_views ?? 0))}%
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Registrati</p>
          </div>
          <div>
            <p className="font-sans text-lg font-semibold tabular-nums">{formatDwell(s?.avg_dwell_ms)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Tempo medio</p>
          </div>
          <div>
            <p className="font-sans text-lg font-semibold">{langLabel(topLang)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Lingua top</p>
          </div>
        </div>
      )}

      <AdminArticleInsightDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        articleId={articleId}
        titleFallback={titleFallback}
      />
    </div>
  );
}
