import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { generateHTML } from "@tiptap/react";
import { format } from "date-fns";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, User } from "lucide-react";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";
import StickyEngagementBar from "@/components/StickyEngagementBar";
import ArticleSidebar from "@/components/ArticleSidebar";
import ArticleRelatedSection from "@/components/ArticleRelatedSection";
import ArticleVoyageMediaWidget from "@/components/ArticleVoyageMediaWidget";
import LazyArticleMapAside from "@/components/LazyArticleMapAside";
import LiveReadCounter from "@/components/LiveReadCounter";
import ProfileAvatar from "@/components/ProfileAvatar";
import { articleContentExtensions } from "@/lib/article-content";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import { sanitizeRichHtml } from "@/lib/sanitize-rich-html";
import { articlePathForLang, storyPathForLang } from "@/lib/article-slug";
import { getArticleInstagramStoryImage } from "@/lib/article-instagram-story";
import { supabase } from "@/integrations/supabase/client";
import {
  getLegRangeBetweenWaypoints,
  isVoyageBookableNow,
  type BookableLegAvailability,
} from "@/lib/booking-utils";
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
  type GeoArticle,
  type Voyage,
  type VoyageWaypoint,
} from "@/lib/voyage-utils";
import type { Language } from "@/lib/i18n";

export type ArticleReaderArticle = GeoArticle & {
  article_map_scenes?: unknown;
  category?: string | null;
  content_en?: unknown;
  content_it?: unknown;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  cover_image?: string | null;
  cover_zoom?: number | null;
  excerpt_en?: string | null;
  excerpt_it?: string | null;
  instagram_story_image_en?: string | null;
  instagram_story_image_it?: string | null;
  instagram_story_use_cover_en?: boolean | null;
  instagram_story_use_cover_it?: boolean | null;
  published_at?: string | null;
  story_id?: string | null;
  updated_at?: string | null;
  view_count?: number | null;
};

export type ArticleReaderStoryChapter = {
  id: string;
  slug: string;
  slug_it?: string | null;
  slug_en?: string | null;
  title_en: string;
  title_it: string;
  published_at: string | null;
};

type ArticleReaderAuthor = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

type ArticleReaderTag = {
  id: string;
  name: string;
};

type ArticleReaderStory = {
  id?: string;
  slug: string;
  slug_it?: string | null;
  slug_en?: string | null;
  title_en: string;
  title_it: string;
};

type ArticleReaderProps = {
  article: ArticleReaderArticle;
  authors?: ArticleReaderAuthor[];
  tags?: ArticleReaderTag[];
  story?: ArticleReaderStory | null;
  storyChapters?: ArticleReaderStoryChapter[];
  linkedVoyage?: Voyage | null;
  linkedVoyageWaypoints?: VoyageWaypoint[];
  lang: Language;
  focusCommentId?: string | null;
  onCommentFocusHandled?: () => void;
  previewMode?: boolean;
  previewLabel?: string;
  shareUrl?: string;
};

