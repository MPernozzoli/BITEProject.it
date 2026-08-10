import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Clock, Eye, Globe, Heart, MessageCircle, UserCheck, Users } from "lucide-react";
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
  type ArticleViewInsightDetail,
} from "@/lib/article-insights";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
  titleFallback?: string | null;
};

function Stat({
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

function SplitBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.label}
            className={cn("h-full transition-all", s.className)}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", s.className)} />
            {s.label}: <span className="tabular-nums text-foreground">{formatCount(s.value)}</span>{" "}
            ({pct(s.value, total)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AdminArticleInsightDialog({ open, onOpenChange, articleId, titleFallback }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-article-insight", articleId],
    enabled: open && Boolean(articleId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_article_view_insight_one", {
        _article_id: articleId!,
      });
      if (error) throw error;
      return data as unknown as ArticleViewInsightDetail | null;
    },
  });

  const maxDaily = useMemo(
    () => (data?.daily?.length ? Math.max(...data.daily.map((d) => d.views)) : 0),
    [data?.daily]
  );

  const title = data ? insightArticleTitle(data) : titleFallback || "Insight articolo";
  const s = data?.summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{title}</DialogTitle>
          <DialogDescription>
            Dettaglio visualizzazioni: pubblico registrato vs anonimo, tempo di lettura medio e lingua.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 animate-pulse py-4">
            <div className="h-20 rounded-[16px] bg-muted/50" />
            <div className="h-20 rounded-[16px] bg-muted/50" />
          </div>
        ) : error ? (
          <p className="py-6 text-sm text-destructive">Impossibile caricare le statistiche.</p>
        ) : !s ? (
          <p className="py-6 text-sm text-muted-foreground">Nessun dato disponibile per questo articolo.</p>
        ) : (
          <div className="space-y-5 py-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat icon={Eye} label="Visualizzazioni" value={formatCount(data?.view_count)} />
              <Stat
                icon={Users}
                label="Visitatori unici"
                value={formatCount(s.distinct_visitors)}
                hint={`${formatCount(s.distinct_registered)} registrati`}
              />
              <Stat
                icon={Clock}
                label="Tempo medio"
                value={formatDwell(s.avg_dwell_ms)}
                hint={s.measured_dwell_count ? `su ${formatCount(s.measured_dwell_count)} letture` : "in raccolta"}
              />
              <Stat
                icon={Heart}
                label="Mi piace"
                value={formatCount(s.like_count)}
                hint={`${formatCount(s.registered_likes)} registrati / ${formatCount(s.anonymous_likes)} anonimi`}
              />
              <Stat icon={MessageCircle} label="Commenti" value={formatCount(s.comment_count)} />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <UserCheck className="size-3.5" /> Registrati vs anonimi
              </p>
              <SplitBar
                segments={[
                  { label: "Registrati", value: s.registered_views, className: "bg-accent/80" },
                  { label: "Anonimi", value: s.anonymous_views, className: "bg-muted-foreground/40" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <Heart className="size-3.5" /> Mi piace: registrati vs anonimi
              </p>
              <SplitBar
                segments={[
                  { label: "Registrati", value: s.registered_likes, className: "bg-red-500/70" },
                  { label: "Anonimi", value: s.anonymous_likes, className: "bg-muted-foreground/40" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <Globe className="size-3.5" /> Lingua di visualizzazione
              </p>
              <SplitBar
                segments={[
                  { label: langLabel("it"), value: s.views_it, className: "bg-emerald-500/70" },
                  { label: langLabel("en"), value: s.views_en, className: "bg-sky-500/70" },
                  ...(s.views_unknown_lang
                    ? [{ label: "Non tracciata", value: s.views_unknown_lang, className: "bg-muted-foreground/30" }]
                    : []),
                ]}
              />
            </div>

            {data?.daily?.length ? (
              <div className="space-y-2">
                <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                  <BookOpen className="size-3.5" /> Ultimi 30 giorni
                </p>
                <div className="flex items-end gap-0.5 h-20 rounded-[14px] border border-border/60 bg-background/40 p-2">
                  {data.daily.map((d) => (
                    <div
                      key={d.day}
                      className="flex-1 min-w-[2px] rounded-t bg-accent/70"
                      style={{ height: `${maxDaily ? Math.max(4, (d.views / maxDaily) * 100) : 0}%` }}
                      title={`${d.day}: ${d.views} viste (${d.registered} registrati)`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
