import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Heart, Reply, Send } from "lucide-react";
import ProfileCard from "./ProfileCard";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

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

const GUEST_IDENTITY_KEY = "bite_guest_comment_identity";
const PENDING_GUEST_COMMENTS_KEY = "bite_pending_guest_comments";

type GuestIdentity = { name: string; email: string };

type PendingGuestComment = {
  pendingId: string;
  articleId: string;
  parentId: string | null;
  content: string;
  guestName: string;
  createdAt: string;
};

const readGuestIdentity = (): GuestIdentity => {
  try {
    const raw = window.localStorage.getItem(GUEST_IDENTITY_KEY);
    if (!raw) return { name: "", email: "" };
    const parsed = JSON.parse(raw) as Partial<GuestIdentity>;
    return { name: parsed.name ?? "", email: parsed.email ?? "" };
  } catch {
    return { name: "", email: "" };
  }
};

const writeGuestIdentity = (identity: GuestIdentity) => {
  try {
    window.localStorage.setItem(GUEST_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // best effort only
  }
};

const readAllPendingGuestComments = (): PendingGuestComment[] => {
  try {
    const raw = window.localStorage.getItem(PENDING_GUEST_COMMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingGuestComment[]) : [];
  } catch {
    return [];
  }
};

const addPendingGuestComment = (entry: PendingGuestComment) => {
  const all = readAllPendingGuestComments();
  all.push(entry);
  try {
    window.localStorage.setItem(PENDING_GUEST_COMMENTS_KEY, JSON.stringify(all));
  } catch {
    // best effort only
  }
};

/**
 * Drops any locally-tracked pending comment whose id now exists as a real,
 * published comment (claim_pending_article_comments reuses the pending id as
 * the article_comments id, so this is a plain id match — no heuristics).
 * Covers the case where confirmation happened on a different device: this
 * browser never got a sign-in event for that, but the next fetch still
 * clears the now-stale "in attesa" card. Returns the pruned full list
 * (all articles), already persisted to storage.
 */
const resolvePendingGuestComments = (publishedIds: Set<string>): PendingGuestComment[] => {
  const all = readAllPendingGuestComments();
  if (all.length === 0 || publishedIds.size === 0) return all;

  const remaining = all.filter((c) => !publishedIds.has(c.pendingId));
  if (remaining.length === all.length) return all;

  try {
    window.localStorage.setItem(PENDING_GUEST_COMMENTS_KEY, JSON.stringify(remaining));
  } catch {
    // best effort only
  }
  return remaining;
};

const CommentSection = ({ articleId, focusCommentId = null, onFocusHandled }: CommentSectionProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [submittingReplyTo, setSubmittingReplyTo] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestError, setGuestError] = useState("");
  const [pendingGuestComments, setPendingGuestComments] = useState<PendingGuestComment[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { lang } = useI18n();

  useEffect(() => {
    checkSession();
    fetchComments();

    const identity = readGuestIdentity();
    setGuestName(identity.name);
    setGuestEmail(identity.email);
  }, [articleId]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id || null;
      setAuthChecked(true);
      setUserId((previous) => {
        if (!previous && nextUserId) {
          // Just signed in: re-fetching resolves any pending card this
          // device's own login just claimed via claim_pending_article_comments.
          fetchComments();
        }
        return nextUserId;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Catches confirmations that happened elsewhere (e.g. the email link
    // opened on another device) without needing a persistent realtime
    // channel — same lazy-refresh-on-visibility idiom used for view counts.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchComments();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
    // fetchComments is stable across the component's lifetime for a given articleId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id || null);
    setAuthChecked(true);
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

    const resolved = resolvePendingGuestComments(new Set(enriched.map((c) => c.id)));
    setPendingGuestComments(resolved.filter((c) => c.articleId === articleId));

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

    const trimmedGuestName = guestName.trim();
    const normalizedGuestEmail = guestEmail.trim().toLowerCase();

    if (!currentUserId) {
      setGuestError("");
      if (!trimmedGuestName || !normalizedGuestEmail.includes("@")) {
        setGuestError("Inserisci nome ed email per lasciare un commento.");
        return;
      }
    }

    if (isReply) {
      setSubmittingReplyTo(parentId);
    } else {
      setIsSubmittingComment(true);
    }

    const { data, error } = await supabase.rpc("submit_article_comment", {
      _article_id: articleId,
      _content: content,
      _parent_id: parentId,
      _guest_name: currentUserId ? undefined : trimmedGuestName,
      _guest_email: currentUserId ? undefined : normalizedGuestEmail,
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

    const result = data as { status: "published" | "pending"; pending_id?: string } | null;

    if (result?.status === "pending") {
      writeGuestIdentity({ name: trimmedGuestName, email: normalizedGuestEmail });

      const pendingEntry: PendingGuestComment = {
        pendingId: result.pending_id!,
        articleId,
        parentId,
        content,
        guestName: trimmedGuestName,
        createdAt: new Date().toISOString(),
      };
      addPendingGuestComment(pendingEntry);
      setPendingGuestComments((prev) => [...prev, pendingEntry]);

      setNewComment("");
      setReplyTo(null);
      setReplyText("");
      if (isReply) {
        setSubmittingReplyTo(null);
      } else {
        setIsSubmittingComment(false);
      }

      // Stays on the article: the confirmation email itself (link or code)
      // finishes the job, on /login, without bouncing through a signup form.
      const emailRedirectTo = new URL(
        `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
        window.location.origin
      ).toString();

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalizedGuestEmail,
        options: {
          shouldCreateUser: true,
          data: { name: trimmedGuestName, lang },
          emailRedirectTo,
        },
      });

      if (otpError) {
        toast({
          title: "Email non inviata",
          description:
            "Il commento è salvato, ma non siamo riusciti a inviare la mail di conferma. Riprova tra poco.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Controlla la tua email",
          description: `Ti abbiamo mandato un'email a ${normalizedGuestEmail}: confermala per pubblicare il commento.`,
        });
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
        {authChecked && !userId && (
          <div className="glass-panel rounded-[28px] p-4 mb-3 flex flex-col sm:flex-row gap-3">
            <div className="glass-input rounded-[22px] flex-1 px-1.5 py-1.5">
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Nome"
                className="w-full bg-transparent px-4 py-2.5 text-sm font-sans focus:outline-none"
              />
            </div>
            <div className="glass-input rounded-[22px] flex-1 px-1.5 py-1.5">
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="la-tua@email.com"
                className="w-full bg-transparent px-4 py-2.5 text-sm font-sans focus:outline-none"
              />
            </div>
          </div>
        )}
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
        {authChecked && !userId && (
          <p className="mt-2 text-xs font-sans text-muted-foreground">
            {guestError || "Ti mandiamo un'email di conferma per pubblicare il commento: il testo non andrà perso."}
          </p>
        )}
      </div>

      {pendingGuestComments.length > 0 && (
        <div className="space-y-3 mb-4">
          {pendingGuestComments.map((p) => (
            <div
              key={p.pendingId}
              className="rounded-[24px] border border-dashed border-amber-500/50 bg-amber-500/5 p-4"
            >
              <div className="flex items-center gap-2 mb-1 text-xs font-sans font-medium text-amber-600">
                <Clock size={12} /> In attesa di conferma email
              </div>
              <p className="text-xs font-sans text-muted-foreground mb-1">{p.guestName}</p>
              <p className="text-sm font-sans text-foreground/90 whitespace-pre-wrap">{p.content}</p>
              <p className="mt-2 text-[11px] font-sans text-muted-foreground">
                Verrà pubblicato non appena confermi il codice inviato via email.
              </p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento commenti...</p>
      ) : comments.length === 0 && pendingGuestComments.length === 0 ? (
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
