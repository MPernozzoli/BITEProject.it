import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { generateHTML } from "@tiptap/react";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, User } from "lucide-react";
import { format } from "date-fns";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";
import ArticleSidebar from "@/components/ArticleSidebar";
import ArticleRelatedSection from "@/components/ArticleRelatedSection";
import ArticleVoyageMediaWidget from "@/components/ArticleVoyageMediaWidget";
import { useArticleDwellTracking, useQualifiedArticleRead, useSyncArticleViewCount } from "@/hooks/useArticleReads";
import { useEffect, useMemo, useRef, useState } from "react";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import LiveReadCounter from "@/components/LiveReadCounter";
import { articleContentExtensions } from "@/lib/article-content";
import ProfileAvatar from "@/components/ProfileAvatar";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import {
  articleLocalizedPaths,
  articlePathForLang,
  bilingualSlugOrFilter,
  slugForLang,
  storyPathForLang,
} from "@/lib/article-slug";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";
import LazyArticleMapAside from "@/components/LazyArticleMapAside";
import { extractImagesFromRichContent } from "@/lib/content-images";
import { getArticleInstagramStoryImage } from "@/lib/article-instagram-story";
import ArticleReader from "@/components/ArticleReader";
import {
  getArticleSceneCameraCenter,
  getArticleSceneAnchorId,
  getArticleSceneAnchorIndex,
  getArticleSceneAnchorPreview,
  getArticleSceneDescription,
  getArticleOverlayLabel,
  getArticleSceneTitle,
  getArticleSceneWindLabel,
  normalizeArticleMapScenes,
  sortArticleMapScenesForLanguage,
} from "@/lib/article-map";
import {
  buildPublicVoyageGeometry,
  buildVoyageSegmentGeometry,
  formatWaypointMoment,
  getArticleDisplayLocationLabel,
  getLocalizedWaypointDescription,
  getLocalizedWaypointName,
  normalizeWaypointMedia,
  resolveArticleRouteRange,
  totalCoordinateDistanceKm,
  totalWaypointDistance,
} from "@/lib/voyage-utils";
import type { GeoArticle, Voyage, VoyageWaypoint } from "@/lib/voyage-utils";

type StoryChapter = {
  id: string;
  slug: string;
  slug_it?: string | null;
  slug_en?: string | null;
  title_en: string;
  title_it: string;
  published_at: string | null;
  status: string;
  story_sort_order: number;
};

type ArticleSeoOptimization = {
  status: string;
  title_it: string | null;
  title_en: string | null;
  description_it: string | null;
  description_en: string | null;
  social_title_it: string | null;
  social_title_en: string | null;
  social_description_it: string | null;
  social_description_en: string | null;
  keywords_it: string[] | null;
  keywords_en: string[] | null;
  structured_data: Record<string, unknown> | null;
};

