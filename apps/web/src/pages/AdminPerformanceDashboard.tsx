import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Globe,
  Heart,
  MessageCircle,
  MousePointerClick,
  Pencil,
  UserCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { isAuthFailureError } from "@/lib/supabase-auth";
import {
  formatCount,
  formatDwell,
  insightArticleTitle,
  langLabel,
  pct,
  type ArticleViewInsightRow,
} from "@/lib/article-insights";
import AdminArticleInsightDialog from "@/components/admin/AdminArticleInsightDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ArticleScoreRow = {
  article_id: string;
  title_en: string;
  title_it: string;
  slug: string;
  status: string;
  published_at: string | null;
  view_count: number | null;
  score: {
    reach: number;
    read: number;
    react: number;
    retain: number;
    revenue: number;
    total: number;
    reach_count: number;
    avg_dwell_ms: number;
    scroll_pct: number;
    like_count: number;
    comment_count: number;
    share_count: number;
    click_count: number;
    unique_readers: number;
  };
};

type MergedArticle = ArticleScoreRow & {
  insight: ArticleViewInsightRow | null;
};

const AXIS_CONFIG = [
  { key: "reach", label: "Reach", icon: Eye, description: "Lettori unici (30gg)" },
  { key: "read", label: "Read", icon: BookOpen, description: "Dwell time + scroll" },
  { key: "react", label: "React", icon: Heart, description: "(Like + commenti + share) / 100 lettori unici (30gg)" },
  { key: "retain", label: "Retain", icon: MessageCircle, description: "Lettori unici totali (all-time)" },
  { key: "revenue", label: "Lead", icon: MousePointerClick, description: "Click su link/CTA (30gg)" },
] as const;

const scoreColor = (score: number, max: number) => {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return "text-emerald-500";
  if (ratio >= 0.5) return "text-amber-500";
  return "text-muted-foreground";
};

