import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

interface LikeButtonProps {
  articleId: string;
  size?: number;
}

const LikeButton = ({ articleId, size = 18 }: LikeButtonProps) => {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
      if (!cancelled) setCount(c || 0);

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
      if (!cancelled) setLiked(!!data);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);

    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    const { data, error } = await supabase.rpc("toggle_article_like", {
      _article_id: articleId,
      _visitor_key: userId ? undefined : getOrCreateVisitorKey(),
    });

    if (error) {
      console.error("Failed to toggle article like", { articleId, error });
      setLiked(!nextLiked);
      setCount((c) => Math.max(0, c - (nextLiked ? 1 : -1)));
    } else {
      const result = data as { liked: boolean; count: number } | null;
      if (result) {
        setLiked(result.liked);
        setCount(result.count);
        if (result.liked && userId) {
          void supabase.functions.invoke("dispatch-engagement-notifications", {
            body: { limit: 100 },
          });
        }
      }
    }

    setBusy(false);
  };

  return (
    <button
      onClick={toggleLike}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 text-sm font-sans transition-colors ${
        liked ? "text-red-500" : "text-muted-foreground hover:text-foreground"
      }`}
      title={liked ? "Rimuovi mi piace" : "Mi piace"}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
};

export default LikeButton;
