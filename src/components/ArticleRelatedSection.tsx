import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";

type Lang = "en" | "it";

type RelatedRow = {
  id: string;
  slug: string;
  title_en: string;
  title_it: string;
  cover_image: string | null;
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
  cover_zoom?: number | null;
  excerpt_en: string | null;
  excerpt_it: string | null;
  published_at: string | null;
};

async function fetchRecentFallback(excludeId: string): Promise<RelatedRow[]> {
  const { data, error } = await supabase
    .from("logbook_articles")
    .select(
      "id, slug, title_en, title_it, cover_image, cover_focal_x, cover_focal_y, cover_zoom, excerpt_en, excerpt_it, published_at"
    )
    .eq("status", "published")
    .neq("id", excludeId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(6);
  if (error) throw error;
  return (data || []) as RelatedRow[];
}

const ArticleRelatedSection = ({
  articleId,
  tagIds,
  lang,
}: {
  articleId: string;
  tagIds: string[];
  lang: Lang;
}) => {
  const sortedKey = [...tagIds].sort().join(",");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["related-articles", articleId, sortedKey],
    queryFn: async () => {
      if (tagIds.length > 0) {
        const { data: links, error: e1 } = await supabase
          .from("article_tags")
          .select("article_id")
          .in("tag_id", tagIds);
        if (e1) throw e1;
        const score = new Map<string, number>();
        (links || []).forEach((row: { article_id: string }) => {
          if (row.article_id === articleId) return;
          score.set(row.article_id, (score.get(row.article_id) || 0) + 1);
        });
        const sortedIds = [...score.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => id)
          .slice(0, 12);
        if (sortedIds.length === 0) return fetchRecentFallback(articleId);
        const { data: articles, error: e2 } = await supabase
          .from("logbook_articles")
          .select(
            "id, slug, title_en, title_it, cover_image, cover_focal_x, cover_focal_y, cover_zoom, excerpt_en, excerpt_it, published_at"
          )
          .in("id", sortedIds)
          .eq("status", "published");
        if (e2) throw e2;
        const order = new Map(sortedIds.map((id, i) => [id, i]));
        return (articles || [])
          .sort((a: RelatedRow, b: RelatedRow) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
          .slice(0, 6) as RelatedRow[];
      }
      return fetchRecentFallback(articleId);
    },
  });

  if (isLoading && !items.length) {
    return (
      <section className="mt-16 pt-12 border-t glass-divider">
        <div className="h-6 w-48 bg-muted animate-pulse rounded mb-8" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-3">
              <div className="aspect-[16/10] bg-muted" />
              <div className="h-4 bg-muted w-3/4" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section className="mt-16 pt-12 border-t glass-divider">
      <h2 className="glass-chip inline-flex px-4 py-2 text-xs font-sans tracking-[0.25em] uppercase text-muted-foreground mb-8">
        {lang === "it" ? "Articoli correlati" : "Related articles"}
      </h2>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const t = lang === "en" ? item.title_en : item.title_it || item.title_en;
          const ex = lang === "en" ? item.excerpt_en : item.excerpt_it || item.excerpt_en;
          const focal = clampCoverFocal(
            Number(item.cover_focal_x ?? 50),
            Number(item.cover_focal_y ?? 50),
            Number(item.cover_zoom ?? 1)
          );
          const covStyle = item.cover_image ? coverImageStyle(item.cover_image, focal) : undefined;
          return (
            <Link key={item.id} to={`/logbook/${item.slug}`} className="group block">
              <article className="glass-panel-soft rounded-[28px] p-3 transition-transform duration-reveal ease-out-expo group-hover:-translate-y-1 active:scale-[0.99]">
                <div className="glass-frame rounded-[24px] p-1.5 mb-4">
                  <div className="aspect-[16/10] overflow-hidden bg-muted relative rounded-[19px]">
                    {item.cover_image && covStyle ? (
                      <img
                        src={item.cover_image}
                        alt=""
                        className="absolute inset-0 max-w-none transition-opacity duration-reveal ease-out-expo group-hover:opacity-90"
                        style={covStyle}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/25 font-serif text-lg">
                        BITE
                      </div>
                    )}
                  </div>
                </div>
                <h3 className="editorial-heading text-base leading-snug group-hover:text-accent transition-colors duration-interaction ease-out-expo line-clamp-2 mb-1">
                  {t}
                </h3>
                {ex && (
                  <p className="text-xs font-sans text-muted-foreground line-clamp-2 leading-relaxed">{ex}</p>
                )}
              </article>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default ArticleRelatedSection;
