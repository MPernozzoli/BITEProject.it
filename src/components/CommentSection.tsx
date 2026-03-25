import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Heart, Reply, Send } from "lucide-react";
import ProfileCard from "./ProfileCard";
import { format } from "date-fns";

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
}

const CommentSection = ({ articleId }: CommentSectionProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
    fetchComments();
  }, [articleId]);

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
    const { data: profiles } = await supabase.from("profiles").select("id, name, avatar_url").in("id", profileIds);
    const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

    // Get like counts
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

    // Build tree
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
    if (!userId || !text.trim()) return;
    await supabase.from("article_comments").insert({
      article_id: articleId,
      profile_id: userId,
      parent_id: parentId,
      content: text.trim(),
    });
    setNewComment("");
    setReplyTo(null);
    setReplyText("");
    fetchComments();
  };

  const toggleCommentLike = async (commentId: string, isLiked: boolean) => {
    if (!userId) return;
    if (isLiked) {
      await supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("profile_id", userId);
    } else {
      await supabase.from("comment_likes").insert({ comment_id: commentId, profile_id: userId });
    }
    fetchComments();
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <div key={comment.id} className={`${isReply ? "ml-8 pl-4 border-l border-border" : ""}`}>
      <div className="py-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <ProfileCard
              name={comment.profile?.name || ""}
              avatarUrl={comment.profile?.avatar_url || undefined}
              size="sm"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">
                {format(new Date(comment.created_at), "MMM d, yyyy · HH:mm")}
              </span>
            </div>
            <p className="text-sm font-sans text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => toggleCommentLike(comment.id, comment.liked_by_me)}
                className={`inline-flex items-center gap-1 text-xs transition-colors ${
                  comment.liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground"
                } ${!userId ? "opacity-50 cursor-default" : ""}`}
                disabled={!userId}
              >
                <Heart size={12} fill={comment.liked_by_me ? "currentColor" : "none"} />
                {comment.likes_count > 0 && comment.likes_count}
              </button>
              {userId && (
                <button
                  onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Reply size={12} /> Reply
                </button>
              )}
            </div>
            {replyTo === comment.id && (
              <div className="flex gap-2 mt-3">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  className="flex-1 bg-transparent border-b border-border py-1.5 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && submitComment(comment.id, replyText)}
                />
                <button
                  onClick={() => submitComment(comment.id, replyText)}
                  className="text-accent hover:text-foreground transition-colors"
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
    <div className="border-t border-border pt-8 mt-12">
      <h3 className="editorial-heading text-xl mb-6">
        Comments {comments.length > 0 && `(${comments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0)})`}
      </h3>

      {userId && (
        <div className="flex gap-3 mb-8">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Leave a comment..."
            rows={2}
            className="flex-1 bg-transparent border border-border px-4 py-3 text-sm font-sans focus:outline-none focus:border-accent transition-colors resize-none"
          />
          <button
            onClick={() => submitComment(null, newComment)}
            disabled={!newComment.trim()}
            className="self-end bg-primary text-primary-foreground px-4 py-2.5 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Be the first to share your thoughts.</p>
      ) : (
        <div className="divide-y divide-border">
          {comments.map((c) => renderComment(c))}
        </div>
      )}
    </div>
  );
};

export default CommentSection;
