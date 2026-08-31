import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useArticleReads } from "@/hooks/useArticleReads";
import { usePublicContentSnapshot } from "@/hooks/usePublicContentSnapshot";
import { articlePathForLang, storyPathForLang } from "@/lib/article-slug";
import { storageImageProps } from "@/lib/storage-image";
import { BookOpen, TrendingUp, Clock, Eye, Bell, BellOff, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface ArticleSidebarProps {
  currentArticleId: string;
  storyId?: string | null;
  storyChapters?: { id: string; slug: string; title_en: string; title_it: string; published_at: string | null; status?: string }[];
}

type SidebarArticle = {
  id: string;
  slug: string;
  title_en: string;
  title_it: string;
  cover_image?: string | null;
  published_at?: string | null;
};

const SidebarLink = ({
  article,
  currentArticleId,
  isArticleRead,
  lang,
  showReadBadge = true,
}: {
  article: SidebarArticle;
  currentArticleId: string;
  isArticleRead: boolean;
  lang: string;
  showReadBadge?: boolean;
}) => (
  <Link
    to={`/logbook/${article.slug}`}
    className={`glass-panel-soft rounded-[22px] flex items-start gap-3 group p-3 ${article.id === currentArticleId ? "opacity-50 pointer-events-none" : "transition-transform duration-300 hover:-translate-y-0.5"}`}
  >
    {article.cover_image && (
      <div className="glass-frame w-12 h-12 flex-shrink-0 rounded-[16px] p-1">
        <img
          {...storageImageProps(article.cover_image, 40)}
          alt=""
          className="img-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
    )}
    <div className="flex-1 min-w-0">
      <p className="text-sm font-serif leading-snug group-hover:text-accent transition-colors line-clamp-2">
        {lang === "en" ? article.title_en : (article.title_it || article.title_en)}
      </p>
      {showReadBadge && isArticleRead && (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
          <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
        </span>
      )}
    </div>
  </Link>
);

const ArticleSidebar = ({ currentArticleId, storyId, storyChapters = [] }: ArticleSidebarProps) => {
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
    enabled: !!storyId && !snapshotArticles && !isPublicContentLoading && storyChapters.length === 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("logbook_articles")
        .select("id, title_en, title_it, slug, published_at, story_sort_order")
        .eq("story_id", storyId!)
        .eq("status", "published")
        .order("story_sort_order", { ascending: true })
        .order("published_at", { ascending: true });
      return data || [];
    },
  });
  const effectiveChapters = storyChapters.length > 0 ? storyChapters : (snapshotStoryChapters ?? liveStoryChapters);

  // Story details for the widget
  const { data: story } = useQuery({
    queryKey: ["sidebar-story", storyId],
    enabled: !!storyId,
    queryFn: async () => {
      const { data } = await supabase.from("stories").select("id, slug, slug_it, slug_en, title_en, title_it, type, target_chapter_count").eq("id", storyId!).single();
      return data;
    },
  });

  // Subscription status
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUserId(session?.user?.id || null));
    return () => subscription.unsubscribe();
  }, []);

  const queryClient = useQueryClient();
  const { data: isSubscribed = false } = useQuery({
    queryKey: ["story-subscription", storyId, userId],
    enabled: !!storyId && !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("story_subscriptions").select("id").eq("story_id", storyId!).eq("profile_id", userId!).maybeSingle();
      return !!data;
    },
  });

  const toggleSubscription = useMutation({
    mutationFn: async () => {
      if (!userId || !storyId) return;
      if (isSubscribed) {
        await supabase.from("story_subscriptions").delete().eq("story_id", storyId).eq("profile_id", userId);
      } else {
        await supabase.from("story_subscriptions").insert({ story_id: storyId, profile_id: userId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["story-subscription", storyId, userId] });
      toast.success(isSubscribed
        ? (lang === "it" ? "Iscrizione cancellata" : "Unsubscribed")
        : (lang === "it" ? "Iscritto! Riceverai notifiche." : "Subscribed! You'll be notified.")
      );
    },
  });

  // Determine next chapter and story completion
  const storyMeta = useMemo(() => {
    if (!story) return null;
    const published = effectiveChapters.filter((c) => c.status !== "draft");
    const allPublished = effectiveChapters.filter((c) => !c.status || c.status === "published");
    const currentIdx = allPublished.findIndex((c) => c.id === currentArticleId);
    const nextPublished = currentIdx >= 0 ? allPublished.slice(currentIdx + 1).find((c) => !c.status || c.status === "published") : null;

    const isComplete = story.target_chapter_count != null
      && allPublished.length >= story.target_chapter_count;

    // Next upcoming (scheduled/draft) after all published ones
    const upcoming = effectiveChapters.filter((c) => c.status === "scheduled" || c.status === "draft");
    const nextUpcoming = upcoming.length > 0 ? upcoming[0] : null;

    return {
      title_en: story.title_en,
      title_it: story.title_it,
      slug: story.slug,
      slug_it: story.slug_it,
      slug_en: story.slug_en,
      type: story.type,
      target_chapter_count: story.target_chapter_count,
      publishedCount: allPublished.length,
      isComplete,
      nextPublished,
      nextUpcoming,
    };
  }, [story, effectiveChapters, currentArticleId]);

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

  return (
    <aside className="space-y-8">
      {/* Story widget */}
      {storyId && storyMeta && (
        <div className="glass-panel rounded-[28px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Storia" : "Story"}
            </h3>
          </div>

          <Link
            to={storyPathForLang(storyMeta as any, lang)}
            className="block mb-3 group"
          >
            <p className="text-sm font-serif leading-snug group-hover:text-accent transition-colors">
              {lang === "en" ? storyMeta.title_en : (storyMeta.title_it || storyMeta.title_en)}
            </p>
          </Link>

          {/* Progress */}
          <div className="flex items-center gap-2 mb-3">
            {storyMeta.type === "closed" && storyMeta.target_chapter_count != null && (
              <>
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${Math.min((storyMeta.publishedCount / storyMeta.target_chapter_count) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {storyMeta.publishedCount}/{storyMeta.target_chapter_count}
                </span>
              </>
            )}
            {storyMeta.type === "open" && (
              <span className="text-[10px] text-muted-foreground">
                {storyMeta.publishedCount} {lang === "it" ? "capitoli" : "chapters"}
              </span>
            )}
          </div>

          {/* Subscribe / next chapter / completed */}
          {storyMeta.isComplete ? (
            <div className="space-y-2">
              <Link
                to="/logbook"
                className="glass-panel-soft rounded-[18px] flex items-center gap-2 px-3 py-2.5 text-xs font-sans text-accent hover:text-foreground transition-colors"
              >
                <BookOpen size={12} />
                {lang === "it" ? "Altri articoli" : "More articles"}
                <ChevronRight size={12} className="ml-auto" />
              </Link>
            </div>
          ) : storyMeta.nextPublished ? (
            <div className="space-y-2">
              <Link
                to={articlePathForLang(storyMeta.nextPublished as any, lang)}
                className="glass-panel-soft rounded-[18px] flex items-center gap-2 px-3 py-2.5 text-xs font-sans text-foreground hover:border-accent transition-colors"
              >
                <ChevronRight size={12} className="text-accent shrink-0" />
                <span className="min-w-0 truncate">
                  {lang === "it" ? "Prossimo capitolo:" : "Next chapter:"}{" "}
                  <span className="text-accent">{lang === "en" ? storyMeta.nextPublished.title_en : (storyMeta.nextPublished.title_it || storyMeta.nextPublished.title_en)}</span>
                </span>
              </Link>
              {userId && (
                <button
                  onClick={() => toggleSubscription.mutate()}
                  className={`w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans transition-colors ${
                    isSubscribed
                      ? "border border-border text-muted-foreground hover:text-foreground"
                      : "bg-accent text-accent-foreground hover:opacity-90"
                  }`}
                >
                  {isSubscribed ? <BellOff size={11} /> : <Bell size={11} />}
                  {isSubscribed
                    ? (lang === "it" ? "Iscritto" : "Subscribed")
                    : (lang === "it" ? "Avviami quando esce" : "Notify me when it drops")}
                </button>
              )}
              {!userId && (
                <Link
                  to="/login"
                  className="w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  <Bell size={11} />
                  {lang === "it" ? "Accedi per iscriverti" : "Log in to subscribe"}
                </Link>
              )}
            </div>
          ) : storyMeta.nextUpcoming ? (
            <div className="space-y-2">
              <div className="glass-panel-soft rounded-[18px] px-3 py-2.5 text-xs font-sans text-muted-foreground">
                {lang === "it" ? "Prossimo capitolo in arrivo" : "Next chapter coming soon"}
                {storyMeta.nextUpcoming.scheduled_at && (
                  <span className="block text-[10px] mt-0.5">
                    {lang === "it" ? `Dal ${new Date(storyMeta.nextUpcoming.scheduled_at).toLocaleDateString("it-IT")}` : `From ${new Date(storyMeta.nextUpcoming.scheduled_at).toLocaleDateString("en-US")}`}
                  </span>
                )}
              </div>
              {userId && (
                <button
                  onClick={() => toggleSubscription.mutate()}
                  className={`w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans transition-colors ${
                    isSubscribed
                      ? "border border-border text-muted-foreground hover:text-foreground"
                      : "bg-accent text-accent-foreground hover:opacity-90"
                  }`}
                >
                  {isSubscribed ? <BellOff size={11} /> : <Bell size={11} />}
                  {isSubscribed
                    ? (lang === "it" ? "Iscritto" : "Subscribed")
                    : (lang === "it" ? "Avviami quando esce" : "Notify me when it drops")}
                </button>
              )}
              {!userId && (
                <Link
                  to="/login"
                  className="w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  <Bell size={11} />
                  {lang === "it" ? "Accedi per iscriverti" : "Log in to subscribe"}
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="glass-panel-soft rounded-[18px] px-3 py-2.5 text-xs font-sans text-muted-foreground">
                {lang === "it" ? "Nuovi capitoli in arrivo" : "New chapters coming soon"}
              </div>
              {userId && (
                <button
                  onClick={() => toggleSubscription.mutate()}
                  className={`w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans transition-colors ${
                    isSubscribed
                      ? "border border-border text-muted-foreground hover:text-foreground"
                      : "bg-accent text-accent-foreground hover:opacity-90"
                  }`}
                >
                  {isSubscribed ? <BellOff size={11} /> : <Bell size={11} />}
                  {isSubscribed
                    ? (lang === "it" ? "Iscritto" : "Subscribed")
                    : (lang === "it" ? "Avviami quando esce" : "Notify me when it drops")}
                </button>
              )}
              {!userId && (
                <Link
                  to="/login"
                  className="w-full rounded-[18px] flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-sans text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  <Bell size={11} />
                  {lang === "it" ? "Accedi per iscriverti" : "Log in to subscribe"}
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chapter list */}
      {storyId && effectiveChapters.length > 1 && (
        <div className="glass-panel rounded-[28px] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={14} className="text-accent" />
            <h3 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Capitoli" : "Chapters"}
            </h3>
          </div>
          <div className="space-y-2">
            {effectiveChapters.map((ch, i) => {
              const isPublished = !ch.status || ch.status === "published";
              return (
                <Link
                  key={ch.id}
                  to={isPublished ? `/logbook/${ch.slug}` : "#"}
                  className={`glass-panel-soft flex items-center gap-3 rounded-[20px] px-4 py-3 text-sm transition-colors ${
                    ch.id === currentArticleId
                      ? "text-accent font-medium"
                      : isPublished
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/50 pointer-events-none"
                  }`}
                >
                  <span className="glass-chip inline-flex h-7 min-w-7 items-center justify-center text-[11px] text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{lang === "en" ? ch.title_en : (ch.title_it || ch.title_en)}</span>
                  {isPublished && isRead(ch.id) && ch.id !== currentArticleId && (
                    <Eye size={10} className="text-muted-foreground" />
                  )}
                  {!isPublished && (
                    <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">{ch.status === "scheduled" ? "Sched." : "Draft"}</span>
                  )}
                </Link>
              );
            })}
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
              <SidebarLink key={a.id} article={a} currentArticleId={currentArticleId} isArticleRead={isRead(a.id)} lang={lang} />
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
              <SidebarLink key={a.id} article={a} currentArticleId={currentArticleId} isArticleRead={isRead(a.id)} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

export default ArticleSidebar;
