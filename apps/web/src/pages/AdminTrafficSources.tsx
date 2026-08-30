/**
 * Sorgenti di traffico: il generatore di link tracciati e il report di ciò che
 * quei link hanno portato.
 *
 * Le due metà stanno nella stessa pagina di proposito. Un link tracciato è
 * un'ipotesi ("questo gruppo porterà lettori"); il report è la verifica. Averli
 * separati vorrebbe dire generare link e non guardare mai il risultato.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Radar,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { MAIN_HOSTNAME } from "@/lib/admin-host";
import { slugForLang } from "@/lib/article-slug";
import { formatCount, formatDwell } from "@/lib/article-insights";
import {
  TRACKING_CHANNELS,
  buildTrackedUrl,
  mediumLabel,
  normalizeTrackingToken,
  sourceLabel,
} from "@/lib/utm";

type Lang = "it" | "en";

interface ContentRow {
  id: string;
  title_it: string | null;
  title_en: string | null;
  slug: string | null;
  slug_it: string | null;
  slug_en: string | null;
}

interface SourceRow {
  source: string;
  medium: string;
  campaign: string | null;
  views: number;
  unique_visitors: number;
  registered_views: number;
  articles: number;
  avg_dwell_ms: number | null;
  last_view_at: string | null;
}

interface SourceArticleRow {
  article_id: string;
  title_it: string | null;
  title_en: string | null;
  slug: string | null;
  views: number;
  unique_visitors: number;
  avg_dwell_ms: number | null;
  last_view_at: string | null;
}

const PERIODS = [
  { days: 7, label: "7 giorni" },
  { days: 30, label: "30 giorni" },
  { days: 90, label: "90 giorni" },
  { days: 365, label: "12 mesi" },
] as const;

const CUSTOM_CHANNEL = "__custom__";

/**
 * L'origine pubblica del sito. In admin il browser sta su un altro sottodominio:
 * un link generato con `window.location.origin` punterebbe al backoffice.
 */
function publicOrigin(): string {
  if (typeof window === "undefined") return `https://${MAIN_HOSTNAME}`;
  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  return `https://${MAIN_HOSTNAME}`;
}

const rowKey = (r: SourceRow) => `${r.source}|${r.medium}|${r.campaign ?? ""}`;

