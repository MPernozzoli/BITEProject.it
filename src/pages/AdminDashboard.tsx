import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit, Trash2, Eye, LogOut, Clock, FileText, Send } from "lucide-react";
import { format } from "date-fns";

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
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
    fetchArticles();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) navigate("/admin/login");
  };

  const fetchArticles = async () => {
    const { data, error } = await supabase
      .from("logbook_articles")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error && data) setArticles(data as Article[]);
    setLoading(false);
  };

  const deleteArticle = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    await supabase.from("logbook_articles").delete().eq("id", id);
    setArticles((prev) => prev.filter((a) => a.id !== id));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-12">
          <h1 className="editorial-heading text-3xl md:text-4xl">Logbook Admin</h1>
          <div className="flex items-center gap-4">
            <Link
              to="/admin/article/new"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors"
            >
              <Plus size={16} /> New Article
            </Link>
            <button onClick={handleLogout} className="text-muted-foreground hover:text-foreground transition-colors" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : articles.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground mb-4">No articles yet.</p>
            <Link
              to="/admin/article/new"
              className="inline-flex items-center gap-2 text-sm text-accent hover:text-foreground transition-colors"
            >
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
                    <span className="text-xs font-sans tracking-wide text-muted-foreground uppercase">
                      {statusLabel(article.status)}
                    </span>
                    <span className="text-xs text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground">{article.category}</span>
                  </div>
                  <h3 className="editorial-heading text-lg truncate">
                    {article.title_en || article.title_it || "Untitled"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated {format(new Date(article.updated_at), "MMM d, yyyy HH:mm")}
                    {article.scheduled_at && article.status === "scheduled" && (
                      <> · Scheduled for {format(new Date(article.scheduled_at), "MMM d, yyyy HH:mm")}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                  {article.status === "published" && (
                    <Link to={`/logbook/${article.slug}`} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="View">
                      <Eye size={16} />
                    </Link>
                  )}
                  <Link to={`/admin/article/${article.id}`} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                    <Edit size={16} />
                  </Link>
                  <button onClick={() => deleteArticle(article.id, article.title_en)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
