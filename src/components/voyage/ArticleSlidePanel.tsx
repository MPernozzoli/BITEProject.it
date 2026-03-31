import type { Ref } from "react";
import { X, MapPin, Heart, Eye, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import type { GeoArticle } from "@/lib/voyage-utils";
import { coverImageStyle, clampCoverFocal } from "@/lib/article-cover";
import ProfileAvatar from "@/components/ProfileAvatar";
import { User } from "lucide-react";

interface ArticleSlidePanelProps {
  article: GeoArticle | null;
  onClose: () => void;
  lang: "en" | "it";
  onAuthorClick?: (profileId: string) => void;
  onOpenArticle?: (article: GeoArticle) => void;
  panelRef?: Ref<HTMLDivElement>;
  isSoftHidden?: boolean;
  isAutoHidden?: boolean;
  disableEntranceAnimation?: boolean;
}

const ArticleSlidePanel = ({
  article,
  onClose,
  lang,
  onAuthorClick,
  onOpenArticle,
  panelRef,
  isSoftHidden = false,
  isAutoHidden = false,
  disableEntranceAnimation = false,
}: ArticleSlidePanelProps) => {
  if (!article) return null;

  const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
  const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);
  const focal = clampCoverFocal(
    Number(article.cover_focal_x ?? 50),
    Number(article.cover_focal_y ?? 50),
    Number(article.cover_zoom ?? 1)
  );
  const coverStyle = article.cover_image ? coverImageStyle(article.cover_image, focal) : undefined;
  const dateLabel = article.published_at
    ? format(new Date(article.published_at), lang === "it" ? "d MMM yyyy" : "MMM d, yyyy")
    : null;
  const likes = Number(article.likeCount ?? 0).toLocaleString(lang === "it" ? "it-IT" : "en-US");
  const views = Number(article.viewCount ?? 0).toLocaleString(lang === "it" ? "it-IT" : "en-US");

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 lg:hidden ${
          isAutoHidden ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        className={`fixed inset-x-3 top-24 bottom-4 sm:left-auto sm:right-4 sm:w-[440px] xl:w-[460px] z-50 overflow-hidden rounded-[32px] border border-white/55 bg-background/72 shadow-[0_30px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl flex flex-col transition-[opacity,transform] duration-300 ${
          disableEntranceAnimation ? "" : "animate-slide-in-right"
        } ${
          isSoftHidden ? "opacity-0 pointer-events-none" : "opacity-100"
        } ${
          isAutoHidden ? "translate-x-[calc(100%+2rem)] opacity-0 pointer-events-none" : "translate-x-0"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/45 bg-background/55 px-5 py-4 backdrop-blur-xl shrink-0">
          <div className="min-w-0 flex items-center gap-2 text-xs font-sans text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-3 py-1">
              <MapPin size={12} className="shrink-0 text-accent" />
              <span className="truncate">{article.location_name || (lang === "it" ? "Anteprima articolo" : "Article preview")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-3 py-1">
              <Eye size={12} className="shrink-0 text-accent" />
              <span>{views}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-3 py-1">
              <Heart size={12} className="shrink-0 text-accent" />
              <span>{likes}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={lang === "it" ? "Chiudi" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 md:px-5 md:py-5 flex-1 overflow-y-auto" style={{ touchAction: "pan-y" }}>
          <div className="space-y-4">
            {article.cover_image && (
              <div className="overflow-hidden rounded-[26px] border border-white/55 bg-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="aspect-[16/10] overflow-hidden bg-muted shrink-0">
                  <img
                    src={article.cover_image}
                    alt=""
                    className="w-full h-full max-w-none"
                    style={coverStyle}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            )}

            <div className="rounded-[26px] border border-white/55 bg-white/58 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              <h2 className="editorial-heading text-2xl md:text-3xl mb-5 text-balance leading-tight">{title}</h2>

              {(article.authors && article.authors.length > 0) || dateLabel ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-5 mb-5 border-b border-border/60">
                  {article.authors?.map((a) => (
                    onAuthorClick ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => onAuthorClick(a.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-background/75 px-3 py-2 text-xs font-sans text-foreground transition-colors hover:text-accent"
                      >
                        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-white/70">
                          <ProfileAvatar
                            name={a.name || "Anonymous"}
                            avatarUrl={a.avatar_url || undefined}
                            imgClassName="h-full w-full object-cover"
                            fallback={<User size={12} className="text-muted-foreground" />}
                          />
                        </span>
                        <span>{a.name}</span>
                      </button>
                    ) : (
                      <Link
                        key={a.id}
                        to={`/profile/${a.id}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-background/75 px-3 py-2 text-xs font-sans text-foreground transition-colors hover:text-accent"
                      >
                        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-white/70">
                          <ProfileAvatar
                            name={a.name || "Anonymous"}
                            avatarUrl={a.avatar_url || undefined}
                            imgClassName="h-full w-full object-cover"
                            fallback={<User size={12} className="text-muted-foreground" />}
                          />
                        </span>
                        <span>{a.name}</span>
                      </Link>
                    )
                  ))}
                  {dateLabel && (
                    <span className="text-xs font-sans text-muted-foreground">
                      {lang === "it" ? "Pubblicato " : "Published "}
                      <time dateTime={article.published_at || undefined}>{dateLabel}</time>
                    </span>
                  )}
                </div>
              ) : null}
              {excerpt && (
                <div className="rounded-[22px] border border-white/65 bg-background/65 px-4 py-4 mb-5">
                  <p className="editorial-body text-muted-foreground leading-[1.75] whitespace-pre-wrap">{excerpt}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpenArticle?.(article)}
                className="inline-flex w-full justify-center items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-sans font-medium tracking-wide hover:opacity-90 transition-opacity"
              >
                {lang === "it" ? "Leggi l'articolo completo" : "Read full article"}
                <ArrowUpRight size={15} />
              </button>
            </div>

            {article.tags && article.tags.length > 0 && (
              <div className="rounded-[26px] border border-white/55 bg-white/50 p-4">
                <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                  {lang === "it" ? "Hashtag" : "Tags"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {article.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full border border-white/70 bg-background/72 px-3 py-1.5 text-xs font-sans text-muted-foreground"
                    >
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ArticleSlidePanel;
