import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { format } from "date-fns";
import { ArrowLeft, Bell, BellOff, BookOpen, Clock, Lock, Unlock } from "lucide-react";
import ProfileCard from "@/components/ProfileCard";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { applySeo, DEFAULT_DESCRIPTION, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/seo";
import {
  articlePathForLang,
  bilingualSlugOrFilter,
  slugForLang,
  storyLocalizedPaths,
  storyPathForLang,
} from "@/lib/article-slug";

type ChapterArticle = {
  id: string;
  slug: string;
  title_en: string;
  title_it: string;
  excerpt_en: string | null;
  excerpt_it: string | null;
  cover_image: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  status: string;
  authors?: { id: string; name: string | null; avatar_url: string | null }[];
};

const StoryPage = () => {
  const { slug } = useParams();
  const { lang } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const { data: story, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: async () => {
      const safe = (slug ?? "").trim();
      if (!safe) throw new Error("Missing slug");
      const { data, error } = await supabase
        .from("stories")
        .select("*")
        .or(bilingualSlugOrFilter(safe))
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Story not found");
      return data;
    },
  });

  useEffect(() => {
    if (!story || !slug) return;
    const preferred = slugForLang(story as any, lang);
    if (preferred && preferred !== slug) {
      navigate(`/${lang}/logbook/story/${preferred}${window.location.search}${window.location.hash}`, {
        replace: true,
      });
    }
  }, [story, slug, lang, navigate]);

  // Fetch ALL articles in this story (published + scheduled + draft)
  const { data: allChapters = [] } = useQuery({
    queryKey: ["story-chapters", story?.id],
    enabled: !!story?.id,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("logbook_articles")
        .select("*") as any)
        .eq("story_id", story!.id)
        .in("status", ["published", "scheduled", "draft"])
        .order("published_at", { ascending: true, nullsFirst: true })
        .order("scheduled_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (error) throw error;

      const ids = (data || []).map((a: any) => a.id);
      if (!ids.length) return [];
      const { data: authorLinks } = await supabase.from("article_authors").select("article_id, profile_id").in("article_id", ids);
      const profileIds = [...new Set((authorLinks || []).map((a) => a.profile_id))];
      const { data: profiles } = profileIds.length
        ? await supabase.from("public_profiles").select("id, name, avatar_url").in("id", profileIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      const articleAuthorsMap: Record<string, any[]> = {};
      (authorLinks || []).forEach((link) => {
        if (!articleAuthorsMap[link.article_id]) articleAuthorsMap[link.article_id] = [];
        const profile = profileMap[link.profile_id];
        if (profile) articleAuthorsMap[link.article_id].push(profile);
      });

      return (data || []).map((article: any) => ({
        ...article,
        authors: articleAuthorsMap[article.id] || [],
      }));
    },
  });

  const publishedChapters = useMemo(
    () => allChapters.filter((c) => c.status === "published"),
    [allChapters]
  );

  const upcomingChapters = useMemo(
    () => allChapters.filter((c) => c.status !== "published"),
    [allChapters]
  );

  const isClosedComplete = story?.type === "closed" && story?.target_chapter_count != null
    && publishedChapters.length >= story.target_chapter_count;

  // Subscription status
  const { data: isSubscribed = false } = useQuery({
    queryKey: ["story-subscription", story?.id, userId],
    enabled: !!story?.id && !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("story_subscriptions")
        .select("id")
        .eq("story_id", story!.id)
        .eq("profile_id", userId!)
        .maybeSingle();
      return !!data;
    },
  });

  const toggleSubscription = useMutation({
    mutationFn: async () => {
      if (!userId || !story) return;
      if (isSubscribed) {
        await supabase.from("story_subscriptions").delete().eq("story_id", story.id).eq("profile_id", userId);
      } else {
        await supabase.from("story_subscriptions").insert({ story_id: story.id, profile_id: userId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["story-subscription", story?.id, userId] });
      toast.success(isSubscribed
        ? (lang === "it" ? "Iscrizione cancellata" : "Unsubscribed")
        : (lang === "it" ? "Iscritto! Riceverai una notifica per ogni nuovo capitolo." : "Subscribed! You'll be notified of new chapters.")
      );
    },
  });

  const title = story ? (lang === "en" ? story.title_en : (story.title_it || story.title_en)) : "";
  const desc = story ? (lang === "en" ? story.description_en : (story.description_it || story.description_en)) : "";

  useEffect(() => {
    if (!story) return;

    applySeo({
      title: `${title} | BITE`,
      description: desc || DEFAULT_DESCRIPTION,
      pathname: storyPathForLang(story as any, lang),
      localizedPaths: storyLocalizedPaths(story as any),
      image: story.cover_image,
      type: "collection",
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: title,
          description: desc || DEFAULT_DESCRIPTION,
          url: `${window.location.origin}/${lang}${storyPathForLang(story as any, lang)}`,
          mainEntity: {
            "@type": "CreativeWorkSeries",
            name: title,
            description: desc || DEFAULT_DESCRIPTION,
            url: `${window.location.origin}/${lang}${storyPathForLang(story as any, lang)}`,
          },
          hasPart: publishedChapters.map((chapter) => ({
            "@type": "Article",
            headline: lang === "en" ? chapter.title_en : chapter.title_it || chapter.title_en,
            url: `${window.location.origin}/${lang}${articlePathForLang(chapter as any, lang)}`,
            datePublished: chapter.published_at || undefined,
          })),
          publisher: { "@id": ORGANIZATION_ID },
          isPartOf: { "@id": WEBSITE_ID },
          inLanguage: lang,
        },
      ],
    });
  }, [publishedChapters, story, title, desc, lang]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center pt-20"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (!story) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Story not found.</p>
          <Link to="/logbook" className="text-accent hover:text-foreground transition-colors text-sm">← Back to Logbook</Link>
        </div>
      </div>
    );
  }

  const showSubscribe = !isClosedComplete;

  return (
    <div>
      {story.cover_image && (
        <section className="relative h-[40vh] md:h-[50vh] overflow-hidden">
          <img src={story.cover_image} alt={title} className="img-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-primary/40" />
        </section>
      )}

      <section className="page-section">
        <div className="page-section-narrow">
          <Link to="/logbook" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12">
            <ArrowLeft size={14} /> {lang === "it" ? "Torna al Logbook" : "Back to Logbook"}
          </Link>

          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={16} className="text-accent" />
            <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
              {lang === "it" ? "Storia" : "Story"}
            </span>
            <span className="glass-chip inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.15em] text-muted-foreground">
              {story.type === "closed" ? <Lock size={10} /> : <Unlock size={10} />}
              {story.type === "closed"
                ? (lang === "it" ? "Chiusa" : "Closed")
                : (lang === "it" ? "Aperta" : "Open")}
            </span>
          </div>

          <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-4">{title}</h1>
          {desc && <p className="editorial-body text-lg text-muted-foreground mb-6">{desc}</p>}

          {/* Progress for closed stories */}
          {story.type === "closed" && story.target_chapter_count != null && (
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-xs">
                <div
                  className="h-full bg-accent rounded-full transition-all"
                  style={{ width: `${Math.min((publishedChapters.length / story.target_chapter_count) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs font-sans text-muted-foreground">
                {publishedChapters.length} {lang === "it" ? "di" : "of"} {story.target_chapter_count} {lang === "it" ? "capitoli pubblicati" : "chapters published"}
              </span>
            </div>
          )}

          {/* Subscribe button — hidden when closed story is complete */}
          {showSubscribe && userId && (
            <button
              onClick={() => toggleSubscription.mutate()}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-sans font-medium transition-colors mb-12 ${
                isSubscribed
                  ? "border border-border text-muted-foreground hover:text-foreground"
                  : "bg-accent text-accent-foreground hover:opacity-90"
              }`}
            >
              {isSubscribed ? <BellOff size={14} /> : <Bell size={14} />}
              {isSubscribed
                ? (lang === "it" ? "Disiscriviti" : "Unsubscribe")
                : (lang === "it" ? "Iscriviti alla storia" : "Subscribe to story")
              }
            </button>
          )}

          {showSubscribe && !userId && (
            <p className="text-sm text-muted-foreground mb-12">
              <Link to="/login" className="text-accent hover:underline">
                {lang === "it" ? "Accedi" : "Log in"}
              </Link>
              {" "}
              {lang === "it" ? "per iscriverti e ricevere notifiche sui nuovi capitoli." : "to subscribe and get notified about new chapters."}
            </p>
          )}

          {/* Chapters */}
          <div className="space-y-8">
            <h2 className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground">
              {lang === "it"
                ? `${publishedChapters.length} Capitoli${story.type === "closed" && story.target_chapter_count != null ? ` di ${story.target_chapter_count}` : ""}`
                : `${publishedChapters.length} Chapters${story.type === "closed" && story.target_chapter_count != null ? ` of ${story.target_chapter_count}` : ""}`}
            </h2>

            {/* Published chapters */}
            {publishedChapters.map((chapter, idx) => {
              const chTitle = lang === "en" ? chapter.title_en : (chapter.title_it || chapter.title_en);
              const chExcerpt = lang === "en" ? chapter.excerpt_en : (chapter.excerpt_it || chapter.excerpt_en);
              return (
                <article key={chapter.id} className="group">
                  <div className="flex gap-6 items-start">
                    <Link
                      to={articlePathForLang(chapter as any, lang)}
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-border text-sm font-sans text-muted-foreground group-hover:border-accent group-hover:text-accent transition-colors"
                      aria-label={lang === "it" ? `Apri capitolo ${chTitle}` : `Open chapter ${chTitle}`}
                    >
                      {idx + 1}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={articlePathForLang(chapter as any, lang)} className="block">
                        <h3 className="editorial-heading text-xl md:text-2xl mb-1 group-hover:text-accent transition-colors">
                          {chTitle}
                        </h3>
                        {chExcerpt && (
                          <p className="text-sm text-muted-foreground font-sans line-clamp-2">{chExcerpt}</p>
                        )}
                      </Link>
                      <div className="flex items-center gap-3 mt-2">
                        {chapter.published_at && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(chapter.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                        {chapter.authors?.map((a: any) => (
                          <ProfileCard
                            key={a.id}
                            profileId={a.id}
                            name={a.name}
                            avatarUrl={a.avatar_url || undefined}
                            size="sm"
                          />
                        ))}
                      </div>
                    </div>
                    {chapter.cover_image && (
                      <Link
                        to={articlePathForLang(chapter as any, lang)}
                        className="hidden sm:block flex-shrink-0 w-24 h-16 overflow-hidden bg-muted"
                        aria-label={lang === "it" ? `Apri capitolo ${chTitle}` : `Open chapter ${chTitle}`}
                      >
                        <img src={chapter.cover_image} alt={chTitle} className="img-cover" loading="lazy" decoding="async" />
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}

            {/* Upcoming chapters (scheduled / draft) — non-clickable previews */}
            {upcomingChapters.map((chapter, idx) => {
              const chTitle = lang === "en" ? chapter.title_en : (chapter.title_it || chapter.title_en);
              const chapterNumber = publishedChapters.length + idx + 1;
              return (
                <article key={chapter.id} className="opacity-60">
                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-dashed border-border text-sm font-sans text-muted-foreground">
                      {chapterNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="editorial-heading text-xl md:text-2xl mb-1 text-muted-foreground">
                        {chTitle}
                      </h3>
                      <div className="flex items-center gap-3 mt-2">
                        {chapter.scheduled_at ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock size={11} />
                            {lang === "it" ? `Disponibile dal ${format(new Date(chapter.scheduled_at), "d MMM yyyy")}` : `Available from ${format(new Date(chapter.scheduled_at), "MMM d, yyyy")}`}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            {lang === "it" ? "In preparazione" : "In preparation"}
                          </span>
                        )}
                        <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground border border-border rounded-full px-2 py-0.5">
                          {chapter.status === "scheduled"
                            ? (lang === "it" ? "Pianificato" : "Scheduled")
                            : (lang === "it" ? "Bozza" : "Draft")}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            {allChapters.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {lang === "it" ? "Nessun capitolo ancora pubblicato." : "No chapters published yet."}
              </p>
            )}
          </div>

          {/* Footer link to logbook when story is complete */}
          {isClosedComplete && (
            <div className="mt-12 pt-8 border-t border-border">
              <Link
                to="/logbook"
                className="glass-panel-soft rounded-[24px] flex items-center gap-3 p-4 hover:border-accent transition-colors group"
              >
                <BookOpen size={16} className="text-accent" />
                <div>
                  <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                    {lang === "it" ? "Altri articoli" : "More articles"}
                  </span>
                  <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    {lang === "it" ? "Scopri altri articoli nel Logbook" : "Discover more articles in the Logbook"}
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default StoryPage;
