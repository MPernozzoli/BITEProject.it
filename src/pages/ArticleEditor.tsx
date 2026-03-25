import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import RichTextEditor from "@/components/admin/RichTextEditor";
import AuthorSelector from "@/components/AuthorSelector";
import type { Json } from "@/integrations/supabase/types";
import { ArrowLeft, Save, Send, Image as ImageIcon } from "lucide-react";

const categories = ["Refit", "Life Aboard", "Navigation", "Remote Work", "Places", "Notes from the Boat", "Lessons Learned"];

const ArticleEditor = () => {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"en" | "it">("en");
  const [titleEn, setTitleEn] = useState("");
  const [titleIt, setTitleIt] = useState("");
  const [slug, setSlug] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [contentEn, setContentEn] = useState<object>({});
  const [contentIt, setContentIt] = useState<object>({});
  const [coverImage, setCoverImage] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [publishDate, setPublishDate] = useState("");
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, [id]);

  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/admin/login"); return; }
    setCurrentUserId(session.user.id);
    if (isNew) {
      setAuthorIds([session.user.id]);
      setPublishDate(new Date().toISOString().slice(0, 16));
    } else {
      loadArticle(session.user.id);
    }
  };

  const loadArticle = async (userId: string) => {
    const { data, error } = await supabase.from("logbook_articles").select("*").eq("id", id).single();
    if (error || !data) { navigate("/admin"); return; }
    setTitleEn(data.title_en || "");
    setTitleIt(data.title_it || "");
    setSlug(data.slug || "");
    setExcerptEn(data.excerpt_en || "");
    setExcerptIt(data.excerpt_it || "");
    setContentEn(data.content_en as object || {});
    setContentIt(data.content_it as object || {});
    setCoverImage(data.cover_image || "");
    setCategory(data.category || categories[0]);
    setPublishDate(data.published_at ? new Date(data.published_at).toISOString().slice(0, 16) : data.scheduled_at ? new Date(data.scheduled_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16));

    // Load authors
    const { data: authorsData } = await supabase.from("article_authors").select("profile_id").eq("article_id", id);
    if (authorsData?.length) {
      setAuthorIds(authorsData.map((a) => a.profile_id));
    } else {
      setAuthorIds([userId]);
    }
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

  const handleTitleEnChange = (val: string) => {
    setTitleEn(val);
    if (isNew || !slug) setSlug(generateSlug(val));
  };

  const handleCoverUpload = async (file: File) => {
    const ext = file.name.split(".").pop();
    const path = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file);
    if (error) { console.error("Cover upload error:", error); return; }
    const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
    setCoverImage(urlData.publicUrl);
  };

  const saveArticle = useCallback(async (action: "draft" | "publish") => {
    setSaving(true);
    const selectedDate = publishDate ? new Date(publishDate) : new Date();
    const now = new Date();
    const isFuture = selectedDate > now;

    let finalStatus: "draft" | "scheduled" | "published";
    let publishedAt: string | null = null;
    let scheduledAt: string | null = null;

    if (action === "draft") {
      finalStatus = "draft";
    } else if (isFuture) {
      finalStatus = "scheduled";
      scheduledAt = selectedDate.toISOString();
    } else {
      finalStatus = "published";
      publishedAt = selectedDate.toISOString();
    }

    const articleData = {
      title_en: titleEn,
      title_it: titleIt,
      slug,
      excerpt_en: excerptEn,
      excerpt_it: excerptIt,
      content_en: contentEn as Json,
      content_it: contentIt as Json,
      cover_image: coverImage,
      category,
      status: finalStatus,
      published_at: publishedAt,
      scheduled_at: scheduledAt,
    };

    let articleId = id;
    if (isNew) {
      const { data, error } = await supabase.from("logbook_articles").insert(articleData).select().single();
      if (!error && data) {
        articleId = data.id;
        navigate(`/admin/article/${data.id}`, { replace: true });
      }
    } else {
      await supabase.from("logbook_articles").update(articleData).eq("id", id);
    }

    // Save authors
    if (articleId && articleId !== "new") {
      await supabase.from("article_authors").delete().eq("article_id", articleId);
      if (authorIds.length > 0) {
        await supabase.from("article_authors").insert(
          authorIds.map((profileId) => ({ article_id: articleId!, profile_id: profileId }))
        );
      }
    }

    setSaving(false);
  }, [titleEn, titleIt, slug, excerptEn, excerptIt, contentEn, contentIt, coverImage, category, publishDate, authorIds, id, isNew, navigate]);

  const selectedDate = publishDate ? new Date(publishDate) : new Date();
  const isFuture = selectedDate > new Date();

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button onClick={() => navigate("/admin")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => saveArticle("draft")} disabled={saving} className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-sans hover:bg-muted transition-colors disabled:opacity-50">
              <Save size={14} /> Save Draft
            </button>
            <button onClick={() => saveArticle("publish")} disabled={saving} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50">
              <Send size={14} /> {isFuture ? "Schedule" : "Publish"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Main content */}
          <div className="space-y-6">
            <div className="flex gap-4 border-b border-border">
              <button onClick={() => setActiveTab("en")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "en" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>English</button>
              <button onClick={() => setActiveTab("it")} className={`pb-3 text-sm font-sans tracking-wide transition-colors border-b-2 ${activeTab === "it" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>Italiano</button>
            </div>

            {activeTab === "en" ? (
              <input type="text" value={titleEn} onChange={(e) => handleTitleEnChange(e.target.value)} placeholder="Article title (English)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            ) : (
              <input type="text" value={titleIt} onChange={(e) => setTitleIt(e.target.value)} placeholder="Titolo articolo (Italiano)" className="w-full bg-transparent font-serif text-3xl md:text-4xl font-bold focus:outline-none placeholder:text-muted-foreground/30" />
            )}

            {activeTab === "en" ? (
              <textarea value={excerptEn} onChange={(e) => setExcerptEn(e.target.value)} placeholder="Short excerpt (English)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            ) : (
              <textarea value={excerptIt} onChange={(e) => setExcerptIt(e.target.value)} placeholder="Breve estratto (Italiano)..." rows={2} className="w-full bg-transparent border-b border-border py-3 text-foreground/80 font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
            )}

            {activeTab === "en" ? (
              <RichTextEditor content={contentEn} onChange={setContentEn} placeholder="Start writing your article in English..." />
            ) : (
              <RichTextEditor content={contentIt} onChange={setContentIt} placeholder="Inizia a scrivere l'articolo in italiano..." />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Cover image */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3 block">Cover Image</label>
              {coverImage ? (
                <div className="relative aspect-[16/10] overflow-hidden mb-2 group">
                  <img src={coverImage} alt="Cover" className="img-cover" />
                  <button onClick={() => setCoverImage("")} className="absolute top-2 right-2 bg-primary/80 text-primary-foreground px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">Remove</button>
                </div>
              ) : (
                <button onClick={() => coverInputRef.current?.click()} className="w-full aspect-[16/10] border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-accent hover:text-accent transition-colors">
                  <ImageIcon size={24} />
                </button>
              )}
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCoverUpload(file); e.target.value = ""; }} />
            </div>

            {/* Slug */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug</label>
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors">
                {categories.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
              </select>
            </div>

            {/* Publish date */}
            <div>
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                {isFuture ? "Schedule for" : "Publish date"}
              </label>
              <input type="datetime-local" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
              {isFuture && <p className="text-xs text-amber-600 mt-1">This article will be scheduled for future publication.</p>}
            </div>

            {/* Authors */}
            <AuthorSelector selectedIds={authorIds} onChange={setAuthorIds} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArticleEditor;
