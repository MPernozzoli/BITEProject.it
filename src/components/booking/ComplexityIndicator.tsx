import type { Language } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getComplexityClass,
  getComplexityDisclaimer,
  getComplexityLabel,
  getComplexityTitle,
  getDangerClass,
  getDangerLabel,
} from "@/lib/booking-utils";

interface ComplexityIndicatorProps {
  level: number;
  lang: Language | "it" | "en";
  /** Optional danger level (0–3); when > 0 it is surfaced in the tooltip (and as a chip in badge mode). */
  dangerLevel?: number;
  /** "badge" = labelled pill (default); "dot" = compact numbered circle for dense layouts. */
  variant?: "badge" | "dot";
  /** Smaller footprint for dense layouts. */
  compact?: boolean;
  className?: string;
}

/**
 * Complexity indicator with an accessible explanatory tooltip. The tooltip opens on hover
 * and keyboard focus (desktop) and on tap (touch), and always carries the estimate
 * disclaimer so the value is never read as a guarantee.
 */
const ComplexityIndicator = ({
  level,
  lang,
  dangerLevel = 0,
  variant = "badge",
  compact = false,
  className = "",
}: ComplexityIndicatorProps) => {
  const italian = lang === "it";
  const complexityPrefix = italian ? "Complessità" : "Complexity";
  const dangerPrefix = italian ? "Pericolo" : "Danger";

  const ariaLabel = `${complexityPrefix}: ${getComplexityLabel(level, lang)}`;
  const badgePadding = compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <TooltipTrigger asChild>
            {variant === "dot" ? (
              <button
                type="button"
                aria-label={ariaLabel}
                className={`inline-flex h-[18px] min-w-[18px] cursor-help items-center justify-center rounded-full border text-[10px] font-bold leading-none ${getComplexityClass(level)} ${
                  dangerLevel > 0 ? "ring-2 ring-red-400/60" : ""
                }`}
              >
                {level}
              </button>
            ) : (
              <button
                type="button"
                className={`inline-flex cursor-help items-center rounded-full border font-semibold ${badgePadding} ${getComplexityClass(level)}`}
              >
                {complexityPrefix}: {getComplexityLabel(level, lang)}
                <span aria-hidden className="ml-1 opacity-60">ⓘ</span>
              </button>
            )}
          </TooltipTrigger>

          {variant === "badge" && dangerLevel > 0 && (
            <span
              className={`inline-flex items-center rounded-full border font-semibold ${badgePadding} ${getDangerClass(dangerLevel)}`}
            >
              {dangerPrefix}: {getDangerLabel(dangerLevel, lang)}
            </span>
          )}
        </span>
        <TooltipContent
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          className="z-[13000] w-[min(280px,78vw)] rounded-xl border-border/70 bg-popover/95 p-3 text-left text-[11px] font-normal leading-relaxed shadow-xl backdrop-blur"
        >
          <span className="mb-1 block text-[11px] font-semibold text-foreground">
            {getComplexityTitle(lang)} · {getComplexityLabel(level, lang)}
          </span>
          {dangerLevel > 0 && (
            <span className="mb-1 block text-[11px] font-medium text-foreground/90">
              {dangerPrefix}: {getDangerLabel(dangerLevel, lang)}
            </span>
          )}
          <span className="block text-muted-foreground">{getComplexityDisclaimer(lang)}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ComplexityIndicator;
