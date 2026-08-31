import { forwardRef, type MouseEvent } from "react";
import { format } from "date-fns";
import { MapPin, Eye, Heart, User, Glasses } from "lucide-react";
import { getArticleDisplayLocationLabel, type GeoArticle, type VoyageWaypoint } from "@/lib/voyage-utils";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import ProfileAvatar from "@/components/ProfileAvatar";
import { storageImageProps } from "@/lib/storage-image";
import { articlePathForLang } from "@/lib/article-slug";
import { localizedHref } from "@/lib/i18n";

interface ArticleListCardProps {
  article: GeoArticle;
  waypointsMap?: Record<string, VoyageWaypoint[]>;
  lang: "en" | "it";
  isActive: boolean;
  isDimmed?: boolean;
  isRead?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const ArticleListCard = forwardRef<HTMLAnchorElement, ArticleListCardProps>(
  ({ article, waypointsMap = {}, lang, isActive, isDimmed = false, isRead, onClick, onMouseEnter, onMouseLeave }, ref) => {
    const displayLocation = getArticleDisplayLocationLabel(article, waypointsMap, lang);
    const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
    const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);
    const views = Number(article.viewCount ?? 0).toLocaleString(lang === "it" ? "it-IT" : "en-US");
    const likes = Number(article.likeCount ?? 0).toLocaleString(lang === "it" ? "it-IT" : "en-US");
    const thumbStyle =
      article.cover_image &&
      coverImageStyle(
        article.cover_image,
        clampCoverFocal(
          Number(article.cover_focal_x ?? 50),
          Number(article.cover_focal_y ?? 50),
          Number(article.cover_zoom ?? 1)
        )
      );

    // La card apre un pannello sulla mappa, non naviga: il click semplice resta
    // quel comportamento. Ma resta un <a> con l'indirizzo vero dell'articolo, così
    // il tocco prolungato offre «apri in una nuova scheda» e «condividi», cmd-click
    // e rotellina funzionano, e la pagina espone link interni verso gli articoli.
    const href = localizedHref(lang, articlePathForLang(article, lang));

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onClick();
    };

    return (
      <a
        ref={ref}
        href={href}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`group mx-3 my-3 block cursor-pointer rounded-[24px] border p-3 transition-[transform,box-shadow,border-color,background-color] duration-reveal ease-out-expo active:scale-[0.99] ${
          isActive
            ? "border-accent/50 bg-glass/70 shadow-[0_20px_50px_rgba(15,23,42,0.12)]"
            : "border-glass-edge/55 bg-glass/48 hover:bg-glass/68 hover:shadow-[0_18px_45px_rgba(15,23,42,0.10)]"
        } ${isDimmed && !isActive ? "opacity-40 saturate-[0.65] scale-[0.985]" : ""}`}
      >
        <div className="flex gap-3">
          {/* Thumbnail */}
          {article.cover_image && (
            <div className="w-20 h-20 shrink-0 overflow-hidden rounded-[18px] relative bg-muted">
              <img
                {...storageImageProps(article.cover_image, 96)}
                alt={title}
                className="absolute inset-0 max-w-none"
                style={thumbStyle || undefined}
                loading="lazy"
                decoding="async"
              />
              {isRead && (
                <span
                  className="absolute left-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center text-white drop-shadow-[0_2px_5px_rgba(15,23,42,0.75)]"
                  aria-label={lang === "it" ? "Articolo letto" : "Article read"}
                  title={lang === "it" ? "Letto" : "Read"}
                >
                  <Glasses size={15} strokeWidth={2.4} />
                </span>
              )}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {displayLocation && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-sans text-accent truncate">
                  <MapPin size={8} />
                  {displayLocation}
                </span>
              )}
              {article.published_at && (
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(article.published_at), "MMM d")}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full border border-glass-edge/70 bg-background/70 px-2 py-0.5 text-[10px] font-sans text-muted-foreground">
                <Eye size={10} className="text-accent" />
                {views}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-glass-edge/70 bg-background/70 px-2 py-0.5 text-[10px] font-sans text-muted-foreground">
                <Heart size={10} className="text-accent" />
                {likes}
              </span>
            </div>
            <h3 className={`text-sm font-serif font-medium leading-tight line-clamp-2 mb-1 transition-colors duration-interaction ease-out-expo ${
              isActive ? "text-accent" : "text-foreground group-hover:text-accent"
            }`}>
              {title}
            </h3>
            {article.authors && article.authors.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {article.authors.slice(0, 3).map((author) => (
                  <span
                    key={author.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-glass-edge/70 bg-background/72 px-2 py-1 text-[10px] font-sans text-foreground"
                  >
                    <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-glass-edge/45 bg-glass/70">
                      <ProfileAvatar
                        name={author.name || "Anonymous"}
                        avatarUrl={author.avatar_url || undefined}
                        imgClassName="h-full w-full object-cover"
                        fallback={<User size={9} className="text-muted-foreground" />}
                      />
                    </span>
                    <span className="max-w-[92px] truncate">{author.name}</span>
                  </span>
                ))}
              </div>
            )}
            {excerpt && (
              <p className="text-[11px] text-muted-foreground line-clamp-2 font-sans">{excerpt}</p>
            )}
          </div>
        </div>
      </a>
    );
  }
);

ArticleListCard.displayName = "ArticleListCard";

export default ArticleListCard;
