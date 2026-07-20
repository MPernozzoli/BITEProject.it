import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus,
  LogOut,
  FileText,
  Send,
  BookOpen,
  Navigation,
  Mail,
  ArrowUpRight,
  CalendarClock,
  CalendarCheck,
  Award,
  UsersRound,
  CalendarDays,
  Camera,
  Image as ImageIcon,
  MapPinned,
  UploadCloud,
  Wine,
  ChevronDown,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { useAuth } from "@/hooks/useAuth";
import { getPushPermission, subscribeToPushNotifications, supportsWebPush } from "@/lib/pwa";

const VoyageLiveWidget = lazy(() => import("@/components/voyage/VoyageLiveWidget"));

interface ArticleSummary {
  id: string;
  title_en: string;
  title_it: string;
  status: string;
  updated_at: string;
}

interface StorySummary {
  id: string;
  title_en: string;
  title_it: string;
  created_at: string;
}

interface SeoIssue {
  article_id: string;
  error_message: string | null;
  updated_at: string;
  logbook_articles?: {
    title_en: string | null;
    title_it: string | null;
    slug: string | null;
  } | null;
}

const AdminDashboard = () => {
  const { session, loading: authLoading } = useAuth();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [voyagesCount, setVoyagesCount] = useState(0);
  const [seoIssues, setSeoIssues] = useState<SeoIssue[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const navigate = useNavigate();
  const socialOAuthReturnHandled = useRef(false);
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId || !supportsWebPush() || getPushPermission() !== "granted") return;

    let cancelled = false;
    void (async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        if (!supabaseUrl) return;

        const response = await fetch(`${supabaseUrl}/functions/v1/vapid-public-key`);
        const data = (await response.json()) as { publicKey?: string };
        if (cancelled || !data.publicKey) return;

        const subscription = await subscribeToPushNotifications(data.publicKey);
        if (cancelled) return;

        const payload = subscription.toJSON();
        const endpoint = payload.endpoint;
        const p256dh = payload.keys?.p256dh;
        const auth = payload.keys?.auth;
        if (!endpoint || !p256dh || !auth) return;

        const { error } = await supabase.from("push_subscriptions").upsert(
          {
            profile_id: userId,
            endpoint,
            p256dh,
            auth,
            expiration_time:
              typeof payload.expirationTime === "number"
                ? new Date(payload.expirationTime).toISOString()
                : null,
            user_agent: navigator.userAgent,
            enabled: true,
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );

        if (error) console.error("Admin push subscription sync error:", error);
      } catch (error) {
        console.error("Admin push subscription refresh failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const fetchData = useCallback(async () => {
    if (!userId && !isAdminDevBypassEnabled()) return;

    setLoading(true);
    const [articlesRes, storiesRes, voyagesRes, candidatesRes, seoIssuesRes] = await Promise.all([
      supabase.from("logbook_articles").select("id,title_en,title_it,status,updated_at").order("updated_at", { ascending: false }),
      supabase.from("stories").select("id,title_en,title_it,created_at").order("created_at", { ascending: false }),
      supabase.from("voyages").select("id"),
      (supabase as unknown as { from: (table: string) => { select: (columns?: string) => Promise<{ data: unknown; error: unknown }> } })
        .from("voyage_booking_requests")
        .select("status,is_crew,plan_change_status"),
      supabase
        .from("article_seo_optimizations")
        .select("article_id,error_message,updated_at,logbook_articles(title_en,title_it,slug)")
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);
    const err = articlesRes.error || storiesRes.error || voyagesRes.error;
    if (err && isAuthFailureError(err)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }
    if (articlesRes.data) setArticles(articlesRes.data as unknown as ArticleSummary[]);
    if (storiesRes.data) setStories(storiesRes.data as unknown as StorySummary[]);
    if (voyagesRes.data) setVoyagesCount(voyagesRes.data.length);
    if (seoIssuesRes.error) {
      console.error("SEO dashboard warning fetch failed:", seoIssuesRes.error);
    } else {
      setSeoIssues((seoIssuesRes.data ?? []) as unknown as SeoIssue[]);
    }
    // Booking chip badge: candidature still awaiting an admin decision across all voyages.
    const candidateRows = (candidatesRes.data as { status?: string; is_crew?: boolean; plan_change_status?: string }[] | null) || [];
    setPendingCandidates(
      candidateRows.filter(
        (row) =>
          !row.is_crew &&
          (row.status === "requested" || row.status === "waitlisted" || row.plan_change_status === "pending_user_approval")
      ).length
    );
    setLoading(false);
  }, [navigate, userId]);

  useEffect(() => {
    // The dev bypass renders without a session; fetch anyway so the panels have
    // the publicly readable rows to work with.
    if (!isAdminDevBypassEnabled() && (authLoading || !userId)) return;
    void fetchData();
  }, [authLoading, fetchData, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const social = params.get("social_oauth");
    if (!social) return;
    if (socialOAuthReturnHandled.current) return;
    socialOAuthReturnHandled.current = true;
    if (social === "success") {
      toast.success("Collegamento social completato.");
    } else {
      const reason = params.get("reason")?.trim();
      toast.error(reason ? `Collegamento social non riuscito: ${reason}` : "Collegamento social non riuscito.");
    }
    navigate("/admin/editorial", { replace: true });
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const publishedCount = articles.filter((article) => article.status === "published").length;
  const scheduledCount = articles.filter((article) => article.status === "scheduled").length;
  const draftCount = articles.filter((article) => article.status === "draft").length;
  const latestArticle = articles[0] || null;
  const latestStory = stories[0] || null;

  const publicationRate = articles.length > 0 ? Math.round((publishedCount / articles.length) * 100) : 0;

  const sectionCards = useMemo(
    () => [
      { to: "/admin/articles", label: "Articoli", eyebrow: "Publishing", description: "Lista, stati e modifiche rapide", icon: FileText, count: articles.length },
      { to: "/admin/editorial", label: "Piano editoriale", eyebrow: "Calendario", description: "Slot, assegnazioni e uscite", icon: CalendarDays, count: scheduledCount },
      { to: "/admin/stories", label: "Stories", eyebrow: "Narrativa", description: "Archi editoriali e slug", icon: BookOpen, count: stories.length },
      { to: "/admin/route", label: "Rotte", eyebrow: "Mappa", description: "Voyage, waypoint e geometrie", icon: Navigation, count: voyagesCount },
      { to: "/admin/community", label: "Community", eyebrow: "Crew", description: "Prezzi, ruoli, live e rinnovi", icon: UsersRound, count: null },
      { to: "/admin/newsletter", label: "Newsletter", eyebrow: "Audience", description: "Campagne, liste e automazioni", icon: Mail, count: null },
      { to: "/admin/badges", label: "Badge", eyebrow: "Community", description: "Reward e profili collegati", icon: Award, count: null },
    ],
    [articles.length, scheduledCount, stories.length, voyagesCount]
  );

  const quickLinkGroups = [
    {
      label: "Comunicazioni",
      items: [
        { to: "/admin/bookings", label: "Booking", description: "Richieste e candidature", icon: CalendarCheck, badge: pendingCandidates },
        { to: "/admin/mail", label: "Mail", description: "Inbox e risposte", icon: Mail, badge: 0 },
      ],
    },
    {
      label: "Mappa",
      items: [
        { to: "/admin/trackers", label: "Tracker", description: "Posizioni mappa, insieme alle rotte", icon: MapPinned, badge: 0 },
      ],
    },
    {
      label: "Media",
      collapsible: true,
      icon: UploadCloud,
      description: "Asset, punti foto e galleria pack",
      items: [
        { to: "/admin/media", label: "Media", description: "Asset e upload", icon: UploadCloud, badge: 0 },
        { to: "/admin/logbook-points", label: "Punti foto", description: "Foto sulla mappa", icon: Camera, badge: 0 },
        { to: "/admin/pack-gallery", label: "Galleria pack", description: "Foto del sito cani", icon: ImageIcon, badge: 0 },
      ],
    },
    {
      label: "Extra",
      items: [
        { to: "/admin/spritz", label: "Spritz", description: "Easter egg trovato da", icon: Wine, badge: 0 },
      ],
    },
  ];

  const overviewMetrics = [
    { label: "Pubblicati", value: publishedCount, detail: `${publicationRate}% del logbook`, icon: Send },
    { label: "Schedulati", value: scheduledCount, detail: "uscite pianificate", icon: CalendarClock },
    { label: "Bozze", value: draftCount, detail: "contenuti da chiudere", icon: FileText },
    { label: "Stories", value: stories.length, detail: "archi narrativi", icon: BookOpen },
  ];

  if (!isAdminDevBypassEnabled() && (authLoading || !session)) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <section className="glass-panel rounded-[34px] px-5 py-6 md:px-8 md:py-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)] xl:items-start">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-accent">
                  Admin workspace
                </span>
              </div>
              <h1 className="editorial-heading text-3xl md:text-5xl">Dashboard</h1>
              <p className="mt-3 max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                Punto di ingresso per pubblicazione, viaggi, mail e asset. Ogni area ha una vista dedicata: entra dalla card e torna qui
                quando hai finito.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  to="/admin/article/new"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-sans text-primary-foreground shadow-[0_16px_34px_rgba(15,23,42,0.16)] transition-transform duration-interaction ease-out-expo hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                >
                  <Plus size={16} />
                  Nuovo articolo
                </Link>
                <button
                  onClick={handleLogout}
                  className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
                  title="Logout"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            </div>

            <div className="glass-panel-soft rounded-[26px] p-4 md:p-5">
              <p className="mb-3 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Shortcut operativi</p>
              <div className="space-y-4">
                {quickLinkGroups.map((group) => {
                  const GroupIcon = group.icon;
                  return (
                    <div key={group.label} className="space-y-2">
                      <p className="px-1 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground/70">{group.label}</p>
                      {group.collapsible ? (
                        <div className="rounded-[20px] border border-white/55 bg-white/40 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setMediaMenuOpen((prev) => !prev)}
                            className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/60"
                            aria-expanded={mediaMenuOpen}
                          >
                            <span className="glass-chip inline-flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground group-hover:text-accent">
                              {GroupIcon && <GroupIcon size={16} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-sans font-medium text-foreground">{group.label}</span>
                              <span className="block truncate text-xs font-sans text-muted-foreground">{group.description}</span>
                            </span>
                            <ChevronDown
                              size={16}
                              className={`shrink-0 text-muted-foreground transition-transform duration-interaction ease-out-expo ${mediaMenuOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                          {mediaMenuOpen && (
                            <div className="space-y-1 border-t glass-divider p-2">
                              {group.items.map((item) => {
                                const Icon = item.icon;
                                return (
                                  <Link
                                    key={item.to}
                                    to={item.to}
                                    className="group flex items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-white/70"
                                  >
                                    <span className="glass-chip inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground group-hover:text-accent">
                                      <Icon size={14} />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-sm font-sans font-medium text-foreground">{item.label}</span>
                                      <span className="block truncate text-xs font-sans text-muted-foreground">{item.description}</span>
                                    </span>
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`grid grid-cols-1 gap-2 ${group.items.length > 1 ? "sm:grid-cols-2 xl:grid-cols-1" : ""}`}>
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.to}
                                to={item.to}
                                className="group flex items-center gap-3 rounded-[20px] border border-white/55 bg-white/40 px-3 py-3 text-left transition-[border-color,background-color,transform] duration-interaction ease-out-expo hover:-translate-y-0.5 hover:border-accent/50 hover:bg-white/70 active:translate-y-0"
                              >
                                <span className="glass-chip relative inline-flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground group-hover:text-accent">
                                  <Icon size={16} />
                                  {item.badge > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground shadow-[0_4px_10px_rgba(15,23,42,0.18)]">
                                      {item.badge}
                                    </span>
                                  )}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-sans font-medium text-foreground">{item.label}</span>
                                  <span className="block truncate text-xs font-sans text-muted-foreground">{item.description}</span>
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {overviewMetrics.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-[24px] border border-white/55 bg-white/45 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                    <span className="glass-chip inline-flex h-9 w-9 items-center justify-center text-muted-foreground">
                      <Icon size={15} />
                    </span>
                  </div>
                  <p className="font-sans text-3xl font-semibold leading-none text-foreground tabular-nums">
                    {loading ? "–" : item.value}
                  </p>
                  <p className="mt-2 text-xs font-sans text-muted-foreground">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </section>

        {seoIssues.length > 0 && (
          <section className="rounded-[28px] border border-amber-300/70 bg-amber-50/80 px-5 py-4 shadow-[0_14px_40px_rgba(180,83,9,0.08)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-amber-700">SEO IA da rivedere</p>
                  <p className="mt-1 text-sm font-sans text-amber-950/80">
                    Alcune ottimizzazioni SEO non sono state generate. Pubblicazione e salvataggio sono completati; puoi rilanciare dal pulsante nell'articolo.
                  </p>
                </div>
              </div>
              <div className="w-full space-y-2 md:max-w-xl">
                {seoIssues.map((issue) => {
                  const article = issue.logbook_articles;
                  const title = article?.title_it || article?.title_en || "Articolo senza titolo";
                  return (
                    <Link
                      key={issue.article_id}
                      to={`/admin/article/${issue.article_id}`}
                      className="flex items-center justify-between gap-4 rounded-[18px] border border-amber-200/80 bg-white/65 px-3 py-2 text-left transition-colors hover:bg-white"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-sans font-medium text-amber-950">{title}</span>
                        <span className="block truncate text-xs font-sans text-amber-900/70">
                          {issue.error_message || "Errore SEO IA non specificato"}
                        </span>
                      </span>
                      <ArrowUpRight size={15} className="shrink-0 text-amber-700" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <Suspense fallback={null}>
          <VoyageLiveWidget />
        </Suspense>

        <section className="space-y-4">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Sezioni</p>
            <h2 className="editorial-heading text-2xl md:text-3xl">Aree dedicate</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sectionCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.to}
                  to={card.to}
                  className="group glass-panel rounded-[28px] p-5 transition-[transform,box-shadow] duration-interaction ease-out-expo hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.1)] active:translate-y-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="glass-chip inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground group-hover:text-accent transition-colors">
                      <Icon size={18} />
                    </span>
                    <ChevronRight size={16} className="mt-2 shrink-0 text-muted-foreground/60 transition-transform duration-interaction ease-out-expo group-hover:translate-x-0.5 group-hover:text-accent" />
                  </div>
                  <p className="mt-4 text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">{card.eyebrow}</p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <h3 className="editorial-heading text-xl leading-tight">{card.label}</h3>
                    {typeof card.count === "number" && (
                      <span className="font-sans text-xs tabular-nums text-muted-foreground">{card.count}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-sans text-muted-foreground leading-relaxed">{card.description}</p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="glass-panel-soft rounded-[26px] p-5">
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-3">Snapshot</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-sans text-muted-foreground mb-1">Ultimo articolo</p>
              <p className="font-serif text-lg leading-tight text-foreground">
                {latestArticle ? latestArticle.title_en || latestArticle.title_it || "Untitled" : "Nessun articolo"}
              </p>
            </div>
            <div className="sm:border-l sm:pl-4 glass-divider sm:border-t-0 border-t pt-4 sm:pt-0">
              <p className="text-xs font-sans text-muted-foreground mb-1">Ultima story</p>
              <p className="font-serif text-lg leading-tight text-foreground">
                {latestStory ? latestStory.title_en || latestStory.title_it : "Nessuna story"}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminDashboard;
