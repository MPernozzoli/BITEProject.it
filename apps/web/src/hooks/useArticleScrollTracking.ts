import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateVisitorKey } from "@/lib/visitor-key";

const MILESTONES = [25, 50, 75, 90, 100] as const;

type Options = {
  articleId: string;
  enabled?: boolean;
};

export function useArticleScrollTracking({ articleId, enabled = true }: Options) {
  const reachedRef = useRef<Set<number>>(new Set());
  const rafRef = useRef(0);

  const reportMilestone = useCallback(
    async (pct: number) => {
      try {
        const visitorKey = getOrCreateVisitorKey();
        await supabase.rpc("record_article_scroll", {
          _article_id: articleId,
          _visitor_key: visitorKey,
          _max_scroll_pct: pct as unknown as number,
        });
      } catch {
        // silent
      }
    },
    [articleId]
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    reachedRef.current = new Set();

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollHeight <= 0) return;
        const pct = Math.round((window.scrollY / scrollHeight) * 100);
        for (const milestone of MILESTONES) {
          if (pct >= milestone && !reachedRef.current.has(milestone)) {
            reachedRef.current.add(milestone);
            void reportMilestone(milestone);
          }
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
    };
  }, [enabled, reportMilestone]);
}
