import { forwardRef } from "react";
import { format } from "date-fns";
import { MapPin, Eye } from "lucide-react";
import ProfileCard from "@/components/ProfileCard";
import type { GeoArticle } from "@/lib/voyage-utils";

interface ArticleListCardProps {
  article: GeoArticle;
  lang: "en" | "it";
  isActive: boolean;
  isRead?: boolean;
  onClick: () => void;
}

const ArticleListCard = forwardRef<HTMLDivElement, ArticleListCardProps>(
  ({ article, lang, isActive, isRead, onClick }, ref) => {
    const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
    const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={`group cursor-pointer border-b border-border p-4 transition-all duration-300 ${
          isActive
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-muted/50 border-l-2 border-l-transparent"
        }`}
      >
        <div className="flex gap-3">
          {/* Thumbnail */}
          {article.cover_image && (
            <div className="w-20 h-20 shrink-0 overflow-hidden rounded-sm relative">
              <img
                src={article.cover_image}
                alt={title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              {isRead && (
                <span className="absolute top-1 left-1 bg-background/80 backdrop-blur-sm p-0.5 rounded-sm">
                  <Eye size={8} className="text-muted-foreground" />
                </span>
              )}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {article.location_name && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-sans text-accent truncate">
                  <MapPin size={8} />
                  {article.location_name}
                </span>
              )}
              {article.published_at && (
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(article.published_at), "MMM d")}
                </span>
              )}
            </div>
            <h3 className={`text-sm font-serif font-medium leading-tight line-clamp-2 mb-1 transition-colors ${
              isActive ? "text-accent" : "text-foreground group-hover:text-accent"
            }`}>
              {title}
            </h3>
            {excerpt && (
              <p className="text-[11px] text-muted-foreground line-clamp-2 font-sans">{excerpt}</p>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ArticleListCard.displayName = "ArticleListCard";

export default ArticleListCard;
