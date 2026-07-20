import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Edit, Eye, FileText, Plus, Send, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { useAuth } from "@/hooks/useAuth";
import {
  AdminCollapsibleListFilters,
  adminFilterDateInputClass,
  adminFilterLabelClass,
  adminFilterSelectClass,
  getDateOnlyValue,
  isDateWithinRange,
} from "@/components/admin/AdminCollapsibleListFilters";

interface Article {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  category: string;
  editorial_type?: "pillar" | "support" | "utility_reflection" | null;
  status: string;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

type ArticleListFilters = {
  status: "all" | "draft" | "scheduled" | "published";
  category: string;
  editorialType: "all" | "pillar" | "support" | "utility_reflection" | "unset";
  dateFilterMode: "created" | "updated" | "published" | "scheduled";
  dateFrom: string;
  dateTo: string;
};

type ArticleListSort = {
  field: "updated_at" | "created_at" | "published_at" | "status" | "category";
  direction: "asc" | "desc";
};

const emptyArticleListFilters: ArticleListFilters = {
  status: "all",
  category: "all",
  editorialType: "all",
  dateFilterMode: "updated",
  dateFrom: "",
  dateTo: "",
};

const defaultArticleListSort: ArticleListSort = {
  field: "updated_at",
  direction: "desc",
};

const articleFilterDate = (article: Article, mode: ArticleListFilters["dateFilterMode"]) => {
  switch (mode) {
    case "created":
      return getDateOnlyValue(article.created_at);
    case "updated":
      return getDateOnlyValue(article.updated_at);
    case "published":
      return getDateOnlyValue(article.published_at);
    case "scheduled":
      return getDateOnlyValue(article.scheduled_at);
  }
};

const statusIcon = (status: string) => {
  switch (status) {
    case "draft":
      return <FileText size={14} className="text-muted-foreground" />;
    case "scheduled":
      return <Clock size={14} className="text-amber-600" />;
    case "published":
      return <Send size={14} className="text-accent" />;
    default:
      return null;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "draft":
      return "Draft";
    case "scheduled":
      return "Scheduled";
    case "published":
      return "Published";
    default:
      return status;
  }
};

const AdminArticles = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const userId = session?.user?.id ?? null;
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ArticleListFilters>(emptyArticleListFilters);
  const [sort, setSort] = useState<ArticleListSort>(defaultArticleListSort);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filtersAdvanced, setFiltersAdvanced] = useState(false);

  const fetchArticles = useCallback(async () => {
    if (!userId && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const { data, error } = await supabase.from("logbook_articles").select("*").order("updated_at", { ascending: false });
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/articles" } });
      setLoading(false);
      return;
    }
    if (data) setArticles(data as unknown as Article[]);
    setLoading(false);
  }, [navigate, userId]);

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

  const deleteArticle = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    await supabase.from("logbook_articles").delete().eq("id", id);
    setArticles((prev) => prev.filter((a) => a.id !== id));
  };

  const articleCategories = useMemo(() => {
    const next = new Set<string>();
    articles.forEach((article) => {
      const raw = article.category?.trim();
      if (raw) next.add(raw);
    });
    return [...next].sort((a, b) => a.localeCompare(b));
  }, [articles]);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.category !== "all" ||
    filters.editorialType !== "all" ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  const filteredArticles = useMemo(
    () =>
      articles.filter((article) => {
        if (filters.status !== "all" && article.status !== filters.status) return false;
        if (filters.category !== "all" && article.category !== filters.category) return false;
        if (filters.editorialType === "unset" && article.editorial_type) return false;
        if (filters.editorialType !== "all" && filters.editorialType !== "unset" && article.editorial_type !== filters.editorialType)
          return false;
        const d = articleFilterDate(article, filters.dateFilterMode);
        return isDateWithinRange(d, filters.dateFrom, filters.dateTo);
      }),
    [articles, filters]
  );

  const visibleArticles = useMemo(() => {
    const mult = sort.direction === "asc" ? 1 : -1;
    return [...filteredArticles].sort((left, right) => {
      let comparison = 0;
      switch (sort.field) {
        case "updated_at":
          comparison = (left.updated_at || "").localeCompare(right.updated_at || "");
          break;
        case "created_at":
          comparison = (left.created_at || "").localeCompare(right.created_at || "");
          break;
        case "published_at":
          comparison = (left.published_at || "").localeCompare(right.published_at || "");
          break;
        case "status":
          comparison = left.status.localeCompare(right.status);
          break;
        case "category":
          comparison = left.category.localeCompare(right.category);
          break;
      }
      return comparison * mult;
    });
  }, [filteredArticles, sort]);

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <section className="glass-panel rounded-[34px] px-5 py-6 md:px-8 md:py-8">
          <Link
            to="/admin"
            className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
          >
            <ArrowLeft size={14} />
            Torna alla Dashboard
          </Link>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Publishing</p>
              <h1 className="editorial-heading text-3xl md:text-5xl">Articoli</h1>
            </div>
            <Link
              to="/admin/article/new"
              className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
            >
              <Plus size={16} />
              Nuovo articolo
            </Link>
          </div>
        </section>

        <section className="glass-panel rounded-[34px] p-5 md:p-6 lg:p-8 space-y-6">
          <AdminCollapsibleListFilters
            title="Filtri articoli"
            expanded={filtersExpanded}
            onToggleExpanded={() => setFiltersExpanded((open) => !open)}
            visibleCount={visibleArticles.length}
            totalCount={articles.length}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={() => setFilters(emptyArticleListFilters)}
            advancedOpen={filtersAdvanced}
            onToggleAdvanced={() => setFiltersAdvanced((open) => !open)}
            minimalRow={
              <>
                <div className="min-w-[6.5rem] flex-1">
                  <label className={adminFilterLabelClass}>Stato</label>
                  <select
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ArticleListFilters["status"] }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="all">Tutti</option>
                    <option value="draft">Bozza</option>
                    <option value="scheduled">Programmato</option>
                    <option value="published">Pubblicato</option>
                  </select>
                </div>
                <div className="min-w-[6.5rem] flex-1">
                  <label className={adminFilterLabelClass}>Categoria</label>
                  <select
                    value={filters.category}
                    onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="all">Tutte</option>
                    {articleCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[8.5rem] flex-1">
                  <label className={adminFilterLabelClass}>Tipo editoriale</label>
                  <select
                    value={filters.editorialType}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, editorialType: event.target.value as ArticleListFilters["editorialType"] }))
                    }
                    className={adminFilterSelectClass}
                  >
                    <option value="all">Tutti</option>
                    <option value="pillar">Pillar</option>
                    <option value="support">Support</option>
                    <option value="utility_reflection">Utility / Reflection</option>
                    <option value="unset">Non classificato</option>
                  </select>
                </div>
                <div className="min-w-[9.5rem] flex-1">
                  <label className={adminFilterLabelClass}>Data (filtro)</label>
                  <select
                    value={filters.dateFilterMode}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, dateFilterMode: event.target.value as ArticleListFilters["dateFilterMode"] }))
                    }
                    className={adminFilterSelectClass}
                  >
                    <option value="created">Creazione</option>
                    <option value="updated">Ultimo aggiornamento</option>
                    <option value="published">Pubblicazione</option>
                    <option value="scheduled">Data programmata</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-[2] flex-wrap items-end gap-x-1.5 gap-y-1">
                  <div className="min-w-[6.5rem] flex-1">
                    <label className={adminFilterLabelClass}>Da</label>
                    <input
                      type="date"
                      value={filters.dateFrom}
                      onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                      className={adminFilterDateInputClass}
                    />
                  </div>
                  <div className="min-w-[6.5rem] flex-1">
                    <label className={adminFilterLabelClass}>A</label>
                    <input
                      type="date"
                      value={filters.dateTo}
                      onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
                      className={adminFilterDateInputClass}
                    />
                  </div>
                </div>
              </>
            }
            advancedRow={
              <>
                <div>
                  <label className={adminFilterLabelClass}>Ordina per</label>
                  <select
                    value={sort.field}
                    onChange={(event) => setSort((current) => ({ ...current, field: event.target.value as ArticleListSort["field"] }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="updated_at">Ultimo aggiornamento</option>
                    <option value="created_at">Creazione</option>
                    <option value="published_at">Pubblicazione</option>
                    <option value="status">Stato</option>
                    <option value="category">Categoria</option>
                  </select>
                </div>
                <div>
                  <label className={adminFilterLabelClass}>Direzione</label>
                  <select
                    value={sort.direction}
                    onChange={(event) => setSort((current) => ({ ...current, direction: event.target.value as ArticleListSort["direction"] }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </div>
              </>
            }
          />

          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="glass-panel-soft rounded-[24px] h-24" />
              <div className="glass-panel-soft rounded-[24px] h-24" />
              <div className="glass-panel-soft rounded-[24px] h-24" />
            </div>
          ) : articles.length === 0 ? (
            <div className="glass-panel-soft rounded-[28px] p-10 text-center">
              <p className="text-muted-foreground mb-4">Nessun articolo ancora pubblicato o salvato.</p>
              <Link to="/admin/article/new" className="inline-flex items-center gap-2 text-sm font-sans text-accent hover:text-foreground transition-colors">
                <Plus size={16} />
                Crea il primo articolo
              </Link>
            </div>
          ) : visibleArticles.length === 0 ? (
            <div className="glass-panel-soft rounded-[28px] p-10 text-center space-y-3">
              <p className="text-muted-foreground">Nessun articolo corrisponde ai filtri.</p>
              <button
                type="button"
                onClick={() => setFilters(emptyArticleListFilters)}
                className="text-sm font-sans text-accent hover:text-foreground transition-colors"
              >
                Reimposta filtri
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleArticles.map((article) => (
                <article key={article.id} className="glass-panel-soft rounded-[26px] p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                          {statusIcon(article.status)}
                          {statusLabel(article.status)}
                        </span>
                        <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                          {article.category}
                        </span>
                        {article.editorial_type && (
                          <span className="glass-chip inline-flex px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-accent/90">
                            {article.editorial_type === "utility_reflection" ? "Utility" : article.editorial_type}
                          </span>
                        )}
                      </div>
                      <h3 className="editorial-heading text-2xl leading-tight mb-2">{article.title_en || article.title_it || "Untitled"}</h3>
                      <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                        Aggiornato il {format(new Date(article.updated_at), "d MMM yyyy, HH:mm")}
                        {article.scheduled_at && article.status === "scheduled" && (
                          <> · programmato per {format(new Date(article.scheduled_at), "d MMM yyyy, HH:mm")}</>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {article.status === "published" && (
                        <Link
                          to={`/logbook/${article.slug}`}
                          className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                          title="View"
                        >
                          <Eye size={16} />
                        </Link>
                      )}
                      <Link
                        to={`/admin/article/${article.id}`}
                        className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Edit size={16} />
                      </Link>
                      <button
                        onClick={() => deleteArticle(article.id, article.title_en || article.title_it || "Untitled")}
                        className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminArticles;
