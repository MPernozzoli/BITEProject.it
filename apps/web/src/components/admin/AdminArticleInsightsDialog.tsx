import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Eye, Globe, Heart, MessageCircle, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCount,
  formatDwell,
  insightArticleTitle,
  langLabel,
  pct,
  type ArticleViewInsightRow,
} from "@/lib/article-insights";
import AdminArticleInsightDialog from "./AdminArticleInsightDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function AggregateStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[16px] border border-border/70 bg-background/60 p-3">
      <Icon className="mb-2 size-4 text-accent" aria-hidden />
      <p className="font-sans text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function AdminArticleInsightsDialog({ open, onOpenChange }: Props) {
  const [detailArticleId, setDetailArticleId] = useState<string | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["admin-article-insights"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_article_view_insights");
      if (error) throw error;
      return (data ?? []) as unknown as ArticleViewInsightRow[];
    },
  });

  const totals = useMemo(() => {
    const totalViews = rows.reduce((sum, r) => sum + (r.view_count || 0), 0);
    const registered = rows.reduce((sum, r) => sum + (r.registered_views || 0), 0);
    const anonymous = rows.reduce((sum, r) => sum + (r.anonymous_views || 0), 0);
    const tracked = registered + anonymous;
    const dwellWeightedMs = rows.reduce(
      (sum, r) => sum + (r.avg_dwell_ms || 0) * (r.measured_dwell_count || 0),
      0
    );
    const dwellCount = rows.reduce((sum, r) => sum + (r.measured_dwell_count || 0), 0);
    const viewsIt = rows.reduce((sum, r) => sum + (r.views_it || 0), 0);
    const viewsEn = rows.reduce((sum, r) => sum + (r.views_en || 0), 0);
    const totalLikes = rows.reduce((sum, r) => sum + (r.like_count || 0), 0);
    const registeredLikes = rows.reduce((sum, r) => sum + (r.registered_likes || 0), 0);
    const anonymousLikes = rows.reduce((sum, r) => sum + (r.anonymous_likes || 0), 0);
    const totalComments = rows.reduce((sum, r) => sum + (r.comment_count || 0), 0);
    return {
      totalViews,
      registered,
      anonymous,
      tracked,
      avgDwellMs: dwellCount ? dwellWeightedMs / dwellCount : null,
      topLang: viewsIt === 0 && viewsEn === 0 ? null : viewsIt >= viewsEn ? "it" : "en",
      totalLikes,
      registeredLikes,
      anonymousLikes,
      totalComments,
    };
  }, [rows]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Insight degli articoli</DialogTitle>
            <DialogDescription>
              KPI aggregati e per singolo articolo: pubblico registrato vs anonimo, tempo di lettura medio e lingua.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3 animate-pulse py-4">
              <div className="h-20 rounded-[16px] bg-muted/50" />
              <div className="h-40 rounded-[16px] bg-muted/50" />
            </div>
          ) : error ? (
            <p className="py-6 text-sm text-destructive">Impossibile caricare gli insight.</p>
          ) : (
            <div className="space-y-5 py-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <AggregateStat icon={Eye} label="Visualizzazioni" value={formatCount(totals.totalViews)} />
                <AggregateStat
                  icon={UserCheck}
                  label="Registrati"
                  value={`${pct(totals.registered, totals.tracked)}%`}
                  hint={`${formatCount(totals.registered)} su ${formatCount(totals.tracked)} tracciate`}
                />
                <AggregateStat
                  icon={Clock}
                  label="Tempo medio"
                  value={formatDwell(totals.avgDwellMs)}
                />
                <AggregateStat icon={Globe} label="Lingua top" value={langLabel(totals.topLang)} />
                <AggregateStat
                  icon={Heart}
                  label="Mi piace"
                  value={formatCount(totals.totalLikes)}
                  hint={`${formatCount(totals.registeredLikes)} registrati / ${formatCount(totals.anonymousLikes)} anonimi`}
                />
                <AggregateStat icon={MessageCircle} label="Commenti" value={formatCount(totals.totalComments)} />
              </div>

              <div className="overflow-x-auto rounded-[16px] border border-border/60">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Articolo</th>
                      <th className="px-3 py-2 text-right font-medium">Viste</th>
                      <th className="px-3 py-2 text-right font-medium">Reg. / Anon.</th>
                      <th className="px-3 py-2 text-right font-medium">Tempo medio</th>
                      <th className="px-3 py-2 text-left font-medium">Lingua</th>
                      <th className="px-3 py-2 text-right font-medium">Mi piace</th>
                      <th className="px-3 py-2 text-right font-medium">Commenti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.article_id}
                        className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors"
                        onClick={() => setDetailArticleId(r.article_id)}
                      >
                        <td className="px-3 py-2">
                          <span className="line-clamp-1 text-foreground">{insightArticleTitle(r)}</span>
                          {r.status && r.status !== "published" && (
                            <span className="ml-1 text-[10px] text-muted-foreground">({r.status})</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.view_count)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          <span className="text-accent">{formatCount(r.registered_views)}</span> /{" "}
                          {formatCount(r.anonymous_views)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatDwell(r.avg_dwell_ms)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{langLabel(r.top_lang)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatCount(r.like_count)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatCount(r.comment_count)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                          Nessun articolo con visualizzazioni.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tocca una riga per il dettaglio del singolo articolo. Provenienza del traffico: vedi gli insight di Vercel.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AdminArticleInsightDialog
        open={Boolean(detailArticleId)}
        onOpenChange={(o) => {
          if (!o) setDetailArticleId(null);
        }}
        articleId={detailArticleId}
      />
    </>
  );
}
