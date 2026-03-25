import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, Eye, LogOut, Clock, FileText, Send, User, BookOpen, X, Navigation } from "lucide-react";
import AdminRouteManager from "@/components/admin/AdminRouteManager";
import { format } from "date-fns";
import { toast } from "sonner";

interface Article {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  category: string;
  status: string;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Story {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  description_en: string | null;
  description_it: string | null;
  cover_image: string | null;
}

const statusIcon = (status: string) => {
  switch (status) {
    case "draft": return <FileText size={14} className="text-muted-foreground" />;
    case "scheduled": return <Clock size={14} className="text-amber-600" />;
    case "published": return <Send size={14} className="text-accent" />;
    default: return null;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "draft": return "Draft";
    case "scheduled": return "Scheduled";
    case "published": return "Published";
    default: return status;
  }
};

const AdminDashboard = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeSection, setActiveSection] = useState<"articles" | "stories" | "route">("articles");
  const [showStoryForm, setShowStoryForm] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [storyForm, setStoryForm] = useState({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/login", { state: { from: "/admin" } });
      return;
    }
    // Check admin role from DB
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: session.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      toast.error("Accesso non autorizzato");
      navigate("/", { replace: true });
      return;
    }
    setAuthChecked(true);
    fetchData();
  };

  const fetchData = async () => {
    const [articlesRes, storiesRes] = await Promise.all([
      supabase.from("logbook_articles").select("*").order("updated_at", { ascending: false }),
      supabase.from("stories").select("*").order("created_at", { ascending: false }),
    ]);
    if (articlesRes.data) setArticles(articlesRes.data as Article[]);
    if (storiesRes.data) setStories(storiesRes.data as Story[]);
    setLoading(false);
  };

  const deleteArticle = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    await supabase.from("logbook_articles").delete().eq("id", id);
    setArticles((prev) => prev.filter((a) => a.id !== id));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const generateSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

  const openStoryForm = (story?: Story) => {
    if (story) {
      setEditingStory(story);
      setStoryForm({
        title_en: story.title_en,
        title_it: story.title_it,
        slug: story.slug,
        description_en: story.description_en || "",
        description_it: story.description_it || "",
      });
    } else {
      setEditingStory(null);
      setStoryForm({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
    }
    setShowStoryForm(true);
  };

  const saveStory = async () => {
    const slug = storyForm.slug || generateSlug(storyForm.title_en);
    const data = { ...storyForm, slug };
    if (editingStory) {
      await supabase.from("stories").update(data).eq("id", editingStory.id);
      toast.success("Story updated");
    } else {
      await supabase.from("stories").insert(data);
      toast.success("Story created");
    }
    setShowStoryForm(false);
    fetchData();
  };

  const deleteStory = async (id: string, title: string) => {
    if (!confirm(`Delete story "${title}"? Articles will be unlinked.`)) return;
    await supabase.from("stories").delete().eq("id", id);
    setStories((prev) => prev.filter((s) => s.id !== id));
    toast.success("Story deleted");
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Verifica accesso...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="editorial-heading text-3xl md:text-4xl">Logbook Admin</h1>
          <div className="flex items-center gap-4">
            <Link to="/admin/profile" className="text-muted-foreground hover:text-foreground transition-colors" title="Profile">
              <User size={20} />
            </Link>
            <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-6 mb-8 border-b border-border">
          <button
            onClick={() => setActiveSection("articles")}
            className={`pb-3 text-sm font-sans tracking-wide border-b-2 transition-colors ${
              activeSection === "articles" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            Articles
          </button>
          <button
            onClick={() => setActiveSection("stories")}
            className={`pb-3 text-sm font-sans tracking-wide border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeSection === "stories" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            <BookOpen size={14} /> Stories
          </button>
          <button
            onClick={() => setActiveSection("route")}
            className={`pb-3 text-sm font-sans tracking-wide border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeSection === "route" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            <Navigation size={14} /> Route
          </button>
        </div>

        {activeSection === "articles" && (
          <>
            <div className="flex justify-end mb-6">
              <Link
                to="/admin/article/new"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors"
              >
                <Plus size={16} /> New Article
              </Link>
            </div>

            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : articles.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-muted-foreground mb-4">No articles yet.</p>
                <Link to="/admin/article/new" className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors">
                  <Plus size={16} /> Create your first article
                </Link>
              </div>
            ) : (
              <div className="space-y-0">
                {articles.map((article) => (
                  <div key={article.id} className="flex items-center justify-between py-5 border-b border-border group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        {statusIcon(article.status)}
                        <span className="text-xs font-sans tracking-wide text-muted-foreground uppercase">{statusLabel(article.status)}</span>
                        <span className="text-xs text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">{article.category}</span>
                      </div>
                      <h3 className="editorial-heading text-lg truncate">{article.title_en || article.title_it || "Untitled"}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {format(new Date(article.updated_at), "MMM d, yyyy HH:mm")}
                        {article.scheduled_at && article.status === "scheduled" && (
                          <> · Scheduled for {format(new Date(article.scheduled_at), "MMM d, yyyy HH:mm")}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                      {article.status === "published" && (
                        <Link to={`/logbook/${article.slug}`} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="View"><Eye size={16} /></Link>
                      )}
                      <Link to={`/admin/article/${article.id}`} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Edit size={16} /></Link>
                      <button onClick={() => deleteArticle(article.id, article.title_en)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeSection === "stories" && (
          <>
            <div className="flex justify-end mb-6">
              <button
                onClick={() => openStoryForm()}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors"
              >
                <Plus size={16} /> New Story
              </button>
            </div>

            {showStoryForm && (
              <div className="border border-border p-6 mb-8 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="editorial-heading text-lg">{editingStory ? "Edit Story" : "New Story"}</h3>
                  <button onClick={() => setShowStoryForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Title (EN)</label>
                    <input
                      type="text"
                      value={storyForm.title_en}
                      onChange={(e) => {
                        setStoryForm((f) => ({ ...f, title_en: e.target.value, slug: f.slug || generateSlug(e.target.value) }));
                      }}
                      className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Title (IT)</label>
                    <input type="text" value={storyForm.title_it} onChange={(e) => setStoryForm((f) => ({ ...f, title_it: e.target.value }))} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Slug</label>
                  <input type="text" value={storyForm.slug} onChange={(e) => setStoryForm((f) => ({ ...f, slug: e.target.value }))} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description (EN)</label>
                    <textarea value={storyForm.description_en} onChange={(e) => setStoryForm((f) => ({ ...f, description_en: e.target.value }))} rows={2} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
                  </div>
                  <div>
                    <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-1 block">Description (IT)</label>
                    <textarea value={storyForm.description_it} onChange={(e) => setStoryForm((f) => ({ ...f, description_it: e.target.value }))} rows={2} className="w-full bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none" />
                  </div>
                </div>
                <button onClick={saveStory} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-sans font-medium hover:bg-navy-light transition-colors">
                  {editingStory ? "Update Story" : "Create Story"}
                </button>
              </div>
            )}

            {stories.length === 0 && !showStoryForm ? (
              <div className="text-center py-20">
                <p className="text-muted-foreground mb-4">No stories yet.</p>
                <button onClick={() => openStoryForm()} className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors">
                  <Plus size={16} /> Create your first story
                </button>
              </div>
            ) : (
              <div className="space-y-0">
                {stories.map((story) => (
                  <div key={story.id} className="flex items-center justify-between py-5 border-b border-border group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <BookOpen size={14} className="text-accent" />
                        <span className="text-xs font-sans tracking-wide text-accent uppercase">Story</span>
                      </div>
                      <h3 className="editorial-heading text-lg truncate">{story.title_en || story.title_it}</h3>
                      <p className="text-xs text-muted-foreground mt-1">/{story.slug}</p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                      <Link to={`/logbook/story/${story.slug}`} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="View"><Eye size={16} /></Link>
                      <button onClick={() => openStoryForm(story)} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Edit size={16} /></button>
                      <button onClick={() => deleteStory(story.id, story.title_en)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeSection === "route" && <AdminRouteManager />}
      </div>
    </div>
  );
};

export default AdminDashboard;
