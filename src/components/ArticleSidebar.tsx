import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useArticleReads } from "@/hooks/useArticleReads";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import { BookOpen, TrendingUp, Clock, Eye } from "lucide-react";

interface ArticleSidebarProps {
  currentArticleId: string;
  storyId?: string | null;
}

type SidebarArticle = {
  id: string;
  slug: string;
  title_en: string;
  title_it: string | null;
  cover_image?: string | null;
  published_at?: string | null;
};

const ArticleSidebar = ({ currentArticleId, storyId }: ArticleSidebarProps) => {
  const { lang } = useI18n();
  const { isRead } = useArticleReads();
  const { data: publicContent, isLoading: isPublicContentLoading } = usePublicContentSnapshot();
  const snapshotArticles = publicContent?.articles ?? null;

  const snapshotStoryChapters = useMemo(() => {
    if (!storyId || !snapshotArticles) return null;

    return snapshotArticles
      .filter((article) => article.story_id === storyId)
      .sort((a, b) => {
        const left = a.published_at ? new Date(a.published_at).getTime() : 0;
        const right = b.published_at ? new Date(b.published_at).getTime() : 0;
        return left - right;
      })
      .map((article) => ({
        id: article.id,
        slug: article.slug,
        title_en: article.title_en,
        title_it: article.title_it,
        published_at: article.published_at,
      }));
  }, [snapshotArticles, storyId]);

  const snapshotPopularArticles = useMemo(() => {
    if (!snapshotArticles) return null;

    return snapshotArticles
      .filter((article) => article.id !== currentArticleId)
      .sort((a, b) => (Number(b.likeCount ?? 0) - Number(a.likeCount ?? 0)))
      .slice(0, 5)
      .map((article) => ({
        id: article.id,
        slug: article.slug,
        title_en: article.title_en,
        title_it: article.title_it,
        cover_image: article.cover_image,
      }));
  }, [currentArticleId, snapshotArticles]);

  const snapshotRecentArticles = useMemo(() => {
    if (!snapshotArticles) return null;

    return snapshotArticles
      .filter((article) => article.id !== currentArticleId)
      .sort((a, b) => {
        const left = a.published_at ? new Date(a.published_at).getTime() : 0;
        const right = b.published_at ? new Date(b.published_at).getTime() : 0;
        return right - left;
      })
      .slice(0, 5)
      .map((article) => ({
        id: article.id,
        slug: article.slug,
        title_en: article.title_en,
        title_it: article.title_it,
        cover_image: article.cover_image,
        published_at: article.published_at,
      }));
  }, [currentArticleId, snapshotArticles]);

  // Story chapters
  const { data: liveStoryChapters = [] } = useQuery({
    queryKey: ["story-chapters-sidebar", storyId],
    enabled: !!storyId && !snapshotArticles && !isPublicContentLoading,
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
  const storyChapters = snapshotStoryChapters ?? liveStoryChapters;

  // Popular articles
  const { data: livePopularArticles = [] } = useQuery({
    queryKey: ["popular-articles-sidebar"],
    enabled: !snapshotArticles && !isPublicContentLoading,
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
  const popularArticles = snapshotPopularArticles ?? livePopularArticles;

  // Recent articles
  const { data: liveRecentArticles = [] } = useQuery({
    queryKey: ["recent-articles-sidebar"],
    enabled: !snapshotArticles && !isPublicContentLoading,
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
  const recentArticles = snapshotRecentArticles ?? liveRecentArticles;

  const getTitle = (a: Pick<SidebarArticle, "title_en" | "title_it">) => lang === "en" ? a.title_en : (a.title_it || a.title_en);

  const SidebarLink = ({ article, showReadBadge = true }: { article: SidebarArticle; showReadBadge?: boolean }) => (
    <Link
      to={`/logbook/${article.slug}`}
      className={`glass-panel-soft rounded-[22px] flex items-start gap-3 group p-3 ${article.id === currentArticleId ? "opacity-50 pointer-events-none" : "transition-transform duration-300 hover:-translate-y-0.5"}`}
    >
      {article.cover_image && (
        <div className="glass-frame w-12 h-12 flex-shrink-0 rounded-[16px] p-1">
          <img src={article.cover_image} alt="" className="img-cover" loading="lazy" decoding="async" />
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
      {storyId && storyChapters.length > 1 && (
        <div className="glass-panel rounded-[28px] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Capitoli" : "Chapters"}
            </h3>
          </div>
          <div className="space-y-2">
            {storyChapters.map((ch, i) => (
              <Link
                key={ch.id}
                to={`/logbook/${ch.slug}`}
                className={`glass-panel-soft flex items-center gap-3 rounded-[20px] px-4 py-3 text-sm transition-colors ${
                  ch.id === currentArticleId
                    ? "text-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="glass-chip inline-flex h-7 min-w-7 items-center justify-center text-[11px] text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">{getTitle(ch)}</span>
                {isRead(ch.id) && ch.id !== currentArticleId && (
                  <Eye size={10} className="text-muted-foreground" />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {popularArticles.length > 0 && (
        <div className="glass-panel rounded-[28px] p-5">
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

      {recentArticles.length > 0 && (
        <div className="glass-panel rounded-[28px] p-5">
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
