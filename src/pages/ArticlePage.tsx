import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { generateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { ArrowLeft, BookOpen } from "lucide-react";
import { format } from "date-fns";
import ProfileCard from "@/components/ProfileCard";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import CommentSection from "@/components/CommentSection";

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Image,
  LinkExt,
  Youtube.configure({ width: 640, height: 360 }),
  TextStyle,
  Color,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Underline,
];

const ArticlePage = () => {
  const { slug } = useParams();
  const { lang } = useI18n();

  const { data: article, isLoading } = useQuery({
    queryKey: ["article", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logbook_articles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: authors = [] } = useQuery({
    queryKey: ["article-authors", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const { data: authorLinks } = await supabase
        .from("article_authors")
        .select("profile_id")
        .eq("article_id", article!.id);
      if (!authorLinks?.length) return [];
      const ids = authorLinks.map((a) => a.profile_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", ids);
      return profiles || [];
    },
  });

  // Fetch tags
  const { data: tags = [] } = useQuery({
    queryKey: ["article-tags", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("article_tags")
        .select("tag_id, tags(id, name)")
        .eq("article_id", article!.id);
      return (data || []).map((d: any) => d.tags).filter(Boolean);
    },
  });

  // Fetch story info if article belongs to one
  const { data: story } = useQuery({
    queryKey: ["article-story", article?.id],
    enabled: !!article?.id,
    queryFn: async () => {
      const storyId = (article as any)?.story_id;
      if (!storyId) return null;
      const { data } = await supabase.from("stories").select("*").eq("id", storyId).single();
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Article not found.</p>
          <Link to="/logbook" className="text-accent hover:text-foreground transition-colors text-sm">
            ← Back to Logbook
          </Link>
        </div>
      </div>
    );
  }

  const title = lang === "en" ? article.title_en : (article.title_it || article.title_en);
  const content = lang === "en" ? article.content_en : (article.content_it || article.content_en);
  const htmlContent = content && typeof content === "object" && Object.keys(content).length > 0
    ? generateHTML(content as any, extensions)
    : "";

  return (
    <div>
      {article.cover_image && (
        <section className="relative h-[50vh] md:h-[60vh] overflow-hidden">
          <img src={article.cover_image} alt={title} className="img-cover" />
          <div className="absolute inset-0 bg-primary/40" />
        </section>
      )}

      <article className="page-section">
        <div className="page-section-narrow">
          <Link
            to="/logbook"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
          >
            <ArrowLeft size={14} /> Back to Logbook
          </Link>

          <div className="flex items-center gap-3 mb-6 flex-wrap">
            {tags.length > 0 && tags.map((tag: any) => (
              <span key={tag.id} className="text-xs font-sans text-accent">#{tag.name}</span>
            ))}
            {article.published_at && (
              <span className="text-xs text-muted-foreground">
                {format(new Date(article.published_at), "MMMM d, yyyy")}
              </span>
            )}
          </div>

          {/* Story banner */}
          {story && (
            <Link
              to={`/logbook/story/${story.slug}`}
              className="flex items-center gap-3 mb-8 p-4 border border-border hover:border-accent transition-colors group"
            >
              <BookOpen size={16} className="text-accent flex-shrink-0" />
              <div>
                <span className="text-xs font-sans tracking-[0.2em] uppercase text-accent">
                  {lang === "it" ? "Parte della storia" : "Part of story"}
                </span>
                <p className="editorial-heading text-sm group-hover:text-accent transition-colors">
                  {lang === "en" ? story.title_en : (story.title_it || story.title_en)}
                </p>
              </div>
            </Link>
          )}

          <h1 className="editorial-heading text-3xl md:text-5xl lg:text-6xl mb-6">
            {title}
          </h1>

          {/* Authors */}
          {authors.length > 0 && (
            <div className="flex items-center gap-4 mb-8">
              <span className="text-xs text-muted-foreground">by</span>
              {authors.map((a: any) => (
                <ProfileCard key={a.id} name={a.name} avatarUrl={a.avatar_url || undefined} size="sm" />
              ))}
            </div>
          )}

          {htmlContent && (
            <div
              className="prose prose-lg max-w-none prose-headings:font-serif prose-headings:tracking-tight prose-p:font-sans prose-p:leading-relaxed prose-a:text-accent prose-img:rounded-sm prose-blockquote:border-accent prose-blockquote:font-serif prose-blockquote:italic"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          )}

          {/* Like & Share */}
          <div className="flex items-center gap-6 mt-12 pt-8 border-t border-border">
            <LikeButton articleId={article.id} />
            <ShareButton title={title} />
          </div>

          {/* Comments */}
          <CommentSection articleId={article.id} />
        </div>
      </article>
    </div>
  );
};

export default ArticlePage;
