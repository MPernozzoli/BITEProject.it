import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, BookOpen, Edit, Eye, Plus, Trash2, X } from "lucide-react";
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

interface Story {
  id: string;
  title_en: string;
  title_it: string;
  slug: string;
  description_en: string | null;
  description_it: string | null;
  cover_image: string | null;
  created_at: string;
  updated_at: string;
}

type StoryListFilters = {
  dateFilterMode: "created" | "updated";
  dateFrom: string;
  dateTo: string;
};

type StoryListSort = {
  field: "created_at" | "updated_at" | "title";
  direction: "asc" | "desc";
};

const emptyStoryListFilters: StoryListFilters = {
  dateFilterMode: "created",
  dateFrom: "",
  dateTo: "",
};

const defaultStoryListSort: StoryListSort = {
  field: "created_at",
  direction: "desc",
};

const generateSlug = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

const AdminStories = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const userId = session?.user?.id ?? null;
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [form, setForm] = useState({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
  const [filters, setFilters] = useState<StoryListFilters>(emptyStoryListFilters);
  const [sort, setSort] = useState<StoryListSort>(defaultStoryListSort);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filtersAdvanced, setFiltersAdvanced] = useState(false);

  const fetchStories = useCallback(async () => {
    if (!userId && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const { data, error } = await supabase.from("stories").select("*").order("created_at", { ascending: false });
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/stories" } });
      setLoading(false);
      return;
    }
    if (data) setStories(data as Story[]);
    setLoading(false);
  }, [navigate, userId]);

  useEffect(() => {
    void fetchStories();
  }, [fetchStories]);

  const openForm = (story?: Story) => {
    if (story) {
      setEditingStory(story);
      setForm({
        title_en: story.title_en,
        title_it: story.title_it,
        slug: story.slug,
        description_en: story.description_en || "",
        description_it: story.description_it || "",
      });
    } else {
      setEditingStory(null);
      setForm({ title_en: "", title_it: "", slug: "", description_en: "", description_it: "" });
    }
    setShowForm(true);
  };

  const saveStory = async () => {
    const slug = form.slug || generateSlug(form.title_en);
    const data = { ...form, slug };
    if (editingStory) {
      await supabase.from("stories").update(data).eq("id", editingStory.id);
      toast.success("Story updated");
    } else {
      await supabase.from("stories").insert(data);
      toast.success("Story created");
    }
    setShowForm(false);
    void fetchStories();
  };

  const deleteStory = async (id: string, title: string) => {
    if (!confirm(`Delete story "${title}"? Articles will be unlinked.`)) return;
    await supabase.from("stories").delete().eq("id", id);
    setStories((prev) => prev.filter((s) => s.id !== id));
    toast.success("Story deleted");
  };

  const hasActiveFilters = Boolean(filters.dateFrom) || Boolean(filters.dateTo);

  const filteredStories = useMemo(
    () =>
      stories.filter((story) => {
        const d = filters.dateFilterMode === "created" ? getDateOnlyValue(story.created_at) : getDateOnlyValue(story.updated_at);
        return isDateWithinRange(d, filters.dateFrom, filters.dateTo);
      }),
    [stories, filters]
  );

  const visibleStories = useMemo(() => {
    const mult = sort.direction === "asc" ? 1 : -1;
    return [...filteredStories].sort((left, right) => {
      let comparison = 0;
      if (sort.field === "created_at") {
        comparison = (left.created_at || "").localeCompare(right.created_at || "");
      } else if (sort.field === "updated_at") {
        comparison = (left.updated_at || "").localeCompare(right.updated_at || "");
      } else {
        const ta = (left.title_en || left.title_it || "").toLowerCase();
        const tb = (right.title_en || right.title_it || "").toLowerCase();
        comparison = ta.localeCompare(tb);
      }
      return comparison * mult;
    });
  }, [filteredStories, sort]);

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
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Narrative arcs</p>
              <h1 className="editorial-heading text-3xl md:text-5xl">Stories</h1>
            </div>
            <button
              onClick={() => openForm()}
              className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
            >
              <Plus size={16} />
              Nuova story
            </button>
          </div>
        </section>

        <section className="glass-panel rounded-[34px] p-5 md:p-6 lg:p-8 space-y-6">
          <AdminCollapsibleListFilters
            title="Filtri stories"
            expanded={filtersExpanded}
            onToggleExpanded={() => setFiltersExpanded((open) => !open)}
            visibleCount={visibleStories.length}
            totalCount={stories.length}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={() => setFilters(emptyStoryListFilters)}
            advancedOpen={filtersAdvanced}
            onToggleAdvanced={() => setFiltersAdvanced((open) => !open)}
            minimalRow={
              <>
                <div className="min-w-[9.5rem] flex-1">
                  <label className={adminFilterLabelClass}>Data (filtro)</label>
                  <select
                    value={filters.dateFilterMode}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, dateFilterMode: event.target.value as StoryListFilters["dateFilterMode"] }))
                    }
                    className={adminFilterSelectClass}
                  >
                    <option value="created">Creazione</option>
                    <option value="updated">Ultimo aggiornamento</option>
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
                    onChange={(event) => setSort((current) => ({ ...current, field: event.target.value as StoryListSort["field"] }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="created_at">Creazione</option>
                    <option value="updated_at">Ultimo aggiornamento</option>
                    <option value="title">Titolo</option>
                  </select>
                </div>
                <div>
                  <label className={adminFilterLabelClass}>Direzione</label>
                  <select
                    value={sort.direction}
                    onChange={(event) => setSort((current) => ({ ...current, direction: event.target.value as StoryListSort["direction"] }))}
                    className={adminFilterSelectClass}
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </div>
              </>
            }
          />

          {showForm && (
            <div className="glass-panel-soft rounded-[30px] p-6 md:p-7 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground mb-2">
                    {editingStory ? "Editing" : "Creation"}
                  </p>
                  <h3 className="editorial-heading text-2xl">{editingStory ? "Modifica story" : "Nuova story"}</h3>
                </div>
                <button
                  onClick={() => setShowForm(false)}
                  className="glass-chip inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Title (EN)</label>
                  <input
                    type="text"
                    value={form.title_en}
                    onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value, slug: f.slug || generateSlug(e.target.value) }))}
                    className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Title (IT)</label>
                  <input
                    type="text"
                    value={form.title_it}
                    onChange={(e) => setForm((f) => ({ ...f, title_it: e.target.value }))}
                    className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Description (EN)</label>
                  <textarea
                    value={form.description_en}
                    onChange={(e) => setForm((f) => ({ ...f, description_en: e.target.value }))}
                    rows={3}
                    className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Description (IT)</label>
                  <textarea
                    value={form.description_it}
                    onChange={(e) => setForm((f) => ({ ...f, description_it: e.target.value }))}
                    rows={3}
                    className="w-full rounded-[18px] border border-stone-200/90 bg-white/78 px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveStory}
                  className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
                >
                  <ArrowUpRight size={16} />
                  {editingStory ? "Aggiorna story" : "Crea story"}
                </button>
              </div>
            </div>
          )}

          {stories.length === 0 && !showForm ? (
            <div className="glass-panel-soft rounded-[28px] p-10 text-center">
              <p className="text-muted-foreground mb-4">Nessuna story disponibile.</p>
              <button onClick={() => openForm()} className="inline-flex items-center gap-2 text-sm font-sans text-accent hover:text-foreground transition-colors">
                <Plus size={16} />
                Crea la prima story
              </button>
            </div>
          ) : visibleStories.length === 0 && stories.length > 0 ? (
            <div className="glass-panel-soft rounded-[28px] p-10 text-center space-y-3">
              <p className="text-muted-foreground">Nessuna story corrisponde ai filtri.</p>
              <button
                type="button"
                onClick={() => setFilters(emptyStoryListFilters)}
                className="text-sm font-sans text-accent hover:text-foreground transition-colors"
              >
                Reimposta filtri
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleStories.map((story) => (
                <article key={story.id} className="glass-panel-soft rounded-[26px] p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-accent">
                          <BookOpen size={13} />
                          Story
                        </span>
                      </div>
                      <h3 className="editorial-heading text-2xl leading-tight mb-2">{story.title_en || story.title_it}</h3>
                      <p className="text-sm font-sans text-muted-foreground">/{story.slug}</p>
                      <p className="text-xs font-sans text-muted-foreground mt-1">
                        Creata {format(new Date(story.created_at), "d MMM yyyy")} · aggiornata{" "}
                        {format(new Date(story.updated_at), "d MMM yyyy, HH:mm")}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        to={`/logbook/story/${story.slug}`}
                        className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        title="View"
                      >
                        <Eye size={16} />
                      </Link>
                      <button
                        onClick={() => openForm(story)}
                        className="glass-chip inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => deleteStory(story.id, story.title_en || story.title_it)}
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

export default AdminStories;
