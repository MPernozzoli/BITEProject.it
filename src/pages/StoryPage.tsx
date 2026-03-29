import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { format } from "date-fns";
import { ArrowLeft, Bell, BellOff, BookOpen } from "lucide-react";
import ProfileCard from "@/components/ProfileCard";
import { useState, useEffect } from "react";
import { toast } from "sonner";

const StoryPage = () => {
  const { slug } = useParams();
  const { lang } = useI18n();
  const queryClient = useQueryClient();
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
      const { data, error } = await supabase
        .from("stories")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Chapters (articles in this story, chronological)
  const { data: chapters = [] } = useQuery({
    queryKey: ["story-chapters", story?.id],
    enabled: !!story?.id,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("logbook_articles")
        .select("*") as any)
        .eq("story_id", story!.id)
        .eq("status", "published")
        .order("published_at", { ascending: true });
      if (error) throw error;

      // Fetch authors
      const ids = (data || []).map((a) => a.id);
      if (!ids.length) return [];
      const { data: authorLinks } = await supabase.from("article_authors").select("article_id, profile_id").in("article_id", ids);
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

  const title = lang === "en" ? story.title_en : (story.title_it || story.title_en);
  const desc = lang === "en" ? story.description_en : (story.description_it || story.description_en);

  return (
    <div>
      {story.cover_image && (
        <section className="relative h-[40vh] md:h-[50vh] overflow-hidden">
          <img src={story.cover_image} alt={title} className="img-cover" />
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
          </div>

          <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-4">{title}</h1>
          {desc && <p className="editorial-body text-lg text-muted-foreground mb-8">{desc}</p>}

          {/* Subscribe button */}
          {userId && (
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

          {!userId && (
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
              {lang === "it" ? `${chapters.length} Capitoli` : `${chapters.length} Chapters`}
            </h2>
            {chapters.map((chapter, idx) => {
              const chTitle = lang === "en" ? chapter.title_en : (chapter.title_it || chapter.title_en);
              const chExcerpt = lang === "en" ? chapter.excerpt_en : (chapter.excerpt_it || chapter.excerpt_en);
              return (
                <article key={chapter.id} className="group">
                  <div className="flex gap-6 items-start">
                    <Link
                      to={`/logbook/${chapter.slug}`}
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-border text-sm font-sans text-muted-foreground group-hover:border-accent group-hover:text-accent transition-colors"
                      aria-label={lang === "it" ? `Apri capitolo ${chTitle}` : `Open chapter ${chTitle}`}
                    >
                      {idx + 1}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/logbook/${chapter.slug}`} className="block">
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
                        to={`/logbook/${chapter.slug}`}
                        className="hidden sm:block flex-shrink-0 w-24 h-16 overflow-hidden bg-muted"
                        aria-label={lang === "it" ? `Apri capitolo ${chTitle}` : `Open chapter ${chTitle}`}
                      >
                        <img src={chapter.cover_image} alt={chTitle} className="img-cover" />
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
            {chapters.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {lang === "it" ? "Nessun capitolo ancora pubblicato." : "No chapters published yet."}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default StoryPage;
