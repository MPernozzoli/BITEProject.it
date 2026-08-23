import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, MessageSquare, Reply, EyeOff, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  EDITORIAL_CHANNEL_IDS,
  EDITORIAL_CHANNEL_LABELS,
  type EditorialChannelCode,
} from "@/lib/editorial-plan";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorialChannelLogo } from "@/components/editorial/EditorialChannelLogo";

type CommentStatus = "new" | "replied" | "hidden" | "dismissed";

type CommentRow = {
  id: string;
  channel_id: string;
  platform_post_id: string;
  platform_comment_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  text: string;
  like_count: number | null;
  reply_count: number | null;
  created_at_platform: string;
  local_status: CommentStatus;
  reply_text: string | null;
  replied_at: string | null;
  fetched_at: string;
};

const STATUS_LABELS: Record<CommentStatus, string> = {
  new: "Nuovi",
  replied: "Risposti",
  hidden: "Nascosti",
  dismissed: "Ignorati",
};

const PAGE_SIZE = 20;

export default function AdminCommentsPage() {
  const { session, loading: authLoading } = useAuth();

  const [channelFilter, setChannelFilter] = useState<EditorialChannelCode | "all">("all");
  const [statusFilter, setStatusFilter] = useState<CommentStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);

    let query = supabase
      .from("social_comments_cache" as any)
      .select("*", { count: "exact" })
      .order("created_at_platform", { ascending: false });

    if (channelFilter !== "all") {
      const channelId = EDITORIAL_CHANNEL_IDS[channelFilter as keyof typeof EDITORIAL_CHANNEL_IDS];
      if (channelId) query = query.eq("channel_id", channelId);
    }

    if (statusFilter !== "all") {
      query = query.eq("local_status", statusFilter);
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      toast.error("Errore nel caricamento commenti.");
      setComments([]);
      setTotalCount(0);
    } else {
      setComments((data as CommentRow[]) ?? []);
      setTotalCount(count ?? 0);
    }

    setLoading(false);
  }, [session?.user, channelFilter, statusFilter, page]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadComments();
  }, [authLoading, session?.user, loadComments]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const channelCodeFromId = useCallback((channelId: string): EditorialChannelCode | null => {
    for (const [code, id] of Object.entries(EDITORIAL_CHANNEL_IDS)) {
      if (id === channelId) return code as EditorialChannelCode;
    }
    return null;
  }, []);

  const handleReply = useCallback(async (comment: CommentRow) => {
    if (!replyText.trim()) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.functions.invoke("social-comments", {
        body: {
          action: "reply",
          comment_id: comment.id,
          platform_comment_id: comment.platform_comment_id,
          channel_id: comment.channel_id,
          text: replyText.trim(),
        },
      });

      if (error) throw error;

      toast.success("Risposta inviata.");
      setReplyingTo(null);
      setReplyText("");
      await loadComments();
    } catch (err) {
      toast.error("Errore nell'invio della risposta.");
    } finally {
      setSubmitting(false);
    }
  }, [replyText, loadComments]);

  const handleHide = useCallback(async (comment: CommentRow) => {
    try {
      const { error } = await supabase.functions.invoke("social-comments", {
        body: {
          action: "hide",
          comment_id: comment.id,
          platform_comment_id: comment.platform_comment_id,
          channel_id: comment.channel_id,
        },
      });

      if (error) throw error;

      toast.success("Commento nascosto.");
      await loadComments();
    } catch {
      toast.error("Errore nel nascondere il commento.");
    }
  }, [loadComments]);

  const handleDelete = useCallback(async (comment: CommentRow) => {
    try {
      const { error } = await supabase.functions.invoke("social-comments", {
        body: {
          action: "delete",
          comment_id: comment.id,
          platform_comment_id: comment.platform_comment_id,
          channel_id: comment.channel_id,
        },
      });

      if (error) throw error;

      toast.success("Commento eliminato.");
      await loadComments();
    } catch {
      toast.error("Errore nell'eliminazione del commento.");
    }
  }, [loadComments]);

  const handleDismiss = useCallback(async (comment: CommentRow) => {
    try {
      const { error } = await supabase
        .from("social_comments_cache" as any)
        .update({ local_status: "dismissed" })
        .eq("id", comment.id);

      if (error) throw error;

      toast.success("Commento ignorato.");
      await loadComments();
    } catch {
      toast.error("Errore nell'aggiornamento dello stato.");
    }
  }, [loadComments]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Commenti social</p>
            <h1 className="mt-1 text-2xl font-sans font-semibold text-foreground">Gestione Commenti</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Rispondi, nascondi o elimina commenti da Instagram e YouTube.
            </p>
          </div>
          <Link
            to="/admin/editorial"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Torna al calendario
          </Link>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground">Canale:</span>
            <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v as EditorialChannelCode | "all"); setPage(0); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="instagram_bite">Instagram BITE</SelectItem>
                <SelectItem value="instagram_dogs">Instagram Dogs</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground">Stato:</span>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as CommentStatus | "all"); setPage(0); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="new">Nuovi</SelectItem>
                <SelectItem value="replied">Risposti</SelectItem>
                <SelectItem value="hidden">Nascosti</SelectItem>
                <SelectItem value="dismissed">Ignorati</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadComments()}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Aggiorna
          </Button>
        </div>

        {/* Comments list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel-soft rounded-[16px] h-24 animate-pulse" />
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="glass-panel-soft rounded-[20px] p-8 text-center">
            <MessageSquare className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">Nessun commento trovato.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              I commenti vengono caricati quando sincronizzi le metriche.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {comments.map((comment) => {
              const chCode = channelCodeFromId(comment.channel_id);
              const isReplying = replyingTo === comment.id;

              return (
                <div
                  key={comment.id}
                  className="glass-panel-soft rounded-[16px] p-4 transition-all hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    {comment.author_avatar_url ? (
                      <img
                        src={comment.author_avatar_url}
                        alt={comment.author_name ?? ""}
                        className="size-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-muted-foreground">
                          {(comment.author_name ?? "?").charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {chCode && <EditorialChannelLogo code={chCode} className="text-accent size-3.5" />}
                        <span className="text-xs font-medium">{comment.author_name ?? "Anonimo"}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(comment.created_at_platform).toLocaleDateString("it-IT", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className={`ml-auto text-[9px] px-2 py-0.5 rounded-full ${
                          comment.local_status === "new" ? "bg-accent/20 text-accent" :
                          comment.local_status === "replied" ? "bg-green-500/10 text-green-600" :
                          comment.local_status === "hidden" ? "bg-yellow-500/10 text-yellow-600" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {STATUS_LABELS[comment.local_status]}
                        </span>
                      </div>

                      <p className="text-sm text-foreground/90 mb-2">{comment.text}</p>

                      {comment.like_count != null && comment.like_count > 0 && (
                        <span className="text-[10px] text-muted-foreground mr-3">♥ {comment.like_count}</span>
                      )}

                      {/* Reply form */}
                      {isReplying ? (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Scrivi una risposta…"
                            className="flex-1 rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleReply(comment);
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={submitting || !replyText.trim()}
                            onClick={() => void handleReply(comment)}
                          >
                            Invia
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setReplyingTo(null); setReplyText(""); }}
                          >
                            Annulla
                          </Button>
                        </div>
                      ) : comment.reply_text ? (
                        <div className="mt-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium">Risposta:</span> {comment.reply_text}
                        </div>
                      ) : null}

                      {/* Actions */}
                      {!isReplying && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => { setReplyingTo(comment.id); setReplyText(""); }}
                          >
                            <Reply className="size-3" /> Rispondi
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => void handleDismiss(comment)}
                          >
                            <EyeOff className="size-3" /> Ignora
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive"
                            onClick={() => void handleHide(comment)}
                          >
                            <Trash2 className="size-3" /> Nascondi
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Eliminare definitivamente questo commento dalla piattaforma?")) {
                                void handleDelete(comment);
                              }
                            }}
                          >
                            <Trash2 className="size-3" /> Elimina
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="text-xs text-muted-foreground">
              Pagina {page + 1} di {totalPages} · {totalCount} commenti
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
