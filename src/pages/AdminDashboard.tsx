import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  LogOut,
  Clock,
  FileText,
  Send,
  User,
  BookOpen,
  X,
  Navigation,
  Mail,
  ArrowUpRight,
  CalendarClock,
  Award,
  PanelLeftClose,
  PanelLeftOpen,
  CalendarDays,
  MapPinned,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { useAuth } from "@/hooks/useAuth";
import {
  AdminCollapsibleListFilters,
  adminFilterDateInputClass,
  adminFilterLabelClass,
  adminFilterSelectClass,
  getDateOnlyValue,
  isDateWithinRange,
} from "@/components/admin/AdminCollapsibleListFilters";

const AdminVoyageManager = lazy(() => import("@/components/admin/AdminVoyageManager"));
const AdminNewsletterManager = lazy(() => import("@/components/admin/AdminNewsletterManager"));
const AdminBadgeManager = lazy(() => import("@/components/admin/AdminBadgeManager"));
const AdminEditorialPlan = lazy(() => import("@/components/admin/AdminEditorialPlan"));
const ADMIN_DASHBOARD_SECTION_STORAGE_KEY = "bite_admin_dashboard_active_section";
type AdminSection = "articles" | "editorial" | "stories" | "route" | "newsletter" | "badges";

interface Article {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  category: string;
  editorial_type?: "pillar" | "support" | "utility_reflection" | null;
  status: string;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Story {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  description_en: string | null;
  description_it: string | null;
  cover_image: string | null;
  created_at: string;
  updated_at: string;
}

type ArticleListFilters = {
  status: "all" | "draft" | "scheduled" | "published";
  category: string;
  editorialType: "all" | "pillar" | "support" | "utility_reflection" | "unset";
  dateFilterMode: "created" | "updated" | "published" | "scheduled";
  dateFrom: string;
  dateTo: string;
};

type ArticleListSort = {
  field: "updated_at" | "created_at" | "published_at" | "status" | "category";
  direction: "asc" | "desc";
};

type StoryListFilters = {
  dateFilterMode: "created" | "updated";
  dateFrom: string;
  dateTo: string;
};

type StoryListSort = {
  field: "created_at" | "updated_at" | "title";
  direction: "asc" | "desc";
};

const emptyArticleListFilters: ArticleListFilters = {
  status: "all",
  category: "all",
  editorialType: "all",
  dateFilterMode: "updated",
  dateFrom: "",
  dateTo: "",
};

const defaultArticleListSort: ArticleListSort = {
  field: "updated_at",
  direction: "desc",
};

const emptyStoryListFilters: StoryListFilters = {
  dateFilterMode: "created",
  dateFrom: "",
  dateTo: "",
};

const defaultStoryListSort: StoryListSort = {
  field: "created_at",
  direction: "desc",
};

const articleFilterDate = (article: Article, mode: ArticleListFilters["dateFilterMode"]) => {
  switch (mode) {
    case "created":
      return getDateOnlyValue(article.created_at);
    case "updated":
      return getDateOnlyValue(article.updated_at);
    case "published":
      return getDateOnlyValue(article.published_at);
    case "scheduled":
      return getDateOnlyValue(article.scheduled_at);
  }
};

interface VoyageSummary {
  id: string;
  name: string;
  name_en: string | null;
  name_it: string | null;
  type: "water" | "land";
  status: string;
  is_published: boolean;
  sort_order: number;
}

const statusIcon = (status: string) => {
  switch (status) {
    case "draft":
      return <FileText size={14} className="text-muted-foreground" />;
    case "scheduled":
      return <Clock size={14} className="text-amber-600" />;
    case "published":
      return <Send size={14} className="text-accent" />;
    default:
      return null;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "draft":
      return "Draft";
    case "scheduled":
      return "Scheduled";
    case "published":
      return "Published";
    default:
      return status;
  }
};

const AdminDashboard = () => {
  const { session, loading: authLoading } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [voyages, setVoyages] = useState<VoyageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<AdminSection>(() => {
    if (typeof window === "undefined") return "articles";
    const storedValue = window.sessionStorage.getItem(ADMIN_DASHBOARD_SECTION_STORAGE_KEY);
    return storedValue === "articles" ||
      storedValue === "editorial" ||
      storedValue === "stories" ||
      storedValue === "route" ||
      storedValue === "newsletter" ||
      storedValue === "badges"
      ? storedValue
      : "articles";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showStoryForm, setShowStoryForm] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [storyForm, setStoryForm] = useState({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
  const [routeLeaveGuard, setRouteLeaveGuard] = useState<null | (() => Promise<boolean>)>(null);
  const [selectedRouteVoyageId, setSelectedRouteVoyageId] = useState<string | null>(null);
  const [requestEditVoyageId, setRequestEditVoyageId] = useState<string | null>(null);
  const [articleListFilters, setArticleListFilters] = useState<ArticleListFilters>(emptyArticleListFilters);
  const [articleListSort, setArticleListSort] = useState<ArticleListSort>(defaultArticleListSort);
  const [articleFiltersExpanded, setArticleFiltersExpanded] = useState(false);
  const [articleFiltersAdvanced, setArticleFiltersAdvanced] = useState(false);
  const [storyListFilters, setStoryListFilters] = useState<StoryListFilters>(emptyStoryListFilters);
  const [storyListSort, setStoryListSort] = useState<StoryListSort>(defaultStoryListSort);
  const [storyFiltersExpanded, setStoryFiltersExpanded] = useState(false);
  const [storyFiltersAdvanced, setStoryFiltersAdvanced] = useState(false);
  const navigate = useNavigate();
  const socialOAuthReturnHandled = useRef(false);

  const fetchData = useCallback(async () => {
    if (!session?.user) return;

    setLoading(true);
    const [articlesRes, storiesRes, voyagesRes] = await Promise.all([
      supabase.from("logbook_articles").select("*").order("updated_at", { ascending: false }),
      supabase.from("stories").select("*").order("created_at", { ascending: false }),
      supabase.from("voyages").select("id,name,name_en,name_it,type,status,is_published,sort_order").order("sort_order", { ascending: true }),
    ]);
    const err = articlesRes.error || storiesRes.error || voyagesRes.error;
    if (err && isAuthFailureError(err)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }
    if (articlesRes.data) setArticles(articlesRes.data as unknown as Article[]);
    if (storiesRes.data) setStories(storiesRes.data as Story[]);
    if (voyagesRes.data) setVoyages(voyagesRes.data as VoyageSummary[]);
    setLoading(false);
  }, [navigate, session?.user]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void fetchData();
  }, [authLoading, fetchData, session?.user]);

  useEffect(() => {
    setSidebarCollapsed(activeSection === "newsletter");
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "route") return;
    if (!selectedRouteVoyageId && voyages[0]?.id) {
      setSelectedRouteVoyageId(voyages[0].id);
    }
  }, [activeSection, selectedRouteVoyageId, voyages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(ADMIN_DASHBOARD_SECTION_STORAGE_KEY, activeSection);
  }, [activeSection]);

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
    setActiveSection("editorial");
    params.delete("social_oauth");
    params.delete("reason");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, []);

  const runRouteLeaveGuard = useCallback(async () => {
    if (!routeLeaveGuard) return true;
    return routeLeaveGuard();
  }, [routeLeaveGuard]);

  const handleSectionChange = useCallback(async (nextSection: AdminSection) => {
    if (nextSection === activeSection) return;
    if (!(await runRouteLeaveGuard())) return;
    setActiveSection(nextSection);
  }, [activeSection, runRouteLeaveGuard]);

  const deleteArticle = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    await supabase.from("logbook_articles").delete().eq("id", id);
    setArticles((prev) => prev.filter((a) => a.id !== id));
  };