const ArticleReader = ({
  article,
  authors = [],
  tags = [],
  story = null,
  storyChapters = [],
  linkedVoyage = null,
  linkedVoyageWaypoints = [],
  lang,
  focusCommentId = null,
  onCommentFocusHandled,
  previewMode = false,
  previewLabel,
  shareUrl: providedShareUrl,
}: ArticleReaderProps) => {
  const articleBlockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const articleContentRef = useRef<HTMLDivElement | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [mapCamera, setMapCamera] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);

  const storyId = article.story_id;
  const articleRouteSegment = useMemo(() => {
    if (!article || linkedVoyageWaypoints.length === 0) return null;
    return resolveArticleRouteRange(article as GeoArticle, linkedVoyageWaypoints);
  }, [article, linkedVoyageWaypoints]);
  const shouldLoadBookingAvailability = Boolean(
    article.voyage_id &&
      linkedVoyage &&
      linkedVoyageWaypoints.length >= 2 &&
      isVoyageBookableNow(linkedVoyage)
  );
  const { data: voyageBookingLegs = [] } = useQuery({
    queryKey: ["article-public-voyage-leg-availability", article.voyage_id],
    enabled: shouldLoadBookingAvailability,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_voyage_leg_availability", {
        _voyage_ids: [article.voyage_id!],
      });
      if (error) {
        console.warn("[ArticleReader] get_public_voyage_leg_availability unavailable", error);
        return [] as BookableLegAvailability[];
      }
      return ((data || []) as BookableLegAvailability[]).sort((a, b) => a.sort_order - b.sort_order);
    },
    staleTime: 1000 * 30,
  });

  const articleWaypointsMap = useMemo(() => {
    const vid = article.voyage_id;
    if (!vid || linkedVoyageWaypoints.length === 0) return {} as Record<string, VoyageWaypoint[]>;
    return { [vid]: linkedVoyageWaypoints };
  }, [article.voyage_id, linkedVoyageWaypoints]);

  const articleDisplayLocation = useMemo(
    () => getArticleDisplayLocationLabel(article as GeoArticle, articleWaypointsMap, lang),
    [article, articleWaypointsMap, lang]
  );

  const chapterPrevNext = useMemo(() => {
    if (!article.id || !storyChapters.length) return { prev: null as ArticleReaderStoryChapter | null, next: null as ArticleReaderStoryChapter | null };
    const idx = storyChapters.findIndex((chapter) => chapter.id === article.id);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? storyChapters[idx - 1] : null,
      next: idx < storyChapters.length - 1 ? storyChapters[idx + 1] : null,
    };
  }, [article.id, storyChapters]);

  const coverFocal = useMemo(
    () => clampCoverFocal(Number(article.cover_focal_x ?? 50), Number(article.cover_focal_y ?? 50), Number(article.cover_zoom ?? 1)),
    [article.cover_focal_x, article.cover_focal_y, article.cover_zoom]
  );

  const hasGeo = Boolean(
    typeof article.latitude === "number" &&
      typeof article.longitude === "number" &&
      !Number.isNaN(article.latitude) &&
      !Number.isNaN(article.longitude)
  );
  const articleScenes = useMemo(() => normalizeArticleMapScenes(article.article_map_scenes), [article.article_map_scenes]);
  const title = lang === "en" ? article.title_en : article.title_it || article.title_en;
  const content = lang === "en" ? article.content_en : article.content_it || article.content_en;
  const contentNodes = useMemo(() => {
    if (!content || typeof content !== "object" || !Array.isArray((content as any).content)) return [];
    return (content as any).content as Record<string, unknown>[];
  }, [content]);
  const hasStructuredContent = Boolean(content && typeof content === "object" && Object.keys(content).length > 0);
  let contentRenderFailed = false;
  let htmlContent = "";

  if (hasStructuredContent) {
    try {
      htmlContent = sanitizeRichHtml(generateHTML(content as Parameters<typeof generateHTML>[0], articleContentExtensions));
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
        overlays: scene.overlays.map((overlay) => ({ ...overlay, label: getArticleOverlayLabel(overlay, lang) })),
      }];
    });
  }, [articleScenes, lang]);

  const primaryRouteCoordinates = useMemo(() => {
    if (!article.voyage_id || !linkedVoyage || linkedVoyageWaypoints.length < 2) return null;
    const geometrySource = linkedVoyage.cached_geometry as { coordinates?: [number, number][] } | null;
    const cachedGeometry = Array.isArray(geometrySource?.coordinates) ? geometrySource.coordinates : undefined;

    if (articleRouteSegment) {
      const [start, end] = articleRouteSegment;
      const segmentGeometry = buildVoyageSegmentGeometry(linkedVoyageWaypoints, linkedVoyage.type, start, end, cachedGeometry);
      return segmentGeometry.length >= 2 ? segmentGeometry : null;
    }

    return buildPublicVoyageGeometry(linkedVoyageWaypoints, linkedVoyage.type, [], linkedVoyage.id, cachedGeometry);
  }, [article.voyage_id, articleRouteSegment, linkedVoyage, linkedVoyageWaypoints]);

  const articleRouteDistance = useMemo(() => {
    if (!article.voyage_id || linkedVoyageWaypoints.length < 2) return null;
    let relevantWaypoints = linkedVoyageWaypoints;
    let relevantGeometry = primaryRouteCoordinates;
    if (articleRouteSegment) {
      const [safeStart, safeEnd] = articleRouteSegment;
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
  }, [article.voyage_id, articleRouteSegment, linkedVoyage, linkedVoyageWaypoints, primaryRouteCoordinates]);

  const articleVoyageMediaItems = useMemo(() => {
    if (!article.voyage_id || linkedVoyageWaypoints.length === 0) return [];
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
  }, [article.voyage_id, articleRouteSegment, lang, linkedVoyageWaypoints]);
  const availableBookingLegsForArticle = useMemo(() => {
    if (!shouldLoadBookingAvailability || voyageBookingLegs.length === 0) return [];
    let relevantLegs = voyageBookingLegs;

    if (articleRouteSegment && articleRouteSegment[0] !== articleRouteSegment[1]) {
      const [startIndex, endIndex] = articleRouteSegment;
      const fromWaypointId = linkedVoyageWaypoints[startIndex]?.id;
      const toWaypointId = linkedVoyageWaypoints[endIndex]?.id;
      if (!fromWaypointId || !toWaypointId) return [];

      const waypointIds = linkedVoyageWaypoints.map((waypoint) => waypoint.id);
      relevantLegs = getLegRangeBetweenWaypoints(waypointIds, voyageBookingLegs, fromWaypointId, toWaypointId);
    }

    return relevantLegs.filter((leg) => leg.available && leg.remaining > 0);
  }, [articleRouteSegment, linkedVoyageWaypoints, shouldLoadBookingAvailability, voyageBookingLegs]);
  const bookingCta = useMemo(() => {
    if (!article.voyage_id || availableBookingLegsForArticle.length === 0) return null;
    const count = availableBookingLegsForArticle.length;
    return {
      href: `/bookings?voyage=${encodeURIComponent(article.voyage_id)}`,
      label: lang === "it" ? "Partecipa" : "Join",
      description:
        lang === "it"
          ? `${count} ${count === 1 ? "tratto ancora selezionabile" : "tratti ancora selezionabili"}`
          : `${count} ${count === 1 ? "leg is still selectable" : "legs are still selectable"}`,
    };
  }, [article.voyage_id, availableBookingLegsForArticle.length, lang]);

  const fallbackSceneCoordinates = useMemo(() => {
    if (hasGeo) return { latitude: article.latitude!, longitude: article.longitude! };
    if (primaryRouteCoordinates && primaryRouteCoordinates.length > 0) {
      const middleCoordinate = primaryRouteCoordinates[Math.floor(primaryRouteCoordinates.length / 2)];
      return { longitude: middleCoordinate[0], latitude: middleCoordinate[1] };
    }
    return null;
  }, [article.latitude, article.longitude, hasGeo, primaryRouteCoordinates]);

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
  const dateLabel = article.published_at ? format(new Date(article.published_at), dateFmt) : null;
  const views = Number(article.view_count ?? 0);
  const coverStyle = article.cover_image ? coverImageStyle(article.cover_image, coverFocal) : undefined;
  const instagramStoryImage = getArticleInstagramStoryImage(article, lang);
  const shareUrl = providedShareUrl ?? (typeof window === "undefined" ? "" : window.location.href);
  const prevTitle = chapterPrevNext.prev ? (lang === "en" ? chapterPrevNext.prev.title_en : chapterPrevNext.prev.title_it || chapterPrevNext.prev.title_en) : "";
  const nextTitle = chapterPrevNext.next ? (lang === "en" ? chapterPrevNext.next.title_en : chapterPrevNext.next.title_it || chapterPrevNext.next.title_en) : "";

  useEffect(() => {
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
      if (scenePositions.length === 1 || currentY <= scenePositions[0].top) {
        const scene = scenePositions[0];
        setActiveSceneId(scene.id);
        setMapCamera({ latitude: scene.cameraLatitude, longitude: scene.cameraLongitude, zoom: scene.zoom });
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
  }, [article.latitude, article.longitude, contentNodes.length, hasGeo, localizedScenes]);

  return (
    <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
      {previewLabel && (
        <div className="mx-4 mt-4 rounded border border-dashed border-accent/50 bg-accent/10 px-4 py-2 text-xs font-sans tracking-wide text-accent md:mx-6">
          {previewLabel}
        </div>
      )}

      {article.cover_image && (
        <section className="relative h-[42vh] md:h-[52vh] overflow-hidden mt-24 mx-4 md:mx-6 glass-frame rounded-[36px] p-2">
          <div className="relative h-full overflow-hidden rounded-[30px]">
            <img src={article.cover_image} alt="" className="absolute inset-0 w-full max-w-none pointer-events-none" style={coverStyle} />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(12,20,31,0.72)] via-[rgba(12,20,31,0.18)] to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 lg:px-20 pb-10 md:pb-14">
              <div className="max-w-4xl">
                <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl text-white [text-shadow:0_10px_34px_rgba(0,0,0,0.34)]">{title}</h1>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="page-section !pt-4 md:!pt-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-10 lg:gap-12">
            <article className="min-w-0 glass-panel rounded-[34px] p-6 md:p-8 lg:p-10">
              <Link to="/logbook" className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
                <ArrowLeft size={14} /> {lang === "it" ? "Torna al diario" : "Back to Logbook"}
              </Link>

              {!article.cover_image && <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-8">{title}</h1>}

              {story && (
                <Link to={storyPathForLang(story as any, lang)} className="glass-panel-soft flex items-center gap-3 mb-6 p-4 rounded-[24px] hover:border-accent transition-colors group">
                  <BookOpen size={16} className="text-accent flex-shrink-0" />
                  <div>
                    <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">{lang === "it" ? "Parte della storia" : "Part of story"}</span>
                    <p className="editorial-heading text-sm group-hover:text-accent transition-colors">{lang === "en" ? story.title_en : story.title_it || story.title_en}</p>
                  </div>
                </Link>
              )}

              {story && (chapterPrevNext.prev || chapterPrevNext.next) && (
                <nav className="flex flex-col sm:flex-row sm:items-stretch gap-3 mb-8" aria-label={lang === "it" ? "Navigazione capitoli" : "Chapter navigation"}>
                  {chapterPrevNext.prev ? (
                    <Link to={articlePathForLang(chapterPrevNext.prev as any, lang)} title={prevTitle} className="glass-panel-soft rounded-[24px] flex-1 inline-flex items-center gap-2 px-4 py-3 text-sm font-sans text-foreground hover:border-accent transition-colors">
                      <ChevronLeft size={18} className="shrink-0 text-accent" />
                      <span className="min-w-0"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{lang === "it" ? "Precedente" : "Previous"}</span><span className="block line-clamp-2 leading-snug">{prevTitle}</span></span>
                    </Link>
                  ) : <div className="flex-1 hidden sm:block" aria-hidden />}
                  {chapterPrevNext.next ? (
                    <Link to={articlePathForLang(chapterPrevNext.next as any, lang)} title={nextTitle} className="glass-panel-soft rounded-[24px] flex-1 inline-flex items-center justify-end gap-2 px-4 py-3 text-sm font-sans text-foreground hover:border-accent transition-colors sm:text-right">
                      <span className="min-w-0 order-2 sm:order-1"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:text-right">{lang === "it" ? "Successivo" : "Next"}</span><span className="block line-clamp-2 leading-snug sm:text-right">{nextTitle}</span></span>
                      <ChevronRight size={18} className="shrink-0 text-accent order-1 sm:order-2" />
                    </Link>
                  ) : null}
                </nav>
              )}

              <div className="glass-panel-soft rounded-[26px] flex flex-wrap items-center gap-3 p-4 md:p-5 mb-8">
                {authors.map((author) => (
                  <Link key={author.id} to={`/profile/${author.id}`} className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-sans text-foreground hover:text-accent transition-colors">
                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-white/70">
                      <ProfileAvatar name={author.name || "Anonymous"} avatarUrl={author.avatar_url || undefined} imgClassName="h-full w-full object-cover" fallback={<User size={12} className="text-muted-foreground" />} />
                    </span>
                    <span>{author.name}</span>
                  </Link>
                ))}
                {dateLabel && <span className="glass-chip inline-flex items-center px-3 py-2 text-xs font-sans text-muted-foreground">{lang === "it" ? "Pubblicato il " : "Published "}<time className="ml-1" dateTime={article.published_at || undefined}>{dateLabel}</time></span>}
                <LiveReadCounter count={views} lang={lang} />
              </div>

              {contentNodes.length > 0 && (
                <div className="glass-panel-soft rounded-[30px] p-5 md:p-7">
                  <div ref={articleContentRef} className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-blockquote:font-serif prose-blockquote:italic">
                    {contentNodes.map((node, index) => {
                      const blockHtml = sanitizeRichHtml(generateHTML({ type: "doc", content: [node] } as Parameters<typeof generateHTML>[0], articleContentExtensions));
                      return <div key={`article-block-${index}`} ref={(element) => { articleBlockRefs.current[index] = element; }} data-article-block-index={index} dangerouslySetInnerHTML={{ __html: blockHtml }} />;
                    })}
                  </div>
                </div>
              )}
              {contentNodes.length === 0 && htmlContent && (
                <div className="glass-panel-soft rounded-[30px] p-5 md:p-7">
                  <div className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-blockquote:font-serif prose-blockquote:italic" dangerouslySetInnerHTML={{ __html: htmlContent }} />
                </div>
              )}
              {contentRenderFailed && <p className="text-sm font-sans text-muted-foreground">{lang === "it" ? "Il contenuto di questo articolo non puo essere mostrato al momento." : "This article content cannot be displayed right now."}</p>}

              <div id="article-engagement-panel" className="glass-panel-soft rounded-[24px] flex items-center gap-6 mt-12 p-4 md:p-5 scroll-mt-28">
                {previewMode ? (
                  <span className="text-sm font-sans text-muted-foreground">{lang === "it" ? "Area like, condivisione e commenti" : "Like, share and comments area"}</span>
                ) : (
                  <>
                    <LikeButton articleId={article.id} />
                    <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImage} />
                  </>
                )}
              </div>

              {previewMode ? (
                <div className="mt-8 rounded-[24px] border border-dashed border-border p-5 text-sm font-sans text-muted-foreground">
                  {lang === "it" ? "I commenti saranno disponibili sull'articolo pubblicato." : "Comments will be available on the published article."}
                </div>
              ) : (
                <CommentSection articleId={article.id} focusCommentId={focusCommentId} onFocusHandled={onCommentFocusHandled} />
              )}

              {tags.length > 0 && (
                <footer className="mt-14">
                  <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">{lang === "it" ? "Hashtag" : "Tags"}</p>
                  <div className="glass-panel-soft rounded-[24px] flex flex-wrap gap-2 p-4">
                    {tags.map((tag) => <span key={tag.id} className="glass-chip text-xs font-sans px-2.5 py-1 text-muted-foreground">#{tag.name}</span>)}
                  </div>
                </footer>
              )}
            </article>

            <aside className="min-w-0 space-y-8">
              <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1 space-y-8">
                {shouldShowMapWidget && (
                  <LazyArticleMapAside
                    latitude={fallbackSceneCoordinates?.latitude ?? article.latitude ?? 0}
                    longitude={fallbackSceneCoordinates?.longitude ?? article.longitude ?? 0}
                    title={title}
                    scenes={effectiveScenes}
                    activeSceneId={activeSceneId ?? effectiveScenes[0]?.id ?? null}
                    camera={mapCamera ?? (fallbackSceneCoordinates ? { latitude: fallbackSceneCoordinates.latitude, longitude: fallbackSceneCoordinates.longitude, zoom: hasGeo ? 7 : 6 } : null)}
                    primaryRouteCoordinates={primaryRouteCoordinates}
                    distanceValue={articleRouteDistance?.value ?? null}
                    distanceUnit={articleRouteDistance?.unit ?? null}
                    bookingCta={bookingCta}
                  />
                )}
                {articleVoyageMediaItems.length > 0 && <ArticleVoyageMediaWidget items={articleVoyageMediaItems} lang={lang} />}
                {!previewMode && <ArticleSidebar currentArticleId={article.id} storyId={storyId ?? null} />}
              </div>
            </aside>
          </div>

          {!previewMode && <ArticleRelatedSection articleId={article.id} tagIds={tags.map((tag) => tag.id)} lang={lang} />}
        </div>
      </div>

      {!previewMode && (
        <StickyEngagementBar
          articleId={article.id}
          lang={lang}
          title={title}
          shareUrl={shareUrl}
          instagramStoryImageUrl={instagramStoryImage}
        />
      )}
    </div>
  );
};

export default ArticleReader;
