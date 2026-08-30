import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

interface LikeButtonProps {
  articleId: string;
  size?: number;
  liked?: boolean;
  likeCount?: number;
  onToggleLike?: () => void;
  busy?: boolean;
}

const LikeButton = ({ articleId, size = 18, liked: externalLiked, likeCount: externalCount, onToggleLike, busy: externalBusy }: LikeButtonProps) => {
  const [internalLiked, setInternalLiked] = useState(false);
  const [internalCount, setInternalCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [internalBusy, setInternalBusy] = useState(false);

  const isControlled = externalLiked !== undefined;
  const liked = isControlled ? externalLiked : internalLiked;
  const count = isControlled ? externalCount ?? 0 : internalCount;
  const busy = isControlled ? (externalBusy ?? false) : internalBusy;

  useEffect(() => {
    if (isControlled) return;
    let cancelled = false;

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      const uid = session?.user?.id ?? null;
      setUserId(uid);

      const { count: c } = await supabase
        .from("article_likes")
        .select("id", { count: "exact", head: true })
        .eq("article_id", articleId);
      if (!cancelled) setInternalCount(c || 0);

      const { data } = uid
        ? await supabase
            .from("article_likes")
            .select("id")
            .eq("article_id", articleId)
            .eq("profile_id", uid)
            .maybeSingle()
        : await supabase
            .from("article_likes")
            .select("id")
            .eq("article_id", articleId)
            .eq("visitor_key", getOrCreateVisitorKey())
            .maybeSingle();
      if (!cancelled) setInternalLiked(!!data);
    };

    void load();
    return () => { cancelled = true; };
  }, [articleId, isControlled]);

  const toggleLike = async () => {
    if (onToggleLike) {
      onToggleLike();
      return;
    }
    if (internalBusy) return;
    setInternalBusy(true);

    const nextLiked = !internalLiked;
    setInternalLiked(nextLiked);
    setInternalCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    const { data, error } = await supabase.rpc("toggle_article_like", {
      _article_id: articleId,
      _visitor_key: userId ? undefined : getOrCreateVisitorKey(),
    });

    if (error) {
      setInternalLiked(!nextLiked);
      setInternalCount((c) => Math.max(0, c - (nextLiked ? 1 : -1)));
    } else {
      const result = data as { liked: boolean; count: number } | null;
      if (result) {
        setInternalLiked(result.liked);
        setInternalCount(result.count);
        if (result.liked && userId) {
          void supabase.functions.invoke("dispatch-engagement-notifications", {
            body: { limit: 100 },
          });
        }
      }
    }

    setInternalBusy(false);
  };

  return (
    <button
      onClick={toggleLike}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 text-sm font-sans transition-colors ${
        liked ? "text-red-500 dark:text-red-400" : "text-muted-foreground hover:text-foreground"
      }`}
      title={liked ? "Rimuovi mi piace" : "Mi piace"}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
};

export default LikeButton;