const ArticlePage = () => {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const articleBlockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const articleContentRef = useRef<HTMLDivElement | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [mapCamera, setMapCamera] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const focusedCommentId = searchParams.get("comment");
  const focusTarget = searchParams.get("focus");

  const { data: article, isLoading } = useQuery({
    queryKey: ["article", slug],
    queryFn: async () => {
      const safeSlug = (slug ?? "").trim();
      if (!safeSlug) throw new Error("Missing slug");
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .or(bilingualSlugOrFilter(safeSlug))
        .eq("status", "published")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Article not found");
      return data;
    },
  });

  const storyId = (article as any)?.story_id as string | null | undefined;
  useQualifiedArticleRead(article?.id ?? null, slug, lang);
  useSyncArticleViewCount(article?.id ?? null, slug);
  useArticleDwellTracking(article?.id ?? null);

  // If the user landed on a slug that doesn't match the current language's
  // preferred slug, redirect (replace) to the canonical lang-correct URL.
  useEffect(() => {
    if (!article || !slug) return;
    const preferred = slugForLang(article as any, lang);
    if (preferred && preferred !== slug) {
      navigate(`/${lang}/logbook/${preferred}${window.location.search}${window.location.hash}`, {
        replace: true,
      });
    }
  }, [article, slug, lang, navigate]);

  const { data: storyChapters = [] } = useQuery({
    queryKey: ["story-chapters-published", storyId],
    enabled: Boolean(storyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, slug, slug_it, slug_en, title_en, title_it, published_at, status, story_sort_order")
        .eq("story_id", storyId!)
        .in("status", ["published", "scheduled", "draft"])
        .order("story_sort_order", { ascending: true })
        .order("published_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as StoryChapter[];
    },
  });

  const { data: authors = [] } = useQuery({
    queryKey: ["article-authors", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const { data: authorLinks } = await supabase
        .from("article_authors")
        .select("profile_id")
        .eq("article_id", article!.id);
      if (!authorLinks?.length) return [];
      const ids = authorLinks.map((a) => a.profile_id);
      const { data: profiles } = await supabase
        .from("public_profiles")
        .select("id, name, avatar_url")
        .in("id", ids);
      return profiles || [];
    },
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["article-tags", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("article_tags")
        .select("tag_id, tags(id, name)")
        .eq("article_id", article!.id);
      return (data || []).map((d: any) => d.tags).filter(Boolean);
    },
  });

  const { data: seoOptimization = null } = useQuery({
    queryKey: ["article-seo-optimization", article?.id],
    enabled: Boolean(article?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("article_seo_optimizations")
        .select("status, title_it, title_en, description_it, description_en, social_title_it, social_title_en, social_description_it, social_description_en, keywords_it, keywords_en, structured_data")
        .eq("article_id", article!.id)
        .eq("status", "ready")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ArticleSeoOptimization | null;
    },
  });

  const { data: story } = useQuery({
    queryKey: ["article-story", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const sid = (article as any)?.story_id;
      if (!sid) return null;
      const { data } = await supabase.from("stories").select("*").eq("id", sid).single();
      return data;
    },
  });
  const { data: linkedVoyage } = useQuery({
    queryKey: ["article-linked-voyage", article?.voyage_id],
    enabled: Boolean(article?.voyage_id),
    queryFn: async () => {
      const { data, error } = await supabase.from("voyages").select("*").eq("id", article!.voyage_id).eq("is_published", true).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Voyage | null;
    },
  });
  const { data: linkedVoyageWaypoints = [] } = useQuery({
    queryKey: ["article-linked-voyage-waypoints", article?.voyage_id],
    enabled: Boolean(linkedVoyage?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .eq("voyage_id", linkedVoyage!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });

  const articleRouteSegment = useMemo(() => {
    if (!article || linkedVoyageWaypoints.length === 0) return null;
    return resolveArticleRouteRange(article as GeoArticle, linkedVoyageWaypoints);
  }, [article, linkedVoyageWaypoints]);

  const articleWaypointsMap = useMemo(() => {
    const vid = article?.voyage_id;
    if (!vid || linkedVoyageWaypoints.length === 0) return {} as Record<string, VoyageWaypoint[]>;
    return { [vid]: linkedVoyageWaypoints };
  }, [article?.voyage_id, linkedVoyageWaypoints]);

  const articleDisplayLocation = useMemo(() => {
    if (!article) return "";
    return getArticleDisplayLocationLabel(article as GeoArticle, articleWaypointsMap, lang);
  }, [article, articleWaypointsMap, lang]);

  const chapterPrevNext = useMemo(() => {
    if (!article?.id || !storyChapters.length) return { prev: null as StoryChapter | null, next: null as StoryChapter | null };
    const idx = storyChapters.findIndex((c) => c.id === article.id);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? storyChapters[idx - 1] : null,
      next: idx < storyChapters.length - 1 ? storyChapters[idx + 1] : null,
    };
  }, [article?.id, storyChapters]);

  useEffect(() => {
    if (focusTarget !== "likes") return;

    const element = document.getElementById("article-engagement-panel");
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("comment-notification-flash");

    const timeoutId = window.setTimeout(() => {
      element.classList.remove("comment-notification-flash");
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("focus");
      nextParams.delete("notification");
      setSearchParams(nextParams, { replace: true });
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [focusTarget, searchParams, setSearchParams]);

  const handleCommentFocusHandled = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("comment");
    nextParams.delete("focus");
    nextParams.delete("notification");
    setSearchParams(nextParams, { replace: true });
  };

  const coverFocal = useMemo(() => {
    if (!article) return clampCoverFocal(50, 50, 1);
    return clampCoverFocal(
      Number((article as any).cover_focal_x ?? 50),
      Number((article as any).cover_focal_y ?? 50),
      Number((article as any).cover_zoom ?? 1)
    );
  }, [article]);

  const hasGeo = Boolean(
    article &&
      typeof article.latitude === "number" &&
      typeof article.longitude === "number" &&
      !Number.isNaN(article.latitude) &&
      !Number.isNaN(article.longitude)
  );
  const articleScenes = useMemo(
    () => normalizeArticleMapScenes((article as any)?.article_map_scenes),
    [article]
  );

  const title = article
    ? (lang === "en" ? article.title_en : (article.title_it || article.title_en))
    : "";
  const content = article
    ? (lang === "en" ? article.content_en : (article.content_it || article.content_en))
    : null;
  const contentNodes = useMemo(() => {
    if (!content || typeof content !== "object" || !Array.isArray((content as any).content)) return [];
    return (content as any).content as Record<string, unknown>[];
  }, [content]);
  const hasStructuredContent = Boolean(
    content && typeof content === "object" && Object.keys(content).length > 0
  );
  let contentRenderFailed = false;
  let htmlContent = "";

  if (hasStructuredContent) {
    try {
      htmlContent = sanitizeRichHtml(
        generateHTML(content as Parameters<typeof generateHTML>[0], articleContentExtensions)
      );
    } catch (error) {
      contentRenderFailed = true;
      console.error("Failed to render article content", error);
    }
  }

  const localizedScenes = useMemo(() => {
    const sortedScenes = sortArticleMapScenesForLanguage(articleScenes, lang);
    return sortedScenes.flatMap((scene) => {
      const cameraCenter = getArticleSceneCameraCenter(scene);
      if (!cameraCenter || typeof scene.latitude !== "number" || typeof scene.longitude !== "number") return [];

      return [{
        cameraLatitude: cameraCenter.latitude,
        cameraLongitude: cameraCenter.longitude,
        id: scene.id,
        title: getArticleSceneTitle(scene, lang),
        description: getArticleSceneDescription(scene, lang),
        windLabel: getArticleSceneWindLabel(scene, lang),
        latitude: scene.latitude,
        longitude: scene.longitude,
        zoom: scene.zoom,
        windAngle: scene.wind_angle,
        anchorId: getArticleSceneAnchorId(scene, lang),
        anchorPreview: getArticleSceneAnchorPreview(scene, lang),
        anchorIndex: getArticleSceneAnchorIndex(scene, lang),
        showMainRoute: scene.show_main_route,
        vessels: scene.vessels,
        overlays: scene.overlays.map((overlay) => ({
          ...overlay,
          label: getArticleOverlayLabel(overlay, lang),
        })),
      }];
    });
  }, [articleScenes, lang]);
  const primaryRouteCoordinates = useMemo(() => {
    if (!article?.voyage_id || !linkedVoyage || linkedVoyageWaypoints.length < 2) return null;
    const geometrySource = linkedVoyage.cached_geometry as { coordinates?: [number, number][] } | null;
    const cachedGeometry = Array.isArray(geometrySource?.coordinates) ? geometrySource.coordinates : undefined;

    if (articleRouteSegment) {
      const start = articleRouteSegment[0];
      const end = articleRouteSegment[1];
      const segmentGeometry = buildVoyageSegmentGeometry(
        linkedVoyageWaypoints,
        linkedVoyage.type,
        start,
        end,
        cachedGeometry
      );
      return segmentGeometry.length >= 2 ? segmentGeometry : null;
    }

    return buildPublicVoyageGeometry(linkedVoyageWaypoints, linkedVoyage.type, [], linkedVoyage.id, cachedGeometry);
  }, [article?.voyage_id, articleRouteSegment, linkedVoyage, linkedVoyageWaypoints]);
  const articleRouteDistance = useMemo(() => {
    if (!article?.voyage_id || linkedVoyageWaypoints.length < 2) return null;

    let relevantWaypoints = linkedVoyageWaypoints;
    let relevantGeometry = primaryRouteCoordinates;
    if (articleRouteSegment) {
      const safeStart = articleRouteSegment[0];
      const safeEnd = articleRouteSegment[1];
      relevantWaypoints = linkedVoyageWaypoints.slice(safeStart, safeEnd + 1);
      relevantGeometry = linkedVoyage
        ? buildVoyageSegmentGeometry(
            linkedVoyageWaypoints,
            linkedVoyage.type,
            safeStart,
            safeEnd,
            (linkedVoyage.cached_geometry as { coordinates?: [number, number][] } | null)?.coordinates
          )
        : null;
    }

    if (relevantWaypoints.length < 2) return null;
    if (linkedVoyage?.type === "land") {
      const distanceKm = relevantGeometry && relevantGeometry.length >= 2 ? totalCoordinateDistanceKm(relevantGeometry) : 0;
      return distanceKm > 0 ? { value: distanceKm, unit: "KM" as const } : null;
    }
    return { value: totalWaypointDistance(relevantWaypoints), unit: "NM" as const };
  }, [article?.voyage_id, articleRouteSegment, linkedVoyage, linkedVoyageWaypoints, primaryRouteCoordinates]);
  const articleVoyageMediaItems = useMemo(() => {
    if (!article?.voyage_id || linkedVoyageWaypoints.length === 0) return [];

    const startIndex = articleRouteSegment ? articleRouteSegment[0] : 0;
    const endIndex = articleRouteSegment ? articleRouteSegment[1] : linkedVoyageWaypoints.length - 1;

    return linkedVoyageWaypoints.slice(startIndex, endIndex + 1).flatMap((waypoint, relativeIndex) => {
      const originalIndex = startIndex + relativeIndex;
      const waypointName = getLocalizedWaypointName(waypoint, lang, originalIndex);
      const waypointDescription = getLocalizedWaypointDescription(waypoint, lang);
      const waypointDate = formatWaypointMoment(waypoint, lang === "it" ? "it-IT" : "en-US");
      const waypointCoordinates = `Lat ${waypoint.lat.toFixed(5)} · Long ${waypoint.lng.toFixed(5)}`;

      return normalizeWaypointMedia(waypoint.media).map((mediaItem, mediaIndex) => ({
        id: `${waypoint.id}-${mediaIndex}-${mediaItem.url}`,
        waypointId: waypoint.id,
        waypointName,
        waypointDescription,
        waypointCoordinates,
        waypointDate,
        media: mediaItem,
      }));
    });
  }, [article?.voyage_id, articleRouteSegment, lang, linkedVoyageWaypoints]);
  const fallbackSceneCoordinates = useMemo(() => {
    if (hasGeo && article) {
      return {
        latitude: article.latitude!,
        longitude: article.longitude!,
      };
    }

    if (primaryRouteCoordinates && primaryRouteCoordinates.length > 0) {
      const middleCoordinate = primaryRouteCoordinates[Math.floor(primaryRouteCoordinates.length / 2)];
      return {
        longitude: middleCoordinate[0],
        latitude: middleCoordinate[1],
      };
    }

    return null;
  }, [article, hasGeo, primaryRouteCoordinates]);
  const effectiveScenes = useMemo(() => {
    if (localizedScenes.length > 0) return localizedScenes;
    if (!fallbackSceneCoordinates) return [];

    return [{
      id: "article-default-scene",
      title: title || (lang === "it" ? "Posizione articolo" : "Article location"),
      description: articleDisplayLocation,
      windLabel: "",
      latitude: fallbackSceneCoordinates.latitude,
      longitude: fallbackSceneCoordinates.longitude,
      zoom: hasGeo ? 7 : 6,
      windAngle: null,
      anchorId: "",
      anchorPreview: "",
      anchorIndex: 0,
      showMainRoute: Boolean(primaryRouteCoordinates && primaryRouteCoordinates.length > 1),
      vessels: [],
      overlays: [],
    }];
  }, [articleDisplayLocation, fallbackSceneCoordinates, hasGeo, lang, localizedScenes, primaryRouteCoordinates, title]);
  const shouldShowMapWidget = effectiveScenes.length > 0 || Boolean(primaryRouteCoordinates && primaryRouteCoordinates.length > 1);

  const dateFmt = lang === "it" ? "d MMMM yyyy" : "MMMM d, yyyy";
  const dateLabel = article?.published_at ? format(new Date(article.published_at), dateFmt) : null;
  const views = Number((article as any)?.view_count ?? 0);

  const coverStyle = article?.cover_image ? coverImageStyle(article.cover_image, coverFocal) : undefined;
  const instagramStoryImage = getArticleInstagramStoryImage(article, lang);
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : (() => {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("lang", lang);
          return nextUrl.toString();
        })();

  const prevTitle = chapterPrevNext.prev
    ? lang === "en"
      ? chapterPrevNext.prev.title_en
      : chapterPrevNext.prev.title_it || chapterPrevNext.prev.title_en
    : "";
  const nextTitle = chapterPrevNext.next
    ? lang === "en"
      ? chapterPrevNext.next.title_en
      : chapterPrevNext.next.title_it || chapterPrevNext.next.title_en
    : "";

  useEffect(() => {
    if (!article) return;

    const seoTitle =
      (lang === "en" ? seoOptimization?.title_en : seoOptimization?.title_it) ||
      title;
    const seoDescription =
      (lang === "en" ? seoOptimization?.description_en : seoOptimization?.description_it) ||
      (lang === "en" ? article.excerpt_en : article.excerpt_it || article.excerpt_en) ||
      DEFAULT_DESCRIPTION;
    const socialTitle =
      (lang === "en" ? seoOptimization?.social_title_en : seoOptimization?.social_title_it) ||
      seoTitle;
    const socialDescription =
      (lang === "en" ? seoOptimization?.social_description_en : seoOptimization?.social_description_it) ||
      seoDescription;
    const seoKeywords =
      (lang === "en" ? seoOptimization?.keywords_en : seoOptimization?.keywords_it) ||
      [];
    const authorNames = authors
      .map((author: any) => author?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    const inlineImages = [
      ...extractImagesFromRichContent(article.content_en as any),
      ...extractImagesFromRichContent(article.content_it as any),
    ];
    const imageUrls = Array.from(
      new Set([article.cover_image, ...inlineImages.map((image) => image.src)].filter((value): value is string => Boolean(value)))
    );

    applySeo({
      title: `${seoTitle} | BITE`,
      description: seoDescription,
      pathname: articlePathForLang(article as any, lang),
      localizedPaths: articleLocalizedPaths(article as any),
      image: article.cover_image,
      type: "article",
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          ...(seoOptimization?.structured_data && typeof seoOptimization.structured_data === "object"
            ? seoOptimization.structured_data
            : {}),
          headline: socialTitle,
          description: socialDescription,
          url: `${window.location.origin}/${lang}${articlePathForLang(article as any, lang)}`,
          mainEntityOfPage: `${window.location.origin}/${lang}${articlePathForLang(article as any, lang)}`,
          image: imageUrls.length ? imageUrls : undefined,
          datePublished: article.published_at || undefined,
          dateModified: article.published_at || undefined,
          articleSection: article.category || "Logbook",
          keywords: seoKeywords.length ? seoKeywords : tags.map((tag: any) => tag.name).filter(Boolean),
          author: authorNames.length
            ? authorNames.map((name) => ({
                "@type": "Person",
                name,
              }))
            : undefined,
          publisher: { "@id": ORGANIZATION_ID },
          isPartOf: { "@id": WEBSITE_ID },
          inLanguage: lang,
          associatedMedia: inlineImages.length
            ? inlineImages.map((image) => ({
                "@type": "ImageObject",
              contentUrl: image.src,
              url: image.src,
              caption: image.caption || image.alt || image.title || undefined,
              name: image.title || image.caption || image.alt || undefined,
            }))
            : undefined,
        },
      ],
    });
  }, [article, authors, lang, seoOptimization, tags, title]);

  useEffect(() => {
    if (!article) return;

    if (!localizedScenes.length) {
      setActiveSceneId(null);
      setMapCamera(hasGeo ? { latitude: article.latitude!, longitude: article.longitude!, zoom: 7 } : null);
      return;
    }

    const updateFromScroll = () => {
      const scenePositions = localizedScenes.map((scene) => {
        const anchorElement = scene.anchorId
          ? articleContentRef.current?.querySelector<HTMLElement>(`[data-map-scene-anchor-id="${scene.anchorId}"]`) ?? null
          : null;
        const anchorIndex = Math.min(scene.anchorIndex, Math.max(contentNodes.length - 1, 0));
        const fallbackElement = articleBlockRefs.current[anchorIndex];
        const top = anchorElement
          ? anchorElement.getBoundingClientRect().top + window.scrollY
          : fallbackElement
            ? fallbackElement.getBoundingClientRect().top + window.scrollY
            : window.scrollY;

        return { ...scene, top };
      });

      const currentY = window.scrollY + window.innerHeight * 0.34;

      if (scenePositions.length === 1) {
        const [scene] = scenePositions;
        setActiveSceneId(scene.id);
        setMapCamera({ latitude: scene.cameraLatitude, longitude: scene.cameraLongitude, zoom: scene.zoom });
        return;
      }

      if (currentY <= scenePositions[0].top) {
        const firstScene = scenePositions[0];
        setActiveSceneId(firstScene.id);
        setMapCamera({ latitude: firstScene.cameraLatitude, longitude: firstScene.cameraLongitude, zoom: firstScene.zoom });
        return;
      }

      const lastScene = scenePositions[scenePositions.length - 1];
      if (currentY >= lastScene.top) {
        setActiveSceneId(lastScene.id);
        setMapCamera({ latitude: lastScene.cameraLatitude, longitude: lastScene.cameraLongitude, zoom: lastScene.zoom });
        return;
      }

      for (let index = 0; index < scenePositions.length - 1; index += 1) {
        const currentScene = scenePositions[index];
        const nextScene = scenePositions[index + 1];

        if (currentY < currentScene.top || currentY > nextScene.top) continue;

        const span = Math.max(nextScene.top - currentScene.top, 1);
        const progress = Math.min(Math.max((currentY - currentScene.top) / span, 0), 1);
        const interpolate = (start: number, end: number) => start + (end - start) * progress;
        const nearestScene = progress < 0.5 ? currentScene : nextScene;

        setActiveSceneId(nearestScene.id);
        setMapCamera({
          latitude: interpolate(currentScene.cameraLatitude, nextScene.cameraLatitude),
          longitude: interpolate(currentScene.cameraLongitude, nextScene.cameraLongitude),
          zoom: interpolate(currentScene.zoom, nextScene.zoom),
        });
        return;
      }
    };

    let frameId = 0;
    const requestUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateFromScroll);
    };

    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("load", requestUpdate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      window.removeEventListener("load", requestUpdate);
    };
  }, [article, contentNodes.length, hasGeo, localizedScenes]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="animate-pulse space-y-4 w-full max-w-2xl px-6">
          <div className="h-8 bg-muted rounded w-3/4" />
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Article not found.</p>
          <Link to="/logbook" className="text-accent hover:text-foreground transition-colors text-sm">
            ← Back to Logbook
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ArticleReader
      article={article as any}
      authors={authors as any}
      tags={tags as any}
      story={story as any}
      storyChapters={storyChapters}
      linkedVoyage={linkedVoyage}
      linkedVoyageWaypoints={linkedVoyageWaypoints}
      lang={lang}
      focusCommentId={focusedCommentId}
      onCommentFocusHandled={handleCommentFocusHandled}
      shareUrl={shareUrl}
    />
  );
};

export default ArticlePage;
