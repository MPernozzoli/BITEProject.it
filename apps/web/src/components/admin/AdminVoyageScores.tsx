/**
 * Classifica di performance delle pagine viaggio.
 *
 * Stessa forma della classifica articoli — cinque assi da 0 a 2, totale su 10 —
 * ma letti sul funnel invece che sull'engagement: un viaggio non si commenta,
 * si guarda, ci si pensa, e alla fine si chiede di salire a bordo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Globe,
  Heart,
  MousePointerClick,
  Pencil,
  Ship,
  TicketCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { formatCount, formatDwell, pct } from "@/lib/article-insights";
import {
  formatVoyageWindow,
  insightVoyageName,
  voyagePublicSlug,
  type VoyageScoreRow,
  type VoyageViewInsightRow,
} from "@/lib/voyage-insights";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type MergedVoyage = VoyageScoreRow & { insight: VoyageViewInsightRow | null };

/**
 * `types.ts` è generato e non conosce ancora le RPC dei viaggi: si passa dal
 * client con firma larga, come già fa VoyagePage per le RPC di booking.
 */
type SupabaseRpcClient = {
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>;
};

const rpcClient = supabase as unknown as SupabaseRpcClient;

/**
 * I cinque assi, tutti sulla stessa finestra di 30 giorni. React e Retain sono
 * tassi: sotto i 10 visitatori si fermano a 1, perché su una base piccola una
 * percentuale non distingue il merito dal caso.
 */
const AXIS_CONFIG = [
  {
    key: "reach",
    label: "Reach",
    icon: Eye,
    description: "Visitatori unici della pagina viaggio (30gg)",
    scale: "200+ vale 2, 20+ vale 1",
  },
  {
    key: "read",
    label: "Read",
    icon: BookOpen,
    description: "Permanenza e scroll sulla pagina (30gg)",
    scale: "60s e 50% di scroll valgono 2",
  },
  {
    key: "react",
    label: "React",
    icon: Heart,
    description: "Watchlist e bozze di prenotazione ogni 100 visitatori (30gg)",
    scale: "5+ vale 2, 1+ vale 1",
  },
  {
    key: "retain",
    label: "Retain",
    icon: Users,
    description: "Quota di visitatori tornati in una giornata diversa (30gg)",
    scale: "15%+ vale 2, 5%+ vale 1",
  },
  {
    key: "revenue",
    label: "Lead",
    icon: MousePointerClick,
    description: "Richieste di imbarco (30gg)",
    scale: "3+ vale 2, 1+ vale 1",
  },
] as const;

/** Nel tooltip sta tutto: cosa misura l'asse e a quanto ammontano le soglie. */
const axisTooltip = (axis?: { description: string; scale: string }) =>
  axis ? `${axis.description} — ${axis.scale}` : "";

const scoreColor = (score: number, max: number) => {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return "text-emerald-500 dark:text-emerald-400";
  if (ratio >= 0.5) return "text-amber-500 dark:text-amber-400";
  return "text-muted-foreground";
};

