import { FormEvent, useEffect, useMemo, useState } from "react";
import { Heart, Reply, Send } from "lucide-react";
import { CommunityReferenceCards, CommunityReferencePicker } from "@/components/CommunityReferences";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import { CommunityLinkedResource, formatDateTime } from "@/lib/community";
import { toast } from "sonner";

type CommentRow = {
  id: string;
  post_id: string;
  profile_id: string;
  parent_id: string | null;
  content: string;
  linked_resources: unknown[];
  is_hidden: boolean;
  created_at: string;
  profiles?: { name: string | null; avatar_url: string | null } | null;
  liked_by_me?: boolean;
  likes_count?: number;
  replies?: CommentRow[];
};

const CommunityComments = ({ postId, canComment, isAdmin = false }: { postId: string; canComment: boolean; isAdmin?: boolean }) => {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [linkedResources, setLinkedResources] = useState<CommunityLinkedResource[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLinkedResources, setReplyLinkedResources] = useState<CommunityLinkedResource[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flatComments = useMemo(() => {
    const flatten = (rows: CommentRow[]): CommentRow[] => rows.flatMap((row) => [row, ...flatten(row.replies ?? [])]);
    return flatten(comments);
  }, [comments]);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id ?? null);

    const { data, error } = await supabase
      .from("community_comments")
      .select("*, profiles:public_profiles(name, avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const commentIds = (data ?? []).map((row: CommentRow) => row.id);
    const { data: reactions } = commentIds.length
      ? await supabase.from("community_reactions").select("comment_id, profile_id").in("comment_id", commentIds)
      : { data: [] };

    const counts: Record<string, number> = {};
    const mine = new Set<string>();
    (reactions ?? []).forEach((reaction: { comment_id: string; profile_id: string }) => {
      counts[reaction.comment_id] = (counts[reaction.comment_id] ?? 0) + 1;
      if (reaction.profile_id === session?.user?.id) mine.add(reaction.comment_id);
    });

    const enriched = ((data ?? []) as CommentRow[]).map((row) => ({
      ...row,
      likes_count: counts[row.id] ?? 0,
      liked_by_me: mine.has(row.id),
    }));

    const top = enriched.filter((row) => !row.parent_id);
    const childMap: Record<string, CommentRow[]> = {};
    enriched.filter((row) => row.parent_id).forEach((row) => {
      childMap[row.parent_id!] = [...(childMap[row.parent_id!] ?? []), row];
    });
    setComments(top.map((row) => ({ ...row, replies: childMap[row.id] ?? [] })));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`community-comments:${postId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "community_comments", filter: `post_id=eq.${postId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_reactions" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [postId]);

  const submit = async (parentId: string | null, value: string, resources: CommunityLinkedResource[] = []) => {
    const content = value.trim();
    if (!content && resources.length === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin();
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("community_comments").insert({
      post_id: postId,
      profile_id: session.user.id,
      parent_id: parentId,
      content: content || " ",
      linked_resources: resources,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("row-level") ? "Serve un Crew Pass attivo per commentare." : "Commento non inviato.");
      return;
    }
    setText("");
    setLinkedResources([]);
    setReplyText("");
    setReplyLinkedResources([]);
    setReplyTo(null);
    await load();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(null, text, linkedResources);
  };

  const toggleLike = async (comment: CommentRow) => {
    if (!userId) return;
    if (comment.liked_by_me) {
      await supabase.from("community_reactions").delete().eq("comment_id", comment.id).eq("profile_id", userId).eq("reaction", "heart");
    } else {
      await supabase.from("community_reactions").insert({ comment_id: comment.id, profile_id: userId, reaction: "heart" });
    }
    await load();
  };

  const hideComment = async (commentId: string) => {
    const { error } = await supabase.from("community_comments").update({ is_hidden: true }).eq("id", commentId);
    if (error) {
      toast.error("Moderazione non riuscita.");
      return;
    }
    await load();
  };

  const renderComment = (comment: CommentRow, isReply = false) => (
    <div key={comment.id} className={isReply ? "ml-6 mt-3 md:ml-10" : ""}>
      <article className="crew-panel rounded-3xl p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
            {comment.profiles?.avatar_url && <img src={comment.profiles.avatar_url} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <a href={`https://biteproject.it/profile/${comment.profile_id}`} className="font-medium text-slate-900">
                {comment.profiles?.name || "Membro"}
              </a>
              <span>{formatDateTime(comment.created_at)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
              {comment.is_hidden ? "Commento nascosto." : comment.content}
            </p>
            {!comment.is_hidden && <CommunityReferenceCards resources={comment.linked_resources} />}
            <div className="mt-3 flex items-center gap-4">
              {!comment.is_hidden && (
                <button type="button" onClick={() => void toggleLike(comment)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950">
                  <Heart size={13} fill={comment.liked_by_me ? "currentColor" : "none"} />
                  {comment.likes_count ? comment.likes_count : "Mi piace"}
                </button>
              )}
              {canComment && !comment.is_hidden && (
                <button type="button" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950">
                  <Reply size={13} />
                  Rispondi
                </button>
              )}
              {isAdmin && !comment.is_hidden && (
                <button type="button" onClick={() => void hideComment(comment.id)} className="text-xs text-slate-600 hover:text-slate-950">
                  Nascondi
                </button>
              )}
            </div>
            {replyTo === comment.id && (
              <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void submit(comment.id, replyText, replyLinkedResources); }}>
                <label className="sr-only" htmlFor={`reply-${comment.id}`}>Risposta</label>
                <div className="flex gap-2">
                  <input id={`reply-${comment.id}`} name="reply" value={replyText} onChange={(event) => setReplyText(event.target.value)} className="crew-field min-h-12 flex-1 py-2 text-sm" />
                  <button type="submit" disabled={busy} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white disabled:opacity-50">
                    <Send size={15} />
                  </button>
                </div>
                <CommunityReferencePicker value={replyLinkedResources} onChange={setReplyLinkedResources} />
              </form>
            )}
          </div>
        </div>
      </article>
      {comment.replies?.map((reply) => renderComment(reply, true))}
    </div>
  );

  return (
    <section className="mt-12 border-t border-slate-200/80 pt-8">
      <h2 className="font-serif text-2xl text-slate-950">Discussione</h2>
      <p className="mt-1 text-sm text-slate-600">{flatComments.length} interventi</p>
      {canComment ? (
        <form className="crew-panel mt-6 rounded-3xl p-4" onSubmit={onSubmit}>
          <label className="crew-label" htmlFor="community-comment">Scrivi un commento</label>
          <textarea
            id="community-comment"
            name="comment"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="crew-field mt-2 min-h-28"
            maxLength={4000}
          />
          <CommunityReferencePicker value={linkedResources} onChange={setLinkedResources} />
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white disabled:opacity-50">
              <Send size={15} />
              Pubblica
            </button>
          </div>
        </form>
      ) : (
        <p className="crew-panel mt-6 rounded-3xl p-4 text-sm text-slate-700">Serve un Crew Pass attivo per commentare. I post pubblici restano leggibili.</p>
      )}
      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Caricamento commenti...</p>
      ) : comments.length ? (
        <div className="mt-6 space-y-4">{comments.map((comment) => renderComment(comment))}</div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Nessun commento per ora.</p>
      )}
    </section>
  );
};

export default CommunityComments;