  const handleLogout = async () => {
    if (!(await runRouteLeaveGuard())) return;
    await supabase.auth.signOut();
    navigate("/login");
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

  const openStoryForm = (story?: Story) => {
    if (story) {
      setEditingStory(story);
      setStoryForm({
        title_en: story.title_en,
        title_it: story.title_it,
        slug: story.slug,
        description_en: story.description_en || "",
        description_it: story.description_it || "",
      });
    } else {
      setEditingStory(null);
      setStoryForm({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
    }
    setShowStoryForm(true);
  };

  const saveStory = async () => {
    const slug = storyForm.slug || generateSlug(storyForm.title_en);
    const data = { ...storyForm, slug };
    if (editingStory) {
      await supabase.from("stories").update(data).eq("id", editingStory.id);
      toast.success("Story updated");
    } else {
      await supabase.from("stories").insert(data);
      toast.success("Story created");
    }
    setShowStoryForm(false);
    fetchData();
  };

  const deleteStory = async (id: string, title: string) => {
    if (!confirm(`Delete story "${title}"? Articles will be unlinked.`)) return;
    await supabase.from("stories").delete().eq("id", id);
    setStories((prev) => prev.filter((s) => s.id !== id));
    toast.success("Story deleted");
  };

  if (authLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <p className="text-sm font-sans text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  const publishedCount = articles.filter((article) => article.status === "published").length;
  const scheduledCount = articles.filter((article) => article.status === "scheduled").length;
  const draftCount = articles.filter((article) => article.status === "draft").length;
  const latestArticle = articles[0] || null;
  const latestStory = stories[0] || null;
  const routeSidebarVoyages = voyages;

  const articleCategories = useMemo(() => {
    const next = new Set<string>();
    articles.forEach((article) => {
      const raw = article.category?.trim();
      if (raw) next.add(raw);
    });
    return [...next].sort((a, b) => a.localeCompare(b));
  }, [articles]);

  const hasActiveArticleFilters =
    articleListFilters.status !== "all" ||
    articleListFilters.category !== "all" ||
    articleListFilters.editorialType !== "all" ||
    Boolean(articleListFilters.dateFrom) ||
    Boolean(articleListFilters.dateTo);

  const filteredArticles = useMemo(
    () =>
      articles.filter((article) => {
        if (articleListFilters.status !== "all" && article.status !== articleListFilters.status) return false;
        if (articleListFilters.category !== "all" && article.category !== articleListFilters.category) return false;
        if (articleListFilters.editorialType === "unset" && article.editorial_type) return false;
        if (
          articleListFilters.editorialType !== "all" &&
          articleListFilters.editorialType !== "unset" &&
          article.editorial_type !== articleListFilters.editorialType
        )
          return false;
        const d = articleFilterDate(article, articleListFilters.dateFilterMode);
        return isDateWithinRange(d, articleListFilters.dateFrom, articleListFilters.dateTo);
      }),
    [articles, articleListFilters]
  );

  const visibleArticles = useMemo(() => {
    const mult = articleListSort.direction === "asc" ? 1 : -1;
    return [...filteredArticles].sort((left, right) => {
      let comparison = 0;
      switch (articleListSort.field) {
        case "updated_at":
          comparison = (left.updated_at || "").localeCompare(right.updated_at || "");
          break;
        case "created_at":
          comparison = (left.created_at || "").localeCompare(right.created_at || "");
          break;
        case "published_at":
          comparison = (left.published_at || "").localeCompare(right.published_at || "");
          break;
        case "status":
          comparison = left.status.localeCompare(right.status);
          break;
        case "category":
          comparison = left.category.localeCompare(right.category);
          break;
      }
      return comparison * mult;
    });
  }, [articleListSort, filteredArticles]);

  const hasActiveStoryFilters = Boolean(storyListFilters.dateFrom) || Boolean(storyListFilters.dateTo);

  const filteredStories = useMemo(
    () =>
      stories.filter((story) => {
        const d =
          storyListFilters.dateFilterMode === "created"
            ? getDateOnlyValue(story.created_at)
            : getDateOnlyValue(story.updated_at);
        return isDateWithinRange(d, storyListFilters.dateFrom, storyListFilters.dateTo);
      }),
    [stories, storyListFilters]
  );

  const visibleStories = useMemo(() => {
    const mult = storyListSort.direction === "asc" ? 1 : -1;
    return [...filteredStories].sort((left, right) => {
      let comparison = 0;
      if (storyListSort.field === "created_at") {
        comparison = (left.created_at || "").localeCompare(right.created_at || "");
      } else if (storyListSort.field === "updated_at") {
        comparison = (left.updated_at || "").localeCompare(right.updated_at || "");
      } else {
        const ta = (left.title_en || left.title_it || "").toLowerCase();
        const tb = (right.title_en || right.title_it || "").toLowerCase();
        comparison = ta.localeCompare(tb);
      }
      return comparison * mult;
    });
  }, [filteredStories, storyListSort]);

  const sectionTabs = [
    { id: "articles" as const, label: "Articoli", icon: FileText },
    { id: "editorial" as const, label: "Piano editoriale", icon: CalendarDays },
    { id: "stories" as const, label: "Stories", icon: BookOpen },
    { id: "badges" as const, label: "Badge", icon: Award },
    { id: "route" as const, label: "Rotte", icon: Navigation },
    { id: "newsletter" as const, label: "Newsletter", icon: Mail },
  ];

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <section className="glass-panel rounded-[38px] px-6 py-8 md:px-10 md:py-10">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Logbook Dashboard</h1>
              <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Logbook Dashboard</h1>
              <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
                Gestisci articoli, stories, rotte e newsletter dentro un’unica interfaccia coerente con il nuovo linguaggio del progetto.
              </p>
            </div>

            <div className="flex items-center gap-3 self-start">
              <Link
                to="/admin/trackers"
                onClick={(event) => {
                  event.preventDefault();
                  void (async () => {
                    if (!(await runRouteLeaveGuard())) return;
                    navigate("/admin/trackers");
                  })();
                }}
                className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
                title="Tracker mappa"
              >
                <MapPinned size={16} />
                Tracker
              </Link>
              <Link
                to="/profile"
                onClick={(event) => {
                  event.preventDefault();
                  void (async () => {
                    if (!(await runRouteLeaveGuard())) return;
                    navigate("/profile");
                  })();
                }}
                className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
                title="Profilo"
              >
                <User size={16} />
                Profilo
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

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
            {[
              { label: "Pubblicati", value: publishedCount, icon: Send },
              { label: "Schedulati", value: scheduledCount, icon: CalendarClock },
              { label: "Bozze", value: draftCount, icon: FileText },
              { label: "Stories", value: stories.length, icon: BookOpen },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="glass-panel-soft rounded-[26px] p-5">
                  <div className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground mb-4">
                    <Icon size={16} />
                  </div>
                  <p className="editorial-heading text-3xl leading-none mb-2">{item.value}</p>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">{item.label}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`grid grid-cols-1 gap-6 ${sidebarCollapsed ? "xl:grid-cols-[96px_minmax(0,1fr)]" : "xl:grid-cols-[0.92fr_2.08fr]"}`}>
          <aside className={`glass-panel rounded-[34px] p-5 md:p-6 h-fit transition-all ${sidebarCollapsed ? "xl:px-3" : ""}`}>
            <div className={`mb-4 flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between gap-3"}`}>
              {!sidebarCollapsed && (
                <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground">Sezioni</p>
              )}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title={sidebarCollapsed ? "Espandi sidebar" : "Comprimi sidebar"}
                aria-label={sidebarCollapsed ? "Espandi sidebar" : "Comprimi sidebar"}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            </div>
            <div className="space-y-2">
              {sectionTabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeSection === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => void handleSectionChange(tab.id)}
                    className={`w-full rounded-[22px] py-3 text-left transition-all ${
                      active
                        ? "bg-white/82 border border-stone-200/90 shadow-[0_14px_30px_rgba(15,23,42,0.07)]"
                        : "glass-panel-soft hover:border-accent"
                    } ${sidebarCollapsed ? "px-2" : "px-4"}`}
                    title={sidebarCollapsed ? tab.label : undefined}
                  >
                    <span className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-3"}`}>
                      <span className="glass-chip inline-flex h-9 w-9 items-center justify-center text-muted-foreground">
                        <Icon size={15} className={active ? "text-accent" : undefined} />
                      </span>
                      {!sidebarCollapsed && (
                        <span>
                          <span className="block font-sans text-sm text-foreground">{tab.label}</span>
                          <span className="block text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground mt-1">
                            {tab.id === "articles" && "Publishing"}
                            {tab.id === "editorial" && "Calendario interno"}
                            {tab.id === "stories" && "Narrative arcs"}
                            {tab.id === "badges" && "Profile rewards"}
                            {tab.id === "route" && "Voyage map"}
                            {tab.id === "newsletter" && "Audience"}
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {!sidebarCollapsed && (
              <div className="glass-panel-soft rounded-[26px] p-5 mt-6">
                <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-3">Snapshot</p>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-sans text-muted-foreground mb-1">Ultimo articolo</p>
                    <p className="font-serif text-lg leading-tight text-foreground">
                      {latestArticle ? latestArticle.title_en || latestArticle.title_it || "Untitled" : "Nessun articolo"}
                    </p>
                  </div>
                  <div className="pt-4 border-t glass-divider">
                    <p className="text-xs font-sans text-muted-foreground mb-1">Ultima story</p>
                    <p className="font-serif text-lg leading-tight text-foreground">
                      {latestStory ? latestStory.title_en || latestStory.title_it : "Nessuna story"}
                    </p>
                  </div>
                  {activeSection === "route" && (
                    <div className="pt-4 border-t glass-divider">
                      <p className="text-xs font-sans text-muted-foreground mb-2">Rotte in mappa</p>
                      <div className="space-y-2 max-h-[320px] overflow-y-auto">
                        {routeSidebarVoyages.length === 0 ? (
                          <p className="text-xs font-sans text-muted-foreground">Nessuna rotta disponibile.</p>
                        ) : (
                          routeSidebarVoyages.map((voyage) => {
                            const displayName = voyage.name_it || voyage.name_en || voyage.name || "Untitled voyage";
                            return (
                              <div key={voyage.id} className="flex items-stretch gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void (async () => {
                                      if (!(await runRouteLeaveGuard())) return;
                                      setSelectedRouteVoyageId(voyage.id);
                                    })();
                                  }}
                                  className={`flex-1 min-w-0 rounded-[18px] border px-3 py-2 text-left transition-colors ${
                                    selectedRouteVoyageId === voyage.id
                                      ? "border-accent bg-accent/10"
                                      : "border-border/70 bg-background/40 hover:border-accent/50"
                                  }`}
                                >
                                  <span className="block text-sm font-sans text-foreground truncate">{displayName}</span>
                                  <span className="mt-1 block text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">
                                    {voyage.type} · {voyage.status}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRequestEditVoyageId(voyage.id)}
                                  className="shrink-0 self-stretch inline-flex items-center justify-center rounded-[18px] border border-border/70 bg-background/80 px-2.5 text-muted-foreground hover:border-accent hover:text-foreground transition-colors"
                                  title="Modifica nome e dettagli rotta"
                                  aria-label="Modifica info rotta"
                                >
                                  <Edit size={14} />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>

          <main className="glass-panel rounded-[34px] p-5 md:p-6 lg:p-8">
            {activeSection === "articles" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Publishing</p>
                    <h2 className="editorial-heading text-3xl md:text-4xl">Articoli</h2>
                  </div>
                  <Link
                    to="/admin/article/new"
                    onClick={(event) => {
                      event.preventDefault();
                      void (async () => {
                        if (!(await runRouteLeaveGuard())) return;
                        navigate("/admin/article/new");
                      })();
                    }}
                    className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
                  >
                    <Plus size={16} />
                    Nuovo articolo
                  </Link>
                </div>

                <AdminCollapsibleListFilters
                  title="Filtri articoli"
                  expanded={articleFiltersExpanded}
                  onToggleExpanded={() => setArticleFiltersExpanded((open) => !open)}
                  visibleCount={visibleArticles.length}
                  totalCount={articles.length}
                  hasActiveFilters={hasActiveArticleFilters}
                  onResetFilters={() => {
                    setArticleListFilters(emptyArticleListFilters);
                  }}
                  advancedOpen={articleFiltersAdvanced}
                  onToggleAdvanced={() => setArticleFiltersAdvanced((open) => !open)}
                  minimalRow={
                    <>
                      <div className="min-w-[6.5rem] flex-1">
                        <label className={adminFilterLabelClass}>Stato</label>
                        <select
                          value={articleListFilters.status}
                          onChange={(event) =>
                            setArticleListFilters((current) => ({
                              ...current,
                              status: event.target.value as ArticleListFilters["status"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="all">Tutti</option>
                          <option value="draft">Bozza</option>
                          <option value="scheduled">Programmato</option>
                          <option value="published">Pubblicato</option>
                        </select>
                      </div>
                      <div className="min-w-[6.5rem] flex-1">
                        <label className={adminFilterLabelClass}>Categoria</label>
                        <select
                          value={articleListFilters.category}
                          onChange={(event) =>
                            setArticleListFilters((current) => ({ ...current, category: event.target.value }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="all">Tutte</option>
                          {articleCategories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-[8.5rem] flex-1">
                        <label className={adminFilterLabelClass}>Tipo editoriale</label>
                        <select
                          value={articleListFilters.editorialType}
                          onChange={(event) =>
                            setArticleListFilters((current) => ({
                              ...current,
                              editorialType: event.target.value as ArticleListFilters["editorialType"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="all">Tutti</option>
                          <option value="pillar">Pillar</option>
                          <option value="support">Support</option>
                          <option value="utility_reflection">Utility / Reflection</option>
                          <option value="unset">Non classificato</option>
                        </select>
                      </div>
                      <div className="min-w-[9.5rem] flex-1">
                        <label className={adminFilterLabelClass}>Data (filtro)</label>
                        <select
                          value={articleListFilters.dateFilterMode}
                          onChange={(event) =>
                            setArticleListFilters((current) => ({
                              ...current,
                              dateFilterMode: event.target.value as ArticleListFilters["dateFilterMode"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="created">Creazione</option>
                          <option value="updated">Ultimo aggiornamento</option>
                          <option value="published">Pubblicazione</option>
                          <option value="scheduled">Data programmata</option>
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-[2] flex-wrap items-end gap-x-1.5 gap-y-1">
                        <div className="min-w-[6.5rem] flex-1">
                          <label className={adminFilterLabelClass}>Da</label>
                          <input
                            type="date"
                            value={articleListFilters.dateFrom}
                            onChange={(event) =>
                              setArticleListFilters((current) => ({ ...current, dateFrom: event.target.value }))
                            }
                            className={adminFilterDateInputClass}
                          />
                        </div>
                        <div className="min-w-[6.5rem] flex-1">
                          <label className={adminFilterLabelClass}>A</label>
                          <input
                            type="date"
                            value={articleListFilters.dateTo}
                            onChange={(event) =>
                              setArticleListFilters((current) => ({ ...current, dateTo: event.target.value }))
                            }
                            className={adminFilterDateInputClass}
                          />
                        </div>
                      </div>
                    </>
                  }
                  advancedRow={
                    <>
                      <div>
                        <label className={adminFilterLabelClass}>Ordina per</label>
                        <select
                          value={articleListSort.field}
                          onChange={(event) =>
                            setArticleListSort((current) => ({
                              ...current,
                              field: event.target.value as ArticleListSort["field"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="updated_at">Ultimo aggiornamento</option>
                          <option value="created_at">Creazione</option>
                          <option value="published_at">Pubblicazione</option>
                          <option value="status">Stato</option>
                          <option value="category">Categoria</option>
                        </select>
                      </div>
                      <div>
                        <label className={adminFilterLabelClass}>Direzione</label>
                        <select
                          value={articleListSort.direction}
                          onChange={(event) =>
                            setArticleListSort((current) => ({
                              ...current,
                              direction: event.target.value as ArticleListSort["direction"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="desc">Decrescente</option>
                          <option value="asc">Crescente</option>
                        </select>
                      </div>
                    </>
                  }
                />

                {loading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="glass-panel-soft rounded-[24px] h-24" />
                    <div className="glass-panel-soft rounded-[24px] h-24" />
                    <div className="glass-panel-soft rounded-[24px] h-24" />
                  </div>
                ) : articles.length === 0 ? (
                  <div className="glass-panel-soft rounded-[28px] p-10 text-center">
                    <p className="text-muted-foreground mb-4">Nessun articolo ancora pubblicato o salvato.</p>
                    <Link
                      to="/admin/article/new"
                      className="inline-flex items-center gap-2 text-sm font-sans text-accent hover:text-foreground transition-colors"
                    >
                      <Plus size={16} />
                      Crea il primo articolo
                    </Link>
                  </div>
                ) : visibleArticles.length === 0 ? (
                  <div className="glass-panel-soft rounded-[28px] p-10 text-center space-y-3">
                    <p className="text-muted-foreground">Nessun articolo corrisponde ai filtri.</p>
                    <button
                      type="button"
                      onClick={() => setArticleListFilters(emptyArticleListFilters)}
                      className="text-sm font-sans text-accent hover:text-foreground transition-colors"
                    >
                      Reimposta filtri
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleArticles.map((article) => (
                      <article key={article.id} className="glass-panel-soft rounded-[26px] p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                                {statusIcon(article.status)}
                                {statusLabel(article.status)}
                              </span>
                              <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                                {article.category}
                              </span>
                              {article.editorial_type && (
                                <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-accent/90">
                                  {article.editorial_type === "utility_reflection"
                                    ? "Utility"
                                    : article.editorial_type}
                                </span>
                              )}
                            </div>
                            <h3 className="editorial-heading text-2xl leading-tight mb-2">
                              {article.title_en || article.title_it || "Untitled"}
                            </h3>
                            <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                              Aggiornato il {format(new Date(article.updated_at), "d MMM yyyy, HH:mm")}
                              {article.scheduled_at && article.status === "scheduled" && (
                                <> · programmato per {format(new Date(article.scheduled_at), "d MMM yyyy, HH:mm")}</>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {article.status === "published" && (
                              <Link
                                to={`/logbook/${article.slug}`}
                                className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                                title="View"
                              >
                                <Eye size={16} />
                              </Link>
                            )}
                            <Link
                              to={`/admin/article/${article.id}`}
                              onClick={(event) => {
                                event.preventDefault();
                                void (async () => {
                                  if (!(await runRouteLeaveGuard())) return;
                                  navigate(`/admin/article/${article.id}`);
                                })();
                              }}
                              className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Edit size={16} />
                            </Link>
                            <button
                              onClick={() => deleteArticle(article.id, article.title_en || article.title_it || "Untitled")}
                              className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "editorial" && (
              <Suspense
                fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Caricamento piano editoriale…</div>}
              >
                <AdminEditorialPlan />
              </Suspense>
            )}

            {activeSection === "stories" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Narrative arcs</p>
                    <h2 className="editorial-heading text-3xl md:text-4xl">Stories</h2>
                  </div>
                  <button
                    onClick={() => openStoryForm()}
                    className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
                  >
                    <Plus size={16} />
                    Nuova story
                  </button>
                </div>

                <AdminCollapsibleListFilters
                  title="Filtri stories"
                  expanded={storyFiltersExpanded}
                  onToggleExpanded={() => setStoryFiltersExpanded((open) => !open)}
                  visibleCount={visibleStories.length}
                  totalCount={stories.length}
                  hasActiveFilters={hasActiveStoryFilters}
                  onResetFilters={() => setStoryListFilters(emptyStoryListFilters)}
                  advancedOpen={storyFiltersAdvanced}
                  onToggleAdvanced={() => setStoryFiltersAdvanced((open) => !open)}
                  minimalRow={
                    <>
                      <div className="min-w-[9.5rem] flex-1">
                        <label className={adminFilterLabelClass}>Data (filtro)</label>
                        <select
                          value={storyListFilters.dateFilterMode}
                          onChange={(event) =>
                            setStoryListFilters((current) => ({
                              ...current,
                              dateFilterMode: event.target.value as StoryListFilters["dateFilterMode"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="created">Creazione</option>
                          <option value="updated">Ultimo aggiornamento</option>
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-[2] flex-wrap items-end gap-x-1.5 gap-y-1">
                        <div className="min-w-[6.5rem] flex-1">
                          <label className={adminFilterLabelClass}>Da</label>
                          <input
                            type="date"
                            value={storyListFilters.dateFrom}
                            onChange={(event) =>
                              setStoryListFilters((current) => ({ ...current, dateFrom: event.target.value }))
                            }
                            className={adminFilterDateInputClass}
                          />
                        </div>
                        <div className="min-w-[6.5rem] flex-1">
                          <label className={adminFilterLabelClass}>A</label>
                          <input
                            type="date"
                            value={storyListFilters.dateTo}
                            onChange={(event) =>
                              setStoryListFilters((current) => ({ ...current, dateTo: event.target.value }))
                            }
                            className={adminFilterDateInputClass}
                          />
                        </div>
                      </div>
                    </>
                  }
                  advancedRow={
                    <>
                      <div>
                        <label className={adminFilterLabelClass}>Ordina per</label>
                        <select
                          value={storyListSort.field}
                          onChange={(event) =>
                            setStoryListSort((current) => ({
                              ...current,
                              field: event.target.value as StoryListSort["field"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="created_at">Creazione</option>
                          <option value="updated_at">Ultimo aggiornamento</option>
                          <option value="title">Titolo</option>
                        </select>
                      </div>
                      <div>
                        <label className={adminFilterLabelClass}>Direzione</label>
                        <select
                          value={storyListSort.direction}
                          onChange={(event) =>
                            setStoryListSort((current) => ({
                              ...current,
                              direction: event.target.value as StoryListSort["direction"],
                            }))
                          }
                          className={adminFilterSelectClass}
                        >
                          <option value="desc">Decrescente</option>
                          <option value="asc">Crescente</option>
                        </select>
                      </div>
                    </>
                  }
                />

                {showStoryForm && (
                  <div className="glass-panel-soft rounded-[30px] p-6 md:p-7 space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                          {editingStory ? "Editing" : "Creation"}
                        </p>
                        <h3 className="editorial-heading text-2xl">
                          {editingStory ? "Modifica story" : "Nuova story"}
                        </h3>
                      </div>
                      <button
                        onClick={() => setShowStoryForm(false)}
                        className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Title (EN)</label>
                        <input
                          type="text"
                          value={storyForm.title_en}
                          onChange={(e) => {
                            setStoryForm((f) => ({ ...f, title_en: e.target.value, slug: f.slug || generateSlug(e.target.value) }));
                          }}
                          className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Title (IT)</label>
                        <input
                          type="text"
                          value={storyForm.title_it}
                          onChange={(e) => setStoryForm((f) => ({ ...f, title_it: e.target.value }))}
                          className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug</label>
                      <input
                        type="text"
                        value={storyForm.slug}
                        onChange={(e) => setStoryForm((f) => ({ ...f, slug: e.target.value }))}
                        className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Description (EN)</label>
                        <textarea
                          value={storyForm.description_en}
                          onChange={(e) => setStoryForm((f) => ({ ...f, description_en: e.target.value }))}
                          rows={3}
                          className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Description (IT)</label>
                        <textarea
                          value={storyForm.description_it}
                          onChange={(e) => setStoryForm((f) => ({ ...f, description_it: e.target.value }))}
                          rows={3}
                          className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={saveStory}
                        className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
                      >
                        <ArrowUpRight size={16} />
                        {editingStory ? "Aggiorna story" : "Crea story"}
                      </button>
                    </div>
                  </div>
                )}

                {stories.length === 0 && !showStoryForm ? (
                  <div className="glass-panel-soft rounded-[28px] p-10 text-center">
                    <p className="text-muted-foreground mb-4">Nessuna story disponibile.</p>
                    <button
                      onClick={() => openStoryForm()}
                      className="inline-flex items-center gap-2 text-sm font-sans text-accent hover:text-foreground transition-colors"
                    >
                      <Plus size={16} />
                      Crea la prima story
                    </button>
                  </div>
                ) : visibleStories.length === 0 && stories.length > 0 ? (
                  <div className="glass-panel-soft rounded-[28px] p-10 text-center space-y-3">
                    <p className="text-muted-foreground">Nessuna story corrisponde ai filtri.</p>
                    <button
                      type="button"
                      onClick={() => setStoryListFilters(emptyStoryListFilters)}
                      className="text-sm font-sans text-accent hover:text-foreground transition-colors"
                    >
                      Reimposta filtri
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleStories.map((story) => (
                      <article key={story.id} className="glass-panel-soft rounded-[26px] p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-accent">
                                <BookOpen size={13} />
                                Story
                              </span>
                            </div>
                            <h3 className="editorial-heading text-2xl leading-tight mb-2">
                              {story.title_en || story.title_it}
                            </h3>
                            <p className="text-sm font-sans text-muted-foreground">/{story.slug}</p>
                            <p className="text-xs font-sans text-muted-foreground mt-1">
                              Creata {format(new Date(story.created_at), "d MMM yyyy")} · aggiornata{" "}
                              {format(new Date(story.updated_at), "d MMM yyyy, HH:mm")}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Link
                              to={`/logbook/story/${story.slug}`}
                              className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                              title="View"
                            >
                              <Eye size={16} />
                            </Link>
                            <button
                              onClick={() => openStoryForm(story)}
                              className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => deleteStory(story.id, story.title_en || story.title_it)}
                              className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === "route" && (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Voyage map</p>
                    <h2 className="editorial-heading text-3xl md:text-4xl">Rotte</h2>
                  </div>
                  <Link
                    to="/admin/trackers"
                    onClick={(event) => {
                      event.preventDefault();
                      void (async () => {
                        if (!(await runRouteLeaveGuard())) return;
                        navigate("/admin/trackers");
                      })();
                    }}
                    className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
                  >
                    <MapPinned size={16} />
                    Apri tracker mappa
                  </Link>
                </div>
                <Suspense fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading route manager...</div>}>
                  <AdminVoyageManager
                    onRegisterLeaveGuard={(guard) => setRouteLeaveGuard(() => guard)}
                    selectedVoyageId={selectedRouteVoyageId}
                    onSelectedVoyageIdChange={setSelectedRouteVoyageId}
                    requestEditVoyageId={requestEditVoyageId}
                    onRequestEditVoyageConsumed={() => setRequestEditVoyageId(null)}
                  />
                </Suspense>
              </div>
            )}

            {activeSection === "badges" && (
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Profile rewards</p>
                  <h2 className="editorial-heading text-3xl md:text-4xl">Badge</h2>
                </div>
                <Suspense fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading badge manager...</div>}>
                  <AdminBadgeManager />
                </Suspense>
              </div>
            )}

            {activeSection === "newsletter" && (
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Audience</p>
                  <h2 className="editorial-heading text-3xl md:text-4xl">Newsletter</h2>
                </div>
                <Suspense fallback={<div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">Loading newsletter manager...</div>}>
                  <AdminNewsletterManager />
                </Suspense>
              </div>
            )}
          </main>
        </section>
      </div>
    </div>
  );
};

export default AdminDashboard;
