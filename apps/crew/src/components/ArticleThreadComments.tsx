import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Heart, Reply, Send } from "lucide-react";
import { CommunityComposerTools, CommunityMentionedProfile } from "@/components/CommunityReferences";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import { CommunityLinkedResource, formatDateTime } from "@/lib/community";
import { toast } from "sonner";

type ArticleCommentRow = {
  id: string;
  article_id: string;
  profile_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  profiles?: { name: string | null; avatar_url: string | null } | null;
  liked_by_me?: boolean;
  likes_count?: number;
  replies?: ArticleCommentRow[];
};

const ArticleThreadComments = ({ articleId, articleHref }: { articleId: string; articleHref?: string | null }) => {
  const [comments, setComments] = useState<ArticleCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [linkedResources, setLinkedResources] = useState<CommunityLinkedResource[]>([]);
  const [mentionedProfiles, setMentionedProfiles] = useState<CommunityMentionedProfile[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLinkedResources, setReplyLinkedResources] = useState<CommunityLinkedResource[]>([]);
  const [replyMentionedProfiles, setReplyMentionedProfiles] = useState<CommunityMentionedProfile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const flatComments = useMemo(() => {
    const flatten = (rows: ArticleCommentRow[]): ArticleCommentRow[] => rows.flatMap((row) => [row, ...flatten(row.replies ?? [])]);
    return flatten(comments);
  }, [comments]);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id ?? null);

    const { data, error } = await supabase
      .from("article_comments")
      .select("*")
      .eq("article_id", articleId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ArticleCommentRow[];
    const profileIds = [...new Set(rows.map((row) => row.profile_id))];
    const commentIds = rows.map((row) => row.id);

    const [{ data: profiles }, { data: likes }] = await Promise.all([
      profileIds.length
        ? supabase.from("public_profiles").select("id, name, avatar_url").in("id", profileIds)
        : Promise.resolve({ data: [] }),
      commentIds.length
        ? supabase.from("comment_likes").select("comment_id, profile_id").in("comment_id", commentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profileMap = new Map(((profiles ?? []) as Array<{ id: string; name: string | null; avatar_url: string | null }>).map((profile) => [profile.id, profile]));
    const counts: Record<string, number> = {};
    const mine = new Set<string>();
    (likes ?? []).forEach((like: { comment_id: string; profile_id: string }) => {
      counts[like.comment_id] = (counts[like.comment_id] ?? 0) + 1;
      if (like.profile_id === session?.user?.id) mine.add(like.comment_id);
    });

    const enriched = rows.map((row) => ({
      ...row,
      profiles: profileMap.get(row.profile_id) ?? null,
      likes_count: counts[row.id] ?? 0,
      liked_by_me: mine.has(row.id),
    }));

    const top = enriched.filter((row) => !row.parent_id);
    const childMap: Record<string, ArticleCommentRow[]> = {};
    enriched.filter((row) => row.parent_id).forEach((row) => {
      childMap[row.parent_id!] = [...(childMap[row.parent_id!] ?? []), row];
    });
    setComments(top.map((row) => ({ ...row, replies: childMap[row.id] ?? [] })));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`article-thread:${articleId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "article_comments", filter: `article_id=eq.${articleId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comment_likes" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [articleId]);

  const submit = async (
    parentId: string | null,
    value: string,
    resources: CommunityLinkedResource[] = [],
    profiles: CommunityMentionedProfile[] = [],
  ) => {
    const content = value.trim();
    if (!content) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin();
      return;
    }

    setBusy(true);
    const { data: insertedComment, error } = await supabase.from("article_comments").insert({
      article_id: articleId,
      profile_id: session.user.id,
      parent_id: parentId,
      content,
    }).select("id").single();
    setBusy(false);

    if (error || !insertedComment?.id) {
      toast.error("Commento non inviato.");
      return;
    }

    const mentionRows = [
      ...resources
        .filter((resource) => resource.kind === "article")
        .map((resource) => ({
          comment_id: insertedComment.id,
          mentioned_article_id: resource.id,
          mentioned_profile_id: null,
        })),
      ...profiles.map((profile) => ({
        comment_id: insertedComment.id,
        mentioned_article_id: null,
        mentioned_profile_id: profile.id,
      })),
    ];

    if (mentionRows.length) {
      const { error: mentionError } = await supabase.from("comment_mentions").insert(mentionRows);
      if (mentionError) toast.error("Commento pubblicato, ma alcune menzioni non sono state salvate.");
    }

    void supabase.functions.invoke("dispatch-engagement-notifications", {
      body: { limit: 100 },
    });

    setText("");
    setLinkedResources([]);
    setMentionedProfiles([]);
    setReplyText("");
    setReplyLinkedResources([]);
    setReplyMentionedProfiles([]);
    setReplyTo(null);
    await load();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(null, text, linkedResources, mentionedProfiles);
  };

  const toggleLike = async (comment: ArticleCommentRow) => {
    if (!userId) {
      redirectToLogin();
      return;
    }
    if (comment.liked_by_me) {
      await supabase.from("comment_likes").delete().eq("comment_id", comment.id).eq("profile_id", userId);
    } else {
      await supabase.from("comment_likes").insert({ comment_id: comment.id, profile_id: userId });
      void supabase.functions.invoke("dispatch-engagement-notifications", {
        body: { limit: 100 },
      });
    }
    await load();
  };

  const renderComment = (comment: ArticleCommentRow, isReply = false) => (
    <div key={comment.id} className={isReply ? "ml-6 mt-3 md:ml-10" : ""}>
      <article className="crew-panel rounded-3xl p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-slate-200">
            {comment.profiles?.avatar_url && <img src={comment.profiles.avatar_url} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <a href={`https://biteproject.it/profile/${comment.profile_id}`} className="font-medium text-slate-900">
                {comment.profiles?.name || "BITE"}
              </a>
              <span>{formatDateTime(comment.created_at)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{comment.content}</p>
            <div className="mt-3 flex items-center gap-4">
              <button type="button" onClick={() => void toggleLike(comment)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950">
                <Heart size={13} fill={comment.liked_by_me ? "currentColor" : "none"} />
                {comment.likes_count ? comment.likes_count : "Mi piace"}
              </button>
              <button type="button" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950">
                <Reply size={13} />
                Rispondi
              </button>
            </div>
            {replyTo === comment.id && (
              <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void submit(comment.id, replyText, replyLinkedResources, replyMentionedProfiles); }}>
                <label className="sr-only" htmlFor={`article-reply-${comment.id}`}>Risposta</label>
                <div className="flex gap-2">
                  <input ref={replyInputRef} id={`article-reply-${comment.id}`} name="reply" value={replyText} onChange={(event) => setReplyText(event.target.value)} className="crew-field min-h-12 flex-1 py-2 text-sm" />
                  <button type="submit" disabled={busy || !replyText.trim()} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white disabled:opacity-50">
                    <Send size={15} />
                  </button>
                </div>
                <CommunityComposerTools
                  inputRef={replyInputRef}
                  text={replyText}
                  onTextChange={setReplyText}
                  resources={replyLinkedResources}
                  onResourcesChange={setReplyLinkedResources}
                  mentionedProfiles={replyMentionedProfiles}
                  onMentionedProfilesChange={setReplyMentionedProfiles}
                  referenceKinds={["article"]}
                />
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-slate-950">Discussione articolo</h2>
          <p className="mt-1 text-sm text-slate-600">{flatComments.length} interventi pubblici tra logbook e BITE Crew</p>
        </div>
        {articleHref && (
          <a href={`https://biteproject.it${articleHref}`} className="text-sm font-medium text-slate-700 hover:text-slate-950">
            Leggi sul sito
          </a>
        )}
      </div>

      <form className="crew-panel mt-6 rounded-3xl p-4" onSubmit={onSubmit}>
        <label className="crew-label" htmlFor="article-thread-comment">Scrivi nel thread pubblico</label>
        <textarea
          ref={commentInputRef}
          id="article-thread-comment"
          name="comment"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="crew-field mt-2 min-h-28"
          maxLength={4000}
        />
        <CommunityComposerTools
          inputRef={commentInputRef}
          text={text}
          onTextChange={setText}
          resources={linkedResources}
          onResourcesChange={setLinkedResources}
          mentionedProfiles={mentionedProfiles}
          onMentionedProfilesChange={setMentionedProfiles}
          referenceKinds={["article"]}
        />
        {!userId && <p className="mt-2 text-xs text-slate-500">Accedi per pubblicare. La discussione resta visibile anche senza Crew Pass.</p>}
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white disabled:opacity-50">
            <Send size={15} />
            Pubblica
          </button>
        </div>
      </form>

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

export default ArticleThreadComments;
