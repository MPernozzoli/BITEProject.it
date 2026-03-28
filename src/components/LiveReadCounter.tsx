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
  const [isUpdating, setIsUpdating] = useState(false);
  const previousCountRef = useRef(count);
  const updateTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousCountRef.current === count) return;

    previousCountRef.current = count;
    setIsUpdating(true);

    if (updateTimeoutRef.current !== null) {
      window.clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = window.setTimeout(() => {
      setIsUpdating(false);
      updateTimeoutRef.current = null;
    }, FLIP_ANIMATION_MS);

    return () => {
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    };
  }, [count]);

  const formattedCount = useMemo(
    () => count.toLocaleString(lang === "it" ? "it-IT" : "en-US"),
    [count, lang]
  );

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm font-sans text-muted-foreground/80", className)}
      title={lang === "it" ? "Letture totali" : "Total reads"}
    >
      <Eye
        size={15}
        className={cn(
          "shrink-0 opacity-60 transition-opacity duration-500",
          isUpdating && "opacity-80"
        )}
        aria-hidden
      />
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "tabular-nums transition-all duration-500",
            isUpdating ? "opacity-100 -translate-y-px text-muted-foreground" : "opacity-75"
          )}
        >
          {formattedCount}
        </span>
        <span>{lang === "it" ? "letture" : "reads"}</span>
      </span>
    </span>
  );
}
