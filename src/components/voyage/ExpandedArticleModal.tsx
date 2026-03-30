import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { generateHTML } from "@tiptap/react";
import { Link } from "react-router-dom";
import { ArrowLeft, MapPin, User, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";
import LiveReadCounter from "@/components/LiveReadCounter";
import { useQualifiedArticleRead, useSyncArticleViewCount } from "@/hooks/useArticleReads";
import { articleContentExtensions } from "@/lib/article-content";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import ProfileAvatar from "@/components/ProfileAvatar";
import LazyArticleMapAside from "@/components/LazyArticleMapAside";
import {
  getArticleSceneAnchorIndex,
  getArticleSceneDescription,
  getArticleSceneTitle,
  getArticleSceneWindLabel,
  normalizeArticleMapScenes,
  sortArticleMapScenesForLanguage,
} from "@/lib/article-map";

export type ExpandedArticleOrigin = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
};

type ExpandedArticleModalProps = {
  slug: string | null;
  lang: "it" | "en";
  originRect: ExpandedArticleOrigin | null;
  phase: "opening" | "open" | "closing";
  previewAuthors?: Array<{ id: string; name: string; avatar_url: string | null }>;
  onClose: () => void;
};

const ANIMATION_MS = 480;
const ANIMATION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

const getViewportRect = () => ({
  width: typeof window === "undefined" ? 1440 : window.innerWidth,
  height: typeof window === "undefined" ? 900 : window.innerHeight,
});

const buildTargetRect = (viewportWidth: number, viewportHeight: number): ExpandedArticleOrigin => {
  const inset = viewportWidth >= 1024 ? 28 : viewportWidth >= 768 ? 20 : 12;
  const width = Math.min(1180, Math.max(320, viewportWidth - inset * 2));
  const height = Math.max(420, viewportHeight - inset * 2);

  return {
    top: inset,
    left: (viewportWidth - width) / 2,
    width,
    height,
    borderRadius: viewportWidth >= 768 ? 36 : 30,
  };
};

