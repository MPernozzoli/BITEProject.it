import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Heart, Reply, Send } from "lucide-react";
import ProfileCard from "./ProfileCard";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Comment {
  id: string;
  article_id: string;
  profile_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  profile?: { name: string; avatar_url: string | null };
  likes_count: number;
  liked_by_me: boolean;
  replies?: Comment[];
}

interface CommentSectionProps {
  articleId: string;
  focusCommentId?: string | null;
  onFocusHandled?: () => void;
}

const PENDING_COMMENT_DRAFT_KEY = "bite_pending_comment_draft";

type PendingCommentDraft = {
  articleId: string;
  parentId: string | null;
  text: string;
};

const readPendingDraft = (articleId: string): PendingCommentDraft | null => {
  try {
    const raw = window.localStorage.getItem(PENDING_COMMENT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCommentDraft>;
    if (parsed?.articleId !== articleId || typeof parsed.text !== "string" || !parsed.text.trim()) {
      return null;
    }
    return { articleId, parentId: parsed.parentId ?? null, text: parsed.text };
  } catch {
    return null;
  }
};

const CommentSection = ({ articleId, focusCommentId = null, onFocusHandled }: CommentSectionProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [submittingReplyTo, setSubmittingReplyTo] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    checkSession();
    fetchComments();

    const draft = readPendingDraft(articleId);
    if (draft) {
      window.localStorage.removeItem(PENDING_COMMENT_DRAFT_KEY);
      if (draft.parentId) {
        setReplyTo(draft.parentId);
        setReplyText(draft.text);
      } else {
        setNewComment(draft.text);
      }
    }
  }, [articleId]);

  const saveDraftAndRedirect = (parentId: string | null, text: string) => {
    const draft: PendingCommentDraft = { articleId, parentId, text };
    window.localStorage.setItem(PENDING_COMMENT_DRAFT_KEY, JSON.stringify(draft));
    navigate("/login", { state: { from: window.location.pathname } });
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id || null);
  };

  const fetchComments = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user?.id;

    const { data: commentsData } = await supabase
      .from("article_comments")
      .select("*")
      .eq("article_id", articleId)
      .order("created_at", { ascending: true });

    if (!commentsData) { setLoading(false); return; }

    const profileIds = [...new Set(commentsData.map((c) => c.profile_id))];
    const { data: profiles } = await supabase.from("public_profiles").select("id, name, avatar_url").in("id", profileIds);
    const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

    const commentIds = commentsData.map((c) => c.id);
    const { data: likesData } = await supabase
      .from("comment_likes")
      .select("comment_id, profile_id")
      .in("comment_id", commentIds);

    const likeCounts: Record<string, number> = {};
    const myLikes = new Set<string>();
    (likesData || []).forEach((l) => {
      likeCounts[l.comment_id] = (likeCounts[l.comment_id] || 0) + 1;
      if (l.profile_id === currentUserId) myLikes.add(l.comment_id);
    });

    const enriched: Comment[] = commentsData.map((c) => ({
      ...c,
      profile: profileMap[c.profile_id],
      likes_count: likeCounts[c.id] || 0,
      liked_by_me: myLikes.has(c.id),
    }));

    const topLevel = enriched.filter((c) => !c.parent_id);
    const childMap: Record<string, Comment[]> = {};
    enriched.filter((c) => c.parent_id).forEach((c) => {
      if (!childMap[c.parent_id!]) childMap[c.parent_id!] = [];
      childMap[c.parent_id!].push(c);
    });
    topLevel.forEach((c) => { c.replies = childMap[c.id] || []; });

    setComments(topLevel);
    setLoading(false);
  };

  const submitComment = async (parentId: string | null, text: string) => {
    const content = text.trim();
    if (!content) return;

    const isReply = Boolean(parentId);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const currentUserId = session?.user?.id || userId;

    if (!currentUserId) {
      saveDraftAndRedirect(parentId, content);
      return;
    }

    if (isReply) {
      setSubmittingReplyTo(parentId);
    } else {
      setIsSubmittingComment(true);
    }

    const { error } = await supabase.from("article_comments").insert({
      article_id: articleId,
      profile_id: currentUserId,
      parent_id: parentId,
      content,
    });

    if (error) {
      toast({
        title: "Commento non inviato",
        description: "C'è stato un problema durante il salvataggio. Riprova tra un attimo.",
        variant: "destructive",
      });
      if (isReply) {
        setSubmittingReplyTo(null);
      } else {
        setIsSubmittingComment(false);
      }
      return;
    }

    void supabase.functions.invoke("dispatch-engagement-notifications", {
      body: { limit: 100 },
    });

    setNewComment("");
    setReplyTo(null);
    setReplyText("");
    await fetchComments();

    if (isReply) {
      setSubmittingReplyTo(null);
    } else {
      setIsSubmittingComment(false);
    }
  };

  const toggleCommentLike = async (commentId: string, isLiked: boolean) => {
    if (!userId) {
      navigate("/login", { state: { from: window.location.pathname } });
      return;
    }
    if (isLiked) {
      await supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("profile_id", userId);
    } else {
      await supabase.from("comment_likes").insert({ comment_id: commentId, profile_id: userId });
      void supabase.functions.invoke("dispatch-engagement-notifications", {
        body: { limit: 100 },
      });
    }
    fetchComments();
  };

  useEffect(() => {
    if (!focusCommentId || loading) return;

    const element = document.getElementById(`comment-${focusCommentId}`);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("comment-notification-flash");
    const timeoutId = window.setTimeout(() => {
      element.classList.remove("comment-notification-flash");
      onFocusHandled?.();
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [comments, focusCommentId, loading, onFocusHandled]);

  const renderComment = (comment: Comment, isReply = false) => (
    <div id={`comment-${comment.id}`} key={comment.id} className={`${isReply ? "ml-8 mt-3" : ""} scroll-mt-28`}>
      <div className={`glass-panel-soft rounded-[24px] p-4 ${isReply ? "" : ""}`}>
        <div className="flex items-start gap-3">
          <Link to={`/profile/${comment.profile_id}`} className="flex-shrink-0 mt-0.5 hover:opacity-80 transition-opacity">
            <ProfileCard
              name={comment.profile?.name || ""}
              avatarUrl={comment.profile?.avatar_url || undefined}
              size="sm"
            />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link to={`/profile/${comment.profile_id}`} className="text-xs font-sans font-medium text-foreground hover:text-accent transition-colors">
                {comment.profile?.name || "Anonymous"}
              </Link>
              <span className="text-xs text-muted-foreground">
                {format(new Date(comment.created_at), "d MMM yyyy · HH:mm")}
              </span>
            </div>
            <p className="text-sm font-sans text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => toggleCommentLike(comment.id, comment.liked_by_me)}
                className={`inline-flex items-center gap-1 text-xs transition-colors ${
                  comment.liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Heart size={12} fill={comment.liked_by_me ? "currentColor" : "none"} />
                {comment.likes_count > 0 && comment.likes_count}
              </button>
              <button
                onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Reply size={12} /> Rispondi
              </button>
            </div>
            {replyTo === comment.id && (
              <div className="flex gap-2 mt-3 items-end">
                <div className="glass-input rounded-[18px] flex-1 px-1.5">
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Scrivi una risposta..."
                    className="w-full bg-transparent px-3 py-2.5 text-sm font-sans focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      void submitComment(comment.id, replyText);
                    }}
                  />
                </div>
                <button
                  onClick={() => void submitComment(comment.id, replyText)}
                  disabled={!replyText.trim() || submittingReplyTo === comment.id}
                  className={`inline-flex h-10 w-10 items-center justify-center ${
                    replyText.trim() ? "glass-button-dark" : "glass-button"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {comment.replies?.map((r) => renderComment(r, true))}
    </div>
  );

  return (
    <div className="border-t glass-divider pt-8 mt-12">
      <h3 className="editorial-heading text-xl mb-6">
        Commenti {comments.length > 0 && `(${comments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0)})`}
      </h3>

      <div className="mb-8">
        <div className="glass-panel rounded-[28px] p-4 flex gap-3">
          <div className="glass-input rounded-[22px] flex-1 px-1.5 py-1.5">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Scrivi un commento..."
              rows={2}
              className="w-full bg-transparent px-4 py-3 text-sm font-sans focus:outline-none resize-none"
            />
          </div>
          <button
            onClick={() => void submitComment(null, newComment)}
            disabled={!newComment.trim() || isSubmittingComment}
            className={`self-end px-4 py-2.5 text-sm font-sans font-medium ${
              newComment.trim() ? "glass-button-dark" : "glass-button"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Send size={14} />
          </button>
        </div>
        {!userId && (
          <p className="mt-2 text-xs font-sans text-muted-foreground">
            Accedi per pubblicare il commento: il testo scritto non andrà perso.
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento commenti...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun commento. Sii il primo a condividere il tuo pensiero.</p>
      ) : (
        <div className="space-y-4">
          {comments.map((c) => renderComment(c))}
        </div>
      )}
    </div>
  );
};

export default CommentSection;
