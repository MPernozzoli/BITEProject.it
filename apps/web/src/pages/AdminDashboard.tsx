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
  AlertTriangle,
  BarChart3,
  ClipboardList,
  MessageSquare,
  MessagesSquare,
  Radar,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  const [openContactRequests, setOpenContactRequests] = useState(0);
  const [unreadMail, setUnreadMail] = useState(0);
  const [loading, setLoading] = useState(true);
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
    const [articlesRes, storiesRes, voyagesRes, candidatesRes, seoIssuesRes, contactRequestsRes, unreadMailRes] =
      await Promise.all([
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
        supabase
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .eq("intake_source", "contact_form")
          .eq("archived", false)
          .eq("read", false),
        // Same definition the mailbox uses for its "Non lette" counter.
        supabase
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .eq("read", false)
          .eq("archived", false)
          .eq("spam", false),
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
    // Booking badge: candidature still awaiting an admin decision across all voyages.
    const candidateRows = (candidatesRes.data as { status?: string; is_crew?: boolean; plan_change_status?: string }[] | null) || [];
    setPendingCandidates(
      candidateRows.filter(
        (row) =>
          !row.is_crew &&
          (row.status === "requested" || row.status === "waitlisted" || row.plan_change_status === "pending_user_approval")
      ).length
    );
    // Contatti badge: form submissions nobody has opened yet.
    if (contactRequestsRes.error) {
      console.error("Contact requests count fetch failed:", contactRequestsRes.error);
    } else {
      setOpenContactRequests(contactRequestsRes.count ?? 0);
    }
    // Mail badge: unread inbox mail (archived and spam excluded), contact form included
    // so the number matches the counter shown inside /admin/mail.
    if (unreadMailRes.error) {
      console.error("Unread mail count fetch failed:", unreadMailRes.error);
    } else {
      setUnreadMail(unreadMailRes.count ?? 0);
    }
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

  // Le tre code che richiedono una risposta: badge con il numero di nuove/non lette.
  const inboxItems = useMemo(
    () => [
      {
        to: "/admin/bookings",
        label: "Booking",
        icon: CalendarCheck,
        count: pendingCandidates,
        pendingLabel: "candidature da valutare",
        emptyLabel: "nessuna richiesta aperta",
      },
      {
        to: "/admin/mail",
        label: "Mail",
        icon: Mail,
        count: unreadMail,
        pendingLabel: "messaggi non letti",
        emptyLabel: "inbox in pari",
      },
      {
        to: "/admin/contatti",
        label: "Contatti",
        icon: MessageSquare,
        count: openContactRequests,
        pendingLabel: "richieste dal form",
        emptyLabel: "nessuna nuova richiesta",
      },
    ],
    [openContactRequests, pendingCandidates, unreadMail]
  );

  const metrics = [
    { label: "Pubblicati", value: publishedCount, detail: `${publicationRate}% del logbook`, icon: Send },
    { label: "Schedulati", value: scheduledCount, detail: "uscite pianificate", icon: CalendarClock },
    { label: "Bozze", value: draftCount, detail: "da chiudere", icon: FileText },
    { label: "Stories", value: stories.length, detail: "archi narrativi", icon: BookOpen },
  ];

  const navGroups = useMemo(
    () => [
      {
        label: "Contenuti",
        items: [
          { to: "/admin/articles", label: "Articoli", hint: "Lista e stati", icon: FileText, count: articles.length },
          { to: "/admin/editorial", label: "Piano editoriale", hint: "Slot e uscite", icon: CalendarDays, count: scheduledCount },
          { to: "/admin/stories", label: "Stories", hint: "Archi narrativi", icon: BookOpen, count: stories.length },
          { to: "/admin/content-notes", label: "Content Notes", hint: "Idee e backlog", icon: ClipboardList, count: null },
          { to: "/admin/comments", label: "Commenti", hint: "Social e risposte", icon: MessagesSquare, count: null },
          { to: "/admin/performance", label: "Performance", hint: "Punteggi articoli", icon: BarChart3, count: null },
          { to: "/admin/sorgenti", label: "Sorgenti", hint: "Link tracciati e traffico", icon: Radar, count: null },
        ],
      },
      {
        label: "Viaggi e mappa",
        items: [
          { to: "/admin/route", label: "Rotte", hint: "Voyage e waypoint", icon: Navigation, count: voyagesCount },
          { to: "/admin/trackers", label: "Tracker", hint: "Posizioni in mappa", icon: MapPinned, count: null },
          { to: "/admin/logbook-points", label: "Punti foto", hint: "Foto sulla mappa", icon: Camera, count: null },
        ],
      },
      {
        label: "Community",
        items: [
          { to: "/admin/community", label: "Community", hint: "Prezzi, ruoli, live", icon: UsersRound, count: null },
          { to: "/admin/newsletter", label: "Newsletter", hint: "Campagne e liste", icon: Mail, count: null },
          { to: "/admin/badges", label: "Badge", hint: "Reward e profili", icon: Award, count: null },
          { to: "/admin/spritz", label: "Spritz", hint: "Easter egg", icon: Wine, count: null },
        ],
      },
      {
        label: "Media",
        items: [
          { to: "/admin/media", label: "Media", hint: "Asset e upload", icon: UploadCloud, count: null },
          { to: "/admin/pack-gallery", label: "Galleria pack", hint: "Foto sito cani", icon: ImageIcon, count: null },
        ],
      },
    ],
    [articles.length, scheduledCount, stories.length, voyagesCount]
  );

  if (!isAdminDevBypassEnabled() && (authLoading || !session)) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 md:px-8 xl:px-10">
      <div className="mx-auto max-w-[1440px] space-y-4">
        {/* Barra di testa compatta: identità a sinistra, azioni a destra. */}
        <header className="glass-panel flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[24px] px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-muted-foreground">Admin workspace</p>
            <h1 className="editorial-heading text-2xl leading-tight md:text-3xl">Dashboard</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-sans text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              title="Aggiorna dati"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
              Aggiorna
            </button>
            <Link
              to="/admin/article/new"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-sans text-primary-foreground shadow-[0_16px_34px_rgba(15,23,42,0.16)] transition-transform duration-interaction ease-out-expo hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              <Plus size={15} />
              Nuovo articolo
            </Link>
            <button
              onClick={handleLogout}
              className="glass-chip inline-flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        <Suspense fallback={null}>
          <VoyageLiveWidget />
        </Suspense>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            {/* Code in attesa: badge con il numero di nuove/non lette. */}
            <section className="grid gap-3 sm:grid-cols-3">
              {inboxItems.map((item) => {
                const Icon = item.icon;
                const pending = !loading && item.count > 0;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "glass-panel group flex items-center gap-3 rounded-[22px] px-4 py-3.5 transition-[transform,box-shadow,border-color] duration-interaction ease-out-expo hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.1)] active:translate-y-0",
                      pending && "border-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "glass-chip inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-accent",
                        pending && "text-accent",
                      )}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-sans font-medium text-foreground">{item.label}</span>
                      <span className="block truncate text-xs font-sans text-muted-foreground">
                        {loading ? "…" : pending ? item.pendingLabel : item.emptyLabel}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full px-2 font-sans text-sm font-semibold tabular-nums",
                        pending
                          ? "bg-accent text-accent-foreground shadow-[0_6px_16px_rgba(15,23,42,0.18)]"
                          : "border border-glass-edge/60 bg-glass/40 text-muted-foreground",
                      )}
                      aria-label={`${item.count} ${item.pendingLabel}`}
                    >
                      {loading ? "–" : item.count}
                    </span>
                  </Link>
                );
              })}
            </section>

            {/* Tutte le aree in un solo pannello: etichetta di gruppo a sinistra, tessere a destra. */}
            <section className="glass-panel rounded-[26px] px-4 py-4 md:px-5">
              <div className="divide-y divide-glass-edge/30">
                {navGroups.map((group) => (
                  <div
                    key={group.label}
                    className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[6.5rem_minmax(0,1fr)] md:gap-4"
                  >
                    <p className="pt-1 text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            className="group flex items-center gap-3 rounded-[18px] border border-glass-edge/55 bg-glass/40 px-3 py-2.5 transition-[transform,border-color,background-color] duration-interaction ease-out-expo hover:-translate-y-0.5 hover:border-accent/50 hover:bg-glass/70 active:translate-y-0"
                          >
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-glass-edge/60 bg-glass/50 text-muted-foreground transition-colors group-hover:text-accent">
                              <Icon size={15} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-sans font-medium leading-tight text-foreground">
                                {item.label}
                              </span>
                              <span className="block truncate text-[11px] font-sans text-muted-foreground">{item.hint}</span>
                            </span>
                            {typeof item.count === "number" && (
                              <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
                                {loading ? "–" : item.count}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Colonna laterale: numeri del logbook, alert e ultimo stato. */}
          <aside className="space-y-4">
            <section className="glass-panel-soft rounded-[24px] p-4">
              <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Logbook</p>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {metrics.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 rounded-[18px] border border-glass-edge/55 bg-glass/45 px-3 py-2.5"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-glass-edge/60 bg-glass/50 text-muted-foreground">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                          {item.label}
                        </span>
                        <span className="block truncate text-[11px] font-sans text-muted-foreground/80">{item.detail}</span>
                      </span>
                      <span className="font-sans text-xl font-semibold leading-none tabular-nums text-foreground">
                        {loading ? "–" : item.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {seoIssues.length > 0 && (
              <section className="rounded-[24px] border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 p-4 shadow-[0_14px_40px_rgba(180,83,9,0.08)]">
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0 text-amber-700 dark:text-amber-300" />
                  <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-amber-700 dark:text-amber-300">SEO IA da rivedere</p>
                </div>
                <p className="mb-3 text-xs font-sans leading-relaxed text-amber-950/80 dark:text-amber-300">
                  Alcune ottimizzazioni non sono state generate. Rilancia dal pulsante dentro l'articolo.
                </p>
                <div className="space-y-1.5">
                  {seoIssues.map((issue) => {
                    const article = issue.logbook_articles;
                    const title = article?.title_it || article?.title_en || "Articolo senza titolo";
                    return (
                      <Link
                        key={issue.article_id}
                        to={`/admin/article/${issue.article_id}`}
                        className="flex items-center justify-between gap-3 rounded-[14px] border border-amber-200/80 dark:border-amber-500/30 bg-glass/65 px-3 py-2 transition-colors hover:bg-glass"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-sans font-medium text-amber-950 dark:text-amber-300">{title}</span>
                          <span className="block truncate text-[11px] font-sans text-amber-900/70 dark:text-amber-300">
                            {issue.error_message || "Errore SEO IA non specificato"}
                          </span>
                        </span>
                        <ArrowUpRight size={14} className="shrink-0 text-amber-700 dark:text-amber-300" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="glass-panel-soft rounded-[24px] p-4">
              <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">Ultimi lavori</p>
              <div className="space-y-3">
                <div>
                  <p className="mb-0.5 text-[11px] font-sans text-muted-foreground">Articolo</p>
                  <p className="font-serif text-base leading-tight text-foreground">
                    {latestArticle ? latestArticle.title_it || latestArticle.title_en || "Untitled" : "Nessun articolo"}
                  </p>
                </div>
                <div className="border-t glass-divider pt-3">
                  <p className="mb-0.5 text-[11px] font-sans text-muted-foreground">Story</p>
                  <p className="font-serif text-base leading-tight text-foreground">
                    {latestStory ? latestStory.title_it || latestStory.title_en : "Nessuna story"}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
