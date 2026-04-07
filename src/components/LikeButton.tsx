import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function loadLikeState() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      const uid = session?.user?.id ?? null;
      setUserId(uid);

      if (!uid) {
        setLiked(false);
      } else {
        const { data } = await supabase
          .from("article_likes")
          .select("id")
          .eq("article_id", articleId)
          .eq("profile_id", uid)
          .maybeSingle();
        if (cancelled) return;
        setLiked(!!data);
      }

      // Conteggio dopo getSession: altrimenti la prima richiesta può partire senza JWT e RLS restituisce 0
      const { count: total, error } = await supabase
        .from("article_likes")
        .select("id", { count: "exact", head: true })
        .eq("article_id", articleId);
      if (cancelled) return;
      if (error) {
        const { data: rows } = await supabase.from("article_likes").select("id").eq("article_id", articleId);
        if (cancelled) return;
        setCount(rows?.length ?? 0);
        return;
      }
      setCount(total ?? 0);
    }

    void loadLikeState();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") return;
      void loadLikeState();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [articleId]);

  const toggleLike = async () => {
    if (!userId) {
      navigate("/login", { state: { from: window.location.pathname } });
      return;
    }
    if (liked) {
      const { error } = await supabase
        .from("article_likes")
        .delete()
        .eq("article_id", articleId)
        .eq("profile_id", userId);
      if (error) return;
      setLiked(false);
      setCount((c) => Math.max(0, c - 1));
    } else {
      const { error } = await supabase
        .from("article_likes")
        .insert({ article_id: articleId, profile_id: userId });
      if (error) return;
      setLiked(true);
      setCount((c) => c + 1);
      void supabase.functions.invoke("dispatch-engagement-notifications", {
        body: { limit: 100 },
      });
    }
  };

  return (
    <button
      onClick={toggleLike}
      className={`inline-flex items-center gap-1.5 text-sm font-sans transition-colors ${
        liked ? "text-red-500" : "text-muted-foreground hover:text-foreground"
      }`}
      title={userId ? (liked ? "Rimuovi mi piace" : "Mi piace") : "Accedi per mettere mi piace"}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} />
      <span className="tabular-nums min-w-[1ch]">{count}</span>
    </button>
  );
};

export default LikeButton;
