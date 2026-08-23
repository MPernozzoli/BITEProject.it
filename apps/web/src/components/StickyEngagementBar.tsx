import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";
import ShareButton from "@/components/ShareButton";
import type { Language } from "@/lib/i18n";

const HEART_NUDGE_TEXTS_IT = [
  "Ti sta piacendo? Faccelo sapere!",
  "Metti un like, ci fa felici!",
  "Ti è piaciuto? Lascia il tuo cuore!",
];
const HEART_NUDGE_TEXTS_EN = [
  "Enjoying it? Let us know!",
  "Drop a like, it means a lot!",
  "Loved it? Leave a heart!",
];

const COMMENT_NUDGE_TEXTS_IT = [
  "Hai qualcosa da dire? Scrivi un commento!",
  "Racconta la tua esperienza nei commenti!",
  "Ci piacerebbe leggere cosa ne pensi!",
  "Un commento? Non farti i fatti tuoi!",
  "Qualche pensiero? Condividilo qui sotto!",
];
const COMMENT_NUDGE_TEXTS_EN = [
  "Got something to say? Leave a comment!",
  "Share your experience in the comments!",
  "We'd love to hear what you think!",
  "A comment? Don't be shy!",
  "Any thoughts? Share them below!",
];

const pickRandom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

interface StickyEngagementBarProps {
  articleId: string;
  lang: Language;
  title: string;
  shareUrl: string;
  instagramStoryImageUrl?: string | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  liked: boolean;
  likeCount: number;
  onToggleLike: () => void;
  busy: boolean;
  onScrollToComments?: () => void;
}

const StickyEngagementBar = ({
  articleId,
  lang,
  title,
  shareUrl,
  instagramStoryImageUrl,
  scrollContainerRef,
  liked,
  likeCount,
  onToggleLike,
  busy,
  onScrollToComments,
}: StickyEngagementBarProps) => {
  const [visible, setVisible] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [hasCommented, setHasCommented] = useState(false);
  const [heartNudge, setHeartNudge] = useState(false);
  const [heartNudgeText, setHeartNudgeText] = useState("");
  const [commentNudge, setCommentNudge] = useState(false);
  const [commentNudgeText, setCommentNudgeText] = useState("");
  const nudgeFired = useRef(false);
  const commentNudgeFired = useRef(false);
  const heartNudgeTimeout = useRef<ReturnType<typeof setTimeout>>();
  const commentNudgeTimeout = useRef<ReturnType<typeof setTimeout>>();
  const barRef = useRef<HTMLDivElement>(null);

  const isIt = lang === "it";
  const heartTexts = isIt ? HEART_NUDGE_TEXTS_IT : HEART_NUDGE_TEXTS_EN;
  const commentTexts = isIt ? COMMENT_NUDGE_TEXTS_IT : COMMENT_NUDGE_TEXTS_EN;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const visitorKey = getOrCreateVisitorKey();
      const [countResult, commentResult] = await Promise.all([
        supabase
          .from("article_comments")
          .select("id", { count: "exact", head: true })
          .eq("article_id", articleId),
        supabase
          .from("article_comments")
          .select("id", { count: "exact", head: true })
          .eq("article_id", articleId)
          .eq("visitor_key", visitorKey),
      ]);
      if (!cancelled) {
        setCommentCount(countResult.count || 0);
        setHasCommented((commentResult.count || 0) > 0);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [articleId]);

  useEffect(() => {
    let frameId = 0;
    const container = scrollContainerRef?.current;

    const getScrollInfo = () => {
      if (container) {
        return {
          scrollY: container.scrollTop,
          vh: container.clientHeight,
          docHeight: container.scrollHeight,
        };
      }
      return {
        scrollY: window.scrollY,
        vh: window.innerHeight,
        docHeight: document.documentElement.scrollHeight,
      };
    };

    const onScroll = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const { scrollY, vh, docHeight } = getScrollInfo();
        const scrollProgress = scrollY / Math.max(docHeight - vh, 1);

        setVisible(scrollY > vh * 0.35);

        if (!nudgeFired.current && !liked && scrollProgress > 0.3 && scrollProgress < 0.65) {
          nudgeFired.current = true;
          setHeartNudgeText(pickRandom(heartTexts));
          setHeartNudge(true);
          heartNudgeTimeout.current = setTimeout(() => setHeartNudge(false), 2800);
        }

        if (!commentNudgeFired.current && !hasCommented && scrollProgress > 0.6 && scrollProgress < 0.9) {
          commentNudgeFired.current = true;
          setCommentNudgeText(pickRandom(commentTexts));
          setCommentNudge(true);
          commentNudgeTimeout.current = setTimeout(() => setCommentNudge(false), 2800);
        }
      });
    };

    const target = container || window;
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(frameId);
      target.removeEventListener("scroll", onScroll);
      clearTimeout(heartNudgeTimeout.current);
      clearTimeout(commentNudgeTimeout.current);
    };
  }, [scrollContainerRef, heartTexts, commentTexts, liked, hasCommented]);

  const scrollToComments = useCallback(() => {
    if (onScrollToComments) {
      onScrollToComments();
      return;
    }
    const el = document.getElementById("article-engagement-panel");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [onScrollToComments]);

  const tooltipBase =
    "z-[60] absolute bottom-full mb-2 whitespace-nowrap rounded-full bg-white/95 px-3 py-1.5 text-xs font-sans font-medium text-foreground shadow-lg border border-black/5 backdrop-blur-sm pointer-events-none transition-all duration-500 ease-[var(--ease-out-expo)]";
  const tooltipHidden = "opacity-0 translate-y-2 scale-95";
  const tooltipVisible = "opacity-100 translate-y-0 scale-100";
  const arrow =
    "absolute -bottom-1 left-5 h-2 w-2 rotate-45 bg-white/95 border-r border-b border-black/5";

  return (
    <div
      ref={barRef}
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-500 ease-[var(--ease-out-expo)] ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="mx-auto max-w-3xl px-3 pb-[env(safe-area-inset-bottom)] md:px-4 relative">
        {/* Tooltip cuore — fuori dal glass-panel per evitare clip da border-radius */}
        <div className={`${tooltipBase} left-4 ${heartNudge ? tooltipVisible : tooltipHidden}`}>
          {heartNudgeText}
          <div className={arrow} />
        </div>

        {/* Tooltip commenti — fuori dal glass-panel, allineato al bottone */}
        <div className={`${tooltipBase} left-[72px] ${commentNudge ? tooltipVisible : tooltipHidden}`}>
          {commentNudgeText}
          <div className={`${arrow} left-5`} />
        </div>

        <div className="glass-panel rounded-t-[22px] border border-b-0 border-white/20 bg-white/70 backdrop-blur-xl px-4 py-3 md:px-6 md:py-3.5 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={onToggleLike}
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
              className={`inline-flex items-center gap-1.5 text-sm font-sans hover:text-foreground hover:bg-black/5 rounded-full px-3 py-1.5 transition-colors ${
                commentNudge ? "text-accent" : "text-muted-foreground"
              }`}
              title={isIt ? "Commenti" : "Comments"}
            >
              <MessageCircle size={20} />
              {commentCount > 0 && <span className="font-medium tabular-nums">{commentCount}</span>}
            </button>

            <div className="flex-1" />

            <ShareButton articleId={articleId} title={title} url={shareUrl} instagramStoryImageUrl={instagramStoryImageUrl} size={18} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default StickyEngagementBar;