const AdminVoyageScores = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<VoyageScoreRow[]>([]);
  const [insights, setInsights] = useState<VoyageViewInsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"total" | "reach" | "read" | "react" | "retain" | "revenue">("total");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const [scoresRes, insightsRes] = await Promise.all([
      rpcClient.rpc<VoyageScoreRow[]>("admin_voyage_scores"),
      rpcClient.rpc<VoyageViewInsightRow[]>("admin_voyage_view_insights"),
    ]);
    const error = scoresRes.error || insightsRes.error;
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/performance" } });
      setLoading(false);
      return;
    }
    if (scoresRes.data) setRows(scoresRes.data);
    if (insightsRes.data) setInsights(insightsRes.data);
    setLoading(false);
  }, [navigate, session?.user?.id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const insightMap = useMemo(() => {
    const m = new Map<string, VoyageViewInsightRow>();
    for (const r of insights) m.set(r.voyage_id, r);
    return m;
  }, [insights]);

  const merged: MergedVoyage[] = useMemo(
    () => rows.map((r) => ({ ...r, insight: insightMap.get(r.voyage_id) ?? null })),
    [rows, insightMap]
  );

  const sorted = useMemo(
    () => [...merged].sort((a, b) => (b.score?.[sortBy] ?? 0) - (a.score?.[sortBy] ?? 0)),
    [merged, sortBy]
  );

  const totals = useMemo(() => {
    const agg = { reach: 0, read: 0, react: 0, retain: 0, revenue: 0, total: 0, count: 0, requests: 0 };
    for (const row of merged) {
      if (!row.score) continue;
      agg.reach += row.score.reach;
      agg.read += row.score.read;
      agg.react += row.score.react;
      agg.retain += row.score.retain;
      agg.revenue += row.score.revenue;
      agg.total += row.score.total;
      agg.requests += row.score.request_count ?? 0;
      agg.count += 1;
    }
    return agg;
  }, [merged]);

  const avgTotal = totals.count > 0 ? (totals.total / totals.count).toFixed(1) : "0";

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <>
      {/* Aggregate */}
      <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="editorial-heading text-xl">Aggregate</h2>
          <div className="flex items-center gap-3 text-sm font-sans text-muted-foreground">
            <span>{totals.count} viaggi</span>
            <span className="text-border">|</span>
            <span>
              Media totale: <span className="text-foreground font-medium">{avgTotal}</span>/10
            </span>
            <span className="text-border">|</span>
            <span>
              <span className="text-foreground font-medium">{formatCount(totals.requests)}</span> richieste (30gg)
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {AXIS_CONFIG.map((axis) => {
            const { key, label, description } = axis;
            return (
            <div key={key} className="rounded-[16px] border border-border/70 bg-background/60 p-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1 cursor-help">
                    {label}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="text-xs max-w-[260px]">
                  {axisTooltip(axis)}
                </TooltipContent>
              </Tooltip>
              <p
                className={`text-xl font-sans font-semibold tabular-nums ${scoreColor(
                  totals[key],
                  totals.count * 2
                )}`}
              >
                {totals[key]}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">/ {totals.count * 2}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
            </div>
            );
          })}
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
                      sortBy === key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {key === "total" ? "Total" : axis?.label ?? key}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="text-xs max-w-[260px]">
                  {axisTooltip(axis)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {loading && <p className="text-sm font-sans text-muted-foreground animate-pulse">Caricamento...</p>}

        {!loading && sorted.length === 0 && (
          <p className="text-sm font-sans text-muted-foreground py-8 text-center">Nessun viaggio pubblicato.</p>
        )}

        <div className="space-y-3">
          {sorted.map((row, idx) => {
            const isExpanded = expandedId === row.voyage_id;
            const ins = row.insight;
            const totalTracked = (ins?.registered_views ?? 0) + (ins?.anonymous_views ?? 0);
            const slug = voyagePublicSlug(row);

            return (
              <div
                key={row.voyage_id}
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
                        onClick={() => toggleExpand(row.voyage_id)}
                        className="font-sans font-medium text-sm truncate hover:text-accent transition-colors text-left"
                      >
                        {insightVoyageName(row)}
                      </button>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        <span>{formatVoyageWindow(row.start_date, row.end_date)}</span>
                        <span className="text-border">|</span>
                        <Eye size={10} />
                        <span>{row.view_count ?? 0}</span>
                        {row.booking_enabled ? (
                          <>
                            <span className="text-border">|</span>
                            <TicketCheck size={10} />
                            <span>{formatCount(row.score?.request_count)} richieste</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {AXIS_CONFIG.map((axis) => {
                      const { key, icon: Icon } = axis;
                      return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <div
                            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-sans cursor-help ${
                              row.score[key] >= 2
                                ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : row.score[key] >= 1
                                  ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <Icon size={10} />
                            <span>{row.score[key]}/2</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="center" className="text-xs max-w-[260px]">
                          {axisTooltip(axis)}
                        </TooltipContent>
                      </Tooltip>
                      );
                    })}
                    <span className="text-sm font-sans font-semibold tabular-nums text-foreground ml-1">
                      {row.score.total}/10
                    </span>
                  </div>

                  <div className="hidden lg:flex items-center gap-4 text-[10px] text-muted-foreground shrink-0">
                    <span>{row.score.reach_count} visitatori</span>
                    <span>{formatDwell(row.score.avg_dwell_ms)} avg</span>
                    <span>{row.score.scroll_pct}% scroll</span>
                    <span>{row.score.retain_pct}% ritorno</span>
                    <span>{row.score.confirmed_count} a bordo</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleExpand(row.voyage_id)}
                    className="shrink-0 p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    aria-label={isExpanded ? "Chiudi dettagli" : "Apri dettagli"}
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-border/50 px-4 md:px-5 pb-4 md:pb-5 pt-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <Link
                        to="/admin/route"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                      >
                        <Pencil size={12} />
                        Rotta
                      </Link>
                      {slug && (
                        <a
                          href={`/voyages/${encodeURIComponent(slug)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                        >
                          <ExternalLink size={12} />
                          Apri
                        </a>
                      )}
                      {row.booking_enabled && (
                        <Link
                          to="/admin/bookings"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-sans bg-muted hover:bg-accent/20 transition-colors"
                        >
                          <CalendarCheck size={12} />
                          Prenotazioni
                        </Link>
                      )}
                    </div>

                    {ins && ins.tracked_views > 0 ? (
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

                        {/* Dwell + scroll */}
                        <div className="space-y-2">
                          <div className="rounded-[12px] border border-border/60 bg-background/40 p-2.5">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5 mb-1">
                              <Clock className="size-3" /> Permanenza media
                            </p>
                            <p className="text-sm font-sans font-semibold tabular-nums">
                              {formatDwell(ins.avg_dwell_ms)}
                            </p>
                          </div>
                          <div className="rounded-[12px] border border-border/60 bg-background/40 p-2.5">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5 mb-1">
                              <Ship className="size-3" /> Scroll medio
                            </p>
                            <p className="text-sm font-sans font-semibold tabular-nums">
                              {ins.avg_scroll_pct ? `${Math.round(ins.avg_scroll_pct)}%` : "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nessuna visita tracciata: il tracking della pagina viaggio raccoglie i dati dalle prossime
                        visite in poi.
                      </p>
                    )}

                    {/* Funnel: dalla visita all'imbarco */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      {[
                        {
                          label: "Visitatori unici",
                          value: formatCount(row.score.unique_visitors),
                          icon: Users,
                        },
                        {
                          label: "Tornati un altro giorno",
                          value: `${formatCount(row.score.returning_visitors)} (${row.score.retain_pct}%)`,
                          icon: Users,
                        },
                        {
                          label: "In attesa di posti",
                          value: formatCount(row.score.watch_count),
                          icon: Eye,
                        },
                        {
                          label: "Bozze aperte",
                          value: formatCount(row.score.draft_count),
                          icon: Pencil,
                        },
                        {
                          label: "Richieste / a bordo",
                          value: `${formatCount(row.score.request_count)} / ${formatCount(row.score.confirmed_count)}`,
                          icon: TicketCheck,
                        },
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="rounded-[12px] border border-border/60 bg-background/40 p-2.5">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5 mb-1">
                            <Icon className="size-3" /> {label}
                          </p>
                          <p className="text-sm font-sans font-semibold tabular-nums">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
};

export default AdminVoyageScores;
