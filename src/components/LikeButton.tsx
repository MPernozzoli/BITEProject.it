import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface LikeButtonProps {
  articleId: string;
  size?: number;
}

const LikeButton = ({ articleId, size = 18 }: LikeButtonProps) => {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchLikes();
    checkSession();
  }, [articleId]);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id || null);
    if (session?.user?.id) {
      const { data } = await supabase
        .from("article_likes")
        .select("id")
        .eq("article_id", articleId)
        .eq("profile_id", session.user.id)
        .maybeSingle();
      setLiked(!!data);
    }
  };

  const fetchLikes = async () => {
    const { count: c } = await supabase
      .from("article_likes")
      .select("id", { count: "exact", head: true })
      .eq("article_id", articleId);
    setCount(c || 0);
  };

  const toggleLike = async () => {
    if (!userId) return;
    if (liked) {
      await supabase.from("article_likes").delete().eq("article_id", articleId).eq("profile_id", userId);
      setCount((c) => Math.max(0, c - 1));
    } else {
      await supabase.from("article_likes").insert({ article_id: articleId, profile_id: userId });
      setCount((c) => c + 1);
    }
    setLiked(!liked);
  };

  return (
    <button
      onClick={toggleLike}
      className={`inline-flex items-center gap-1.5 text-sm font-sans transition-colors ${
        liked ? "text-red-500" : "text-muted-foreground hover:text-foreground"
      } ${!userId ? "opacity-50 cursor-default" : ""}`}
      disabled={!userId}
      title={userId ? (liked ? "Remove like" : "Like") : "Sign in to like"}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
};

export default LikeButton;
