import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, FileText, Pin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAdminDevBypassEnabled } from "@/lib/admin-dev-bypass";
import { isAuthFailureError } from "@/lib/supabase-auth";

type ContentNote = {
  id: string;
  title: string;
  body: string | null;
  pillar: string;
  status: "note" | "selected" | "draft" | "archived";
  pinned: boolean;
  promoted_to_article_id: string | null;
  created_at: string;
  updated_at: string;
};

const PILLAR_LABELS: Record<string, string> = {
  experience: "Experience",
  practical: "Practical",
  reflective: "Reflective",
};

const STATUS_LABELS: Record<string, string> = {
  note: "Idea",
  selected: "Selected",
  draft: "Draft",
  archived: "Archived",
};

const STATUS_COLORS: Record<string, string> = {
  note: "bg-muted text-muted-foreground",
  selected: "bg-accent/15 text-accent",
  draft: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400",
  archived: "bg-muted text-muted-foreground line-through",
};

const AdminContentNotes = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ContentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newPillar, setNewPillar] = useState("experience");
  const [creating, setCreating] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!session?.user?.id && !isAdminDevBypassEnabled()) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("content_notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error && isAuthFailureError(error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin/content-notes" } });
      setLoading(false);
      return;
    }
    if (data) setNotes(data as unknown as ContentNote[]);
    setLoading(false);
  }, [navigate, session?.user?.id]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const filteredNotes = useMemo(() => {
    if (statusFilter === "all") return notes;
    return notes.filter((n) => n.status === statusFilter);
  }, [notes, statusFilter]);

  const createNote = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("content_notes").insert({
      title: newTitle.trim(),
      body: newBody.trim() || null,
      pillar: newPillar,
    });
    setCreating(false);
    if (error) {
      toast.error("Failed to create note.");
      return;
    }
    setNewTitle("");
    setNewBody("");
    toast.success("Note created.");
    void fetchNotes();
  };

  const updateStatus = async (id: string, status: ContentNote["status"]) => {
    const { error } = await supabase.from("content_notes").update({ status }).eq("id", id);
    if (error) {
      toast.error("Failed to update status.");
      return;
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, status } : n)));
  };

  const togglePin = async (id: string, pinned: boolean) => {
    const { error } = await supabase.from("content_notes").update({ pinned: !pinned }).eq("id", id);
    if (error) {
      toast.error("Failed to toggle pin.");
      return;
    }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !pinned } : n)));
  };

  const deleteNote = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    const { error } = await supabase.from("content_notes").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete note.");
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const promoteToDraft = async (note: ContentNote) => {
    const { data: article, error: articleError } = await supabase
      .from("logbook_articles")
      .insert({
        title_en: note.title,
        title_it: note.title,
        status: "draft",
        editorial_type: "support",
        category: note.pillar,
      })
      .select("id")
      .single();
    if (articleError || !article) {
      toast.error("Failed to create article.");
      return;
    }
    const { error } = await supabase
      .from("content_notes")
      .update({ status: "draft", promoted_to_article_id: article.id })
      .eq("id", note.id);
    if (error) {
      toast.error("Failed to link note to article.");
      return;
    }
    toast.success("Promoted to draft. Opening editor...");
    navigate(`/admin/article/${article.id}`);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <section className="glass-panel rounded-[38px] px-6 py-8 md:px-10 md:py-10">
          <div className="max-w-3xl">
            <Link
              to="/admin"
              className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground transition-colors mb-5"
            >
              <ArrowLeft size={14} />
              Torna alla Dashboard
            </Link>
            <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-5">
              <FileText size={14} />
              Content backlog
            </div>
            <h1 className="editorial-heading text-4xl md:text-6xl mb-4">Content Notes</h1>
            <p className="max-w-2xl text-sm md:text-base font-sans text-foreground/72 leading-relaxed">
              Idee, appunti e bozze non ancora assegnate al piano editoriale. Raccogli qui tutto quello che
              vorresti scrivere, poi promuovi a draft quando sei pronto.
            </p>
          </div>
        </section>

        <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-4">
          <h2 className="editorial-heading text-xl">Nuova nota</h2>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Titolo dell'idea..."
              className="w-full rounded-[14px] border border-border/70 bg-background/60 px-4 py-2.5 text-sm font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <select
              value={newPillar}
              onChange={(e) => setNewPillar(e.target.value)}
              className="rounded-[14px] border border-border/70 bg-background/60 px-3 py-2.5 text-sm font-sans"
            >
              {Object.entries(PILLAR_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Note opzionali..."
            rows={2}
            className="w-full rounded-[14px] border border-border/70 bg-background/60 px-4 py-2.5 text-sm font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
          <button
            onClick={() => void createNote()}
            disabled={creating || !newTitle.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-sans text-primary-foreground disabled:opacity-50 transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Plus size={14} />
            Aggiungi nota
          </button>
        </section>

        <section className="glass-panel rounded-[30px] p-5 md:p-8 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="editorial-heading text-xl mr-2">Backlog</h2>
            {["all", "note", "selected", "draft", "archived"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-sans transition-colors ${
                  statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "Tutte" : STATUS_LABELS[s] ?? s}
              </button>
            ))}
          </div>

          {loading && <p className="text-sm font-sans text-muted-foreground animate-pulse">Caricamento...</p>}

          {!loading && filteredNotes.length === 0 && (
            <p className="text-sm font-sans text-muted-foreground py-8 text-center">
              Nessuna nota trovata.
            </p>
          )}

          <div className="space-y-3">
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                className="glass-panel-soft rounded-[20px] p-4 md:p-5 flex flex-col md:flex-row md:items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    {note.pinned && <Pin size={12} className="text-accent shrink-0" />}
                    <h3 className="font-sans font-medium text-sm truncate">{note.title || "Senza titolo"}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-sans ${STATUS_COLORS[note.status]}`}>
                      {STATUS_LABELS[note.status]}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-sans bg-muted text-muted-foreground">
                      {PILLAR_LABELS[note.pillar] ?? note.pillar}
                    </span>
                  </div>
                  {note.body && (
                    <p className="text-xs font-sans text-muted-foreground line-clamp-2">{note.body}</p>
                  )}
                  {note.promoted_to_article_id && (
                    <Link
                      to={`/admin/article/${note.promoted_to_article_id}`}
                      className="inline-flex items-center gap-1 text-[10px] font-sans text-accent hover:underline mt-1"
                    >
                      <ArrowUpRight size={10} />
                      Articolo collegato
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void togglePin(note.id, note.pinned)}
                    className={`p-1.5 rounded-full transition-colors ${note.pinned ? "text-accent bg-accent/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    title={note.pinned ? "Unpin" : "Pin"}
                  >
                    <Pin size={14} />
                  </button>
                  {note.status === "note" && (
                    <button
                      onClick={() => void updateStatus(note.id, "selected")}
                      className="px-2.5 py-1 rounded-full text-[10px] font-sans bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                    >
                      Select
                    </button>
                  )}
                  {note.status === "selected" && (
                    <button
                      onClick={() => void promoteToDraft(note)}
                      className="px-2.5 py-1 rounded-full text-[10px] font-sans bg-primary text-primary-foreground hover:opacity-90 transition-colors"
                    >
                      Promote to draft
                    </button>
                  )}
                  {note.status !== "archived" && (
                    <button
                      onClick={() => void updateStatus(note.id, "archived")}
                      className="px-2.5 py-1 rounded-full text-[10px] font-sans bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    onClick={() => void deleteNote(note.id)}
                    className="p-1.5 rounded-full text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminContentNotes;
