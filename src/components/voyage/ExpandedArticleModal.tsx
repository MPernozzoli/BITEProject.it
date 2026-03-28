import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { generateHTML } from "@tiptap/react";
import { ArrowLeft, MapPin, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import ProfileCard from "@/components/ProfileCard";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";
import LiveReadCounter from "@/components/LiveReadCounter";
import { useQualifiedArticleRead, useSyncArticleViewCount } from "@/hooks/useArticleReads";
import { articleContentExtensions } from "@/lib/article-content";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";

type ExpandedArticleModalProps = {
  slug: string | null;
  lang: "it" | "en";
  onClose: () => void;
};

const ExpandedArticleModal = ({ slug, lang, onClose }: ExpandedArticleModalProps) => {
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

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

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

  const shareUrl = useMemo(() => {
    if (!slug || typeof window === "undefined") return "";

    const nextUrl = new URL(`/logbook/${slug}`, window.location.origin);
    nextUrl.searchParams.set("lang", lang);
    return nextUrl.toString();
  }, [lang, slug]);

  const instagramStoryImage = article
    ? lang === "en"
      ? (article.instagram_story_use_cover_en ?? true)
        ? article.cover_image
        : article.instagram_story_image_en || article.cover_image
      : (article.instagram_story_use_cover_it ?? true)
        ? article.cover_image
        : article.instagram_story_image_it || article.cover_image
    : null;

  if (!slug) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-xl" onClick={onClose} aria-hidden />

      <div className="fixed inset-3 z-[71] md:inset-5 lg:inset-7">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lang === "it" ? "Articolo completo" : "Full article"}
          className="mx-auto flex h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-[36px] border border-white/55 bg-background/78 shadow-[0_40px_120px_rgba(15,23,42,0.3)] backdrop-blur-2xl"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/45 bg-background/62 px-4 py-4 backdrop-blur-xl md:px-5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/65 px-4 py-2 text-sm font-sans text-foreground transition-colors hover:bg-white/80"
            >
              <ArrowLeft size={15} />
              {lang === "it" ? "Torna all'anteprima" : "Back to preview"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/65 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={lang === "it" ? "Chiudi articolo" : "Close article"}
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3 md:px-5 md:pb-5 md:pt-5">
            {isLoading ? (
              <div className="mx-auto max-w-4xl space-y-4 animate-pulse">
                <div className="h-[34vh] rounded-[30px] bg-muted/70" />
                <div className="h-12 w-3/4 rounded-full bg-muted/60" />
                <div className="h-5 w-1/3 rounded-full bg-muted/60" />
                <div className="rounded-[28px] bg-muted/60 p-6 space-y-3">
                  <div className="h-4 w-full rounded-full bg-muted" />
                  <div className="h-4 w-[92%] rounded-full bg-muted" />
                  <div className="h-4 w-[88%] rounded-full bg-muted" />
                  <div className="h-4 w-[76%] rounded-full bg-muted" />
                </div>
              </div>
            ) : !article ? (
              <div className="mx-auto flex h-full max-w-xl items-center justify-center">
                <div className="rounded-[28px] border border-white/55 bg-white/55 px-6 py-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
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
                  <div className="overflow-hidden rounded-[32px] border border-white/55 bg-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                    <div className="aspect-[16/8.8] overflow-hidden bg-muted">
                      <img src={article.cover_image} alt={title} className="h-full w-full max-w-none" style={coverStyle} />
                    </div>
                  </div>
                )}

                <section className="rounded-[32px] border border-white/55 bg-white/58 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] md:p-7">
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    {article.location_name && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/75 bg-background/75 px-3 py-1.5 text-xs font-sans text-muted-foreground">
                        <MapPin size={12} className="text-accent" />
                        {article.location_name}
                      </span>
                    )}
                    <LiveReadCounter count={views} lang={lang} className="rounded-full border border-white/75 bg-background/75 px-3 py-1.5" />
                  </div>

                  <h1 className="editorial-heading text-3xl leading-tight text-balance md:text-5xl">{title}</h1>

                  {excerpt && (
                    <div className="mt-5 rounded-[24px] border border-white/65 bg-background/70 px-4 py-4 md:px-5">
                      <p className="editorial-body whitespace-pre-wrap leading-[1.8] text-muted-foreground">{excerpt}</p>
                    </div>
                  )}

                  {(authors.length > 0 || dateLabel) && (
                    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border/60 pt-6">
                      {authors.map((author) => (
                        <ProfileCard
                          key={author.id}
                          profileId={author.id}
                          name={author.name}
                          avatarUrl={author.avatar_url || undefined}
                          size="sm"
                        />
                      ))}
                      {dateLabel && (
                        <span className="text-sm font-sans text-muted-foreground">
                          {lang === "it" ? "Pubblicato il " : "Published "}
                          <time dateTime={article.published_at || undefined}>{dateLabel}</time>
                        </span>
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-[32px] border border-white/55 bg-white/58 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] md:p-7">
                  {htmlContent && (
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

                  <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-border/60 pt-6">
                    <LikeButton articleId={article.id} />
                    <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImage || undefined} />
                  </div>
                </section>

                <section className="rounded-[32px] border border-white/55 bg-white/52 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] md:p-7">
                  <CommentSection articleId={article.id} />
                </section>

                {tags.length > 0 && (
                  <section className="rounded-[32px] border border-white/55 bg-white/50 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                    <p className="mb-3 text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      {lang === "it" ? "Hashtag" : "Tags"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border border-white/70 bg-background/72 px-3 py-1.5 text-xs font-sans text-muted-foreground"
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
