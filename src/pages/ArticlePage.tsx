import { useParams, Link, useSearchParams } from "react-router-dom";
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
import { useQualifiedArticleRead, useSyncArticleViewCount } from "@/hooks/useArticleReads";
import { useEffect, useMemo, useRef, useState } from "react";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import LiveReadCounter from "@/components/LiveReadCounter";
import { articleContentExtensions } from "@/lib/article-content";
import ProfileAvatar from "@/components/ProfileAvatar";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";
import LazyArticleMapAside from "@/components/LazyArticleMapAside";
import { extractImagesFromRichContent } from "@/lib/content-images";
import { getArticleInstagramStoryImage } from "@/lib/article-instagram-story";
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
  title_en: string;
  title_it: string;
  published_at: string | null;
};

const ArticlePage = () => {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang } = useI18n();
  const articleBlockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const articleContentRef = useRef<HTMLDivElement | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [mapCamera, setMapCamera] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);
  const focusedCommentId = searchParams.get("comment");
  const focusTarget = searchParams.get("focus");

  const { data: article, isLoading } = useQuery({
    queryKey: ["article", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const storyId = (article as any)?.story_id as string | null | undefined;
  useQualifiedArticleRead(article?.id ?? null, slug);
  useSyncArticleViewCount(article?.id ?? null, slug);

  const { data: storyChapters = [] } = useQuery({
    queryKey: ["story-chapters-published", storyId],
    enabled: Boolean(storyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("id, slug, title_en, title_it, published_at")
        .eq("story_id", storyId!)
        .eq("status", "published")
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

    const seoDescription =
      (lang === "en" ? article.excerpt_en : article.excerpt_it || article.excerpt_en) ||
      DEFAULT_DESCRIPTION;
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
      title: `${title} | BITE`,
      description: seoDescription,
      pathname: `/logbook/${article.slug}`,
      image: article.cover_image,
      type: "article",
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: title,
          description: seoDescription,
          url: `${window.location.origin}/logbook/${article.slug}`,
          mainEntityOfPage: `${window.location.origin}/logbook/${article.slug}`,
          image: imageUrls.length ? imageUrls : undefined,
          datePublished: article.published_at || undefined,
          dateModified: article.updated_at || article.published_at || undefined,
          articleSection: article.category || "Logbook",
          keywords: tags.map((tag: any) => tag.name).filter(Boolean),
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
  }, [article, authors, lang, tags, title]);

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
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      {article.cover_image && (
        <section className="relative h-[42vh] md:h-[52vh] overflow-hidden mt-24 mx-4 md:mx-6 glass-frame rounded-[36px] p-2">
          <div className="relative h-full overflow-hidden rounded-[30px]">
            <img
              src={article.cover_image}
              alt=""
              className="absolute inset-0 w-full max-w-none pointer-events-none"
              style={coverStyle}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(12,20,31,0.72)] via-[rgba(12,20,31,0.18)] to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 lg:px-20 pb-10 md:pb-14">
              <div className="max-w-4xl">
                <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl text-white [text-shadow:0_10px_34px_rgba(0,0,0,0.34)]">
                  {title}
                </h1>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="page-section !pt-4 md:!pt-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-10 lg:gap-12">
            <article className="min-w-0 glass-panel rounded-[34px] p-6 md:p-8 lg:p-10">
              <Link
                to="/logbook"
                className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
              >
                <ArrowLeft size={14} /> {lang === "it" ? "Torna al diario" : "Back to Logbook"}
              </Link>

              {!article.cover_image && (
                <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-8">{title}</h1>
              )}

              {story && (
                <Link
                  to={`/logbook/story/${story.slug}`}
                  className="glass-panel-soft flex items-center gap-3 mb-6 p-4 rounded-[24px] hover:border-accent transition-colors group"
                >
                  <BookOpen size={16} className="text-accent flex-shrink-0" />
                  <div>
                    <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                      {lang === "it" ? "Parte della storia" : "Part of story"}
                    </span>
                    <p className="editorial-heading text-sm group-hover:text-accent transition-colors">
                      {lang === "en" ? story.title_en : (story.title_it || story.title_en)}
                    </p>
                  </div>
                </Link>
              )}

              {story && (chapterPrevNext.prev || chapterPrevNext.next) && (
                <nav
                  className="flex flex-col sm:flex-row sm:items-stretch gap-3 mb-8"
                  aria-label={lang === "it" ? "Navigazione capitoli" : "Chapter navigation"}
                >
                  {chapterPrevNext.prev ? (
                    <Link
                      to={`/logbook/${chapterPrevNext.prev.slug}`}
                      title={prevTitle}
                      className="glass-panel-soft rounded-[24px] flex-1 inline-flex items-center gap-2 px-4 py-3 text-sm font-sans text-foreground hover:border-accent transition-colors"
                    >
                      <ChevronLeft size={18} className="shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                          {lang === "it" ? "Precedente" : "Previous"}
                        </span>
                        <span className="block line-clamp-2 leading-snug">{prevTitle}</span>
                      </span>
                    </Link>
                  ) : (
                    <div className="flex-1 hidden sm:block" aria-hidden />
                  )}
                  {chapterPrevNext.next ? (
                    <Link
                      to={`/logbook/${chapterPrevNext.next.slug}`}
                      title={nextTitle}
                      className="glass-panel-soft rounded-[24px] flex-1 inline-flex items-center justify-end gap-2 px-4 py-3 text-sm font-sans text-foreground hover:border-accent transition-colors sm:text-right"
                    >
                      <span className="min-w-0 order-2 sm:order-1">
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:text-right">
                          {lang === "it" ? "Successivo" : "Next"}
                        </span>
                        <span className="block line-clamp-2 leading-snug sm:text-right">{nextTitle}</span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-accent order-1 sm:order-2" />
                    </Link>
                  ) : null}
                </nav>
              )}

              <div className="glass-panel-soft rounded-[26px] flex flex-wrap items-center gap-3 p-4 md:p-5 mb-8">
                  {authors.map((author: any) => (
                    <Link
                      key={author.id}
                      to={`/profile/${author.id}`}
                      className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-sans text-foreground hover:text-accent transition-colors"
                    >
                      <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-white/70">
                        <ProfileAvatar
                          name={author.name || "Anonymous"}
                          avatarUrl={author.avatar_url || undefined}
                          imgClassName="h-full w-full object-cover"
                          fallback={<User size={12} className="text-muted-foreground" />}
                        />
                      </span>
                      <span>{author.name}</span>
                    </Link>
                  ))}
                  {dateLabel && (
                    <span className="glass-chip inline-flex items-center px-3 py-2 text-xs font-sans text-muted-foreground">
                      {lang === "it" ? "Pubblicato il " : "Published "}
                      <time className="ml-1" dateTime={article.published_at || undefined}>{dateLabel}</time>
                    </span>
                  )}
                <LiveReadCounter count={views} lang={lang} />
              </div>

              {contentNodes.length > 0 && (
                <div className="glass-panel-soft rounded-[30px] p-5 md:p-7">
                  <div ref={articleContentRef} className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-blockquote:font-serif prose-blockquote:italic">
                    {contentNodes.map((node, index) => {
                      const blockHtml = sanitizeRichHtml(
                        generateHTML(
                          { type: "doc", content: [node] } as Parameters<typeof generateHTML>[0],
                          articleContentExtensions
                        )
                      );

                      return (
                        <div
                          key={`article-block-${index}`}
                          ref={(element) => {
                            articleBlockRefs.current[index] = element;
                          }}
                          data-article-block-index={index}
                          dangerouslySetInnerHTML={{ __html: blockHtml }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {contentNodes.length === 0 && htmlContent && (
                <div className="glass-panel-soft rounded-[30px] p-5 md:p-7">
                  <div
                    className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-blockquote:font-serif prose-blockquote:italic"
                    dangerouslySetInnerHTML={{ __html: htmlContent }}
                  />
                </div>
              )}
              {contentRenderFailed && (
                <p className="text-sm font-sans text-muted-foreground">
                  {lang === "it"
                    ? "Il contenuto di questo articolo non puo essere mostrato al momento."
                    : "This article content cannot be displayed right now."}
                </p>
              )}

              <div
                id="article-engagement-panel"
                className="glass-panel-soft rounded-[24px] flex items-center gap-6 mt-12 p-4 md:p-5 scroll-mt-28"
              >
                <LikeButton articleId={article.id} />
                <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImage} />
              </div>

              <CommentSection
                articleId={article.id}
                focusCommentId={focusedCommentId}
                onFocusHandled={handleCommentFocusHandled}
              />

              {tags.length > 0 && (
                <footer className="mt-14">
                  <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                    {lang === "it" ? "Hashtag" : "Tags"}
                  </p>
                  <div className="glass-panel-soft rounded-[24px] flex flex-wrap gap-2 p-4">
                    {tags.map((tag: any) => (
                      <span
                        key={tag.id}
                        className="glass-chip text-xs font-sans px-2.5 py-1 text-muted-foreground"
                      >
                        #{tag.name}
                      </span>
                    ))}
                  </div>
                </footer>
              )}
            </article>

            <aside className="min-w-0 space-y-8">
              {shouldShowMapWidget && (
                <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1 space-y-8">
                  <LazyArticleMapAside
                    latitude={fallbackSceneCoordinates?.latitude ?? article.latitude ?? 0}
                    longitude={fallbackSceneCoordinates?.longitude ?? article.longitude ?? 0}
                    title={title}
                    scenes={effectiveScenes}
                    activeSceneId={activeSceneId ?? effectiveScenes[0]?.id ?? null}
                    camera={mapCamera ?? (fallbackSceneCoordinates ? {
                      latitude: fallbackSceneCoordinates.latitude,
                      longitude: fallbackSceneCoordinates.longitude,
                      zoom: hasGeo ? 7 : 6,
                    } : null)}
                    primaryRouteCoordinates={primaryRouteCoordinates}
                    distanceValue={articleRouteDistance?.value ?? null}
                    distanceUnit={articleRouteDistance?.unit ?? null}
                  />
                  {articleVoyageMediaItems.length > 0 && (
                    <ArticleVoyageMediaWidget items={articleVoyageMediaItems} lang={lang} />
                  )}
                  <div>
                    <ArticleSidebar currentArticleId={article.id} storyId={storyId ?? null} />
                  </div>
                </div>
              )}
              {!shouldShowMapWidget && (
                <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
                  {articleVoyageMediaItems.length > 0 && (
                    <div className="mb-8">
                      <ArticleVoyageMediaWidget items={articleVoyageMediaItems} lang={lang} />
                    </div>
                  )}
                  <ArticleSidebar currentArticleId={article.id} storyId={storyId ?? null} />
                </div>
              )}
            </aside>
          </div>

          <ArticleRelatedSection articleId={article.id} tagIds={tags.map((t: any) => t.id)} lang={lang} />
        </div>
      </div>
    </div>
  );
};

export default ArticlePage;
