import { useI18n } from "@/lib/i18n";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Search, TrendingUp, Clock, BookOpen, Eye } from "lucide-react";
import ProfileCard from "@/components/ProfileCard";
import { useArticleReads } from "@/hooks/useArticleReads";

const Journal = () => {
  const { t, lang } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recent" | "popular">("recent");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { isRead } = useArticleReads();

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["logbook-articles-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;

      const ids = (data || []).map((a) => a.id);
      if (!ids.length) return [];

      const [authorRes, tagRes, likeRes] = await Promise.all([
        supabase.from("article_authors").select("article_id, profile_id").in("article_id", ids),
        supabase.from("article_tags").select("article_id, tag_id, tags(id, name)").in("article_id", ids),
        supabase.from("article_likes").select("article_id").in("article_id", ids),
      ]);

      const profileIds = [...new Set((authorRes.data || []).map((a) => a.profile_id))];
      const { data: profiles } = profileIds.length
        ? await supabase.from("profiles").select("id, name, avatar_url").in("id", profileIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

      const articleAuthorsMap: Record<string, any[]> = {};
      (authorRes.data || []).forEach((link) => {
        if (!articleAuthorsMap[link.article_id]) articleAuthorsMap[link.article_id] = [];
        const profile = profileMap[link.profile_id];
        if (profile) articleAuthorsMap[link.article_id].push(profile);
      });

      const articleTagsMap: Record<string, { id: string; name: string }[]> = {};
      (tagRes.data || []).forEach((link: any) => {
        if (!articleTagsMap[link.article_id]) articleTagsMap[link.article_id] = [];
        if (link.tags) articleTagsMap[link.article_id].push(link.tags);
      });

      const likeCounts: Record<string, number> = {};
      (likeRes.data || []).forEach((like) => {
        likeCounts[like.article_id] = (likeCounts[like.article_id] || 0) + 1;
      });

      return (data || []).map((article) => ({
        ...article,
        authors: articleAuthorsMap[article.id] || [],
        tags: articleTagsMap[article.id] || [],
        likeCount: likeCounts[article.id] || 0,
      }));
    },
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      return data || [];
    },
  });

  const { data: stories = [] } = useQuery({
    queryKey: ["stories-list"],
    queryFn: async () => {
      const { data } = await supabase.from("stories").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const filtered = useMemo(() => {
    let result = [...articles];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => {
        const title = (lang === "en" ? a.title_en : a.title_it || a.title_en).toLowerCase();
        const excerpt = (lang === "en" ? a.excerpt_en : a.excerpt_it || a.excerpt_en || "").toLowerCase();
        const tagMatch = a.tags?.some((t: any) => t.name.toLowerCase().includes(q));
        const authorMatch = a.authors?.some((au: any) => au.name.toLowerCase().includes(q));
        return title.includes(q) || excerpt.includes(q) || tagMatch || authorMatch;
      });
    }

    if (selectedTags.length > 0) {
      result = result.filter((a) =>
        selectedTags.every((tagId) => a.tags?.some((t: any) => t.id === tagId))
      );
    }

    if (activeTab === "popular") {
      result.sort((a, b) => b.likeCount - a.likeCount);
    }

    return result;
  }, [articles, searchQuery, selectedTags, activeTab, lang]);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  // Split: featured (first article) + rest
  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div>
      {/* Header */}
      <section className="pt-32 pb-8 md:pt-40 md:pb-12 px-6 md:px-12">
        <div className="page-section-wide">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("journal.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground max-w-2xl">
            {t("journal.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Controls */}
      <section className="px-6 md:px-12 pb-6">
        <div className="page-section-wide">
          <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between mb-6">
            {/* Search */}
            <div className="relative flex-1 max-w-lg">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === "it" ? "Cerca articoli..." : "Search articles..."}
                className="w-full bg-transparent border border-border pl-10 pr-4 py-2.5 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-muted p-1">
              <button
                onClick={() => setActiveTab("recent")}
                className={`inline-flex items-center gap-1.5 text-xs font-sans tracking-wide px-4 py-2 transition-colors ${
                  activeTab === "recent"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Clock size={12} />
                {lang === "it" ? "Recenti" : "Recent"}
              </button>
              <button
                onClick={() => setActiveTab("popular")}
                className={`inline-flex items-center gap-1.5 text-xs font-sans tracking-wide px-4 py-2 transition-colors ${
                  activeTab === "popular"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp size={12} />
                {lang === "it" ? "Popolari" : "Popular"}
              </button>
            </div>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`text-xs font-sans px-3 py-1.5 border transition-all ${
                    selectedTags.includes(tag.id)
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                  }`}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Stories */}
      {stories.length > 0 && !searchQuery && selectedTags.length === 0 && (
        <section className="px-6 md:px-12 pb-10">
          <div className="page-section-wide">
            <div className="flex items-center gap-2 mb-5">
              <BookOpen size={14} className="text-accent" />
              <h2 className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                {lang === "it" ? "Storie" : "Stories"}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {stories.map((story) => {
                const title = lang === "en" ? story.title_en : (story.title_it || story.title_en);
                const desc = lang === "en" ? story.description_en : (story.description_it || story.description_en);
                return (
                  <Link
                    key={story.id}
                    to={`/logbook/story/${story.slug}`}
                    className="group border border-border hover:border-accent transition-all overflow-hidden"
                  >
                    {story.cover_image && (
                      <div className="aspect-[21/9] overflow-hidden">
                        <img src={story.cover_image} alt={title} className="img-cover group-hover:scale-105 transition-transform duration-700" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="editorial-heading text-base mb-1.5 group-hover:text-accent transition-colors">
                        {title}
                      </h3>
                      {desc && (
                        <p className="text-xs text-muted-foreground font-sans line-clamp-2">{desc}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Articles */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="aspect-[16/10] bg-muted mb-4" />
                  <div className="h-4 bg-muted w-3/4 mb-2" />
                  <div className="h-3 bg-muted w-1/2" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-20">
              {lang === "it" ? "Nessun risultato." : "No entries found."}
            </p>
          ) : (
            <div className="space-y-12">
              {/* Featured article */}
              {featured && (
                <Link to={`/logbook/${featured.slug}`} className="block group">
                  <article className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 items-center">
                    <div className="aspect-[16/10] overflow-hidden bg-muted relative">
                      {featured.cover_image ? (
                        <img src={featured.cover_image} alt="" className="img-cover group-hover:scale-105 transition-transform duration-700" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-4xl">BITE</div>
                      )}
                      {isRead(featured.id) && (
                        <span className="absolute top-3 left-3 inline-flex items-center gap-1 text-[10px] font-sans bg-background/90 backdrop-blur-sm text-muted-foreground px-2 py-1">
                          <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        {featured.tags?.map((tag: any) => (
                          <span key={tag.id} className="text-xs font-sans text-accent">#{tag.name}</span>
                        ))}
                        {featured.published_at && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(featured.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      <h2 className="editorial-heading text-2xl md:text-3xl lg:text-4xl mb-3 group-hover:text-accent transition-colors">
                        {lang === "en" ? featured.title_en : (featured.title_it || featured.title_en)}
                      </h2>
                      <p className="editorial-body text-muted-foreground leading-relaxed line-clamp-3 mb-4">
                        {lang === "en" ? featured.excerpt_en : (featured.excerpt_it || featured.excerpt_en)}
                      </p>
                      <div className="flex items-center gap-4">
                        {featured.authors?.length > 0 && featured.authors.map((a: any) => (
                          <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
                        ))}
                        {featured.likeCount > 0 && (
                          <span className="text-xs text-muted-foreground">♥ {featured.likeCount}</span>
                        )}
                      </div>
                    </div>
                  </article>
                </Link>
              )}

              {/* Grid of remaining articles */}
              {rest.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
                  {rest.map((article) => {
                    const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
                    const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);
                    return (
                      <Link to={`/logbook/${article.slug}`} key={article.id} className="block group">
                        <article>
                          <div className="aspect-[16/10] overflow-hidden bg-muted mb-4 relative">
                            {article.cover_image ? (
                              <img src={article.cover_image} alt={title} className="img-cover group-hover:scale-105 transition-transform duration-700" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground/20 font-serif text-xl">BITE</div>
                            )}
                            {isRead(article.id) && (
                              <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-sans bg-background/90 backdrop-blur-sm text-muted-foreground px-2 py-0.5">
                                <Eye size={10} /> {lang === "it" ? "Letto" : "Read"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {article.tags?.slice(0, 2).map((tag: any) => (
                              <span key={tag.id} className="text-[11px] font-sans text-accent">#{tag.name}</span>
                            ))}
                            {article.published_at && (
                              <span className="text-[11px] text-muted-foreground">
                                {format(new Date(article.published_at), "MMM d")}
                              </span>
                            )}
                          </div>
                          <h3 className="editorial-heading text-lg md:text-xl mb-2 group-hover:text-accent transition-colors line-clamp-2">
                            {title}
                          </h3>
                          <p className="text-sm text-muted-foreground font-sans line-clamp-2 mb-3">{excerpt}</p>
                          <div className="flex items-center gap-3">
                            {article.authors?.slice(0, 2).map((a: any) => (
                              <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
                            ))}
                            {article.likeCount > 0 && (
                              <span className="text-xs text-muted-foreground ml-auto">♥ {article.likeCount}</span>
                            )}
                          </div>
                        </article>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Journal;
