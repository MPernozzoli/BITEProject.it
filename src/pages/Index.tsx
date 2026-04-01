import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Wrench, Compass, Wifi, Pen, Eye } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useArticleReads } from "@/hooks/useArticleReads";
import { useAuth } from "@/hooks/useAuth";
import type { GeoArticle, Voyage, VoyageWaypoint } from "@/lib/voyage-utils";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import LazyVoyageMap from "@/components/LazyVoyageMap";
import StructuredData from "@/components/StructuredData";
import { ORGANIZATION_ID, SITE_URL, WEBSITE_ID } from "@/lib/seo";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  fetchHeroVideoPoolVersion,
  isHeroVideoPoolVersionEqual,
  type HeroMedia,
  type HeroVideoPoolVersion,
  type HomepageHeroVideoPool,
} from "@/lib/public-content";
import { invokeOptionalNewsletterFunction } from "@/lib/newsletter";

import boatSunset from "@/assets/boat-sunset.webp";
import dogsMarina from "@/assets/dogs-marina.webp";
import dinghyCrew from "@/assets/dinghy-crew.webp";

interface HomeTag {
  id: string;
  name: string;
}

interface HomeArticle {
  id: string;
  title_en: string;
  title_it: string | null;
  slug: string;
  excerpt_en: string | null;
  excerpt_it: string | null;
  cover_image: string | null;
  published_at: string | null;
  category: string;
  tags: HomeTag[];
}

interface ArticleTagRelation {
  article_id: string;
  tags: HomeTag | null;
}

interface StorageListItem {
  name: string;
}

interface HeroTransitionTarget {
  media: HeroMedia;
  index: number;
  playlist: HeroMedia[];
}

interface NavigatorConnectionInfo {
  effectiveType?: string;
  saveData?: boolean;
}

const HOMEPAGE_MEDIA_BUCKET = "homepage-media";
const HOMEPAGE_HORIZONTAL_FOLDER = "hero-horizontal";
const HOMEPAGE_VERTICAL_FOLDER = "hero-vertical";
const SUPPORTED_HERO_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "m4v", "mov"]);
const HERO_CROSSFADE_DURATION_MS = 2000;
const HERO_MAX_VIDEO_SEGMENT_SECONDS = 10;
const HERO_VIDEO_CACHE_NAME = "bite-hero-media-v1";

const getNavigatorConnectionInfo = (): NavigatorConnectionInfo | null => {
  if (typeof navigator === "undefined") return null;

  const connectionNavigator = navigator as Navigator & {
    connection?: NavigatorConnectionInfo;
    mozConnection?: NavigatorConnectionInfo;
    webkitConnection?: NavigatorConnectionInfo;
  };

  return connectionNavigator.connection
    ?? connectionNavigator.mozConnection
    ?? connectionNavigator.webkitConnection
    ?? null;
};

const shouldWarmHeroCacheAggressively = (isMobile: boolean) => {
  if (isMobile) return false;

  const connection = getNavigatorConnectionInfo();
  if (connection?.saveData) return false;

  const effectiveType = connection?.effectiveType?.toLowerCase();
  if (!effectiveType) return true;

  return !(effectiveType.includes("2g") || effectiveType === "3g");
};

const shuffleHeroMedia = (items: HeroMedia[], avoidSrc?: string) => {
  const nextItems = [...items];
  for (let i = nextItems.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [nextItems[i], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[i]];
  }

  if (avoidSrc && nextItems.length > 1 && nextItems[0]?.src === avoidSrc) {
    [nextItems[0], nextItems[1]] = [nextItems[1], nextItems[0]];
  }

  return nextItems;
};

const getVideoMimeType = (filename: string) => {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return "video/mp4";
};

const createStorageVideoEntries = (folder: string, files: StorageListItem[], alt: string): HeroMedia[] =>
  files
    .filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return Boolean(extension && SUPPORTED_HERO_VIDEO_EXTENSIONS.has(extension));
    })
    .map((file) => {
      const path = `${folder}/${file.name}`;
      const { data } = supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).getPublicUrl(path);

      return {
        kind: "video",
        src: data.publicUrl,
        alt,
        mimeType: getVideoMimeType(file.name),
      };
    });

const getNextHeroTransition = (
  currentIndex: number,
  playlist: HeroMedia[],
  currentPool: HeroMedia[]
): HeroTransitionTarget | null => {
  if (!playlist.length) return null;

  const isLast = currentIndex >= playlist.length - 1;
  if (isLast) {
    const nextPlaylist = shuffleHeroMedia(currentPool, playlist[currentIndex]?.src);
    const media = nextPlaylist[0];
    return media ? { media, index: 0, playlist: nextPlaylist } : null;
  }

  const index = currentIndex + 1;
  const media = playlist[index];
  return media ? { media, index, playlist } : null;
};

