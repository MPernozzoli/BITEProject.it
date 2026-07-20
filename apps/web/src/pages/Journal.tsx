import { useI18n } from "@/lib/i18n";
import { useState, useMemo, useRef, useCallback, useEffect, type TouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, Plus, Map, List, Ship, Mountain, Navigation, Anchor, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { useArticleReads } from "@/hooks/useArticleReads";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import LazyVoyageMap from "@/components/LazyVoyageMap";
import ArticleListCard from "@/components/voyage/ArticleListCard";
import ArticleSlidePanel from "@/components/voyage/ArticleSlidePanel";
import BookingSidebarPanel from "@/components/voyage/BookingSidebarPanel";
import ProfileSlidePanel from "@/components/voyage/ProfileSlidePanel";
import ExpandedArticleModal, { type ExpandedArticleOrigin } from "@/components/voyage/ExpandedArticleModal";
import VoyageLegend from "@/components/voyage/VoyageLegend";
import BookingConfirmDialog from "@/components/booking/BookingConfirmDialog";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import PaymentMethodDialog from "@/components/booking/PaymentMethodDialog";
import {
  CONTRIBUTION_FIXED_MINIMUM_ACTIVE_BOOKING_STATUSES,
  perPersonDepositEur,
  shouldApplyContributionFixedMinimum,
  totalDepositEur,
  type PriorVoyageContributionBooking,
} from "@/lib/booking-deposit";
import { startDepositPayment } from "@/lib/booking-payment";
import {
  buildCandidateInfoPrefill,
  emptyCandidateInfo,
  getCandidateInfoValidationError,
  type CandidateInfo,
} from "@/lib/booking-candidate-info";
import {
  buildBookingApplicationDraft,
  clearCloudBookingApplicationDraft,
  clearLocalBookingApplicationDraft,
  isBookingApplicationDraftEmpty,
  loadBookingApplicationDraft,
  saveLocalBookingApplicationDraft,
} from "@/lib/booking-application-draft";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildMapPresenceMarkers, type MapPresenceTrackerRow } from "@/lib/map-presence";
import {
  getArticleVoyageFocus,
  getLocalizedVoyageName,
  getLocalizedWaypointName,
  getArticleDisplayLocationLabel,
  getVoyageRecencyMillis,
  totalCoordinateDistanceKm,
  totalWaypointDistance,
} from "@/lib/voyage-utils";
import type { Voyage, VoyageWaypoint, GeoArticle } from "@/lib/voyage-utils";
import type { LogbookPhotoPoint } from "@/lib/logbook-photo-points";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import {
  type BookableLegAvailability,
  type BookingRequest,
  type BookingWaypoint,
  getLegLabel,
  getLegRangeBetweenWaypoints,
  isVoyageBookableNow,
} from "@/lib/booking-utils";

type SupabaseRpcResponse<T> = { data: T | null; error: { message?: string } | null };
type SupabaseRpcClient = {
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<SupabaseRpcResponse<T>>;
};
const bookingRpcClient = supabase as unknown as SupabaseRpcClient;

const getVoyageTypeIconClassName = (voyageType: Voyage["type"]) =>
  voyageType === "water" ? "text-sky-700" : "text-orange-700";

const getVoyageStatusPillClassName = (status: Voyage["status"]) => {
  if (status === "planned") {
    return "border border-dashed border-slate-300/80 bg-slate-50/65 text-slate-600";
  }

  if (status === "active") {
    return "border border-sky-300/75 bg-sky-50/75 text-sky-800";
  }

  return "border border-slate-300/75 bg-white/70 text-slate-700";
};

function isMissingMapPresenceRelationError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "PGRST205" || (message.includes("relation") && message.includes("does not exist"));
}

