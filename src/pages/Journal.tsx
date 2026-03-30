import { useI18n } from "@/lib/i18n";
import { useState, useMemo, useRef, useCallback, useEffect, type TouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Search, Plus, Map, List, Ship, Navigation, Anchor, ChevronUp, ChevronDown } from "lucide-react";
import { useArticleReads } from "@/hooks/useArticleReads";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import LazyVoyageMap from "@/components/LazyVoyageMap";
import ArticleListCard from "@/components/voyage/ArticleListCard";
import ArticleSlidePanel from "@/components/voyage/ArticleSlidePanel";
import ProfileSlidePanel from "@/components/voyage/ProfileSlidePanel";
import ExpandedArticleModal, { type ExpandedArticleOrigin } from "@/components/voyage/ExpandedArticleModal";
import { totalWaypointDistance } from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";

const Journal = () => {
  const EXPANDED_READER_MS = 480;
  const MOBILE_SIDEBAR_PEEK = 220;
  const MOBILE_SIDEBAR_OPEN = 0.78;
  const MOBILE_SIDEBAR_HANDLE = 34;
  const MOBILE_SHEET_SWIPE_THRESHOLD = 48;
  const { t, lang } = useI18n();
  const { isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [panelArticle, setPanelArticle] = useState<GeoArticle | null>(null);
  const [panelProfileId, setPanelProfileId] = useState<string | null>(null);
  const [expandedArticle, setExpandedArticle] = useState<{ slug: string; originRect: ExpandedArticleOrigin } | null>(null);
  const [expandedArticlePhase, setExpandedArticlePhase] = useState<"opening" | "open" | "closing" | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarMode, setMobileSidebarMode] = useState<"peek" | "expanded" | "collapsed">("peek");
  const [mobileSidebarDragOffset, setMobileSidebarDragOffset] = useState(0);
  const [hideMapChromeOnScroll, setHideMapChromeOnScroll] = useState(false);
  const { isRead } = useArticleReads();
  const articleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const articlePanelRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const mobileSidebarTouchStartRef = useRef<number | null>(null);

  const buildFallbackPanelRect = useCallback((): ExpandedArticleOrigin => {
    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const top = 96;
    const bottomInset = 16;

    if (viewportWidth >= 640) {
      const width = viewportWidth >= 1280 ? 460 : 440;
      return {
        top,
        left: Math.max(16, viewportWidth - 16 - width),
        width,
        height: Math.max(320, viewportHeight - top - bottomInset),
        borderRadius: 32,
      };
    }

    return {
      top,
      left: 12,
      width: Math.max(320, viewportWidth - 24),
      height: Math.max(320, viewportHeight - top - bottomInset),
      borderRadius: 32,
    };
  }, []);

  const capturePanelOrigin = useCallback((): ExpandedArticleOrigin => {
    const rect = articlePanelRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return buildFallbackPanelRect();
    }

    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      borderRadius: 32,
    };
  }, [buildFallbackPanelRect]);

  // Fetch articles with geo data
  const { data: articles = [], isLoading: isArticlesLoading } = useQuery({
    queryKey: ["logbook-articles-geo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
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
        viewCount: Number(article.view_count ?? 0),
      })) as GeoArticle[];
    },
  });

  // Fetch voyages
  const { data: voyages = [], isLoading: isVoyagesLoading } = useQuery({
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
  const { data: allWaypoints = [], isLoading: isWaypointsLoading } = useQuery({
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
    const voyageCount = voyages.length;
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
    setPanelProfileId(null);
    scrollToArticle(article.id);
  }, [scrollToArticle]);

  const handleListArticleClick = useCallback((article: GeoArticle) => {
    setSelectedArticleId(article.id);
    setPanelArticle(article);
    setPanelProfileId(null);
    if (isMobile) {
      setMobileSidebarMode("expanded");
    }
  }, [isMobile]);

  const handleProfilePreviewOpen = useCallback((profileId: string) => {
    setPanelProfileId(profileId);
  }, []);

  const handleOpenExpandedArticle = useCallback((article: GeoArticle) => {
    setPanelArticle(article);
    setPanelProfileId(null);
    setExpandedArticle({
      slug: article.slug,
      originRect: capturePanelOrigin(),
    });
    setExpandedArticlePhase("opening");
    if (isMobile) {
      setMobileSidebarMode("collapsed");
    } else {
      setSidebarOpen(false);
    }
  }, [capturePanelOrigin, isMobile]);

  const handleCollapseExpandedArticle = useCallback(() => {
    if (!expandedArticle) return;
    setExpandedArticlePhase("closing");
    if (isMobile) {
      setMobileSidebarMode("expanded");
    } else {
      setSidebarOpen(true);
    }
  }, [expandedArticle, isMobile]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
      return;
    }

    setSidebarOpen((current) => !current);
  }, [isMobile]);

  const handleMobileSidebarTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    mobileSidebarTouchStartRef.current = event.touches[0]?.clientY ?? null;
    setMobileSidebarDragOffset(0);
  }, []);

  const handleMobileSidebarTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (mobileSidebarTouchStartRef.current === null) return;
    const currentY = event.touches[0]?.clientY ?? mobileSidebarTouchStartRef.current;
    const delta = currentY - mobileSidebarTouchStartRef.current;

    if (mobileSidebarMode === "expanded" && delta > 0) {
      setMobileSidebarDragOffset(Math.min(delta, 160));
      return;
    }

    if ((mobileSidebarMode === "peek" || mobileSidebarMode === "collapsed") && delta < 0) {
      setMobileSidebarDragOffset(Math.min(Math.abs(delta), 160));
      return;
    }

    setMobileSidebarDragOffset(0);
  }, [mobileSidebarMode]);

  const handleMobileSidebarTouchEnd = useCallback(() => {
    if (mobileSidebarTouchStartRef.current === null) return;

    if (mobileSidebarDragOffset > MOBILE_SHEET_SWIPE_THRESHOLD) {
      setMobileSidebarMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
    }

    mobileSidebarTouchStartRef.current = null;
    setMobileSidebarDragOffset(0);
  }, [mobileSidebarDragOffset]);

  useEffect(() => {
    if (!panelArticle) return;

    const nextPanelArticle = articles.find((article) => article.id === panelArticle.id);
    if (nextPanelArticle && nextPanelArticle !== panelArticle) {
      setPanelArticle(nextPanelArticle);
    }
  }, [articles, panelArticle]);

  useEffect(() => {
    if (expandedArticlePhase !== "opening") return;

    const frameId = window.requestAnimationFrame(() => {
      setExpandedArticlePhase("open");
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [expandedArticlePhase]);

  useEffect(() => {
    if (expandedArticlePhase !== "closing") return;

    const timeoutId = window.setTimeout(() => {
      setExpandedArticle(null);
      setExpandedArticlePhase(null);
    }, EXPANDED_READER_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [expandedArticlePhase]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (viewMode !== "map") {
      setHideMapChromeOnScroll(false);
      return;
    }

    lastScrollYRef.current = window.scrollY;
    let frameId: number | null = null;

    const handleScroll = () => {
      if (frameId !== null) return;

      frameId = window.requestAnimationFrame(() => {
        frameId = null;

        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollYRef.current;

        if (currentScrollY <= 24) {
          setHideMapChromeOnScroll(false);
          lastScrollYRef.current = currentScrollY;
          return;
        }

        if (Math.abs(delta) < 12) return;

        setHideMapChromeOnScroll(delta > 0);
        lastScrollYRef.current = currentScrollY;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", handleScroll);
    };
  }, [viewMode]);

  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarMode("peek");
      setMobileSidebarDragOffset(0);
    }
  }, [isMobile]);

  // Highlighted voyage based on selected article
  const highlightedVoyageId = useMemo(() => {
    if (!selectedArticleId) return null;
    const article = articles.find((a) => a.id === selectedArticleId);
    return article?.voyage_id || null;
  }, [selectedArticleId, articles]);

  const articleReaderActive = Boolean(expandedArticle);
  const showPreviewPanel = Boolean(panelArticle) && (!articleReaderActive || expandedArticlePhase === "closing");
  const sidePanelVisible = showPreviewPanel || Boolean(panelProfileId);
  const isSidebarAutoHidden = !isMobile && hideMapChromeOnScroll && sidebarOpen;
  const isDetailPanelAutoHidden = hideMapChromeOnScroll && sidePanelVisible;
  const shouldOffsetControlsForDetail = sidePanelVisible && !isDetailPanelAutoHidden;
  const mobileSidebarVisible = mobileSidebarMode !== "collapsed";
  const mobileSidebarHeight = typeof window === "undefined"
    ? 560
    : Math.max(360, Math.round(window.innerHeight * MOBILE_SIDEBAR_OPEN));
  const mobileSidebarPeekHeight = Math.min(MOBILE_SIDEBAR_PEEK, Math.round(mobileSidebarHeight * 0.42));
  const mobileSidebarBaseOffset =
    mobileSidebarMode === "expanded"
      ? 0
      : mobileSidebarMode === "peek"
        ? Math.max(0, mobileSidebarHeight - mobileSidebarPeekHeight)
        : Math.max(0, mobileSidebarHeight - MOBILE_SIDEBAR_HANDLE);
  const mobileSidebarTranslateY =
    mobileSidebarMode === "expanded"
      ? Math.max(0, mobileSidebarDragOffset)
      : Math.max(0, mobileSidebarBaseOffset - mobileSidebarDragOffset);
  const isMapInteractionLocked =
    viewMode === "map" &&
    (articleReaderActive || showPreviewPanel || Boolean(panelProfileId) || (isMobile && mobileSidebarVisible));

  return (
    <div className="min-h-screen flex flex-col">
      {viewMode === "map" ? (
        <div className="relative flex-1 min-h-screen" style={{ height: "100vh" }}>
          {/* Full-screen map */}
          <LazyVoyageMap
            voyages={voyages}
            waypointsMap={waypointsMap}
            articles={filtered}
            selectedArticleId={selectedArticleId}
            highlightedVoyageId={highlightedVoyageId}
            onArticleClick={handleArticleClick}
            lang={lang}
            disableInteractions={isMapInteractionLocked}
            initialFitReady={!isArticlesLoading && !isVoyagesLoading && !isWaypointsLoading}
            fallbackHeightClassName="h-full min-h-screen"
          />

          {isMapInteractionLocked && <div className="absolute inset-0 z-10" aria-hidden />}

          {/* Floating controls — top right */}
          <div
            className={`fixed top-24 z-30 flex flex-col gap-2 transition-all duration-300 ${
              shouldOffsetControlsForDetail ? "right-4 lg:right-[29rem] xl:right-[30.5rem]" : "right-4"
            }`}
          >
            <button
              onClick={toggleSidebar}
              className="rounded-full border border-white/60 bg-background/75 backdrop-blur-xl shadow-lg p-2.5 hover:bg-background transition-colors"
              title={isMobile ? (mobileSidebarMode === "expanded" ? "Collapse list" : "Expand list") : (sidebarOpen ? "Hide list" : "Show list")}
            >
              {(isMobile ? mobileSidebarMode === "expanded" : sidebarOpen) ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="rounded-full border border-white/60 bg-background/75 backdrop-blur-xl shadow-lg p-2.5 hover:bg-background transition-colors"
              title="Grid view"
            >
              <List size={16} />
            </button>
            {isAdmin && (
              <Link
                to="/admin/article/new"
                className="rounded-full bg-primary text-primary-foreground shadow-lg p-2.5 hover:opacity-90 transition-opacity flex items-center justify-center"
              >
                <Plus size={16} />
              </Link>
            )}
          </div>

          {/* Floating stats bar — top center */}
          {stats.totalNM > 0 && (
            <div className="absolute top-32 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-2 rounded-full bg-background/75 backdrop-blur-xl border border-white/60 shadow-lg px-4 py-2">
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
            className={`fixed z-30 overflow-hidden bg-background/72 backdrop-blur-2xl border border-white/55 shadow-[0_30px_90px_rgba(15,23,42,0.18)] flex flex-col transition-all duration-300 ease-out ${
              isMobile
                ? "left-3 right-3 bottom-3 top-auto rounded-[28px]"
                : "top-24 left-4 bottom-4 w-[340px] xl:w-[390px] rounded-[32px]"
            } ${
              isMobile
                ? "opacity-100"
                : sidebarOpen && !isSidebarAutoHidden
                  ? "translate-x-0 opacity-100"
                  : "-translate-x-[calc(100%+1rem)] opacity-0 pointer-events-none"
            }`}
            style={isMobile ? { height: `${mobileSidebarHeight}px`, transform: `translateY(${mobileSidebarTranslateY}px)` } : undefined}
          >
            {/* Search inside sidebar */}
            <div
              className="p-4 border-b border-white/45 shrink-0 bg-background/55 backdrop-blur-xl"
            >
              {isMobile && (
                <div className="mb-3 flex flex-col items-center gap-2">
                  <div
                    className="flex w-full flex-col items-center gap-2"
                    onTouchStart={handleMobileSidebarTouchStart}
                    onTouchMove={handleMobileSidebarTouchMove}
                    onTouchEnd={handleMobileSidebarTouchEnd}
                    onTouchCancel={handleMobileSidebarTouchEnd}
                  >
                    <div className={`h-1.5 w-14 rounded-full bg-foreground/20 ${mobileSidebarMode !== "expanded" ? "mobile-sheet-handle-hint" : ""}`} />
                    <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {mobileSidebarMode === "expanded"
                        ? (lang === "it" ? "Scorri verso il basso" : "Swipe down")
                        : (lang === "it" ? "Scorri verso l'alto" : "Swipe up")}
                    </p>
                  </div>
                </div>
              )}
              <div className="relative rounded-full border border-white/65 bg-white/60 px-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={lang === "it" ? "Cerca..." : "Search..."}
                  className="w-full bg-transparent pl-8 pr-3 py-2 text-xs font-sans focus:outline-none"
                />
              </div>
            </div>

            {/* Article list */}
            <div
              className={`flex-1 overflow-y-auto pb-3 ${isMobile ? "overscroll-contain" : ""}`}
              style={isMobile ? { touchAction: "pan-y" } : undefined}
            >
              {isArticlesLoading ? (
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
          <div className="pt-24 md:pt-28 px-4 md:px-6 pb-4">
            <div className="glass-panel max-w-7xl mx-auto rounded-[30px] px-4 py-4 md:px-6 md:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="glass-input relative rounded-full max-w-md flex-1 px-1.5">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={lang === "it" ? "Cerca articoli, luoghi..." : "Search articles, places..."}
                  className="w-full bg-transparent pl-9 pr-4 py-3 text-sm font-sans focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 md:ml-4">
                <button
                  onClick={() => setViewMode("map")}
                  className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Map size={14} />
                </button>
                {isAdmin && (
                  <Link
                    to="/admin/article/new"
                    className="glass-button inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-sans font-medium tracking-wide"
                  >
                    <Plus size={12} /> {lang === "it" ? "Nuovo" : "New"}
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 px-4 md:px-6 py-4">
            <div className="max-w-7xl mx-auto">
              {isArticlesLoading ? (
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
                    const gridCoverStyle =
                      article.cover_image &&
                      coverImageStyle(
                        article.cover_image,
                        clampCoverFocal(
                          Number(article.cover_focal_x ?? 50),
                          Number(article.cover_focal_y ?? 50),
                          Number(article.cover_zoom ?? 1)
                        )
                      );
                  return (
                    <Link to={`/logbook/${article.slug}`} key={article.id} className="block group">
                        <article className="glass-panel-soft rounded-[30px] p-3 h-full transition-transform duration-300 group-hover:-translate-y-1">
                          <div className="glass-frame rounded-[24px] p-1.5 mb-4">
                            <div className="aspect-[16/10] overflow-hidden bg-muted relative rounded-[19px]">
                            {article.cover_image ? (
                              <img
                                src={article.cover_image}
                                alt={title}
                                className="absolute inset-0 max-w-none"
                                style={gridCoverStyle || undefined}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-xl">BITE</div>
                            )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {article.location_name && (
                              <span className="glass-chip inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-sans text-accent">
                                <Map size={9} /> {article.location_name}
                              </span>
                            )}
                            {article.tags?.slice(0, 2).map((tag: any) => (
                              <span key={tag.id} className="glass-chip inline-flex px-2.5 py-1 text-[11px] font-sans text-accent">#{tag.name}</span>
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

      {!articleReaderActive && panelProfileId ? (
        <ProfileSlidePanel
          profileId={panelProfileId}
          article={panelArticle}
          lang={lang}
          isAutoHidden={isDetailPanelAutoHidden}
          onBackToArticle={() => setPanelProfileId(null)}
          onClose={() => {
            setPanelProfileId(null);
            setPanelArticle(null);
            setSelectedArticleId(null);
          }}
        />
      ) : null}

      {showPreviewPanel && !panelProfileId ? (
        <ArticleSlidePanel
          article={panelArticle}
          panelRef={articlePanelRef}
          isSoftHidden={articleReaderActive && expandedArticlePhase !== "closing"}
          isAutoHidden={isDetailPanelAutoHidden}
          disableEntranceAnimation={expandedArticlePhase === "closing"}
          onClose={() => {
            setPanelProfileId(null);
            setPanelArticle(null);
            setSelectedArticleId(null);
          }}
          onAuthorClick={handleProfilePreviewOpen}
          onOpenArticle={handleOpenExpandedArticle}
          lang={lang}
        />
      ) : null}

      {expandedArticle && expandedArticlePhase && (
        <ExpandedArticleModal
          slug={expandedArticle.slug}
          originRect={expandedArticle.originRect}
          phase={expandedArticlePhase}
          previewAuthors={panelArticle?.authors || []}
          lang={lang}
          onClose={handleCollapseExpandedArticle}
        />
      )}
    </div>
  );
};

export default Journal;