const Index = () => {
  const { t, lang } = useI18n();
  const { isRead } = useArticleReads();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterConsent, setNewsletterConsent] = useState(false);
  const [newsletterWebsite, setNewsletterWebsite] = useState("");
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [heroPlaylist, setHeroPlaylist] = useState<HeroMedia[]>([]);
  const [heroPlaylistIndex, setHeroPlaylistIndex] = useState(0);
  const [pendingHeroTransition, setPendingHeroTransition] = useState<HeroTransitionTarget | null>(null);
  const [isHeroCrossfading, setIsHeroCrossfading] = useState(false);
  const heroPlaybackTimeoutRef = useRef<number | null>(null);
  const heroCrossfadeTimeoutRef = useRef<number | null>(null);
  const pendingHeroVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingHeroPlaybackDurationRef = useRef<number>(HERO_MAX_VIDEO_SEGMENT_SECONDS * 1000);
  const heroVideoObjectUrlsRef = useRef<Record<string, string>>({});
  const heroVideoCachePromisesRef = useRef<Map<string, Promise<string>>>(new Map());
  const [heroVideoLocalUrls, setHeroVideoLocalUrls] = useState<Record<string, string>>({});
  const {
    data: publicContent,
    isLoading: isPublicContentLoading,
    isFetching: isPublicContentFetching,
  } = usePublicContentSnapshot();
  const newsletterSubscriptionQueryKey = [
    "home-newsletter-subscription",
    session?.user?.id ?? null,
    session?.user?.email ?? null,
  ] as const;

  const { data: liveHeroVideoVersion } = useQuery<HeroVideoPoolVersion>({
    queryKey: ["homepage-hero-video-version"],
    queryFn: fetchHeroVideoPoolVersion,
    enabled: Boolean(publicContent),
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: liveHeroVideoPool } = useQuery<HomepageHeroVideoPool>({
    queryKey: ["homepage-hero-videos"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const [desktopResult, mobileResult] = await Promise.all([
        supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_HORIZONTAL_FOLDER, {
          limit: 100,
          sortBy: { column: "name", order: "asc" },
        }),
        supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_VERTICAL_FOLDER, {
          limit: 100,
          sortBy: { column: "name", order: "asc" },
        }),
      ]);

      if (desktopResult.error && mobileResult.error) {
        throw desktopResult.error;
      }

      return {
        desktop: createStorageVideoEntries(
          HOMEPAGE_HORIZONTAL_FOLDER,
          (desktopResult.data ?? []) as StorageListItem[],
          "Spritz sailing footage for the desktop hero"
        ),
        mobile: createStorageVideoEntries(
          HOMEPAGE_VERTICAL_FOLDER,
          (mobileResult.data ?? []) as StorageListItem[],
          "Spritz sailing footage for the mobile hero"
        ),
      };
    },
    staleTime: 1000 * 60 * 10,
    retry: false,
  });
  const heroVideoPool = publicContent?.heroVideoPool ?? liveHeroVideoPool;

  useEffect(() => {
    if (!publicContent?.heroVideoVersion || !liveHeroVideoVersion) return;
    if (isPublicContentFetching) return;

    if (isHeroVideoPoolVersionEqual(publicContent.heroVideoVersion, liveHeroVideoVersion)) {
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["public-content-snapshot"] });
  }, [isPublicContentFetching, liveHeroVideoVersion, publicContent, queryClient]);

  const currentHeroPool = useMemo(() => {
    return isMobile ? (heroVideoPool?.mobile ?? []) : (heroVideoPool?.desktop ?? []);
  }, [heroVideoPool, isMobile]);
  const shouldAggressivelyWarmHeroCache = useMemo(
    () => shouldWarmHeroCacheAggressively(isMobile),
    [isMobile]
  );

  const heroMedia = heroPlaylist[heroPlaylistIndex] ?? currentHeroPool[0] ?? null;
  const heroPriorityMedia = useMemo(() => {
    const candidates = [
      heroMedia,
      pendingHeroTransition?.media ?? null,
      currentHeroPool[0] ?? null,
      currentHeroPool[1] ?? null,
    ].filter(Boolean) as HeroMedia[];

    return Array.from(new Map(candidates.map((media) => [media.src, media])).values());
  }, [currentHeroPool, heroMedia, pendingHeroTransition]);

  const cacheHeroVideoLocally = useCallback(async (media: HeroMedia) => {
    const existingObjectUrl = heroVideoObjectUrlsRef.current[media.src];
    if (existingObjectUrl) return existingObjectUrl;

    const inFlight = heroVideoCachePromisesRef.current.get(media.src);
    if (inFlight) return inFlight;

    const cacheTask = (async () => {
      if (typeof window === "undefined" || !("caches" in window)) {
        return media.src;
      }

      const cache = await window.caches.open(HERO_VIDEO_CACHE_NAME);
      let response = await cache.match(media.src);

      if (!response) {
        const networkResponse = await fetch(media.src, {
          mode: "cors",
          credentials: "omit",
        });

        if (!networkResponse.ok) {
          return media.src;
        }

        await cache.put(media.src, networkResponse.clone());
        response = networkResponse;
      }

      const blob = await response.blob();
      if (!blob.size) {
        return media.src;
      }

      const objectUrl = URL.createObjectURL(blob);
      heroVideoObjectUrlsRef.current[media.src] = objectUrl;
      setHeroVideoLocalUrls((current) => (
        current[media.src] === objectUrl
          ? current
          : { ...current, [media.src]: objectUrl }
      ));
      return objectUrl;
    })()
      .catch(() => media.src)
      .finally(() => {
        heroVideoCachePromisesRef.current.delete(media.src);
      });

    heroVideoCachePromisesRef.current.set(media.src, cacheTask);
    return cacheTask;
  }, []);

  const getHeroPlaybackSrc = useCallback(
    (media: HeroMedia) => heroVideoLocalUrls[media.src] ?? media.src,
    [heroVideoLocalUrls]
  );

  useEffect(() => {
    const nextPlaylist = shuffleHeroMedia(currentHeroPool);
    setHeroPlaylist(nextPlaylist);
    setHeroPlaylistIndex(0);
    const nextTransition = getNextHeroTransition(0, nextPlaylist, currentHeroPool);
    setPendingHeroTransition(nextTransition);
    setIsHeroCrossfading(false);
  }, [currentHeroPool, isMobile]);

  useEffect(() => {
    const nextTransition = getNextHeroTransition(heroPlaylistIndex, heroPlaylist, currentHeroPool);
    setPendingHeroTransition(nextTransition);
    setIsHeroCrossfading(false);
  }, [currentHeroPool, heroPlaylist, heroPlaylistIndex]);

  const queueHeroCrossfade = () => {
    if (heroPlaylist.length <= 1 || !pendingHeroTransition || isHeroCrossfading) return;

    if (heroPlaybackTimeoutRef.current) window.clearTimeout(heroPlaybackTimeoutRef.current);
    startHeroCrossfade();
  };

  useEffect(() => {
    return () => {
      if (heroPlaybackTimeoutRef.current) window.clearTimeout(heroPlaybackTimeoutRef.current);
      if (heroCrossfadeTimeoutRef.current) window.clearTimeout(heroCrossfadeTimeoutRef.current);
      Object.values(heroVideoObjectUrlsRef.current).forEach((objectUrl) => {
        URL.revokeObjectURL(objectUrl);
      });
      heroVideoObjectUrlsRef.current = {};
      heroVideoCachePromisesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!currentHeroPool.length) return;

    let cancelled = false;
    const prioritizedSources = new Set(heroPriorityMedia.map((media) => media.src));

    heroPriorityMedia.forEach((media) => {
      void cacheHeroVideoLocally(media);
    });

    if (!shouldAggressivelyWarmHeroCache) {
      return () => {
        cancelled = true;
      };
    }

    const warmRemainingHeroVideos = async () => {
      for (const media of currentHeroPool) {
        if (cancelled || prioritizedSources.has(media.src)) continue;
        await cacheHeroVideoLocally(media);
      }
    };

    const scheduleIdleWarmup = () => {
      if (typeof window === "undefined") {
        void warmRemainingHeroVideos();
        return;
      }

      if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(() => {
          if (!cancelled) {
            void warmRemainingHeroVideos();
          }
        }, { timeout: 2500 });

        return () => {
          window.cancelIdleCallback(idleId);
        };
      }

      const timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          void warmRemainingHeroVideos();
        }
      }, 1500);

      return () => {
        window.clearTimeout(timeoutId);
      };
    };

    const cancelScheduledWarmup = scheduleIdleWarmup();

    return () => {
      cancelled = true;
      cancelScheduledWarmup?.();
    };
  }, [cacheHeroVideoLocally, currentHeroPool, heroPriorityMedia, shouldAggressivelyWarmHeroCache]);

  const pendingHeroPlaybackSrc = pendingHeroTransition
    ? getHeroPlaybackSrc(pendingHeroTransition.media)
    : null;

  useEffect(() => {
    const pendingVideo = pendingHeroVideoRef.current;
    if (!pendingVideo || !pendingHeroTransition) return;

    pendingVideo.load();
  }, [pendingHeroPlaybackSrc, pendingHeroTransition]);

  const finalizeHeroCrossfade = () => {
    if (!pendingHeroTransition) return;
    setHeroPlaylist(pendingHeroTransition.playlist);
    setHeroPlaylistIndex(pendingHeroTransition.index);
    setPendingHeroTransition(null);
    setIsHeroCrossfading(false);
  };

  const startHeroCrossfade = () => {
    if (!pendingHeroTransition || isHeroCrossfading) return;
    if (heroCrossfadeTimeoutRef.current) window.clearTimeout(heroCrossfadeTimeoutRef.current);
    if (heroPlaybackTimeoutRef.current) window.clearTimeout(heroPlaybackTimeoutRef.current);

    pendingHeroVideoRef.current?.play().catch(() => undefined);
    heroPlaybackTimeoutRef.current = window.setTimeout(() => {
      queueHeroCrossfade();
    }, Math.max(pendingHeroPlaybackDurationRef.current - HERO_CROSSFADE_DURATION_MS, 0));

    setIsHeroCrossfading(true);
    heroCrossfadeTimeoutRef.current = window.setTimeout(() => {
      finalizeHeroCrossfade();
    }, HERO_CROSSFADE_DURATION_MS);
  };

  const handleHeroVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxStartTime = Math.max(duration - HERO_MAX_VIDEO_SEGMENT_SECONDS, 0);
    const startTime = maxStartTime > 0 ? Math.random() * maxStartTime : 0;
    const remainingDuration = duration > 0 ? Math.max(duration - startTime, 0) : HERO_MAX_VIDEO_SEGMENT_SECONDS;
    const playbackDurationMs = Math.max(
      800,
      Math.min(remainingDuration, HERO_MAX_VIDEO_SEGMENT_SECONDS) * 1000
    );

    if (heroPlaybackTimeoutRef.current) window.clearTimeout(heroPlaybackTimeoutRef.current);

    const scheduleAdvance = () => {
      heroPlaybackTimeoutRef.current = window.setTimeout(() => {
        queueHeroCrossfade();
      }, Math.max(playbackDurationMs - HERO_CROSSFADE_DURATION_MS, 0));
    };

    if (startTime > 0) {
      const handleSeeked = () => {
        scheduleAdvance();
        video.removeEventListener("seeked", handleSeeked);
      };
      video.addEventListener("seeked", handleSeeked);
      video.currentTime = startTime;
      return;
    }

    scheduleAdvance();
  };

  const handlePendingHeroVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxStartTime = Math.max(duration - HERO_MAX_VIDEO_SEGMENT_SECONDS, 0);
    const startTime = maxStartTime > 0 ? Math.random() * maxStartTime : 0;
    const remainingDuration = duration > 0 ? Math.max(duration - startTime, 0) : HERO_MAX_VIDEO_SEGMENT_SECONDS;
    pendingHeroPlaybackDurationRef.current = Math.max(
      800,
      Math.min(remainingDuration, HERO_MAX_VIDEO_SEGMENT_SECONDS) * 1000
    );

    if (startTime > 0) {
      const handleSeeked = () => {
        video.pause();
        video.removeEventListener("seeked", handleSeeked);
      };
      video.addEventListener("seeked", handleSeeked);
      video.currentTime = startTime;
      return;
    }

    video.pause();
  };

  const renderHeroMedia = (media: HeroMedia, mode: "active" | "pending") => {
    const playbackSrc = getHeroPlaybackSrc(media);
    const shouldEagerPreload =
      mode === "pending"
      || playbackSrc !== media.src
      || media.src === heroMedia?.src;
    const baseClassName = `img-cover hero-layer ${
      mode === "active"
        ? isHeroCrossfading
          ? "hero-layer--outgoing"
          : "hero-layer--active"
        : isHeroCrossfading
          ? "hero-layer--incoming-active"
          : "hero-layer--incoming"
    }`;

    return (
      <video
        key={`${mode}:${media.src}`}
        ref={mode === "pending" ? pendingHeroVideoRef : undefined}
        className={baseClassName}
        poster={media.poster}
        autoPlay={mode === "active"}
        muted
        playsInline
        preload={shouldEagerPreload ? "auto" : "metadata"}
        onLoadedMetadata={mode === "active" ? handleHeroVideoMetadata : handlePendingHeroVideoMetadata}
        onEnded={mode === "active" ? queueHeroCrossfade : undefined}
      >
        <source src={playbackSrc} type={media.mimeType ?? "video/mp4"} />
      </video>
    );
  };

  // Fetch real articles for the journal preview
  const { data: liveLatestArticles = [] } = useQuery<HomeArticle[]>({
    queryKey: ["home-latest-articles"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, excerpt_en, excerpt_it, cover_image, published_at, category")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(3);
      if (error) throw error;

      // Fetch tags for these articles
      const ids = (data || []).map((a) => a.id);
      if (ids.length) {
        const { data: tagData } = await supabase
          .from("article_tags")
          .select("article_id, tags(id, name)")
          .in("article_id", ids);
        const tagMap: Record<string, HomeTag[]> = {};
        (tagData as ArticleTagRelation[] | null)?.forEach((t) => {
          if (!tagMap[t.article_id]) tagMap[t.article_id] = [];
          if (t.tags) tagMap[t.article_id].push(t.tags);
        });
        return (data || []).map((a) => ({ ...a, tags: tagMap[a.id] || [] })) as HomeArticle[];
      }
      return (data || []).map((a) => ({ ...a, tags: [] })) as HomeArticle[];
    },
  });
  const latestArticles = useMemo<HomeArticle[]>(() => {
    if (!publicContent) return liveLatestArticles;

    return publicContent.articles.slice(0, 3).map((article) => ({
      id: article.id,
      title_en: article.title_en,
      title_it: article.title_it,
      slug: article.slug,
      excerpt_en: article.excerpt_en,
      excerpt_it: article.excerpt_it,
      cover_image: article.cover_image,
      published_at: article.published_at,
      category: article.category ?? "logbook",
      tags: article.tags ?? [],
    }));
  }, [liveLatestArticles, publicContent]);

  const { data: liveMapArticles = [], isLoading: isLiveMapArticlesLoading } = useQuery<GeoArticle[]>({
    queryKey: ["home-logbook-map-articles"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, location_name")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as GeoArticle[];
    },
  });
  const mapArticles = publicContent?.articles ?? liveMapArticles;

  const { data: liveVoyages = [], isLoading: isLiveVoyagesLoading } = useQuery<Voyage[]>({
    queryKey: ["home-voyages"],
    enabled: !publicContent && !isPublicContentLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyages" as any)
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as Voyage[];
    },
  });
  const voyages = publicContent?.voyages ?? liveVoyages;

  const { data: liveAllWaypoints = [], isLoading: isLiveWaypointsLoading } = useQuery<VoyageWaypoint[]>({
    queryKey: ["home-voyage-waypoints"],
    enabled: !publicContent && !isPublicContentLoading && liveVoyages.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints" as any)
        .select("*")
        .in("voyage_id", liveVoyages.map((voyage) => voyage.id))
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });
  const allWaypoints = publicContent?.voyageWaypoints ?? liveAllWaypoints;

  const waypointsMap = useMemo(() => {
    const map: Record<string, VoyageWaypoint[]> = {};
    allWaypoints.forEach((waypoint) => {
      if (!map[waypoint.voyage_id]) map[waypoint.voyage_id] = [];
      map[waypoint.voyage_id].push(waypoint);
    });
    return map;
  }, [allWaypoints]);

  const {
    data: isNewsletterSubscribed = false,
    isLoading: isNewsletterSubscriptionLoading,
  } = useQuery<boolean>({
    queryKey: newsletterSubscriptionQueryKey,
    enabled: !authLoading && Boolean(session?.user?.id),
    queryFn: async () => {
      const userId = session?.user?.id;
      const normalizedEmail = session?.user?.email?.trim().toLowerCase() ?? "";

      if (!userId) {
        return false;
      }

      if (normalizedEmail) {
        const { data: newsletterState, error: newsletterError } = await invokeOptionalNewsletterFunction<{
          subscribed?: boolean;
        }>(
          supabase.functions.invoke.bind(supabase.functions),
          "my-newsletter-subscription",
          {},
        );

        if (!newsletterError) {
          return Boolean(newsletterState?.subscribed);
        }

        console.error("Homepage newsletter subscription load via function failed:", newsletterError);
      }

      const newsletterQuery = supabase.from("newsletter_subscribers").select("subscribed");
      const { data: fallbackSubscription, error: fallbackError } = await (normalizedEmail
        ? newsletterQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
        : newsletterQuery.eq("profile_id", userId))
        .maybeSingle();

      if (fallbackError) {
        console.error("Homepage newsletter subscription fallback load error:", fallbackError);
        return false;
      }

      return Boolean(fallbackSubscription?.subscribed);
    },
  });

  const isHomeMapReady = Boolean(publicContent) || (
    !isPublicContentLoading
    && !isLiveMapArticlesLoading
    && !isLiveVoyagesLoading
    && !isLiveWaypointsLoading
  );
  const shouldShowNewsletterSection = !authLoading && (
    !session?.user || (!isNewsletterSubscriptionLoading && !isNewsletterSubscribed)
  );

  const handleNewsletterSubscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetEmail = session?.user.email?.trim() || newsletterEmail.trim();

    if (!targetEmail) {
      toast.error(lang === "it" ? "Inserisci una email valida." : "Enter a valid email.");
      return;
    }

    if (!newsletterConsent) {
      toast.error(
        lang === "it"
          ? "Devi accettare l'iscrizione alla newsletter prima di continuare."
          : "You need to accept the newsletter subscription before continuing."
      );
      return;
    }

    setNewsletterLoading(true);
    try {
      if (session?.user?.id && session.user.email) {
        const normalizedEmail = session.user.email.trim().toLowerCase();
        let welcomeHandledByBackend = false;
        let fallbackUsed = false;
        let wasAlreadySubscribed = false;

        const { data: ownSubscriptionState, error: ownSubscriptionError } = await invokeOptionalNewsletterFunction<{
          subscribed?: boolean;
        }>(
          supabase.functions.invoke.bind(supabase.functions),
          "my-newsletter-subscription",
          {
            subscribed: true,
            source: "homepage_logged_in",
          },
        );

        if (!ownSubscriptionError) {
          welcomeHandledByBackend = true;
          wasAlreadySubscribed = Boolean(ownSubscriptionState?.subscribed);
        } else {
          console.error("Authenticated newsletter subscribe via my-newsletter-subscription failed:", ownSubscriptionError);

          const { error: legacySubscribeError } = await supabase.functions.invoke("newsletter-subscribe", {
            body: {
              email: normalizedEmail,
              preferredLanguage: lang,
              source: "homepage_logged_in",
              consent: newsletterConsent,
              website: newsletterWebsite,
            },
          });

          if (!legacySubscribeError) {
            welcomeHandledByBackend = true;
          } else {
            console.error("Authenticated newsletter subscribe via newsletter-subscribe failed:", legacySubscribeError);

            const subscriptionQuery = supabase.from("newsletter_subscribers").select("id, subscribed");
            const { data: existingSub, error: existingSubError } = await subscriptionQuery
              .or(`profile_id.eq.${session.user.id},email.eq.${normalizedEmail}`)
              .maybeSingle();

            if (existingSubError) {
              throw existingSubError;
            }

            wasAlreadySubscribed = Boolean(existingSub?.subscribed);

            const mutation = existingSub?.id
              ? supabase
                  .from("newsletter_subscribers")
                  .update({
                    profile_id: session.user.id,
                    email: normalizedEmail,
                    subscribed: true,
                  })
                  .eq("id", existingSub.id)
              : supabase.from("newsletter_subscribers").insert({
                  profile_id: session.user.id,
                  email: normalizedEmail,
                  subscribed: true,
                });

            const { error: mutationError } = await mutation;
            if (mutationError) {
              throw mutationError;
            }

            fallbackUsed = true;
          }
        }

        setNewsletterLoading(false);
        setNewsletterEmail("");
        setNewsletterConsent(false);
        setNewsletterWebsite("");
        queryClient.setQueryData(newsletterSubscriptionQueryKey, true);

        if (!wasAlreadySubscribed && fallbackUsed && !welcomeHandledByBackend) {
          toast.warning(
            lang === "it"
              ? "Iscrizione registrata, ma la mail di benvenuto non è stata inviata perché il servizio email non ha risposto."
              : "Subscription saved, but the welcome email was not sent because the email service did not respond.",
          );
          return;
        }

        toast.success(
          lang === "it"
            ? "Preferenze newsletter aggiornate."
            : "Newsletter preferences updated.",
        );
        return;
      } else {
        const { error } = await supabase.functions.invoke("newsletter-subscribe", {
          body: {
            email: targetEmail,
            preferredLanguage: lang,
            source: session ? "homepage_logged_in" : "homepage",
            consent: newsletterConsent,
            website: newsletterWebsite,
          },
        });

        if (error) {
          throw error;
        }
      }
    } catch (error) {
      setNewsletterLoading(false);
      console.error("Newsletter subscribe failed", error);
      toast.error(
        lang === "it"
          ? "Iscrizione non riuscita. Riprova."
          : "Subscription failed. Please try again."
      );
      return;
    }

    setNewsletterLoading(false);

    setNewsletterEmail("");
    setNewsletterConsent(false);
    setNewsletterWebsite("");
    if (session?.user?.id) {
      queryClient.setQueryData(newsletterSubscriptionQueryKey, true);
    }
    toast.success(
      session?.user.email
        ? lang === "it"
          ? "Preferenze newsletter aggiornate."
          : "Newsletter preferences updated."
        : lang === "it"
          ? "Richiesta registrata."
          : "Subscription request received."
    );
  };

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      <StructuredData
        id="homepage"
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "@id": ORGANIZATION_ID,
            name: "BITE",
            url: SITE_URL,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": WEBSITE_ID,
            name: "BITE",
            url: SITE_URL,
            description: "Stories, voyages, refit notes, and life aboard S/Y Spritz.",
            publisher: { "@id": ORGANIZATION_ID },
          },
        ]}
      />
      <section className="relative min-h-screen overflow-hidden px-4 pb-6 pt-24 md:px-6 md:pb-8 md:pt-28">
        <div className="absolute inset-0">
          {heroMedia ? renderHeroMedia(heroMedia, "active") : null}
          {pendingHeroTransition ? renderHeroMedia(pendingHeroTransition.media, "pending") : null}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_28%),linear-gradient(180deg,rgba(7,15,27,0.26)_0%,rgba(9,18,31,0.22)_24%,rgba(10,20,34,0.36)_48%,rgba(8,17,30,0.6)_100%)]" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl items-center justify-center">
          <div className="hero-copy-shell w-full max-w-4xl px-4 py-8 text-center slide-up md:px-10 md:py-10">
            <h1 className="editorial-heading hero-copy-text text-4xl md:text-6xl lg:text-7xl mb-6 whitespace-pre-line">
              {t("hero.title")}
            </h1>
            <p className="editorial-body hero-copy-text text-base md:text-lg max-w-2xl mx-auto mb-10 whitespace-pre-line">
              {t("hero.subtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/logbook"
                className="glass-button hero-cta inline-flex items-center justify-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
              >
                {t("hero.cta.journey")}
                <ArrowRight size={16} />
              </Link>
              <Link
                to="/collaborations"
                className="glass-button-dark hero-cta hero-cta-dark inline-flex items-center justify-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide"
              >
                {t("hero.cta.collaborate")}
              </Link>
            </div>
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2">
          <div className="hero-scroll-cue">
            <span className="hero-scroll-cue__label">{t("crew.scroll")}</span>
            <span className="hero-scroll-cue__line" aria-hidden="true">
              <span className="hero-scroll-cue__dot" />
            </span>
          </div>
        </div>
      </section>

      <section className="page-section pt-4 md:pt-6">
        <div className="page-section-narrow glass-panel rounded-[34px] px-8 py-10 md:px-12 md:py-14">
          <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
            {t("intro.label")}
          </p>
          <p className="editorial-body text-lg md:text-xl text-foreground/82 leading-relaxed">{t("intro.text")}</p>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="flex items-center justify-center mb-12">
            <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent">
              {t("values.label")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-panel-soft rounded-[28px] p-6 md:p-8">
                <h3 className="editorial-heading text-2xl md:text-3xl mb-4">{t(`values.${i}.title`)}</h3>
                <p className="editorial-body text-muted-foreground leading-relaxed">{t(`values.${i}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">
                {t("life.label")}
              </p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">{t("life.title")}</h2>
              <p className="editorial-body text-muted-foreground leading-relaxed text-lg">{t("life.text")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4]">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={boatSunset}
                    alt="Spritz at sunset"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <div className="glass-frame rounded-[28px] p-2 aspect-[3/4] mt-8">
                <div className="overflow-hidden rounded-[22px] h-full">
                  <img
                    src={dogsMarina}
                    alt="Dogs at the marina"
                    className="img-cover hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel-dark rounded-[38px] px-6 py-10 text-white md:px-10 md:py-12">
          <div className="flex items-center justify-center mb-12">
            <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76">
              {t("topics.label")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { key: "refit", icon: Wrench },
              { key: "navigation", icon: Compass },
              { key: "remote", icon: Wifi },
              { key: "storytelling", icon: Pen },
            ].map(({ key, icon: Icon }) => (
              <div key={key} className="glass-chip-dark rounded-[28px] p-6">
                <div className="glass-chip-dark inline-flex h-12 w-12 items-center justify-center mb-5 text-white/92">
                  <Icon size={20} />
                </div>
                <h3 className="editorial-heading text-xl mb-3 text-white">{t(`topics.${key}`)}</h3>
                <p className="text-sm text-white/84 leading-relaxed">{t(`topics.${key}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="flex items-end justify-between mb-12 gap-6">
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-4">{t("journal.label")}</p>
              <h2 className="editorial-heading text-3xl md:text-4xl">
                {lang === "it" ? "Ultime dal logbook" : "Latest from the logbook"}
              </h2>
            </div>
            <Link
              to="/logbook"
              className="hidden md:inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>

          {latestArticles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {latestArticles.map((entry) => {
                const title = lang === "en" ? entry.title_en : (entry.title_it || entry.title_en);
                const excerpt = lang === "en" ? entry.excerpt_en : (entry.excerpt_it || entry.excerpt_en);
                return (
                  <Link to={`/logbook/${entry.slug}`} key={entry.id} className="group block">
                    <article className="glass-panel-soft rounded-[30px] p-3 h-full transition-transform duration-300 group-hover:-translate-y-1">
                      <div className="glass-frame rounded-[24px] p-1.5 mb-5">
                        <div className="aspect-[4/3] overflow-hidden rounded-[19px] bg-muted relative">
                          {entry.cover_image ? (
                            <img
                              src={entry.cover_image}
                              alt={title}
                              className="img-cover group-hover:scale-105 transition-transform duration-700"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-2xl">BITE</div>
                          )}
                          {isRead(entry.id) && (
                            <span className="glass-chip absolute top-2 left-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-sans text-muted-foreground">
                              <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {entry.tags?.slice(0, 2).map((tag) => (
                          <span key={tag.id} className="glass-chip inline-flex px-2.5 py-1 text-[11px] font-sans text-accent">#{tag.name}</span>
                        ))}
                        {entry.published_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(entry.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      <h3 className="editorial-heading text-xl md:text-2xl mb-2 group-hover:text-accent transition-colors line-clamp-2">
                        {title}
                      </h3>
                      <p className="editorial-body text-sm text-muted-foreground line-clamp-3">{excerpt}</p>
                    </article>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-12">
              {lang === "it" ? "Nessun articolo ancora pubblicato." : "No articles published yet."}
            </p>
          )}

          <div className="mt-8 md:hidden text-center">
            <Link to="/logbook" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("journal.viewall")} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel rounded-[38px] px-6 py-10 md:px-10 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div className="glass-frame rounded-[30px] p-2">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(243,246,247,0.62))]">
                <LazyVoyageMap
                  voyages={voyages}
                  waypointsMap={waypointsMap}
                  articles={mapArticles}
                  lang={lang}
                  initialFitReady={isHomeMapReady}
                  onArticleClick={(article) => navigate(`/logbook/${article.slug}`)}
                  fallbackHeightClassName="aspect-[16/10]"
                  deferUntilVisible
                />
                {!isHomeMapReady ? (
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
                    <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans text-muted-foreground">
                      {lang === "it" ? "Caricamento mappa..." : "Loading map..."}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <p className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-accent mb-8">{t("route.label")}</p>
              <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line">{t("route.title")}</h2>
              <p className="editorial-body text-muted-foreground leading-relaxed mb-8">{t("route.text")}</p>
              <Link to="/route" className="glass-button-secondary inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium">
                {t("route.explore")} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section pt-0">
        <div className="page-section-wide glass-panel-dark rounded-[38px] px-6 py-10 text-white md:px-10 md:py-12">
          <div className="max-w-3xl">
            <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76 mb-8">{t("collab.label")}</p>
            <h2 className="editorial-heading text-3xl md:text-5xl mb-8 whitespace-pre-line text-white">{t("collab.title")}</h2>
            <p className="editorial-body text-white/84 leading-relaxed text-lg mb-10">{t("collab.text")}</p>
            <Link to="/collaborations" className="glass-button inline-flex items-center gap-2 px-8 py-3.5 text-sm font-sans font-medium tracking-wide">
              {t("collab.cta")} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 md:px-6">
        <div className="glass-frame rounded-[34px] p-2 h-[50vh] md:h-[60vh] overflow-hidden">
          <div className="overflow-hidden rounded-[28px] h-full">
            <img src={dinghyCrew} alt="Crew on the dinghy" className="img-cover" loading="lazy" decoding="async" />
          </div>
        </div>
      </section>

      {shouldShowNewsletterSection ? (
        <section className="page-section pt-0">
          <div className="page-section-narrow glass-panel-dark rounded-[38px] px-6 py-10 text-center text-white md:px-10 md:py-12">
            <p className="glass-chip-dark inline-flex px-4 py-2 text-xs font-sans tracking-[0.3em] uppercase text-white/76 mb-8">{t("newsletter.label")}</p>
            <h2 className="editorial-heading text-3xl md:text-5xl mb-6 text-white">{t("newsletter.title")}</h2>
            <p className="editorial-body text-white/84 mb-10 max-w-lg mx-auto">{t("newsletter.text")}</p>
            <form onSubmit={handleNewsletterSubscribe} className="max-w-xl mx-auto space-y-4">
              <input
                type="text"
                name="website"
                value={newsletterWebsite}
                onChange={(event) => setNewsletterWebsite(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <div className="flex flex-col sm:flex-row gap-3">
                {session?.user.email ? (
                  <div className="glass-chip-dark flex-1 px-5 py-3 text-sm text-white/88 text-left">
                    {lang === "it"
                      ? `Ti iscriveremo con ${session.user.email}`
                      : `We'll subscribe you with ${session.user.email}`}
                  </div>
                ) : (
                  <div className="glass-input flex-1 rounded-full px-1.5">
                    <input
                      type="email"
                      value={newsletterEmail}
                      onChange={(event) => setNewsletterEmail(event.target.value)}
                      placeholder={t("newsletter.placeholder")}
                      className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                    />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={newsletterLoading}
                  className="glass-button px-8 py-3 text-sm font-sans font-medium tracking-wide disabled:opacity-60 rounded-full"
                >
                  {newsletterLoading ? (lang === "it" ? "Invio..." : "Sending...") : t("newsletter.submit")}
                </button>
              </div>
              <label className="flex items-start gap-3 text-left text-sm text-white/82">
                <input
                  type="checkbox"
                  checked={newsletterConsent}
                  onChange={(event) => setNewsletterConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/40 bg-transparent accent-white"
                />
                <span>
                  {lang === "it"
                    ? "Acconsento a ricevere la newsletter di BITE e confermo di aver letto la "
                    : "I agree to receive the BITE newsletter and confirm that I have read the "}
                  <Link to="/privacy-policy" className="underline decoration-white/50 underline-offset-4 hover:text-white">
                    {lang === "it" ? "Privacy Policy" : "Privacy Policy"}
                  </Link>
                  .
                </span>
              </label>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default Index;
