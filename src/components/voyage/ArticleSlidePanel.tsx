import { X, MapPin, Heart } from "lucide-react";
import { format } from "date-fns";
import type { GeoArticle } from "@/lib/voyage-utils";
import ProfileCard from "@/components/ProfileCard";
import { Link } from "react-router-dom";
import { coverImageStyle, clampCoverFocal } from "@/lib/article-cover";

interface ArticleSlidePanelProps {
  article: GeoArticle | null;
  onClose: () => void;
  lang: "en" | "it";
}

const ArticleSlidePanel = ({ article, onClose, lang }: ArticleSlidePanelProps) => {
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
  const likes = article.likeCount ?? 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
        onClick={onClose}
        aria-hidden
      />

      <div className="fixed top-0 right-0 h-full w-full sm:w-[440px] lg:w-[480px] bg-background border-l border-border z-50 overflow-y-auto shadow-2xl animate-slide-in-right flex flex-col">
        <div className="sticky top-0 bg-background/95 backdrop-blur-md border-b border-border z-10 px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-sans text-muted-foreground min-w-0">
            {article.location_name && (
              <>
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{article.location_name}</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={lang === "it" ? "Chiudi" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        {article.cover_image && (
          <div className="aspect-[16/10] overflow-hidden bg-muted shrink-0 border-b border-border">
            <img src={article.cover_image} alt="" className="w-full h-full max-w-none" style={coverStyle} />
          </div>
        )}

        <div className="px-5 py-6 flex-1 flex flex-col">
          <h2 className="editorial-heading text-2xl md:text-3xl mb-6 text-balance leading-tight">{title}</h2>

          {(article.authors && article.authors.length > 0) || dateLabel ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-6 mb-6 border-b border-border">
              {article.authors?.map((a) => (
                <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
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
            <p className="editorial-body text-muted-foreground leading-[1.75] mb-8 whitespace-pre-wrap">{excerpt}</p>
          )}

          <div
            className="flex items-center gap-1.5 text-sm text-muted-foreground mb-8"
            aria-label={lang === "it" ? `${likes} mi piace` : `${likes} likes`}
          >
            <Heart size={14} className="text-accent" aria-hidden />
            <span className="tabular-nums">{likes}</span>
          </div>

          <div className="mt-auto pt-4">
            <Link
              to={`/logbook/${article.slug}`}
              className="inline-flex w-full sm:w-auto justify-center items-center gap-2 bg-primary text-primary-foreground px-5 py-3 text-sm font-sans font-medium tracking-wide hover:opacity-90 transition-opacity rounded-sm"
            >
              {lang === "it" ? "Leggi l'articolo completo" : "Read full article"}
            </Link>
          </div>

          {article.tags && article.tags.length > 0 && (
            <div className="mt-10 pt-8 border-t border-border">
              <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                {lang === "it" ? "Hashtag" : "Tags"}
              </p>
              <div className="flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="text-xs font-sans px-2 py-1 border border-border text-muted-foreground bg-muted/30"
                  >
                    #{tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ArticleSlidePanel;
