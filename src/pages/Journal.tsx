import { useI18n } from "@/lib/i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import ProfileCard from "@/components/ProfileCard";

const categories = ["All", "Refit", "Life Aboard", "Navigation", "Remote Work", "Places", "Notes from the Boat", "Lessons Learned"];

const Journal = () => {
  const { t, lang } = useI18n();
  const [activeCategory, setActiveCategory] = useState("All");

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["logbook-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;

      // Fetch authors for all articles
      const ids = (data || []).map((a) => a.id);
      const { data: authorLinks } = await supabase
        .from("article_authors")
        .select("article_id, profile_id")
        .in("article_id", ids);

      const profileIds = [...new Set((authorLinks || []).map((a) => a.profile_id))];
      const { data: profiles } = profileIds.length
        ? await supabase.from("profiles").select("id, name, avatar_url").in("id", profileIds)
        : { data: [] };

      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      const articleAuthorsMap: Record<string, any[]> = {};
      (authorLinks || []).forEach((link) => {
        if (!articleAuthorsMap[link.article_id]) articleAuthorsMap[link.article_id] = [];
        const profile = profileMap[link.profile_id];
        if (profile) articleAuthorsMap[link.article_id].push(profile);
      });

      return (data || []).map((article) => ({
        ...article,
        authors: articleAuthorsMap[article.id] || [],
      }));
    },
  });

  const filtered = activeCategory === "All" ? articles : articles.filter((a) => a.category === activeCategory);

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

      {/* Categories */}
      <section className="px-6 md:px-12 pb-12">
        <div className="page-section-wide">
          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`text-xs font-sans tracking-wide px-4 py-2 border transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Articles */}
      <section className="px-6 md:px-12 pb-20 md:pb-32">
        <div className="page-section-wide">
          {isLoading ? (
            <p className="text-muted-foreground text-center py-20">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-20">No entries yet.</p>
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
                          <div className="flex items-center gap-4 mb-4">
                            <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                              {article.category}
                            </span>
                            {article.published_at && (
                              <>
                                <span className="text-xs text-muted-foreground/40">·</span>
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(article.published_at), "MMM d, yyyy")}
                                </span>
                              </>
                            )}
                          </div>
                          <h2 className="editorial-heading text-2xl md:text-3xl lg:text-4xl mb-4 group-hover:text-accent transition-colors">
                            {title}
                          </h2>
                          <p className="editorial-body text-muted-foreground leading-relaxed">
                            {excerpt}
                          </p>
                          {article.authors?.length > 0 && (
                            <div className="flex items-center gap-3 mt-4">
                              {article.authors.map((a: any) => (
                                <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
                              ))}
                            </div>
                          )}
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