const AdminPerformanceDashboard = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ArticleScoreRow[]>([]);
  const [insights, setInsights] = useState<ArticleViewInsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"total" | "reach" | "read" | "react" | "retain" | "revenue">("total");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailArticleId, setDetailArticleId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const [scoresRes, insightsRes] = await Promise.all([
      supabase.rpc("admin_article_scores"),
      supabase.rpc("admin_article_view_insights"),
    ]);
    const error = scoresRes.error || insightsRes.error;
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/performance" } });
      setLoading(false);
      return;
    }
    if (scoresRes.data) setRows(scoresRes.data as unknown as ArticleScoreRow[]);
    if (insightsRes.data) setInsights(insightsRes.data as unknown as ArticleViewInsightRow[]);
    setLoading(false);
  }, [navigate, session?.user?.id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const insightMap = useMemo(() => {
    const m = new Map<string, ArticleViewInsightRow>();
    for (const r of insights) m.set(r.article_id, r);
    return m;
  }, [insights]);

  const merged: MergedArticle[] = useMemo(
    () => rows.map((r) => ({ ...r, insight: insightMap.get(r.article_id) ?? null })),
    [rows, insightMap]
  );

  const sorted = useMemo(() => {
    return [...merged].sort((a, b) => (b.score?.[sortBy] ?? 0) - (a.score?.[sortBy] ?? 0));
  }, [merged, sortBy]);

  const totals = useMemo(() => {
    const agg = { reach: 0, read: 0, react: 0, retain: 0, revenue: 0, total: 0, count: 0 };
    for (const row of merged) {
      if (!row.score) continue;
      agg.reach += row.score.reach;
      agg.read += row.score.read;
      agg.react += row.score.react;
      agg.retain += row.score.retain;
      agg.revenue += row.score.revenue;
      agg.total += row.score.total;
      agg.count += 1;
    }
    return agg;
  }, [merged]);

  const avgTotal = totals.count > 0 ? (totals.total / totals.count).toFixed(1) : "0";

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <TooltipProvider delayDuration={120}>
      <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <section className="glass-panel rounded-[38px] px-6 py-8 md:px-10 md:py-10">
            <div className="max-w-3xl">
              <Link
                to="/admin"
                className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
              >
                <ArrowLeft size={14} />
                Torna alla Dashboard
              </Link>
              <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
                <BarChart3 size={14} />
                Performance
              </div>
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Article Scores</h1>
              <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                punteggio 5 punti per ogni articolo pubblicato: Reach (visite), Read (tempo + scroll),
                React (engagement), Retain (ritorno), Lead (click CTA). Ogni asse vale 0-2, totale /10.
              </p>
            </div>
          </section>

          {/* Aggregate */}
          <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-6">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="editorial-heading text-xl">Aggregate</h2>
              <div className="flex items-center gap-3 text-sm font-sans text-muted-foreground">
                <span>{totals.count} articoli</span>
                <span className="text-border">|</span>
                <span>Media totale: <span className="text-foreground font-medium">{avgTotal}</span>/10</span>
              </div>
            </div>
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {AXIS_CONFIG.map(({ key, label, description }) => (
                  <div key={key} className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1 cursor-help">{label}</p>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="center" className="text-xs">
                        {description}
                      </TooltipContent>
                    </Tooltip>
                    <p className={`text-xl font-sans font-semibold tabular-nums ${scoreColor(totals[key], totals.count * 2)}`}>
                      {totals[key]}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">/ {totals.count * 2}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
                  </div>
                ))}
              </div>
          </section>

          {/* Ranking */}
          <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="editorial-heading text-xl mr-2">Ranking</h2>
              {(["total", "reach", "read", "react", "retain", "revenue"] as const).map((key) => {
                const axis = AXIS_CONFIG.find((a) => a.key === key);
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSortBy(key)}
                        className={`px-3 py-1 rounded-full text-xs font-sans transition-colors cursor-help ${
                          sortBy === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {key === "total" ? "Total" : axis?.label ?? key}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="center" className="text-xs">
                      {axis?.description ?? ""}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            {loading && <p className="text-sm font-sans text-muted-foreground animate-pulse">Caricamento...</p>}

            {!loading && sorted.length === 0 && (
              <p className="text-sm font-sans text-muted-foreground py-8 text-center">Nessun articolo pubblicato.</p>
            )}

            <div className="space-y-3">
              {sorted.map((row, idx) => {
                const isExpanded = expandedId === row.article_id;
                const ins = row.insight;
                const totalTracked = (ins?.registered_views ?? 0) + (ins?.anonymous_views ?? 0);
                const totalLikes = ins?.like_count ?? 0;

                return (
                  <div
                    key={row.article_id}
                    className={`glass-panel-soft rounded-[20px] transition-colors ${
                      isExpanded ? "ring-1 ring-accent/40" : "hover:border-accent/30"
                    }`}
                  >
                    {/* Collapsed row */}
                    <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-xs font-sans text-muted-foreground tabular-nums w-6 text-right shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setDetailArticleId(row.article_id)}
                            className="font-sans font-medium text-sm truncate hover:text-accent transition-colors text-left"
                          >
                            {row.title_it || row.title_en}
                          </button>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                            <span>{row.published_at ? new Date(row.published_at).toLocaleDateString() : "—"}</span>
                            <span className="text-border">|</span>
                            <Eye size={10} />
                            <span>{row.view_count ?? 0}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {AXIS_CONFIG.map(({ key, icon: Icon, description }) => (
                          <Tooltip key={key}>
                            <TooltipTrigger asChild>
                              <div
                                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-sans cursor-help ${
                                  row.score[key] >= 2
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : row.score[key] >= 1
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                      : "bg-muted text-muted-foreground"
                                }`}
                              >
                                <Icon size={10} />
                                <span>{row.score[key]}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="center" className="text-xs">
                              {description}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                        <span className="text-sm font-sans font-semibold tabular-nums text-foreground ml-1">
                          {row.score.total}/10
                        </span>
                      </div>

                      <div className="hidden lg:flex items-center gap-4 text-[10px] text-muted-foreground shrink-0">
                        <span>{row.score.reach_count} lettori</span>
                        <span>{formatDwell(row.score.avg_dwell_ms)} avg</span>
                        <span>{row.score.scroll_pct}% scroll</span>
                        <span>{row.score.share_count} share</span>
                      </div>

                      {/* Expand toggle */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.article_id)}
                        className="shrink-0 p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? "Chiudi dettagli" : "Apri dettagli"}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-border/50 px-4 md:px-5 pb-4 md:pb-5 pt-4 space-y-4">
                        {/* Quick actions */}
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/admin/article/${row.article_id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                          >
                            <Pencil size={12} />
                            Modifica
                          </Link>
                          {row.slug && (
                            <a
                              href={`/logbook/${encodeURIComponent(row.slug)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                            >
                              <ExternalLink size={12} />
                              Apri
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailArticleId(row.article_id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                          >
                            <BarChart3 size={12} />
                            Dettagli
                          </button>
                        </div>

                        {ins ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* Registered vs anonymous */}
                            <div className="col-span-2 space-y-1.5">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                                <UserCheck className="size-3" /> Registrati vs anonimi
                              </p>
                              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-accent/80 transition-all"
                                  style={{ width: `${pct(ins.registered_views, totalTracked)}%` }}
                                />
                                <div
                                  className="h-full bg-muted-foreground/40 transition-all"
                                  style={{ width: `${pct(ins.anonymous_views, totalTracked)}%` }}
                                />
                              </div>
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-accent/80" />
                                  {formatCount(ins.registered_views)} reg.
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                                  {formatCount(ins.anonymous_views)} anon.
                                </span>
                              </div>
                            </div>

                            {/* Likes split */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                                <Heart className="size-3" /> Mi piace
                              </p>
                              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-red-500/70 transition-all"
                                  style={{ width: `${pct(ins.registered_likes, totalLikes)}%` }}
                                />
                                <div
                                  className="h-full bg-muted-foreground/40 transition-all"
                                  style={{ width: `${pct(ins.anonymous_likes, totalLikes)}%` }}
                                />
                              </div>
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-red-500/70" />
                                  {formatCount(ins.registered_likes)} reg.
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                                  {formatCount(ins.anonymous_likes)} anon.
                                </span>
                              </div>
                            </div>

                            {/* Language split */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                                <Globe className="size-3" /> Lingua
                              </p>
                              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-emerald-500/70 transition-all"
                                  style={{ width: `${pct(ins.views_it, (ins.views_it || 0) + (ins.views_en || 0))}%` }}
                                />
                                <div
                                  className="h-full bg-sky-500/70 transition-all"
                                  style={{ width: `${pct(ins.views_en, (ins.views_it || 0) + (ins.views_en || 0))}%` }}
                                />
                              </div>
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-emerald-500/70" />
                                  {formatCount(ins.views_it)} IT
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-sky-500/70" />
                                  {formatCount(ins.views_en)} EN
                                </span>
                              </div>
                            </div>

                            {/* Dwell + comments */}
                            <div className="space-y-2">
                              <div className="rounded-[12px] border border-border/60 bg-background/40 p-2.5">
                                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5 mb-1">
                                  <Clock className="size-3" /> Dwell medio
                                </p>
                                <p className="text-sm font-sans font-semibold tabular-nums">{formatDwell(ins.avg_dwell_ms)}</p>
                              </div>
                              <div className="rounded-[12px] border border-border/60 bg-background/40 p-2.5">
                                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5 mb-1">
                                  <MessageCircle className="size-3" /> Commenti
                                </p>
                                <p className="text-sm font-sans font-semibold tabular-nums">{formatCount(ins.comment_count)}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Nessuna metrica dettagliata disponibile.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Detail dialog */}
        <AdminArticleInsightDialog
          open={Boolean(detailArticleId)}
          onOpenChange={(o) => {
            if (!o) setDetailArticleId(null);
          }}
          articleId={detailArticleId}
        />
      </div>
    </TooltipProvider>
  );
};

export default AdminPerformanceDashboard;
