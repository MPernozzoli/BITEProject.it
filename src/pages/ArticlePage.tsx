import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { generateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { format } from "date-fns";
import ProfileCard from "@/components/ProfileCard";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";
import ArticleSidebar from "@/components/ArticleSidebar";
import ArticleMapAside from "@/components/ArticleMapAside";
import ArticleRelatedSection from "@/components/ArticleRelatedSection";
import { useRegisterArticleRead } from "@/hooks/useArticleReads";
import { useEffect, useMemo, useRef } from "react";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import LiveReadCounter from "@/components/LiveReadCounter";

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Image,
  LinkExt,
  Youtube.configure({ width: 640, height: 360 }),
  TextStyle,
  Color,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Underline,
];

type StoryChapter = {
  id: string;
  slug: string;
  title_en: string;
  title_it: string;
  published_at: string | null;
};

const READ_QUALIFICATION_MS = 30_000;

const ArticlePage = () => {
  const { slug } = useParams();
  const { lang } = useI18n();
  const queryClient = useQueryClient();
  const { mutate: registerArticleRead } = useRegisterArticleRead(slug);
  const trackedReadFor = useRef<string | null>(null);

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

  useEffect(() => {
    if (!article?.id) return;
    trackedReadFor.current = null;

    let timeoutId: number | null = null;
    let activeSince: number | null = null;
    let accumulatedMs = 0;

    const clearTimer = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const pauseTracking = () => {
      if (activeSince !== null) {
        accumulatedMs += Date.now() - activeSince;
        activeSince = null;
      }
      clearTimer();
    };

    const registerRead = () => {
      if (trackedReadFor.current === article.id) return;
      trackedReadFor.current = article.id;
      pauseTracking();
      registerArticleRead(article.id);
    };

    const resumeTracking = () => {
      if (trackedReadFor.current === article.id) return;
      if (document.visibilityState !== "visible") return;
      if (activeSince !== null) return;

      const remainingMs = READ_QUALIFICATION_MS - accumulatedMs;
      if (remainingMs <= 0) {
        registerRead();
        return;
      }

      activeSince = Date.now();
      timeoutId = window.setTimeout(() => {
        accumulatedMs = READ_QUALIFICATION_MS;
        activeSince = null;
        timeoutId = null;
        registerRead();
      }, remainingMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeTracking();
        return;
      }

      pauseTracking();
    };

    resumeTracking();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", pauseTracking);

    return () => {
      pauseTracking();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", pauseTracking);
    };
  }, [article?.id, registerArticleRead]);

  useEffect(() => {
    if (!article?.id || !slug) return;

    const channel = supabase
      .channel(`article-live-reads:${article.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "logbook_articles",
          filter: `id=eq.${article.id}`,
        },
        (payload) => {
          const nextViewCount =
            typeof payload.new === "object" && payload.new !== null && "view_count" in payload.new
              ? Number(payload.new.view_count ?? 0)
              : null;

          if (nextViewCount === null || Number.isNaN(nextViewCount)) return;

          queryClient.setQueryData(["article", slug], (old: unknown) =>
            old && typeof old === "object"
              ? { ...(old as Record<string, unknown>), view_count: nextViewCount }
              : old
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [article?.id, queryClient, slug]);

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

  const chapterPrevNext = useMemo(() => {
    if (!article?.id || !storyChapters.length) return { prev: null as StoryChapter | null, next: null as StoryChapter | null };
    const idx = storyChapters.findIndex((c) => c.id === article.id);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? storyChapters[idx - 1] : null,
      next: idx < storyChapters.length - 1 ? storyChapters[idx + 1] : null,
    };
  }, [article?.id, storyChapters]);

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

  const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
  const content = lang === "en" ? article.content_en : (article.content_it || article.content_en);
  const hasStructuredContent = Boolean(
    content && typeof content === "object" && Object.keys(content).length > 0
  );
  let contentRenderFailed = false;
  let htmlContent = "";

  if (hasStructuredContent) {
    try {
      htmlContent = generateHTML(content as any, extensions);
    } catch (error) {
      contentRenderFailed = true;
      console.error("Failed to render article content", error);
    }
  }

  const dateFmt = lang === "it" ? "d MMMM yyyy" : "MMMM d, yyyy";
  const dateLabel = article.published_at ? format(new Date(article.published_at), dateFmt) : null;
  const views = Number((article as any).view_count ?? 0);

  const coverStyle = article.cover_image ? coverImageStyle(article.cover_image, coverFocal) : undefined;
  const instagramStoryImage = lang === "en"
    ? ((article as any).instagram_story_use_cover_en ?? true)
      ? article.cover_image
      : (article as any).instagram_story_image_en || article.cover_image
    : ((article as any).instagram_story_use_cover_it ?? true)
      ? article.cover_image
      : (article as any).instagram_story_image_it || article.cover_image;
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

  return (
    <div>
      {article.cover_image && (
        <section className="relative h-[42vh] md:h-[52vh] overflow-hidden">
          <img
            src={article.cover_image}
            alt=""
            className="absolute inset-0 w-full max-w-none pointer-events-none"
            style={coverStyle}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 lg:px-20 pb-10 md:pb-14">
            <div className="max-w-4xl">
              <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl text-foreground drop-shadow-sm">
                {title}
              </h1>
            </div>
          </div>
        </section>
      )}

      <div className="page-section !pt-8 md:!pt-14">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-10 lg:gap-12">
            <article className="min-w-0">
              <Link
                to="/logbook"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
              >
                <ArrowLeft size={14} /> {lang === "it" ? "Torna al diario" : "Back to Logbook"}
              </Link>

              {!article.cover_image && (
                <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-8">{title}</h1>
              )}

              {story && (
                <Link
                  to={`/logbook/story/${story.slug}`}
                  className="flex items-center gap-3 mb-6 p-4 border border-border hover:border-accent transition-colors group bg-card/30"
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
                      className="flex-1 inline-flex items-center gap-2 border border-border px-4 py-3 text-sm font-sans text-foreground hover:border-accent hover:bg-muted/40 transition-colors"
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
                      className="flex-1 inline-flex items-center justify-end gap-2 border border-border px-4 py-3 text-sm font-sans text-foreground hover:border-accent hover:bg-muted/40 transition-colors sm:text-right"
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

              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-8 mb-8 border-b border-border">
                  {authors.map((a: any) => (
                    <ProfileCard
                      key={a.id}
                      profileId={a.id}
                      name={a.name}
                      avatarUrl={a.avatar_url || undefined}
                      size="sm"
                    />
                  ))}
                  {dateLabel && (
                    <span className="text-sm font-sans text-muted-foreground">
                      {lang === "it" ? "Pubblicato il " : "Published "}
                      <time dateTime={article.published_at || undefined}>{dateLabel}</time>
                    </span>
                  )}
                <LiveReadCounter count={views} lang={lang} />
              </div>

              {htmlContent && (
                <div
                  className="article-rich-body prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-[1.75] prose-a:text-accent prose-img:rounded-sm prose-blockquote:border-accent prose-blockquote:font-serif prose-blockquote:italic"
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

              <div className="flex items-center gap-6 mt-12 pt-8 border-t border-border">
                <LikeButton articleId={article.id} />
                <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImage} />
              </div>

              <CommentSection articleId={article.id} />

              {tags.length > 0 && (
                <footer className="mt-14 pt-10 border-t border-border">
                  <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                    {lang === "it" ? "Hashtag" : "Tags"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag: any) => (
                      <span
                        key={tag.id}
                        className="text-xs font-sans px-2.5 py-1 border border-border text-muted-foreground bg-muted/40"
                      >
                        #{tag.name}
                      </span>
                    ))}
                  </div>
                </footer>
              )}
            </article>

            <aside className="min-w-0 space-y-8">
              {hasGeo && (
                <div className="lg:sticky lg:top-24 space-y-8">
                  <ArticleMapAside latitude={article.latitude!} longitude={article.longitude!} title={title} />
                  <div>
                    <ArticleSidebar currentArticleId={article.id} storyId={storyId ?? null} />
                  </div>
                </div>
              )}
              {!hasGeo && (
                <div className="lg:sticky lg:top-24">
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