const ExpandedArticleModal = ({ slug, lang, originRect, phase, previewAuthors = [], onClose }: ExpandedArticleModalProps) => {
  const [viewport, setViewport] = useState(getViewportRect);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const articleBlockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [mapCamera, setMapCamera] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null);

  const { data: article, isLoading } = useQuery({
    queryKey: ["article", slug],
    enabled: Boolean(slug),
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

  useQualifiedArticleRead(article?.id ?? null, slug ?? undefined);
  useSyncArticleViewCount(article?.id ?? null, slug ?? undefined);

  const { data: authors = [] } = useQuery({
    queryKey: ["article-authors", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const { data: authorLinks } = await supabase
        .from("article_authors")
        .select("profile_id")
        .eq("article_id", article!.id);

      if (!authorLinks?.length) return [];

      const ids = authorLinks.map((entry) => entry.profile_id);
      const { data: profiles } = await supabase
        .from("profiles")
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

      return (data || [])
        .map((entry: { tags: { id: string; name: string } | null }) => entry.tags)
        .filter((tag): tag is { id: string; name: string } => Boolean(tag));
    },
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const handleResize = () => setViewport(getViewportRect());

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose]);

  const targetRect = useMemo(
    () => buildTargetRect(viewport.width, viewport.height),
    [viewport.height, viewport.width]
  );

  const overlayOpacity = phase === "closing" ? 0 : phase === "open" ? 1 : 0;
  const contentVisible = phase === "open";
  const startRect = originRect || targetRect;
  const scaleX = startRect.width / targetRect.width;
  const scaleY = startRect.height / targetRect.height;
  const translateX = startRect.left - targetRect.left;
  const translateY = startRect.top - targetRect.top;
  const shellTransform = phase === "open"
    ? "translate3d(0px, 0px, 0px) scale(1, 1)"
    : `translate3d(${translateX}px, ${translateY}px, 0px) scale(${scaleX}, ${scaleY})`;
  const shellBorderRadius = phase === "open" ? targetRect.borderRadius : startRect.borderRadius;
  const resolvedAuthors = authors.length > 0 ? authors : previewAuthors;

  const title = article
    ? lang === "en"
      ? article.title_en
      : article.title_it || article.title_en
    : "";
  const excerpt = article
    ? lang === "en"
      ? article.excerpt_en
      : article.excerpt_it || article.excerpt_en
    : "";
  const content = article
    ? lang === "en"
      ? article.content_en
      : article.content_it || article.content_en
    : null;
  const contentNodes = useMemo(() => {
    if (!content || typeof content !== "object" || !Array.isArray((content as { content?: unknown[] }).content)) return [];
    return (content as { content: Record<string, unknown>[] }).content;
  }, [content]);
  const dateLabel = article?.published_at
    ? format(new Date(article.published_at), lang === "it" ? "d MMMM yyyy" : "MMMM d, yyyy")
    : null;
  const views = Number(article?.view_count ?? 0);
  const coverFocal = useMemo(
    () =>
      clampCoverFocal(
        Number(article?.cover_focal_x ?? 50),
        Number(article?.cover_focal_y ?? 50),
        Number(article?.cover_zoom ?? 1)
      ),
    [article?.cover_focal_x, article?.cover_focal_y, article?.cover_zoom]
  );
  const coverStyle = article?.cover_image ? coverImageStyle(article.cover_image, coverFocal) : undefined;
  const hasGeo = Boolean(
    article &&
      typeof article.latitude === "number" &&
      typeof article.longitude === "number" &&
      !Number.isNaN(article.latitude) &&
      !Number.isNaN(article.longitude)
  );
  const articleScenes = useMemo(
    () => normalizeArticleMapScenes((article as { article_map_scenes?: unknown } | null)?.article_map_scenes),
    [article]
  );
  const localizedScenes = useMemo(() => {
    const sortedScenes = sortArticleMapScenesForLanguage(articleScenes, lang);
    return sortedScenes.map((scene) => ({
      id: scene.id,
      title: getArticleSceneTitle(scene, lang),
      description: getArticleSceneDescription(scene, lang),
      windLabel: getArticleSceneWindLabel(scene, lang),
      latitude: scene.latitude as number,
      longitude: scene.longitude as number,
      zoom: scene.zoom,
      windAngle: scene.wind_angle,
      anchorIndex: getArticleSceneAnchorIndex(scene, lang),
    }));
  }, [articleScenes, lang]);

  const { htmlContent, contentRenderFailed } = useMemo(() => {
    const hasStructuredContent = Boolean(
      content && typeof content === "object" && Object.keys(content as Record<string, unknown>).length > 0
    );

    if (!hasStructuredContent) {
      return { htmlContent: "", contentRenderFailed: false };
    }

    try {
      return {
        htmlContent: generateHTML(content as Parameters<typeof generateHTML>[0], articleContentExtensions),
        contentRenderFailed: false,
      };
    } catch (error) {
      console.error("Failed to render article content", error);
      return { htmlContent: "", contentRenderFailed: true };
    }
  }, [content]);

  useEffect(() => {
    if (!article || !scrollContainerRef.current) return;

    if (!localizedScenes.length) {
      setActiveSceneId(null);
      setMapCamera(hasGeo ? { latitude: article.latitude!, longitude: article.longitude!, zoom: 7 } : null);
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    let frameId = 0;

    const updateFromScroll = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const scenePositions = localizedScenes.map((scene) => {
        const anchorIndex = Math.min(scene.anchorIndex, Math.max(contentNodes.length - 1, 0));
        const anchorElement = articleBlockRefs.current[anchorIndex];
        const top = anchorElement
          ? anchorElement.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop
          : scrollContainer.scrollTop;

        return { ...scene, top };
      });

      const currentY = scrollContainer.scrollTop + scrollContainer.clientHeight * 0.34;

      if (scenePositions.length === 1) {
        const [scene] = scenePositions;
        setActiveSceneId(scene.id);
        setMapCamera({ latitude: scene.latitude, longitude: scene.longitude, zoom: scene.zoom });
        return;
      }

      if (currentY <= scenePositions[0].top) {
        const firstScene = scenePositions[0];
        setActiveSceneId(firstScene.id);
        setMapCamera({ latitude: firstScene.latitude, longitude: firstScene.longitude, zoom: firstScene.zoom });
        return;
      }

      const lastScene = scenePositions[scenePositions.length - 1];
      if (currentY >= lastScene.top) {
        setActiveSceneId(lastScene.id);
        setMapCamera({ latitude: lastScene.latitude, longitude: lastScene.longitude, zoom: lastScene.zoom });
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
          latitude: interpolate(currentScene.latitude, nextScene.latitude),
          longitude: interpolate(currentScene.longitude, nextScene.longitude),
          zoom: interpolate(currentScene.zoom, nextScene.zoom),
        });
        return;
      }
    };

    const requestUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateFromScroll);
    };

    requestUpdate();
    scrollContainer.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      cancelAnimationFrame(frameId);
      scrollContainer.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [article, contentNodes.length, hasGeo, localizedScenes]);

  const shareUrl = useMemo(() => {
    if (!slug || typeof window === "undefined") return "";

    const nextUrl = new URL(`/logbook/${slug}`, window.location.origin);
    nextUrl.searchParams.set("lang", lang);
    return nextUrl.toString();
  }, [lang, slug]);

  const instagramStoryImage = article?.cover_image ?? null;

  if (!slug) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/28 backdrop-blur-xl"
        style={{
          opacity: overlayOpacity,
          transition: `opacity ${ANIMATION_MS}ms ${ANIMATION_EASING}`,
        }}
        onClick={phase === "open" ? onClose : undefined}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={lang === "it" ? "Articolo completo" : "Full article"}
        className="fixed z-[71] overflow-hidden border border-black/5 bg-[rgba(255,255,255,0.97)] shadow-[0_40px_120px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
        style={{
          top: `${targetRect.top}px`,
          left: `${targetRect.left}px`,
          width: `${targetRect.width}px`,
          height: `${targetRect.height}px`,
          transform: shellTransform,
          transformOrigin: "top left",
          borderRadius: `${shellBorderRadius}px`,
          transition: [
            `transform ${ANIMATION_MS}ms ${ANIMATION_EASING}`,
            `border-radius ${ANIMATION_MS}ms ${ANIMATION_EASING}`,
            `box-shadow ${ANIMATION_MS}ms ${ANIMATION_EASING}`,
            `background-color ${ANIMATION_MS}ms ${ANIMATION_EASING}`,
          ].join(", "),
        }}
      >
        <div
          className="flex h-full flex-col"
          style={{
            opacity: contentVisible ? 1 : 0.2,
            transform: contentVisible ? "translateY(0px)" : "translateY(10px)",
            transition: `opacity 280ms ease, transform 360ms ${ANIMATION_EASING}`,
            transitionDelay: contentVisible ? "120ms" : "0ms",
          }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/6 bg-white/96 px-4 py-4 backdrop-blur-xl md:px-5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-sm font-sans text-foreground transition-colors hover:bg-white/90"
            >
              <ArrowLeft size={15} />
              {lang === "it" ? "Torna all'anteprima" : "Back to preview"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/8 bg-white text-muted-foreground transition-colors hover:text-foreground"
              aria-label={lang === "it" ? "Chiudi articolo" : "Close article"}
            >
              <X size={18} />
            </button>
          </div>

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 pb-3 pt-3 md:px-5 md:pb-5 md:pt-5" style={{ touchAction: "pan-y" }}>
            {isLoading ? (
              <div className="mx-auto max-w-4xl space-y-4 animate-pulse">
                <div className="h-[34vh] rounded-[30px] bg-neutral-100" />
                <div className="h-12 w-3/4 rounded-full bg-neutral-100" />
                <div className="h-5 w-1/3 rounded-full bg-neutral-100" />
                <div className="rounded-[28px] bg-neutral-100 p-6 space-y-3">
                  <div className="h-4 w-full rounded-full bg-neutral-200" />
                  <div className="h-4 w-[92%] rounded-full bg-neutral-200" />
                  <div className="h-4 w-[88%] rounded-full bg-neutral-200" />
                  <div className="h-4 w-[76%] rounded-full bg-neutral-200" />
                </div>
              </div>
            ) : !article ? (
              <div className="mx-auto flex h-full max-w-xl items-center justify-center">
                <div className="rounded-[28px] border border-black/6 bg-white px-6 py-10 text-center shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                  <p className="mb-4 text-sm font-sans text-muted-foreground">
                    {lang === "it" ? "Articolo non trovato." : "Article not found."}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-sans font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <ArrowLeft size={14} />
                    {lang === "it" ? "Torna al logbook" : "Back to logbook"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl space-y-5">
                {article.cover_image && (
                  <div className="overflow-hidden rounded-[32px] border border-black/6 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
                    <div className="aspect-[16/8.8] overflow-hidden bg-neutral-100">
                      <img src={article.cover_image} alt={title} className="h-full w-full max-w-none" style={coverStyle} />
                    </div>
                  </div>
                )}

                <section className="rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] md:p-7">
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    {article.location_name && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-black/7 bg-white px-3 py-1.5 text-xs font-sans text-muted-foreground">
                        <MapPin size={12} className="text-accent" />
                        {article.location_name}
                      </span>
                    )}
                    <LiveReadCounter count={views} lang={lang} className="rounded-full border border-black/7 bg-white px-3 py-1.5" />
                  </div>

                  <h1 className="editorial-heading text-3xl leading-tight text-balance md:text-5xl">{title}</h1>

                  {excerpt && (
                    <div className="mt-5 rounded-[24px] border border-black/6 bg-white px-4 py-4 md:px-5">
                      <p className="editorial-body whitespace-pre-wrap leading-[1.8] text-muted-foreground">{excerpt}</p>
                    </div>
                  )}

                  {(resolvedAuthors.length > 0 || dateLabel) && (
                    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-black/6 pt-6">
                      {resolvedAuthors.map((author) => (
                        <Link
                          key={author.id}
                          to={`/profile/${author.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-black/7 bg-white px-3 py-2 text-xs font-sans text-foreground transition-colors hover:text-accent"
                        >
                          <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-black/6 bg-neutral-100">
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
                        <span className="inline-flex items-center rounded-full border border-black/7 bg-white px-3 py-2 text-xs font-sans text-muted-foreground">
                          {lang === "it" ? "Pubblicato il " : "Published "}
                          <time className="ml-1" dateTime={article.published_at || undefined}>{dateLabel}</time>
                        </span>
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] md:p-7">
                  <div className={`grid gap-6 ${hasGeo ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"}`}>
                    <div className="min-w-0">
                      {contentNodes.length > 0 && (
                        <div className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-img:rounded-[18px] prose-blockquote:border-accent prose-blockquote:font-serif prose-blockquote:italic">
                          {contentNodes.map((node, index) => {
                            const blockHtml = generateHTML(
                              { type: "doc", content: [node] } as Parameters<typeof generateHTML>[0],
                              articleContentExtensions
                            );

                            return (
                              <div
                                key={`modal-article-block-${index}`}
                                ref={(element) => {
                                  articleBlockRefs.current[index] = element;
                                }}
                                data-article-block-index={index}
                                dangerouslySetInnerHTML={{ __html: blockHtml }}
                              />
                            );
                          })}
                        </div>
                      )}

                      {contentNodes.length === 0 && htmlContent && (
                        <div
                          className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-img:rounded-[18px] prose-blockquote:border-accent prose-blockquote:font-serif prose-blockquote:italic"
                          dangerouslySetInnerHTML={{ __html: htmlContent }}
                        />
                      )}

                      {contentRenderFailed && (
                        <p className="text-sm font-sans text-muted-foreground">
                          {lang === "it"
                            ? "Il contenuto di questo articolo non puo essere mostrato al momento."
                            : "This article content cannot be displayed right now."}
                        </p>
                      )}

                      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-black/6 pt-6">
                        <LikeButton articleId={article.id} />
                        <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImage || undefined} />
                      </div>
                    </div>

                    {hasGeo && (
                      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
                        <LazyArticleMapAside
                          latitude={article.latitude!}
                          longitude={article.longitude!}
                          title={title}
                          scenes={localizedScenes}
                          activeSceneId={activeSceneId}
                          camera={mapCamera}
                        />
                      </aside>
                    )}
                  </div>
                </section>

                <section className="rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] md:p-7">
                  <CommentSection articleId={article.id} />
                </section>

                {tags.length > 0 && (
                  <section className="rounded-[32px] border border-black/6 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                    <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      {lang === "it" ? "Hashtag" : "Tags"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-black/7 bg-white px-3 py-1.5 text-xs font-sans text-muted-foreground"
                        >
                          #{tag.name}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ExpandedArticleModal;
