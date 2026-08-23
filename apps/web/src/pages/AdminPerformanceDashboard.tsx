import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Eye, Heart, MessageCircle, MousePointerClick, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { isAuthFailureError } from "@/lib/supabase-auth";

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

const AXIS_CONFIG = [
  { key: "reach", label: "Reach", icon: Eye, description: "Lettori unici (30gg)" },
  { key: "read", label: "Read", icon: Eye, description: "Dwell time + scroll" },
  { key: "react", label: "React", icon: Heart, description: "Like + commenti + share / 100 lettori" },
  { key: "retain", label: "Retain", icon: MessageCircle, description: "Lettori unici totali" },
  { key: "revenue", label: "Lead", icon: MousePointerClick, description: "Click su link/CTA (30gg)" },
] as const;

const scoreColor = (score: number, max: number) => {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return "text-emerald-500";
  if (ratio >= 0.5) return "text-amber-500";
  return "text-muted-foreground";
};

const formatDwell = (ms: number) => {
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const AdminPerformanceDashboard = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ArticleScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"total" | "reach" | "read" | "react" | "retain" | "revenue">("total");

  const fetchScores = useCallback(async () => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_article_scores");
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/performance" } });
      setLoading(false);
      return;
    }
    if (data) setRows(data as unknown as ArticleScoreRow[]);
    setLoading(false);
  }, [navigate, session?.user?.id]);

  useEffect(() => {
    void fetchScores();
  }, [fetchScores]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b.score?.[sortBy] ?? 0) - (a.score?.[sortBy] ?? 0));
  }, [rows, sortBy]);

  const totals = useMemo(() => {
    const agg = { reach: 0, read: 0, react: 0, retain: 0, revenue: 0, total: 0, count: 0 };
    for (const row of rows) {
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
  }, [rows]);

  const avgTotal = totals.count > 0 ? (totals.total / totals.count).toFixed(1) : "0";

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-6xl mx-auto space-y-8">
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
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">{label}</p>
                <p className={`text-xl font-sans font-semibold tabular-nums ${scoreColor(totals[key], totals.count * 2)}`}>
                  {totals[key]}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">/ {totals.count * 2}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="editorial-heading text-xl mr-2">Ranking</h2>
            {(["total", "reach", "read", "react", "retain", "revenue"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-3 py-1 rounded-full text-xs font-sans transition-colors ${
                  sortBy === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {key === "total" ? "Total" : AXIS_CONFIG.find((a) => a.key === key)?.label ?? key}
              </button>
            ))}
          </div>

          {loading && <p className="text-sm font-sans text-muted-foreground animate-pulse">Caricamento...</p>}

          {!loading && sorted.length === 0 && (
            <p className="text-sm font-sans text-muted-foreground py-8 text-center">Nessun articolo pubblicato.</p>
          )}

          <div className="space-y-3">
            {sorted.map((row, idx) => (
              <Link
                key={row.article_id}
                to={`/admin/article/${row.article_id}`}
                className="glass-panel-soft rounded-[20px] p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 hover:border-accent transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-xs font-sans text-muted-foreground tabular-nums w-6 text-right shrink-0">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-sans font-medium text-sm truncate group-hover:text-accent transition-colors">
                      {row.title_it || row.title_en}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      <span>{row.published_at ? new Date(row.published_at).toLocaleDateString() : "—"}</span>
                      <span className="text-border">|</span>
                      <Eye size={10} />
                      <span>{row.view_count ?? 0}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {AXIS_CONFIG.map(({ key, icon: Icon }) => (
                    <div
                      key={key}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-sans ${
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
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminPerformanceDashboard;