const Journal = () => {
  const EXPANDED_READER_MS = 480;
  const MOBILE_SIDEBAR_PEEK = 220;
  const MOBILE_SIDEBAR_OPEN = 0.78;
  const MOBILE_SIDEBAR_HANDLE = 34;
  const MOBILE_SHEET_SWIPE_THRESHOLD = 48;
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [hoveredArticleId, setHoveredArticleId] = useState<string | null>(null);
  const [panelArticle, setPanelArticle] = useState<GeoArticle | null>(null);
  const [panelProfileId, setPanelProfileId] = useState<string | null>(null);
  const [expandedArticle, setExpandedArticle] = useState<{ slug: string; originRect: ExpandedArticleOrigin } | null>(null);
  const [expandedArticlePhase, setExpandedArticlePhase] = useState<"opening" | "open" | "closing" | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [mapFallbackActive, setMapFallbackActive] = useState(false);
  const [focusedVoyageId, setFocusedVoyageId] = useState<string | null>(null);
  const [voyageFilterOpen, setVoyageFilterOpen] = useState(false);
  const [voyageTypeFilter, setVoyageTypeFilter] = useState<"all" | Voyage["type"]>("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarMode, setMobileSidebarMode] = useState<"peek" | "expanded" | "collapsed">("collapsed");
  const [mobileSidebarDragOffset, setMobileSidebarDragOffset] = useState(0);
  const [hideMapChromeOnScroll, setHideMapChromeOnScroll] = useState(false);
  const [selectedRouteVoyageId, setSelectedRouteVoyageId] = useState<string | null>(null);
  const [bookingAnchor, setBookingAnchor] = useState<{ voyageId: string; waypointId: string } | null>(null);
  const [selectedBookingLegIds, setSelectedBookingLegIds] = useState<string[]>([]);
  const [bookingRejectedLegIds, setBookingRejectedLegIds] = useState<string[]>([]);
  const [bookingPartySize, setBookingPartySize] = useState(1);
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookingCandidateInfo, setBookingCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [bookingCandidateInfoTouched, setBookingCandidateInfoTouched] = useState(false);
  const [bookingSidebarStep, setBookingSidebarStep] = useState<"legs" | "about">("legs");
  const [bookingSidebarResetKey, setBookingSidebarResetKey] = useState("initial");
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingConfirmOpen, setBookingConfirmOpen] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<{ bookingRequestId: string; participantId?: string } | null>(
    null
  );
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [bankTransfer, setBankTransfer] = useState<{ bookingRequestId: string; participantId?: string } | null>(
    null
  );
  const flyToWaypointRef = useRef<((lat: number, lng: number, popupLabel?: string) => void) | null>(null);
  const { isRead } = useArticleReads();
  const articleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const articlePanelRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const mobileSidebarTouchStartRef = useRef<number | null>(null);
  const restoredBookingDraftRef = useRef<string | null>(null);
  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();

  const { data: mapPresenceRows = [] } = useQuery({
    queryKey: ["logbook-map-presence"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_map_markers")
        .select("*")
        .order("id", { ascending: true });

      if (error) {
        if (isMissingMapPresenceRelationError(error)) {
          return [] as MapPresenceTrackerRow[];
        }
        throw error;
      }

      return (data || []) as MapPresenceTrackerRow[];
    },
    staleTime: 1000 * 60,
    retry: 1,
  });

  const { data: bookingCandidateInfoPrefill = emptyCandidateInfo } = useQuery({
    queryKey: ["booking-candidate-info-prefill", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: async () => {
      const [profileRes, latestRequestRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("preferred_language,secondary_language")
          .eq("id", session!.user.id)
          .maybeSingle(),
        supabase
          .from("voyage_booking_requests")
          .select("candidate_info")
          .eq("profile_id", session!.user.id)
          .order("requested_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (profileRes.error || latestRequestRes.error) {
        return emptyCandidateInfo;
      }

      return buildCandidateInfoPrefill({
        latestCandidateInfo: latestRequestRes.data?.candidate_info as Partial<CandidateInfo> | null | undefined,
        preferredLanguage: profileRes.data?.preferred_language,
        secondaryLanguage: profileRes.data?.secondary_language,
      });
    },
  });

  useEffect(() => {
    if (!session?.user.id || bookingCandidateInfoTouched) return;
    setBookingCandidateInfo(bookingCandidateInfoPrefill);
  }, [bookingCandidateInfoPrefill, bookingCandidateInfoTouched, session?.user.id]);

  const mapPresenceMarkers = useMemo(
    () => buildMapPresenceMarkers(mapPresenceRows, lang),
    [lang, mapPresenceRows]
  );

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
  const { data: liveArticles = [], isLoading: isLiveArticlesLoading } = useQuery({
    queryKey: ["logbook-articles-geo"],
    enabled: !publicContent && !isPublicContentLoading,
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
        ? await supabase.from("public_profiles").select("id, name, avatar_url").in("id", profileIds)
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
  const articles = publicContent?.articles ?? liveArticles;
  const isArticlesLoading = !publicContent && (isPublicContentLoading || isLiveArticlesLoading);

  // Fetch voyages
  const { data: liveVoyages = [], isLoading: isLiveVoyagesLoading } = useQuery({
    queryKey: ["voyages"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data } = await supabase
        .from("voyages" as any)
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });
      return (data || []) as unknown as Voyage[];
    },
  });
  const voyages = publicContent?.voyages ?? liveVoyages;
  const isVoyagesLoading = !publicContent && (isPublicContentLoading || isLiveVoyagesLoading);

  // Fetch waypoints for all voyages
  const { data: liveAllWaypoints = [], isLoading: isLiveWaypointsLoading } = useQuery({
    queryKey: ["voyage-waypoints"],
    enabled: !publicContent && !isPublicContentLoading && liveVoyages.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .in("voyage_id", liveVoyages.map((voyage) => voyage.id))
        .order("sort_order", { ascending: true });
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });
  const allWaypoints = publicContent?.voyageWaypoints ?? liveAllWaypoints;
  const isWaypointsLoading = !publicContent && (isPublicContentLoading || isLiveWaypointsLoading);

  // Published photo points for the map layer. RLS returns only is_published rows to anon.
  const { data: photoPoints = [] } = useQuery({
    queryKey: ["logbook-photo-points"],
    queryFn: async () => {
      const { data } = await supabase
        .from("logbook_photo_points" as never)
        .select(
          "id,voyage_id,taken_at,lat,lng,title_it,title_en,description_it,description_en,storage_path"
        )
        .eq("is_published", true)
        .order("taken_at", { ascending: false });
      return (data ?? []) as unknown as LogbookPhotoPoint[];
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

  const bookableVoyageIds = useMemo(
    () => voyages.filter(isVoyageBookableNow).map((voyage) => voyage.id),
    [voyages]
  );
  const bookableVoyageIdsKey = useMemo(() => [...bookableVoyageIds].sort().join(","), [bookableVoyageIds]);

  const { data: bookingLegs = [], isLoading: isBookingLegsLoading, refetch: refetchBookingLegs } = useQuery({
    queryKey: ["public-voyage-leg-availability", bookableVoyageIdsKey],
    enabled: bookableVoyageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await bookingRpcClient.rpc<BookableLegAvailability[]>("get_public_voyage_leg_availability", {
        _voyage_ids: bookableVoyageIds,
      });
      if (error) {
        console.warn("[Journal] get_public_voyage_leg_availability unavailable", error);
        return [] as BookableLegAvailability[];
      }
      return ((data || []) as BookableLegAvailability[]).sort((a, b) => {
        if (a.voyage_id === b.voyage_id) return a.sort_order - b.sort_order;
        return a.voyage_id.localeCompare(b.voyage_id);
      });
    },
    staleTime: 1000 * 30,
  });

  const bookingLegsByVoyage = useMemo(() => {
    const map: Record<string, BookableLegAvailability[]> = {};
    bookingLegs.forEach((leg) => {
      if (!map[leg.voyage_id]) map[leg.voyage_id] = [];
      map[leg.voyage_id].push(leg);
    });
    Object.values(map).forEach((legs) => legs.sort((a, b) => a.sort_order - b.sort_order));
    return map;
  }, [bookingLegs]);

  const bookingLegsById = useMemo(
    () => Object.fromEntries(bookingLegs.map((leg) => [leg.id, leg])),
    [bookingLegs]
  );

  const { data: myActiveVoyageContributionBookings = [] } = useQuery({
    queryKey: ["my-active-voyage-contribution-bookings", session?.user.id, bookableVoyageIdsKey],
    enabled: Boolean(session?.user.id && bookableVoyageIds.length > 0),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_booking_requests")
        .select("id, voyage_id, status")
        .eq("profile_id", session!.user.id)
        .in("voyage_id", bookableVoyageIds)
        .in("status", [...CONTRIBUTION_FIXED_MINIMUM_ACTIVE_BOOKING_STATUSES]);
      if (error) {
        console.warn("[Journal] my active voyage contribution bookings unavailable", error);
        return [] as PriorVoyageContributionBooking[];
      }
      return (data || []) as PriorVoyageContributionBooking[];
    },
    staleTime: 1000 * 30,
  });

  // Filter articles
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return articles;
    const q = searchQuery.toLowerCase();
    return articles.filter((a) => {
      const title = (lang === "en" ? a.title_en : a.title_it || a.title_en).toLowerCase();
      const excerpt = (lang === "en" ? a.excerpt_en : a.excerpt_it || a.excerpt_en || "").toLowerCase();
      const loc = getArticleDisplayLocationLabel(a, waypointsMap, lang).toLowerCase();
      return title.includes(q) || excerpt.includes(q) || loc.includes(q);
    });
  }, [articles, searchQuery, lang, waypointsMap]);

  const voyageLegendStoryIds = useMemo(() => {
    if (!selectedRouteVoyageId) return [] as string[];
    const ids = new Set<string>();
    articles.forEach((article) => {
      if (article.voyage_id === selectedRouteVoyageId && article.story_id) ids.add(article.story_id);
    });
    return [...ids];
  }, [articles, selectedRouteVoyageId]);

  const voyageLegendStoriesQueryKey = [...voyageLegendStoryIds].sort().join(",");

  const { data: voyageLegendStories = [] } = useQuery({
    queryKey: ["voyage-legend-stories", voyageLegendStoriesQueryKey],
    enabled: Boolean(selectedRouteVoyageId && voyageLegendStoryIds.length > 0),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("stories")
          .select("id, title_it, title_en, slug")
          .in("id", voyageLegendStoryIds);
        if (error) return [];
        return (data || []) as { id: string; title_it: string | null; title_en: string | null; slug: string | null }[];
      } catch {
        return [];
      }
    },
  });

  const voyageLegendStoryTitlesById = useMemo(() => {
    const map: Record<string, { title_it: string | null; title_en: string | null; slug: string | null }> = {};
    voyageLegendStories.forEach((row) => {
      map[row.id] = { title_it: row.title_it, title_en: row.title_en, slug: row.slug };
    });
    return map;
  }, [voyageLegendStories]);

  // Stats
  const stats = useMemo(() => {
    let seaNM = 0;
    let landNM = 0;
    const voyageCount = voyages.length;
    const activeVoyage = voyages.find((v) => v.status === "active");

    voyages.forEach((v) => {
      if (v.status === "planned") return;

      const wps = waypointsMap[v.id] || [];
      if (wps.length >= 2) {
        if (v.type === "water") {
          seaNM += totalWaypointDistance(wps);
        } else {
          const coordinates = (v.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates;
          if (Array.isArray(coordinates) && coordinates.length >= 2) {
            landNM += totalCoordinateDistanceKm(coordinates) / 1.852;
          }
        }
      }
    });

    return {
      seaNM: Math.round(seaNM),
      landKM: Math.round(landNM * 1.852),
      voyageCount,
      activeVoyage,
    };
  }, [voyages, waypointsMap]);

  // Scroll to article in list
  const scrollToArticle = useCallback((articleId: string) => {
    const el = articleRefs.current[articleId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const handleArticleClick = useCallback((article: GeoArticle) => {
    setHoveredArticleId(null);
    setSelectedArticleId(article.id);
    setPanelArticle(article);
    setPanelProfileId(null);
    setFocusedVoyageId(article.voyage_id || null);
    scrollToArticle(article.id);
  }, [scrollToArticle]);

  const handleListArticleClick = useCallback((article: GeoArticle) => {
    setHoveredArticleId(null);
    setSelectedArticleId(article.id);
    setPanelArticle(article);
    setPanelProfileId(null);
    setFocusedVoyageId(article.voyage_id || null);
    if (isMobile) {
      setMobileSidebarMode("expanded");
    }
  }, [isMobile]);

  const handleVoyageFilterSelect = useCallback((voyageId: string | null) => {
    setFocusedVoyageId(voyageId);
    setHoveredArticleId(null);
    setSelectedArticleId(null);
    setPanelArticle(null);
    setPanelProfileId(null);
    setVoyageFilterOpen(false);
  }, []);

  const clearBookingSelection = useCallback(() => {
    setBookingAnchor(null);
    setSelectedBookingLegIds([]);
    setBookingRejectedLegIds([]);
    setBookingMessage("");
    setBookingCandidateInfoTouched(false);
    setBookingCandidateInfo(bookingCandidateInfoPrefill);
    setBookingPartySize(1);
    setBookingSidebarStep("legs");
    setBookingSidebarResetKey(`clear-${Date.now()}`);
  }, [bookingCandidateInfoPrefill]);

  const handleParticipate = useCallback((voyageId: string) => {
    const voyageLegs = bookingLegsByVoyage[voyageId] || [];
    const voyageWaypoints = waypointsMap[voyageId] || [];
    const waypointIds = voyageWaypoints.map((waypoint) => waypoint.id);
    if (waypointIds.length < 2) return;

    setFocusedVoyageId(voyageId);
    setSelectedRouteVoyageId(voyageId);
    setPanelArticle(null);
    setPanelProfileId(null);
    setHideMapChromeOnScroll(false);
    if (isMobile) {
      setMobileSidebarMode("expanded");
    } else {
      setSidebarOpen(true);
    }
    setBookingSidebarStep("legs");
    setBookingSidebarResetKey(`voyage-${voyageId}-${Date.now()}`);

    const fromWaypointId = waypointIds[0];
    const toWaypointId = waypointIds[waypointIds.length - 1];
    setBookingAnchor({ voyageId, waypointId: fromWaypointId });

    const rangeLegs = getLegRangeBetweenWaypoints(waypointIds, voyageLegs, fromWaypointId, toWaypointId);
    const candidateLegs = rangeLegs.length > 0 ? rangeLegs : voyageLegs;
    if (candidateLegs.length === 0) {
      setSelectedBookingLegIds([]);
      setBookingRejectedLegIds([]);
      toast.error(lang === "it" ? "Non ci sono tratte disponibili per questo viaggio." : "There are no open legs for this voyage.");
      return;
    }

    const partySize = Math.max(1, bookingPartySize);
    const availableLegs = candidateLegs.filter((leg) => leg.available && leg.remaining >= partySize);
    const rejectedLegs = candidateLegs.filter((leg) => !leg.available || leg.remaining < partySize);

    setSelectedBookingLegIds([]);
    setBookingRejectedLegIds(rejectedLegs.map((leg) => leg.id));

    if (availableLegs.length === 0) {
      toast.error(lang === "it" ? "Al momento non ci sono posti disponibili su queste tratte." : "There are currently no seats available on these legs.");
    } else if (rejectedLegs.length > 0) {
      toast.info(
        lang === "it"
          ? "Alcune tratte non hanno disponibilità e non sono selezionabili."
          : "Some legs have no availability and cannot be selected."
      );
    }
  }, [bookingLegsByVoyage, bookingPartySize, isMobile, lang, waypointsMap]);

  const buildLogbookBookingReturnPath = useCallback(
    (voyageId: string) => `/${lang}/logbook?booking=${encodeURIComponent(voyageId)}`,
    [lang]
  );

  const saveLogbookBookingDraft = useCallback((step: "legs" | "about" = bookingSidebarStep) => {
    if (!bookingAnchor) return null;
    const draft = buildBookingApplicationDraft({
      voyageId: bookingAnchor.voyageId,
      selectedLegIds: selectedBookingLegIds,
      partySize: String(Math.max(1, bookingPartySize)),
      message: bookingMessage,
      candidateInfo: bookingCandidateInfo,
      applicationStep: step,
    });
    saveLocalBookingApplicationDraft(draft);
    return draft;
  }, [
    bookingAnchor,
    bookingCandidateInfo,
    bookingMessage,
    bookingPartySize,
    bookingSidebarStep,
    selectedBookingLegIds,
  ]);

  const redirectGuestToLoginForBooking = useCallback((step: "legs" | "about" = bookingSidebarStep) => {
    const draft = saveLogbookBookingDraft(step);
    const voyageId = draft?.voyageId || bookingAnchor?.voyageId;
    navigate("/login", { state: { from: voyageId ? buildLogbookBookingReturnPath(voyageId) : `/${lang}/logbook` } });
  }, [bookingAnchor?.voyageId, bookingSidebarStep, buildLogbookBookingReturnPath, lang, navigate, saveLogbookBookingDraft]);

  useEffect(() => {
    if (!bookingAnchor || session?.user) return;
    const draft = buildBookingApplicationDraft({
      voyageId: bookingAnchor.voyageId,
      selectedLegIds: selectedBookingLegIds,
      partySize: String(Math.max(1, bookingPartySize)),
      message: bookingMessage,
      candidateInfo: bookingCandidateInfo,
      applicationStep: bookingSidebarStep,
    });
    if (isBookingApplicationDraftEmpty(draft)) return;

    const timer = window.setTimeout(() => {
      saveLocalBookingApplicationDraft(draft);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [bookingAnchor, bookingCandidateInfo, bookingMessage, bookingPartySize, bookingSidebarStep, selectedBookingLegIds, session?.user]);

  useEffect(() => {
    const requestedVoyageId = new URLSearchParams(location.search).get("booking");
    if (
      !requestedVoyageId ||
      restoredBookingDraftRef.current === requestedVoyageId ||
      isVoyagesLoading ||
      isWaypointsLoading ||
      isBookingLegsLoading
    ) {
      return;
    }

    const voyage = voyages.find((entry) => entry.id === requestedVoyageId);
    const voyageWaypoints = waypointsMap[requestedVoyageId] || [];
    if (!voyage || !isVoyageBookableNow(voyage) || voyageWaypoints.length < 2) return;

    let cancelled = false;
    void (async () => {
      const draft = await loadBookingApplicationDraft(requestedVoyageId, session?.user.id);
      if (cancelled || restoredBookingDraftRef.current === requestedVoyageId) return;
      if (!draft) return;

      restoredBookingDraftRef.current = requestedVoyageId;
      setFocusedVoyageId(requestedVoyageId);
      setSelectedRouteVoyageId(requestedVoyageId);
      setPanelArticle(null);
      setPanelProfileId(null);
      setHideMapChromeOnScroll(false);
      if (isMobile) {
        setMobileSidebarMode("expanded");
      } else {
        setSidebarOpen(true);
      }
      setBookingAnchor({ voyageId: requestedVoyageId, waypointId: voyageWaypoints[0].id });
      setSelectedBookingLegIds(draft.selectedLegIds.filter((legId) => bookingLegsById[legId]?.voyage_id === requestedVoyageId));
      setBookingRejectedLegIds([]);
      setBookingPartySize(Math.max(1, Number.parseInt(draft.partySize, 10) || 1));
      setBookingMessage(draft.message);
      setBookingCandidateInfo(draft.candidateInfo);
      setBookingCandidateInfoTouched(true);
      const restoredStep = draft.applicationStep || (draft.selectedLegIds.length > 0 ? "about" : "legs");
      setBookingSidebarStep(restoredStep);
      setBookingSidebarResetKey(`restore-${requestedVoyageId}-${draft.updatedAt}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bookingLegsById,
    isBookingLegsLoading,
    isMobile,
    isVoyagesLoading,
    isWaypointsLoading,
    location.search,
    session?.user.id,
    voyages,
    waypointsMap,
  ]);

  const toggleBookingLeg = useCallback((legId: string) => {
    const leg = bookingLegsById[legId];
    if (!leg) return;
    if (!leg.available || leg.remaining < bookingPartySize) {
      toast.error(lang === "it" ? "Questa tratta non ha posti disponibili." : "This leg has no available seats.");
      setBookingRejectedLegIds((current) => [...new Set([...current, legId])]);
      return;
    }

    setSelectedBookingLegIds((current) =>
      current.includes(legId) ? current.filter((id) => id !== legId) : [...current, legId]
    );
    setBookingRejectedLegIds((current) => current.filter((id) => id !== legId));
  }, [bookingLegsById, bookingPartySize, lang]);

  const submitBookingFromLogbook = useCallback(async () => {
    if (!session?.user) {
      redirectGuestToLoginForBooking("about");
      return;
    }

    if (!bookingAnchor || selectedBookingLegIds.length === 0) {
      toast.error(lang === "it" ? "Seleziona almeno una tratta disponibile." : "Select at least one available leg.");
      return;
    }
    const candidateInfoError = getCandidateInfoValidationError(bookingCandidateInfo, lang);
    if (candidateInfoError) {
      toast.error(candidateInfoError);
      return;
    }

    const selectedBookingVoyage = voyages.find((voyage) => voyage.id === bookingAnchor.voyageId);
    if (!isVoyageBookableNow(selectedBookingVoyage)) {
      toast.error(lang === "it" ? "Questo viaggio non è più aperto alle adesioni." : "This voyage is no longer open to join.");
      clearBookingSelection();
      return;
    }

    const selectedLegs = selectedBookingLegIds.map((id) => bookingLegsById[id]).filter(Boolean);
    const unavailableLegs = selectedLegs.filter((leg) => !leg.available || leg.remaining < bookingPartySize);
    if (unavailableLegs.length > 0) {
      setBookingRejectedLegIds(unavailableLegs.map((leg) => leg.id));
      setSelectedBookingLegIds(selectedLegs.filter((leg) => leg.available && leg.remaining >= bookingPartySize).map((leg) => leg.id));
      toast.error(
        lang === "it"
          ? "La disponibilità è cambiata: ho lasciato selezionate solo le tratte ancora disponibili."
          : "Availability changed: only still-available legs remain selected."
      );
      return;
    }

    setBookingSubmitting(true);
    try {
      type RequestBookingRow = { booking_request_id?: string; booking_status?: BookingRequest["status"] };
      const { data, error } = await bookingRpcClient.rpc<RequestBookingRow[] | RequestBookingRow>("request_voyage_booking", {
        _voyage_id: bookingAnchor.voyageId,
        _leg_ids: selectedBookingLegIds,
        _party_size: Math.max(1, bookingPartySize),
        _message: bookingMessage.trim() || null,
        _candidate_info: bookingCandidateInfo,
      });

      if (error) {
        if ((error as { code?: string }).code === "BK001") {
          toast.error(
            lang === "it"
              ? "Hai già aderito a una di queste tratte."
              : "You've already joined one of these legs."
          );
          return;
        }
        throw error;
      }
      const result = (Array.isArray(data) ? data[0] : data) as RequestBookingRow | null;
      toast.success(
        result?.booking_status === "waitlisted"
          ? (lang === "it" ? "Richiesta inviata in lista d'attesa." : "Request sent to the waiting list.")
          : (lang === "it" ? "Richiesta di partecipazione inviata." : "Request to join sent.")
      );

      const bookingRequestId = result?.booking_request_id;
      const submittedVoyageId = bookingAnchor.voyageId;
      clearLocalBookingApplicationDraft(submittedVoyageId);
      if (session?.user.id) {
        void clearCloudBookingApplicationDraft(session.user.id, submittedVoyageId).catch((draftError) => {
          console.error("Failed to clear logbook booking draft", draftError);
        });
      }

      // Multi-person bookings go to the participants page (add guests, choose who pays).
      if (bookingRequestId && Math.max(1, bookingPartySize) > 1) {
        setBookingConfirmOpen(false);
        clearBookingSelection();
        navigate(`/bookings/${bookingRequestId}/participants`);
        return;
      }

      // Solo booking: ask explicitly how the user wants to pay before opening Bunq or bank details.
      if (bookingRequestId) {
        setBookingConfirmOpen(false);
        setPaymentChoice({ bookingRequestId });
        clearBookingSelection();
        void refetchBookingLegs();
        return;
      }

      setBookingConfirmOpen(false);
      clearBookingSelection();
      void refetchBookingLegs();
    } catch (error: unknown) {
      await refetchBookingLegs();
      toast.error(
        lang === "it"
          ? "Adesione non riuscita: almeno una tratta potrebbe non avere più posti."
          : "Couldn't join: at least one leg may no longer have seats."
      );
      console.error("[Journal] request_voyage_booking failed", error);
    } finally {
      setBookingSubmitting(false);
    }
  }, [
    bookingAnchor,
    bookingLegsById,
    bookingCandidateInfo,
    bookingMessage,
    bookingPartySize,
    clearBookingSelection,
    lang,
    navigate,
    refetchBookingLegs,
    redirectGuestToLoginForBooking,
    selectedBookingLegIds,
    session?.user,
    voyages,
  ]);

  const startOnlinePayment = useCallback(async (reservedWindow?: Window | null) => {
    if (!paymentChoice) return;
    setPaymentStarting(true);
    try {
      const payment = await startDepositPayment(paymentChoice.bookingRequestId, paymentChoice.participantId);
      if (payment.ok && "shareUrl" in payment) {
        if (reservedWindow && !reservedWindow.closed) {
          reservedWindow.location.href = payment.shareUrl;
        } else {
          window.location.assign(payment.shareUrl);
        }
        return;
      }
      reservedWindow?.close();
      setPaymentChoice(null);
      if (!payment.ok && "notConfigured" in payment) {
        toast.info(
          lang === "it"
            ? "Il pagamento online non è ancora attivo: puoi completare con bonifico."
            : "Online payment is not active yet: you can complete by bank transfer."
        );
      } else if (!payment.ok) {
        toast.info(
          lang === "it"
            ? "Non sono riuscito ad aprire Bunq. Puoi completare con bonifico."
            : "Could not open Bunq. You can complete by bank transfer."
        );
      }
      setBankTransfer(paymentChoice);
    } finally {
      setPaymentStarting(false);
    }
  }, [lang, paymentChoice]);

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
    event.preventDefault();
    event.stopPropagation();
    mobileSidebarTouchStartRef.current = event.touches[0]?.clientY ?? null;
    setMobileSidebarDragOffset(0);
  }, []);

  const handleMobileSidebarTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
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

  const handleMobileSidebarTouchEnd = useCallback((event?: TouchEvent<HTMLDivElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
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
      setMobileSidebarMode("collapsed");
      setMobileSidebarDragOffset(0);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;

    if (viewMode === "map") {
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
    }

    return () => {
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [viewMode]);

  // Highlighted voyage based on selected article
  const selectedArticle = useMemo(
    () => articles.find((article) => article.id === selectedArticleId) || null,
    [articles, selectedArticleId]
  );
  /** Solo articolo selezionato + filtro viaggio: niente hover lista (lo scroll non deve accendere le rotte sulla mappa). */
  const highlightedVoyageId = useMemo(() => {
    const selectedFocus = selectedArticle ? getArticleVoyageFocus(selectedArticle) : null;
    if (selectedFocus?.voyageId) return selectedFocus.voyageId;
    return focusedVoyageId;
  }, [focusedVoyageId, selectedArticle]);

  const bookingSummaryVoyage = useMemo(
    () => voyages.find((voyage) => voyage.id === bookingAnchor?.voyageId) || null,
    [bookingAnchor?.voyageId, voyages]
  );
  const selectedBookingLegs = useMemo(
    () => selectedBookingLegIds.map((id) => bookingLegsById[id]).filter(Boolean),
    [bookingLegsById, selectedBookingLegIds]
  );
  const selectedBookingWaypointsById = useMemo<Record<string, BookingWaypoint>>(
    () => Object.fromEntries((bookingAnchor ? waypointsMap[bookingAnchor.voyageId] || [] : []).map((waypoint) => [
      waypoint.id,
      {
        id: waypoint.id,
        voyage_id: waypoint.voyage_id,
        name: waypoint.name,
        name_it: waypoint.name_it,
        name_en: waypoint.name_en,
        sort_order: waypoint.sort_order,
        lat: waypoint.lat,
        lng: waypoint.lng,
        waypoint_type: waypoint.waypoint_type as BookingWaypoint["waypoint_type"],
        visibility_mode: waypoint.visibility_mode as BookingWaypoint["visibility_mode"],
        planned_stop_duration_minutes: waypoint.planned_stop_duration_minutes,
        stop_mode: waypoint.stop_mode as BookingWaypoint["stop_mode"],
        stop_hours: waypoint.stop_hours,
        stop_nights: waypoint.stop_nights,
        stop_departure_time: waypoint.stop_departure_time,
        date_start: waypoint.date_start,
        date_end: waypoint.date_end,
      } satisfies BookingWaypoint,
    ])),
    [bookingAnchor, waypointsMap]
  );
  const bookingVoyageLegs = bookingAnchor ? bookingLegsByVoyage[bookingAnchor.voyageId] || [] : [];
  const bookingSidebarActive = Boolean(bookingAnchor);
  const bookingContributionOptions = useMemo(
    () => ({
      contributionPerNmEur: bookingSummaryVoyage?.booking_contribution_per_nm_eur,
      fixedMinimumEur: shouldApplyContributionFixedMinimum(
        myActiveVoyageContributionBookings,
        bookingSummaryVoyage?.id,
      )
        ? undefined
        : 0,
    }),
    [bookingSummaryVoyage?.booking_contribution_per_nm_eur, bookingSummaryVoyage?.id, myActiveVoyageContributionBookings],
  );

  const filteredVoyages = useMemo(() => {
    const list =
      voyageTypeFilter === "all" ? [...voyages] : voyages.filter((voyage) => voyage.type === voyageTypeFilter);
    list.sort((a, b) => getVoyageRecencyMillis(b) - getVoyageRecencyMillis(a));
    return list;
  }, [voyageTypeFilter, voyages]);

  const articleReaderActive = Boolean(expandedArticle);
  const showPreviewPanel = Boolean(panelArticle) && (!articleReaderActive || expandedArticlePhase === "closing");
  const sidePanelVisible = showPreviewPanel || Boolean(panelProfileId);
  const isSidebarAutoHidden = !isMobile && hideMapChromeOnScroll && sidebarOpen;
  const isDetailPanelAutoHidden = hideMapChromeOnScroll && sidePanelVisible;
  const shouldOffsetControlsForDetail = sidePanelVisible && !isDetailPanelAutoHidden;
  const mobileSidebarVisible = mobileSidebarMode !== "collapsed";
  const previewAllowsMapInteraction =
    Boolean(panelArticle) && !articleReaderActive && !panelProfileId;
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
    (articleReaderActive ||
      Boolean(panelProfileId) ||
      (isMobile && mobileSidebarVisible && !previewAllowsMapInteraction));

  const handleMapUnavailable = useCallback(() => {
    setMapFallbackActive(true);
    setViewMode("list");
  }, []);

  const mapRootClass =
    viewMode === "map"
      ? isMobile
        ? "fixed inset-0 z-0 h-[100dvh] max-h-[100dvh] w-full overflow-hidden md:relative md:inset-auto md:z-auto md:h-screen md:max-h-none"
        : "h-screen overflow-hidden"
      : "min-h-screen flex flex-col";

  const mapInnerClass = isMobile
    ? "relative h-full min-h-0 overflow-hidden overscroll-none md:h-screen"
    : "relative h-screen overflow-hidden overscroll-none";

  return (
    <div className={mapRootClass}>
      <h1 className="sr-only">{t("journal.page.title")}</h1>
      {viewMode === "map" ? (
        <div className={mapInnerClass}>
          {/* Full-screen map */}
          <LazyVoyageMap
            voyages={voyages}
            waypointsMap={waypointsMap}
            articles={filtered}
            selectedArticleId={selectedArticleId}
            hoveredArticleId={hoveredArticleId}
            highlightedVoyageId={highlightedVoyageId}
            onArticleClick={handleArticleClick}
            onVoyageSelect={setSelectedRouteVoyageId}
            selectedRouteVoyageId={selectedRouteVoyageId}
            bookingLegsByVoyage={bookingLegsByVoyage}
            bookingSelectionAnchor={bookingAnchor}
            selectedBookingLegs={selectedBookingLegs}
            onParticipate={handleParticipate}
            presenceMarkers={mapPresenceMarkers}
            photoPoints={photoPoints}
            flyToWaypointRef={flyToWaypointRef}
            lang={lang}
            disableInteractions={isMapInteractionLocked}
            initialFitReady={!isArticlesLoading && !isVoyagesLoading && !isWaypointsLoading}
            onMapUnavailable={handleMapUnavailable}
            fallbackHeightClassName="h-full min-h-screen"
          />

          {isMapInteractionLocked && <div className="absolute inset-0 z-10" aria-hidden />}

          {selectedRouteVoyageId && (() => {
            const legendVoyage = voyages.find((v) => v.id === selectedRouteVoyageId);
            if (!legendVoyage) return null;
            const sidebarVisible = !isMobile && sidebarOpen && !isSidebarAutoHidden;
            return (
              <div
                className={`fixed bottom-6 z-30 min-w-0 pointer-events-none transition-[left,right,max-width,transform,opacity] duration-300 ease-out-expo ${
                  isMobile
                    ? "left-3 right-3 max-w-none"
                    : sidebarVisible
                      ? "left-[calc(340px+2rem)] xl:left-[calc(390px+2rem)] right-4 max-w-[calc(100vw-340px-2.5rem)] xl:max-w-[calc(100vw-390px-2.5rem)]"
                      : "left-4 right-4 max-w-[calc(100vw-2rem)]"
                } w-full`}
              >
                <VoyageLegend
                  voyage={legendVoyage}
                  waypoints={waypointsMap[selectedRouteVoyageId] || []}
                  articles={articles}
                  lang={lang}
                  onClose={() => setSelectedRouteVoyageId(null)}
                  onArticleClick={handleArticleClick}
                  bookingLegs={bookingLegsByVoyage[selectedRouteVoyageId] || []}
                  selectedBookingLegIds={bookingAnchor?.voyageId === selectedRouteVoyageId ? selectedBookingLegIds : []}
                  onParticipate={handleParticipate}
                  storyTitlesById={voyageLegendStoryTitlesById}
                  onWaypointClick={(wp) => {
                    const wps = waypointsMap[selectedRouteVoyageId] || [];
                    flyToWaypointRef.current?.(
                      wp.lat,
                      wp.lng,
                      getLocalizedWaypointName(wp, lang, wps.indexOf(wp))
                    );
                  }}
                />
              </div>
            );
          })()}

          <BookingConfirmDialog
            open={bookingConfirmOpen}
            onOpenChange={setBookingConfirmOpen}
            lang={lang}
            voyageName={bookingSummaryVoyage ? getLocalizedVoyageName(bookingSummaryVoyage, lang) : undefined}
            legLabels={selectedBookingLegs.map((leg) => getLegLabel(leg, selectedBookingWaypointsById, lang))}
            legs={selectedBookingLegs}
            partySize={bookingPartySize}
            message={bookingMessage}
            requiresPayment
            showPaymentMethodChoice={false}
            depositPerPersonEur={perPersonDepositEur(selectedBookingLegs, bookingContributionOptions)}
            depositTotalEur={totalDepositEur(selectedBookingLegs, bookingPartySize, bookingContributionOptions)}
            contributionPerNmEur={bookingSummaryVoyage?.booking_contribution_per_nm_eur}
            submitting={bookingSubmitting}
            onConfirm={() => void submitBookingFromLogbook()}
          />

          <PaymentMethodDialog
            open={paymentChoice !== null}
            onOpenChange={(open) => {
              if (!open) setPaymentChoice(null);
            }}
            loading={paymentStarting}
            onPayNow={(reservedWindow) => void startOnlinePayment(reservedWindow)}
            onBankTransfer={() => {
              if (!paymentChoice) return;
              setBankTransfer(paymentChoice);
              setPaymentChoice(null);
            }}
          />

          <BankTransferDialog
            open={bankTransfer !== null}
            onOpenChange={(open) => {
              if (!open) setBankTransfer(null);
            }}
            bookingRequestId={bankTransfer?.bookingRequestId ?? ""}
            participantId={bankTransfer?.participantId}
            onConfirmed={() => {
              setBankTransfer(null);
              void refetchBookingLegs();
            }}
          />

          {/* Floating controls — top right */}
          <div
            className={`fixed top-24 z-30 flex flex-col gap-2 transition-[right,transform] duration-300 ease-out-expo ${
              shouldOffsetControlsForDetail ? "right-4 lg:right-[29rem] xl:right-[30.5rem]" : "right-4"
            }`}
          >
            <button
              onClick={toggleSidebar}
              className="rounded-full border border-white/60 bg-background/75 backdrop-blur-xl shadow-lg p-2.5 hover:bg-background transition-colors duration-interaction ease-out-expo active:scale-[0.96]"
              title={isMobile ? (mobileSidebarMode === "expanded" ? "Collapse list" : "Expand list") : (sidebarOpen ? "Hide list" : "Show list")}
            >
              {isMobile ? (
                mobileSidebarMode === "expanded" ? <ChevronDown size={16} /> : <ChevronUp size={16} />
              ) : (
                sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />
              )}
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="rounded-full border border-white/60 bg-background/75 backdrop-blur-xl shadow-lg p-2.5 hover:bg-background transition-colors duration-interaction ease-out-expo active:scale-[0.96]"
              title="Grid view"
            >
              <List size={16} />
            </button>
            {isAdmin && (
              <Link
                to="/admin/article/new"
                className="rounded-full bg-primary text-primary-foreground shadow-lg p-2.5 hover:opacity-90 transition-opacity duration-interaction ease-out-expo flex items-center justify-center active:scale-[0.96]"
              >
                <Plus size={16} />
              </Link>
            )}
          </div>

          {/* Floating stats bar — top center */}
          {(stats.seaNM > 0 || stats.landKM > 0) && (
            <div className="absolute top-32 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-2 rounded-full bg-background/75 backdrop-blur-xl border border-white/60 shadow-lg px-4 py-2">
              {stats.seaNM > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-sky-800/85">
                  <Ship size={10} /> {stats.seaNM.toLocaleString()} NM
                </span>
              ) : null}
              {stats.seaNM > 0 && stats.landKM > 0 ? <span className="w-px h-3 bg-border" /> : null}
              {stats.landKM > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-orange-800/85">
                  <Mountain size={10} /> {stats.landKM.toLocaleString()} KM
                </span>
              ) : null}
              <span className="w-px h-3 bg-border" />
              <Popover open={voyageFilterOpen} onOpenChange={setVoyageFilterOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-sans tracking-wider uppercase transition-colors duration-interaction ease-out-expo ${
                      focusedVoyageId ? "bg-accent/12 text-accent" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Navigation size={10} />
                    {stats.voyageCount} {lang === "it" ? "viaggi" : "voyages"}
                    <ChevronDown size={10} className={`transition-transform duration-200 ease-out-expo ${voyageFilterOpen ? "rotate-180" : ""}`} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  sideOffset={12}
                  className="w-[340px] max-h-[min(72vh,560px)] flex flex-col overflow-hidden rounded-[24px] border-white/60 bg-background/88 p-2 backdrop-blur-2xl"
                >
                  <div className="mb-1 shrink-0 px-2 py-1">
                    <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {lang === "it" ? "Focus viaggio" : "Voyage focus"}
                    </p>
                  </div>
                  <div className="mb-2 flex shrink-0 items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => setVoyageTypeFilter("all")}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                        voyageTypeFilter === "all"
                          ? "bg-foreground text-background"
                          : "bg-white/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lang === "it" ? "tutti" : "all"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoyageTypeFilter("water")}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                        voyageTypeFilter === "water"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-sky-50/70 text-sky-700 hover:bg-sky-100"
                      }`}
                    >
                      <Ship size={10} />
                      {lang === "it" ? "mare" : "water"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoyageTypeFilter("land")}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-sans uppercase tracking-[0.18em] transition-colors duration-interaction ease-out-expo ${
                        voyageTypeFilter === "land"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-orange-50/70 text-orange-700 hover:bg-orange-100"
                      }`}
                    >
                      <Mountain size={10} />
                      {lang === "it" ? "terra" : "land"}
                    </button>
                  </div>
                  <div className="max-h-[min(52vh,440px)] min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
                    <button
                      type="button"
                      onClick={() => handleVoyageFilterSelect(null)}
                      className={`flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left text-xs font-sans transition-colors duration-interaction ease-out-expo ${
                        !focusedVoyageId ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                      }`}
                    >
                      <span>{lang === "it" ? "Tutti i viaggi" : "All voyages"}</span>
                      {!focusedVoyageId ? <Check size={12} className="text-accent" /> : null}
                    </button>
                    {filteredVoyages.map((voyage) => {
                      const isSelected = focusedVoyageId === voyage.id;
                      const isWaterVoyage = voyage.type === "water";
                      const localizedStatus = lang === "it"
                        ? voyage.status === "planned"
                          ? "programmata"
                          : voyage.status === "active"
                            ? "in corso"
                            : "completata"
                        : voyage.status === "planned"
                          ? "planned"
                          : voyage.status === "active"
                            ? "active"
                            : "completed";
                      return (
                        <button
                          key={voyage.id}
                          type="button"
                          onClick={() => handleVoyageFilterSelect(voyage.id)}
                          className={`flex w-full items-center justify-between rounded-[18px] px-3 py-2 text-left text-xs font-sans transition-colors duration-interaction ease-out-expo ${
                            isSelected ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                          }`}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`shrink-0 ${getVoyageTypeIconClassName(voyage.type)}`}>
                                {isWaterVoyage ? <Ship size={12} /> : <Mountain size={12} />}
                              </span>
                              <span className="truncate">{getLocalizedVoyageName(voyage, lang)}</span>
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${getVoyageStatusPillClassName(voyage.status)}`}
                            >
                              {localizedStatus}
                            </span>
                          </span>
                          {isSelected ? <Check size={12} className="text-accent shrink-0" /> : null}
                        </button>
                      );
                    })}
                    {filteredVoyages.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs font-sans text-muted-foreground">
                        {lang === "it" ? "Nessun viaggio in questo filtro" : "No voyages in this filter"}
                      </div>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
              {stats.activeVoyage && (
                <>
                  <span className="w-px h-3 bg-border" />
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-sans tracking-wider uppercase text-accent">
                    <Anchor size={10} /> {getLocalizedVoyageName(stats.activeVoyage, lang)}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Floating sidebar — article list */}
          <div
            className={`fixed z-30 overflow-hidden bg-background/72 backdrop-blur-2xl border border-white/55 shadow-[0_30px_90px_rgba(15,23,42,0.18)] flex flex-col transition-[transform,opacity,height] duration-300 ease-out-expo ${
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
            {bookingSidebarActive ? (
              <BookingSidebarPanel
                voyage={bookingSummaryVoyage}
                legs={bookingVoyageLegs}
                waypointsById={selectedBookingWaypointsById}
                selectedLegIds={selectedBookingLegIds}
                rejectedLegIds={bookingRejectedLegIds}
                partySize={bookingPartySize}
                message={bookingMessage}
                candidateInfo={bookingCandidateInfo}
                depositPerPersonEur={perPersonDepositEur(selectedBookingLegs, bookingContributionOptions)}
                depositTotalEur={totalDepositEur(selectedBookingLegs, bookingPartySize, bookingContributionOptions)}
                submitting={bookingSubmitting}
                isSignedIn={Boolean(session?.user)}
                lang={lang}
                isMobile={isMobile}
                mobileSidebarMode={mobileSidebarMode}
                onMobileTouchStart={handleMobileSidebarTouchStart}
                onMobileTouchMove={handleMobileSidebarTouchMove}
                onMobileTouchEnd={handleMobileSidebarTouchEnd}
                onClose={clearBookingSelection}
                onToggleLeg={toggleBookingLeg}
                onPartySizeChange={setBookingPartySize}
                onMessageChange={setBookingMessage}
                onCandidateInfoChange={(nextInfo) => {
                  setBookingCandidateInfoTouched(true);
                  setBookingCandidateInfo(nextInfo);
                }}
                initialStep={bookingSidebarStep}
                stepResetKey={bookingSidebarResetKey}
                onStepChange={setBookingSidebarStep}
                onSubmit={() => {
                  if (!session?.user) {
                    redirectGuestToLoginForBooking("about");
                    return;
                  }
                  if (selectedBookingLegIds.length === 0) {
                    toast.error(lang === "it" ? "Seleziona almeno una tratta disponibile." : "Select at least one available leg.");
                    return;
                  }
                  const candidateInfoError = getCandidateInfoValidationError(bookingCandidateInfo, lang);
                  if (candidateInfoError) {
                    toast.error(candidateInfoError);
                    return;
                  }
                  setBookingConfirmOpen(true);
                }}
              />
            ) : (
              <>
                {/* Search inside sidebar */}
                <div
                  className="p-4 border-b border-white/45 shrink-0 bg-background/55 backdrop-blur-xl"
                >
                  {isMobile && (
                    <div className="mb-3 flex flex-col items-center gap-2">
                      <div
                        className="flex w-full flex-col items-center gap-2"
                        style={{ touchAction: "none" }}
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
                        waypointsMap={waypointsMap}
                        lang={lang}
                        isActive={selectedArticleId === article.id}
                        isDimmed={Boolean(focusedVoyageId && article.voyage_id !== focusedVoyageId && selectedArticleId !== article.id)}
                        isRead={isRead(article.id)}
                        onMouseEnter={() => setHoveredArticleId(article.id)}
                        onMouseLeave={() => setHoveredArticleId((current) => (current === article.id ? null : current))}
                        onClick={() => handleListArticleClick(article)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* List-only view — classic grid */
        <>
          <div className="pt-24 md:pt-28 px-4 md:px-6 pb-4">
            <div className="glass-panel max-w-7xl mx-auto rounded-[30px] px-4 py-4 md:px-6 md:py-5 flex flex-col gap-4">
              {mapFallbackActive ? (
                <div className="rounded-[24px] border border-white/60 bg-background/70 px-4 py-3 text-sm font-sans text-muted-foreground">
                  {lang === "it"
                    ? "La mappa non è disponibile in questo browser. Ti ho portato alla vista lista per continuare la navigazione."
                    : "The map is unavailable in this browser. You were moved to the list view so you can keep browsing."}
                </div>
              ) : null}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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
                  onClick={() => {
                    setMapFallbackActive(false);
                    setViewMode("map");
                  }}
                  className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-interaction ease-out-expo"
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
                    const displayLocation = getArticleDisplayLocationLabel(article, waypointsMap, lang);
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
                        <article className="glass-panel-soft rounded-[30px] p-3 h-full transition-transform duration-reveal ease-out-expo group-hover:-translate-y-1 active:scale-[0.99]">
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
                            {displayLocation && (
                              <span className="glass-chip inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-sans text-accent">
                                <Map size={9} /> {displayLocation}
                              </span>
                            )}
                            {article.tags?.slice(0, 2).map((tag: any) => (
                              <span key={tag.id} className="glass-chip inline-flex px-2.5 py-1 text-[11px] font-sans text-accent">#{tag.name}</span>
                            ))}
                          </div>
                          <h3 className="editorial-heading text-lg md:text-xl mb-2 group-hover:text-accent transition-colors duration-interaction ease-out-expo line-clamp-2">
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
          locationLabel={
            panelArticle ? getArticleDisplayLocationLabel(panelArticle, waypointsMap, lang) : undefined
          }
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
