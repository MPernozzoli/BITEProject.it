import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import ShareButton from "@/components/ShareButton";
import type { Language } from "@/lib/i18n";

interface StickyEngagementBarProps {
  articleId: string;
  lang: Language;
  title: string;
  shareUrl: string;
  instagramStoryImageUrl?: string | null;
}

const StickyEngagementBar = ({
  articleId,
  lang,
  title,
  shareUrl,
  instagramStoryImageUrl,
}: StickyEngagementBarProps) => {
  const [visible, setVisible] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [heartNudge, setHeartNudge] = useState(false);
  const nudgeFired = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);

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
      if (!cancelled) setLikeCount(c || 0);

      const { count: cc } = await supabase
        .from("article_comments")
        .select("id", { count: "exact", head: true })
        .eq("article_id", articleId);
      if (!cancelled) setCommentCount(cc || 0);

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
    return () => { cancelled = true; };
  }, [articleId]);

  useEffect(() => {
    let frameId = 0;

    const onScroll = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const vh = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;

        const scrollProgress = scrollY / Math.max(docHeight - vh, 1);
        setVisible(scrollY > vh * 0.35);

        if (!nudgeFired.current && scrollProgress > 0.35 && scrollProgress < 0.65) {
          nudgeFired.current = true;
          setHeartNudge(true);
          setTimeout(() => setHeartNudge(false), 1200);
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const toggleLike = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    const { data, error } = await supabase.rpc("toggle_article_like", {
      _article_id: articleId,
      _visitor_key: userId ? undefined : getOrCreateVisitorKey(),
    });

    if (error) {
      setLiked(!nextLiked);
      setLikeCount((c) => Math.max(0, c - (nextLiked ? 1 : -1)));
    } else {
      const result = data as { liked: boolean; count: number } | null;
      if (result) {
        setLiked(result.liked);
        setLikeCount(result.count);
        if (result.liked && userId) {
          void supabase.functions.invoke("dispatch-engagement-notifications", {
            body: { limit: 100 },
          });
        }
      }
    }

    setBusy(false);
  }, [articleId, busy, liked, userId]);

  const scrollToComments = useCallback(() => {
    const el = document.getElementById("article-engagement-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const isIt = lang === "it";

  return (
    <div
      ref={barRef}
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-500 ease-[var(--ease-out-expo)] ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="mx-auto max-w-3xl px-3 pb-[env(safe-area-inset-bottom)] md:px-4">
        <div className="glass-panel rounded-t-[22px] border border-b-0 border-white/20 bg-white/70 backdrop-blur-xl px-4 py-3 md:px-6 md:py-3.5 flex items-center gap-2 md:gap-4 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
          <button
            onClick={toggleLike}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 text-sm font-sans transition-colors rounded-full px-3 py-1.5 -ml-1 ${
              liked
                ? "text-red-500 bg-red-50 hover:bg-red-100"
                : "text-muted-foreground hover:text-foreground hover:bg-black/5"
            } ${heartNudge ? "animate-heart-nudge" : ""}`}
            title={liked ? (isIt ? "Rimuovi mi piace" : "Unlike") : (isIt ? "Mi piace" : "Like")}
          >
            <Heart
              size={20}
              fill={liked ? "currentColor" : "none"}
              className={`transition-transform duration-300 ${heartNudge ? "scale-110" : ""}`}
            />
            {likeCount > 0 && <span className="font-medium tabular-nums">{likeCount}</span>}
          </button>

          <button
            onClick={scrollToComments}
            className="inline-flex items-center gap-1.5 text-sm font-sans text-muted-foreground hover:text-foreground hover:bg-black/5 rounded-full px-3 py-1.5 transition-colors"
            title={isIt ? "Commenti" : "Comments"}
          >
            <MessageCircle size={20} />
            {commentCount > 0 && <span className="font-medium tabular-nums">{commentCount}</span>}
          </button>

          <div className="flex-1" />

          <ShareButton title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImageUrl} size={18} />
        </div>
      </div>
    </div>
  );
};

export default StickyEngagementBar;
