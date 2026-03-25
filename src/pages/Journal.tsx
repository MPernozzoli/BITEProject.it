import { useI18n } from "@/lib/i18n";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Search, TrendingUp, Clock, BookOpen } from "lucide-react";
import ProfileCard from "@/components/ProfileCard";

const Journal = () => {
  const { t, lang } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recent" | "popular">("recent");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Fetch articles with authors, tags, and like counts
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

      // Fetch authors, tags, and likes in parallel
      const [authorRes, tagRes, likeRes] = await Promise.all([
        supabase.from("article_authors").select("article_id, profile_id").in("article_id", ids),
        supabase.from("article_tags").select("article_id, tag_id, tags(id, name)").in("article_id", ids),
        supabase.from("article_likes").select("article_id").in("article_id", ids),
      ]);

      // Build profile map
      const profileIds = [...new Set((authorRes.data || []).map((a) => a.profile_id))];
      const { data: profiles } = profileIds.length
        ? await supabase.from("profiles").select("id, name, avatar_url").in("id", profileIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

      // Build maps
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

  // Fetch all tags
  const { data: allTags = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      return data || [];
    },
  });

  // Fetch stories
  const { data: stories = [] } = useQuery({
    queryKey: ["stories-list"],
    queryFn: async () => {
      const { data } = await supabase.from("stories").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  // Filter and sort
  const filtered = useMemo(() => {
    let result = [...articles];

    // Search
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

    // Tag filter
    if (selectedTags.length > 0) {
      result = result.filter((a) =>
        selectedTags.every((tagId) => a.tags?.some((t: any) => t.id === tagId))
      );
    }

    // Sort
    if (activeTab === "popular") {
      result.sort((a, b) => b.likeCount - a.likeCount);
    }
    // "recent" is already sorted by published_at desc from the query

    return result;
  }, [articles, searchQuery, selectedTags, activeTab, lang]);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  return (
    <div>
      <section className="pt-32 pb-12 md:pt-40 md:pb-16 px-6 md:px-12">
        <div className="page-section-wide">
          <h1 className="editorial-heading text-4xl md:text-6xl lg:text-7xl mb-4">
            {t("journal.page.title")}
          </h1>
          <p className="editorial-body text-lg text-muted-foreground">
            {t("journal.page.subtitle")}
          </p>
        </div>
      </section>

      {/* Search & Tabs */}
      <section className="px-6 md:px-12 pb-8">
        <div className="page-section-wide">
          {/* Search bar */}
          <div className="relative mb-6">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === "it" ? "Cerca per titolo, hashtag, autore o contenuto..." : "Search by title, hashtag, author or content..."}
              className="w-full bg-transparent border border-border pl-12 pr-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-6 mb-6">
            <button
              onClick={() => setActiveTab("recent")}
              className={`inline-flex items-center gap-2 text-sm font-sans tracking-wide pb-2 border-b-2 transition-colors ${
                activeTab === "recent"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Clock size={14} />
              {lang === "it" ? "Recenti" : "Recent"}
            </button>
            <button
              onClick={() => setActiveTab("popular")}
              className={`inline-flex items-center gap-2 text-sm font-sans tracking-wide pb-2 border-b-2 transition-colors ${
                activeTab === "popular"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TrendingUp size={14} />
              {lang === "it" ? "Popolari" : "Popular"}
            </button>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`text-xs font-sans px-3 py-1.5 border transition-colors ${
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
      {stories.length > 0 && (
        <section className="px-6 md:px-12 pb-12">
          <div className="page-section-wide">
            <div className="flex items-center gap-2 mb-6">
              <BookOpen size={16} className="text-accent" />
              <h2 className="text-sm font-sans tracking-[0.2em] uppercase text-accent">
                {lang === "it" ? "Storie" : "Stories"}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {stories.map((story) => {
                const title = lang === "en" ? story.title_en : (story.title_it || story.title_en);
                const desc = lang === "en" ? story.description_en : (story.description_it || story.description_en);
                return (
                  <Link
                    key={story.id}
                    to={`/logbook/story/${story.slug}`}
                    className="group border border-border p-6 hover:border-accent transition-colors"
                  >
                    {story.cover_image && (
                      <div className="aspect-[16/9] overflow-hidden mb-4 -mx-6 -mt-6">
                        <img src={story.cover_image} alt={title} className="img-cover group-hover:scale-105 transition-transform duration-700" />
                      </div>
                    )}
                    <h3 className="editorial-heading text-lg mb-2 group-hover:text-accent transition-colors">
                      {title}
                    </h3>
                    {desc && (
                      <p className="text-sm text-muted-foreground font-sans line-clamp-2">{desc}</p>
                    )}
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
            <p className="text-muted-foreground text-center py-20">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-20">
              {lang === "it" ? "Nessun risultato." : "No entries found."}
            </p>
          ) : (
            <div className="space-y-16">
              {filtered.map((article, i) => {
                const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
                const excerpt = lang === "en" ? article.excerpt_en : (article.excerpt_it || article.excerpt_en);
                return (
                  <Link to={`/logbook/${article.slug}`} key={article.id} className="block group">
                    <article>
                      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center`}>
                        <div className={`aspect-[16/10] overflow-hidden bg-muted ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                          {article.cover_image ? (
                            <img
                              src={article.cover_image}
                              alt={title}
                              className="img-cover group-hover:scale-105 transition-transform duration-700"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 font-serif text-2xl">
                              BITE
                            </div>
                          )}
                        </div>
                        <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                          <div className="flex items-center gap-3 mb-4 flex-wrap">
                            {article.tags?.map((tag: any) => (
                              <span key={tag.id} className="text-xs font-sans text-accent">
                                #{tag.name}
                              </span>
                            ))}
                            {article.published_at && (
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(article.published_at), "MMM d, yyyy")}
                              </span>
                            )}
                          </div>
                          <h2 className="editorial-heading text-2xl md:text-3xl lg:text-4xl mb-4 group-hover:text-accent transition-colors">
                            {title}
                          </h2>
                          <p className="editorial-body text-muted-foreground leading-relaxed">
                            {excerpt}
                          </p>
                          <div className="flex items-center gap-4 mt-4">
                            {article.authors?.length > 0 && (
                              <div className="flex items-center gap-3">
                                {article.authors.map((a: any) => (
                                  <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
                                ))}
                              </div>
                            )}
                            {article.likeCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                ♥ {article.likeCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Journal;
