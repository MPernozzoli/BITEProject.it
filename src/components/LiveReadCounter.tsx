import { useEffect, useMemo, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type LiveReadCounterProps = {
  count: number;
  lang: "it" | "en";
  className?: string;
};

const FLIP_ANIMATION_MS = 640;

export default function LiveReadCounter({ count, lang, className }: LiveReadCounterProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const previousCountRef = useRef(count);
  const animationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousCountRef.current === count) return;

    previousCountRef.current = count;
    setIsAnimating(true);

    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
    }

    animationTimeoutRef.current = window.setTimeout(() => {
      setIsAnimating(false);
      animationTimeoutRef.current = null;
    }, FLIP_ANIMATION_MS);

    return () => {
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, [count]);

  const formattedCount = useMemo(
    () => count.toLocaleString(lang === "it" ? "it-IT" : "en-US"),
    [count, lang]
  );

  return (
    <span
      className={cn("inline-flex items-center gap-2 text-sm font-sans text-muted-foreground", className)}
      title={lang === "it" ? "Letture totali" : "Total reads"}
    >
      <Eye size={15} className={cn("shrink-0 opacity-80 transition-transform duration-500", isAnimating && "scale-110")} aria-hidden />
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "read-counter-chip",
            isAnimating && "read-counter-chip-active"
          )}
        >
          <span className="read-counter-chip__hinge" aria-hidden />
          <span
            key={formattedCount}
            className={cn("read-counter-chip__value", isAnimating && "read-counter-chip__value-active")}
          >
            {formattedCount}
          </span>
        </span>
        <span>{lang === "it" ? "letture" : "reads"}</span>
      </span>
    </span>
  );
}
