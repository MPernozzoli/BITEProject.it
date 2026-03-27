import { X, MapPin, Heart } from "lucide-react";
import { format } from "date-fns";
import type { GeoArticle } from "@/lib/voyage-utils";
import ProfileCard from "@/components/ProfileCard";
import { Link } from "react-router-dom";

interface ArticleSlidePanelProps {
  article: GeoArticle | null;
  onClose: () => void;
  lang: "en" | "it";
}

const ArticleSlidePanel = ({ article, onClose, lang }: ArticleSlidePanelProps) => {
  if (!article) return null;

  const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
  const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[420px] lg:w-[480px] bg-background border-l border-border z-50 overflow-y-auto shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 bg-background/95 backdrop-blur-md border-b border-border z-10 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-sans text-muted-foreground">
            {article.location_name && (
              <>
                <MapPin size={12} />
                <span>{article.location_name}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cover */}
        {article.cover_image && (
          <div className="aspect-[16/10] overflow-hidden">
            <img
              src={article.cover_image}
              alt={title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-6">
          {/* Tags + date */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {article.tags?.map((tag) => (
              <span key={tag.id} className="text-xs font-sans text-accent">#{tag.name}</span>
            ))}
            {article.published_at && (
              <span className="text-xs text-muted-foreground">
                {format(new Date(article.published_at), "MMM d, yyyy")}
              </span>
            )}
          </div>

          {/* Title */}
          <h2 className="editorial-heading text-2xl md:text-3xl mb-4">{title}</h2>

          {/* Authors */}
          {article.authors && article.authors.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              {article.authors.map((a) => (
                <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
              ))}
            </div>
          )}

          {/* Excerpt */}
          {excerpt && (
            <p className="editorial-body text-muted-foreground leading-relaxed mb-6">
              {excerpt}
            </p>
          )}

          {/* Likes */}
          {article.likeCount && article.likeCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
              <Heart size={14} />
              <span>{article.likeCount}</span>
            </div>
          )}

          {/* Read full article link */}
          <Link
            to={`/logbook/${article.slug}`}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-sans font-medium tracking-wide hover:opacity-90 transition-opacity"
          >
            {lang === "it" ? "Leggi l'articolo completo" : "Read full article"}
          </Link>
        </div>
      </div>
    </>
  );
};

export default ArticleSlidePanel;
