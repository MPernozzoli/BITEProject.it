import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useArticleReads } from "@/hooks/useArticleReads";
import { BookOpen, TrendingUp, Clock, Eye } from "lucide-react";

interface ArticleSidebarProps {
  currentArticleId: string;
  storyId?: string | null;
}

const ArticleSidebar = ({ currentArticleId, storyId }: ArticleSidebarProps) => {
  const { lang } = useI18n();
  const { isRead } = useArticleReads();

  // Story chapters
  const { data: storyChapters = [] } = useQuery({
    queryKey: ["story-chapters-sidebar", storyId],
    enabled: !!storyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, published_at")
        .eq("story_id", storyId!)
        .eq("status", "published")
        .order("published_at", { ascending: true });
      return data || [];
    },
  });

  // Popular articles
  const { data: popularArticles = [] } = useQuery({
    queryKey: ["popular-articles-sidebar"],
    queryFn: async () => {
      const { data: likes } = await supabase
        .from("article_likes")
        .select("article_id");
      const counts: Record<string, number> = {};
      (likes || []).forEach((l) => {
        counts[l.article_id] = (counts[l.article_id] || 0) + 1;
      });
      const topIds = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id)
        .filter((id) => id !== currentArticleId);
      if (!topIds.length) return [];
      const { data } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image")
        .in("id", topIds)
        .eq("status", "published");
      return (data || []).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
    },
  });

  // Recent articles
  const { data: recentArticles = [] } = useQuery({
    queryKey: ["recent-articles-sidebar"],
    queryFn: async () => {
      const { data } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, cover_image, published_at")
        .eq("status", "published")
        .neq("id", currentArticleId)
        .order("published_at", { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  const getTitle = (a: any) => lang === "en" ? a.title_en : (a.title_it || a.title_en);

  const SidebarLink = ({ article, showReadBadge = true }: { article: any; showReadBadge?: boolean }) => (
    <Link
      to={`/logbook/${article.slug}`}
      className={`flex items-start gap-3 group py-2 ${article.id === currentArticleId ? "opacity-50 pointer-events-none" : ""}`}
    >
      {article.cover_image && (
        <div className="w-12 h-12 flex-shrink-0 overflow-hidden bg-muted">
          <img src={article.cover_image} alt="" className="img-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-serif leading-snug group-hover:text-accent transition-colors line-clamp-2">
          {getTitle(article)}
        </p>
        {showReadBadge && isRead(article.id) && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
            <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <aside className="space-y-8">
      {/* Story chapters */}
      {storyId && storyChapters.length > 1 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Capitoli" : "Chapters"}
            </h3>
          </div>
          <div className="space-y-1 border-l-2 border-border pl-4">
            {storyChapters.map((ch, i) => (
              <Link
                key={ch.id}
                to={`/logbook/${ch.slug}`}
                className={`block text-sm py-1.5 transition-colors ${
                  ch.id === currentArticleId
                    ? "text-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-xs text-muted-foreground mr-2">{i + 1}.</span>
                {getTitle(ch)}
                {isRead(ch.id) && ch.id !== currentArticleId && (
                  <Eye size={10} className="inline ml-1.5 text-muted-foreground" />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Popular */}
      {popularArticles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Popolari" : "Popular"}
            </h3>
          </div>
          <div className="space-y-2">
            {popularArticles.slice(0, 4).map((a) => (
              <SidebarLink key={a.id} article={a} />
            ))}
          </div>
        </div>
      )}

      {/* Recent */}
      {recentArticles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Recenti" : "Recent"}
            </h3>
          </div>
          <div className="space-y-2">
            {recentArticles.slice(0, 4).map((a) => (
              <SidebarLink key={a.id} article={a} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

export default ArticleSidebar;