const AdminTrafficSources = () => {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [articles, setArticles] = useState<ContentRow[]>([]);
  const [stories, setStories] = useState<ContentRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedArticles, setExpandedArticles] = useState<SourceArticleRow[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Generatore
  const [targetKind, setTargetKind] = useState<"article" | "story" | "url">("article");
  const [targetId, setTargetId] = useState<string>("");
  const [customUrl, setCustomUrl] = useState<string>("");
  const [lang, setLang] = useState<Lang>("it");
  const [channel, setChannel] = useState<string>(TRACKING_CHANNELS[0].id);
  const [source, setSource] = useState<string>(TRACKING_CHANNELS[0].source);
  const [medium, setMedium] = useState<string>(TRACKING_CHANNELS[0].medium);
  const [campaign, setCampaign] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const handleAuthFailure = useCallback(
    async (error: unknown) => {
      if (!isAuthFailureError(error)) return false;
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/sorgenti" } });
      return true;
    },
    [navigate],
  );

  const fetchContent = useCallback(async () => {
    const [articlesRes, storiesRes] = await Promise.all([
      supabase
        .from("logbook_articles")
        .select("id,title_it,title_en,slug,slug_it,slug_en,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false }),
      supabase.from("stories").select("id,title_it,title_en,slug,slug_it,slug_en").order("created_at", { ascending: false }),
    ]);
    if (await handleAuthFailure(articlesRes.error || storiesRes.error)) return;
    if (articlesRes.data) setArticles(articlesRes.data as unknown as ContentRow[]);
    if (storiesRes.data) setStories(storiesRes.data as unknown as ContentRow[]);
  }, [handleAuthFailure]);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_traffic_sources", { _days: days });
    if (await handleAuthFailure(error)) {
      setLoading(false);
      return;
    }
    if (error) {
      toast.error("Lettura sorgenti fallita.");
      setSources([]);
    } else {
      setSources((data ?? []) as unknown as SourceRow[]);
    }
    setLoading(false);
  }, [days, handleAuthFailure]);

  useEffect(() => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    void fetchContent();
  }, [fetchContent, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    void fetchSources();
  }, [fetchSources, session?.user?.id]);

  // Cambiare canale ricompila sorgente e mezzo, non la campagna: quella
  // descrive l'iniziativa e sopravvive al cambio di canale.
  const applyChannel = (id: string) => {
    setChannel(id);
    const preset = TRACKING_CHANNELS.find((c) => c.id === id);
    if (preset) {
      setSource(preset.source);
      setMedium(preset.medium);
    }
  };

  const selectedContent = useMemo(() => {
    const pool = targetKind === "article" ? articles : stories;
    return pool.find((r) => r.id === targetId) ?? null;
  }, [articles, stories, targetId, targetKind]);

  /** L'indirizzo canonico del bersaglio, senza tracker. */
  const canonicalUrl = useMemo(() => {
    if (targetKind === "url") return customUrl.trim();
    if (!selectedContent) return "";
    const slug = slugForLang(selectedContent, lang);
    if (!slug) return "";
    const prefix = targetKind === "article" ? "logbook" : "logbook/story";
    return `${publicOrigin()}/${lang}/${prefix}/${encodeURIComponent(slug)}`;
  }, [customUrl, lang, selectedContent, targetKind]);

  /** La campagna proposta: lo slug del contenuto, finché non se ne scrive una. */
  const effectiveCampaign = useMemo(() => {
    if (campaign.trim()) return normalizeTrackingToken(campaign);
    if (targetKind === "url") return "";
    return normalizeTrackingToken(slugForLang(selectedContent, lang));
  }, [campaign, lang, selectedContent, targetKind]);

  const trackedUrl = useMemo(() => {
    if (!canonicalUrl) return "";
    return buildTrackedUrl(canonicalUrl, {
      source,
      medium,
      campaign: effectiveCampaign,
      content,
    });
  }, [canonicalUrl, content, effectiveCampaign, medium, source]);

  const copyTrackedUrl = async () => {
    if (!trackedUrl) return;
    try {
      await navigator.clipboard.writeText(trackedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Link tracciato copiato.");
    } catch {
      toast.error("Impossibile copiare il link.");
    }
  };

  const toggleExpanded = async (row: SourceRow) => {
    const key = rowKey(row);
    if (expanded === key) {
      setExpanded(null);
      setExpandedArticles([]);
      return;
    }
    setExpanded(key);
    setExpandedArticles([]);
    setExpandedLoading(true);
    const { data, error } = await supabase.rpc("admin_traffic_source_articles", {
      _source: row.source,
      _days: days,
      _medium: row.medium,
      _campaign: row.campaign ?? undefined,
    });
    setExpandedLoading(false);
    if (await handleAuthFailure(error)) return;
    if (!error) setExpandedArticles((data ?? []) as unknown as SourceArticleRow[]);
  };

  const totals = useMemo(() => {
    const views = sources.reduce((sum, r) => sum + Number(r.views ?? 0), 0);
    const tracked = sources
      .filter((r) => r.source !== "direct")
      .reduce((sum, r) => sum + Number(r.views ?? 0), 0);
    return { views, tracked, channels: new Set(sources.map((r) => r.source)).size };
  }, [sources]);

  const contentPool = targetKind === "article" ? articles : stories;

  if (!isAdminDevBypassEnabled() && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-24 px-4 md:px-8">
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
              <Radar size={14} />
              Sorgenti
            </div>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Da dove arrivano</h1>
            <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
              I tracker funzionano solo sui link che pubblichiamo noi: genera qui l'indirizzo da incollare,
              invece di copiarlo dalla barra del browser. Chi arriva da una ricerca o da un link girato in
              chat resta classificato dal referrer, e chi non lascia traccia finisce in "Diretto".
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Generatore                                                          */}
        {/* ------------------------------------------------------------------ */}
        <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Link2 size={18} className="text-muted-foreground" />
            <h2 className="editorial-heading text-xl">Genera un link tracciato</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">Cosa condividere</label>
              <div className="mt-1 flex gap-2">
                {(
                  [
                    { id: "article", label: "Articolo" },
                    { id: "story", label: "Storia" },
                    { id: "url", label: "Altra pagina" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setTargetKind(option.id);
                      setTargetId("");
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-sans transition-colors ${
                      targetKind === option.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">Lingua</label>
              <div className="mt-1 flex gap-2">
                {(["it", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    className={`px-3 py-1.5 rounded-full text-xs font-sans uppercase transition-colors ${
                      lang === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {targetKind === "url" ? (
              <div className="md:col-span-2">
                <label htmlFor="tracker-url" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                  Indirizzo
                </label>
                <input
                  id="tracker-url"
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder={`${publicOrigin()}/it/voyages`}
                  className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
                />
              </div>
            ) : (
              <div className="md:col-span-2">
                <label htmlFor="tracker-target" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                  {targetKind === "article" ? "Articolo" : "Storia"}
                </label>
                <select
                  id="tracker-target"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
                >
                  <option value="">Seleziona…</option>
                  {contentPool.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title_it || row.title_en || row.slug}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="tracker-channel" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                Canale
              </label>
              <select
                id="tracker-channel"
                value={channel}
                onChange={(e) => applyChannel(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
              >
                {TRACKING_CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                <option value={CUSTOM_CHANNEL}>Personalizzato…</option>
              </select>
              {TRACKING_CHANNELS.find((c) => c.id === channel)?.hint && (
                <p className="mt-1 text-[11px] font-sans text-muted-foreground">
                  {TRACKING_CHANNELS.find((c) => c.id === channel)?.hint}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="tracker-campaign" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                Campagna
              </label>
              <input
                id="tracker-campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder={effectiveCampaign || "slug del contenuto"}
                className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
              />
            </div>

            <div>
              <label htmlFor="tracker-source" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                utm_source
              </label>
              <input
                id="tracker-source"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setChannel(CUSTOM_CHANNEL);
                }}
                className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
              />
            </div>

            <div>
              <label htmlFor="tracker-medium" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                utm_medium
              </label>
              <input
                id="tracker-medium"
                value={medium}
                onChange={(e) => {
                  setMedium(e.target.value);
                  setChannel(CUSTOM_CHANNEL);
                }}
                className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="tracker-content" className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                Variante <span className="normal-case tracking-normal">(utm_content, opzionale)</span>
              </label>
              <input
                id="tracker-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="es. cta-fondo, primo-commento"
                className="mt-1 min-h-11 w-full rounded-[14px] border border-border bg-background/90 px-3 py-2 text-sm font-sans"
              />
            </div>
          </div>

          <div className="rounded-[20px] border border-border/70 bg-background/60 p-4 space-y-3">
            <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-muted-foreground">Link da incollare</p>
            {trackedUrl ? (
              <>
                <p className="break-all font-mono text-xs text-foreground">{trackedUrl}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyTrackedUrl()}
                    className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-sans hover:text-foreground transition-colors"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copiato" : "Copia"}
                  </button>
                  <a
                    href={trackedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink size={14} />
                    Apri
                  </a>
                </div>
              </>
            ) : (
              <p className="text-xs font-sans text-muted-foreground">
                {targetKind === "url" ? "Incolla un indirizzo." : "Seleziona un contenuto."}
              </p>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Report                                                              */}
        {/* ------------------------------------------------------------------ */}
        <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="editorial-heading text-xl mr-2">Cosa hanno portato</h2>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                className={`px-3 py-1 rounded-full text-xs font-sans transition-colors ${
                  days === p.days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-xs font-sans text-muted-foreground">
            <span>
              <span className="text-foreground font-medium tabular-nums">{formatCount(totals.views)}</span> letture tracciate
            </span>
            <span className="text-border">|</span>
            <span>
              <span className="text-foreground font-medium tabular-nums">{formatCount(totals.tracked)}</span> con una sorgente
              riconosciuta
            </span>
            <span className="text-border">|</span>
            <span>
              <span className="text-foreground font-medium tabular-nums">{totals.channels}</span> sorgenti distinte
            </span>
          </div>

          {loading && <p className="text-sm font-sans text-muted-foreground animate-pulse">Caricamento...</p>}

          {!loading && sources.length === 0 && (
            <p className="text-sm font-sans text-muted-foreground py-8 text-center">
              Nessuna lettura nel periodo. I dati compaiono man mano che le pagine vengono visitate.
            </p>
          )}

          <div className="space-y-2">
            {sources.map((row) => {
              const key = rowKey(row);
              const isOpen = expanded === key;
              return (
                <div key={key} className={`glass-panel-soft rounded-[18px] ${isOpen ? "ring-1 ring-accent/40" : ""}`}>
                  <button
                    type="button"
                    onClick={() => void toggleExpanded(row)}
                    className="w-full p-4 flex flex-col gap-2 text-left md:flex-row md:items-center"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <div className="min-w-0">
                        <p className="font-sans text-sm font-medium truncate">
                          {sourceLabel(row.source)}
                          <span className="text-muted-foreground font-normal"> · {mediumLabel(row.medium)}</span>
                        </p>
                        {row.campaign && (
                          <p className="text-[11px] font-sans text-muted-foreground truncate">campagna: {row.campaign}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] font-sans text-muted-foreground shrink-0">
                      <span className="inline-flex items-center gap-1">
                        <Eye size={11} />
                        <span className="tabular-nums text-foreground font-medium">{formatCount(row.views)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} />
                        <span className="tabular-nums">{formatCount(row.unique_visitors)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        <span className="tabular-nums">{formatDwell(row.avg_dwell_ms)}</span>
                      </span>
                      <span className="hidden sm:inline tabular-nums">{formatCount(row.articles)} articoli</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border/60 px-4 py-3 space-y-2">
                      {expandedLoading && (
                        <p className="text-xs font-sans text-muted-foreground animate-pulse">Caricamento articoli...</p>
                      )}
                      {!expandedLoading && expandedArticles.length === 0 && (
                        <p className="text-xs font-sans text-muted-foreground">Nessun articolo per questa sorgente.</p>
                      )}
                      {expandedArticles.map((a) => (
                        <div key={a.article_id} className="flex items-center gap-3 text-xs font-sans">
                          <span className="min-w-0 flex-1 truncate">{a.title_it || a.title_en}</span>
                          <span className="tabular-nums text-muted-foreground">{formatCount(a.views)} letture</span>
                          <span className="tabular-nums text-muted-foreground">{formatDwell(a.avg_dwell_ms)}</span>
                          <Link
                            to={`/admin/article/${a.article_id}`}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Apri in editor"
                          >
                            <ExternalLink size={12} />
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminTrafficSources;
