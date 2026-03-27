import { useI18n } from "@/lib/i18n";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Search, Plus, Map, List, Ship, Navigation, Anchor, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import { useArticleReads } from "@/hooks/useArticleReads";
import { useAuth } from "@/hooks/useAuth";
import VoyageMap from "@/components/voyage/VoyageMap";
import ArticleListCard from "@/components/voyage/ArticleListCard";
import ArticleSlidePanel from "@/components/voyage/ArticleSlidePanel";
import { totalWaypointDistance } from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";

const Journal = () => {
  const { t, lang } = useI18n();
  const { isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [panelArticle, setPanelArticle] = useState<GeoArticle | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isRead } = useArticleReads();
  const articleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch articles with geo data
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["logbook-articles-geo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;

      const ids = (data || []).map((a: any) => a.id);
      if (!ids.length) return [];

      const [authorRes, tagRes, likeRes] = await Promise.all([
        supabase.from("article_authors").select("article_id, profile_id").in("article_id", ids),
        supabase.from("article_tags").select("article_id, tag_id, tags(id, name)").in("article_id", ids),
        supabase.from("article_likes").select("article_id").in("article_id", ids),
      ]);

      const profileIds = [...new Set((authorRes.data || []).map((a: any) => a.profile_id))];
      const { data: profiles } = profileIds.length
        ? await supabase.from("profiles").select("id, name, avatar_url").in("id", profileIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));

      const articleAuthorsMap: Record<string, any[]> = {};
      (authorRes.data || []).forEach((link: any) => {
        if (!articleAuthorsMap[link.article_id]) articleAuthorsMap[link.article_id] = [];
        const profile = profileMap[link.profile_id];
        if (profile) articleAuthorsMap[link.article_id].push(profile);
      });

      const articleTagsMap: Record<string, { id: string; name: string }[]> = {};
      (tagRes.data || []).forEach((link: any) => {
        if (!articleTagsMap[link.article_id]) articleTagsMap[link.article_id] = [];
        if (link.tags) articleTagsMap[link.article_id].push(link.tags);
      });

      const likeCounts: Record<string, number> = {};
      (likeRes.data || []).forEach((like: any) => {
        likeCounts[like.article_id] = (likeCounts[like.article_id] || 0) + 1;
      });

      return (data || []).map((article: any) => ({
        ...article,
        authors: articleAuthorsMap[article.id] || [],
        tags: articleTagsMap[article.id] || [],
        likeCount: likeCounts[article.id] || 0,
      })) as GeoArticle[];
    },
  });

  // Fetch voyages
  const { data: voyages = [] } = useQuery({
    queryKey: ["voyages"],
    queryFn: async () => {
      const { data } = await supabase
        .from("voyages" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      return (data || []) as unknown as Voyage[];
    },
  });

  // Fetch waypoints for all voyages
  const { data: allWaypoints = [] } = useQuery({
    queryKey: ["voyage-waypoints"],
    queryFn: async () => {
      const { data } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });

  const waypointsMap = useMemo(() => {
    const map: Record<string, VoyageWaypoint[]> = {};
    allWaypoints.forEach((wp) => {
      if (!map[wp.voyage_id]) map[wp.voyage_id] = [];
      map[wp.voyage_id].push(wp);
    });
    return map;
  }, [allWaypoints]);

  // Filter articles
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return articles;
    const q = searchQuery.toLowerCase();
    return articles.filter((a) => {
      const title = (lang === "en" ? a.title_en : a.title_it || a.title_en).toLowerCase();
      const excerpt = (lang === "en" ? a.excerpt_en : a.excerpt_it || a.excerpt_en || "").toLowerCase();
      return title.includes(q) || excerpt.includes(q) || a.location_name?.toLowerCase().includes(q);
    });
  }, [articles, searchQuery, lang]);

  // Stats
  const stats = useMemo(() => {
    let totalNM = 0;
    let voyageCount = voyages.length;
    const activeVoyage = voyages.find((v) => v.status === "active");

    voyages.forEach((v) => {
      const wps = waypointsMap[v.id] || [];
      if (wps.length >= 2) {
        totalNM += totalWaypointDistance(wps);
      }
    });

    return { totalNM: Math.round(totalNM), voyageCount, activeVoyage };
  }, [voyages, waypointsMap]);

  // Scroll to article in list
  const scrollToArticle = useCallback((articleId: string) => {
    const el = articleRefs.current[articleId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const handleArticleClick = useCallback((article: GeoArticle) => {
    setSelectedArticleId(article.id);
    setPanelArticle(article);
    scrollToArticle(article.id);
  }, [scrollToArticle]);

  const handleListArticleClick = useCallback((article: GeoArticle) => {
    setSelectedArticleId(article.id);
    setPanelArticle(article);
  }, []);

  // Highlighted voyage based on selected article
  const highlightedVoyageId = useMemo(() => {
    if (!selectedArticleId) return null;
    const article = articles.find((a) => a.id === selectedArticleId);
    return article?.voyage_id || null;
  }, [selectedArticleId, articles]);

  const geoArticleCount = articles.filter((a) => a.latitude && a.longitude).length;

  return (
    <div className="min-h-screen flex flex-col">
      {viewMode === "map" ? (
        <div className="flex-1 relative" style={{ height: "100vh" }}>
          {/* Full-screen map */}
          <VoyageMap
            voyages={voyages}
            waypointsMap={waypointsMap}
            articles={filtered}
            selectedArticleId={selectedArticleId}
            highlightedVoyageId={highlightedVoyageId}
            onArticleClick={handleArticleClick}
            lang={lang}
          />

          {/* Floating controls — top right */}
          <div className="absolute top-24 right-4 z-20 flex flex-col gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="bg-background/90 backdrop-blur-md border border-border shadow-lg p-2.5 hover:bg-background transition-colors"
              title={sidebarOpen ? "Hide list" : "Show list"}
            >
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="bg-background/90 backdrop-blur-md border border-border shadow-lg p-2.5 hover:bg-background transition-colors"
              title="Grid view"
            >
              <List size={16} />
            </button>
            {isAdmin && (
              <Link
                to="/admin/article/new"
                className="bg-primary text-primary-foreground shadow-lg p-2.5 hover:opacity-90 transition-opacity flex items-center justify-center"
              >
                <Plus size={16} />
              </Link>
            )}
          </div>

          {/* Floating stats bar — top center */}
          {stats.totalNM > 0 && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-2 bg-background/90 backdrop-blur-md border border-border shadow-lg px-4 py-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-muted-foreground">
                <Ship size={10} /> {stats.totalNM.toLocaleString()} NM
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-muted-foreground">
                <Navigation size={10} /> {stats.voyageCount} {lang === "it" ? "viaggi" : "voyages"}
              </span>
              {stats.activeVoyage && (
                <>
                  <span className="w-px h-3 bg-border" />
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-accent">
                    <Anchor size={10} /> {stats.activeVoyage.name}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Floating sidebar — article list */}
          <div
            className={`absolute top-24 left-4 bottom-4 z-20 w-[340px] xl:w-[380px] bg-background/95 backdrop-blur-md border border-border shadow-2xl flex flex-col transition-all duration-300 ease-out ${
              sidebarOpen
                ? "translate-x-0 opacity-100"
                : "-translate-x-[calc(100%+1rem)] opacity-0 pointer-events-none"
            }`}
          >
            {/* Search inside sidebar */}
            <div className="p-3 border-b border-border shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={lang === "it" ? "Cerca..." : "Search..."}
                  className="w-full bg-transparent border border-border pl-8 pr-3 py-1.5 text-xs font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            {/* Article list */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="p-3 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse flex gap-3">
                      <div className="w-16 h-16 bg-muted shrink-0" />
                      <div className="flex-1">
                        <div className="h-3 bg-muted w-1/3 mb-2" />
                        <div className="h-4 bg-muted w-3/4 mb-1" />
                        <div className="h-3 bg-muted w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-xs">
                  {lang === "it" ? "Nessun risultato." : "No entries found."}
                </div>
              ) : (
                filtered.map((article) => (
                  <ArticleListCard
                    key={article.id}
                    ref={(el) => { articleRefs.current[article.id] = el; }}
                    article={article}
                    lang={lang}
                    isActive={selectedArticleId === article.id}
                    isRead={isRead(article.id)}
                    onClick={() => handleListArticleClick(article)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* List-only view — classic grid */
        <>
          <div className="pt-20 md:pt-24 px-6 md:px-12 pb-4 bg-background border-b border-border">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="relative max-w-md flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={lang === "it" ? "Cerca articoli, luoghi..." : "Search articles, places..."}
                  className="w-full bg-transparent border border-border pl-9 pr-4 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => setViewMode("map")}
                  className="p-2 bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Map size={14} />
                </button>
                {isAdmin && (
                  <Link
                    to="/admin/article/new"
                    className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 text-xs font-sans font-medium tracking-wide hover:opacity-90 transition-opacity"
                  >
                    <Plus size={12} /> {lang === "it" ? "Nuovo" : "New"}
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 px-6 md:px-12 py-8">
            <div className="max-w-7xl mx-auto">
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="aspect-[16/10] bg-muted mb-4" />
                      <div className="h-4 bg-muted w-3/4 mb-2" />
                      <div className="h-3 bg-muted w-1/2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
                  {filtered.map((article) => {
                    const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
                    const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);
                    return (
                      <Link to={`/logbook/${article.slug}`} key={article.id} className="block group">
                        <article>
                          <div className="aspect-[16/10] overflow-hidden bg-muted mb-4 relative">
                            {article.cover_image ? (
                              <img src={article.cover_image} alt={title} className="img-cover group-hover:scale-105 transition-transform duration-700" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-xl">BITE</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {article.location_name && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans text-accent">
                                <Map size={9} /> {article.location_name}
                              </span>
                            )}
                            {article.tags?.slice(0, 2).map((tag: any) => (
                              <span key={tag.id} className="text-[11px] font-sans text-accent">#{tag.name}</span>
                            ))}
                          </div>
                          <h3 className="editorial-heading text-lg md:text-xl mb-2 group-hover:text-accent transition-colors line-clamp-2">
                            {title}
                          </h3>
                          <p className="text-sm text-muted-foreground font-sans line-clamp-2">{excerpt}</p>
                        </article>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Slide panel */}
      <ArticleSlidePanel
        article={panelArticle}
        onClose={() => {
          setPanelArticle(null);
          setSelectedArticleId(null);
        }}
        lang={lang}
      />
    </div>
  );
};

export default Journal;
