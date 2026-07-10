import type { Language } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getComplexityClass,
  getComplexityDisclaimer,
  getComplexityExplanation,
  getComplexityLabel,
  getComplexityTitle,
  getDangerClass,
  getDangerLabel,
  type BookableLeg,
} from "@/lib/booking-utils";
import { getDangerReasonDef } from "@/lib/danger-reasons";

type ComplexityLegFactors = Pick<
  BookableLeg,
  | "complexity_override"
  | "danger_level"
  | "danger_reasons"
  | "open_sea"
  | "starts_at_window_start"
  | "ends_at_window_start"
>;

interface ComplexityIndicatorProps {
  level: number;
  lang: Language | "it" | "en";
  /** Optional danger level (0–3); when > 0 it is surfaced in the tooltip (and as a chip in badge mode). */
  dangerLevel?: number;
  /**
   * The leg the estimate is for. When provided, the tooltip explains the specific factors
   * behind the level (open sea, duration, night navigation, danger) instead of a generic
   * disclaimer.
   */
  leg?: ComplexityLegFactors;
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
  leg,
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
          // Without this, Radix/Floating-UI uses the trigger's nearest scrollable ancestor
          // (e.g. the horizontally-scrolling route diagram in VoyageLegend) as the collision
          // boundary, which can push the tooltip into a bad position even though it renders
          // in a portal. Use the whole viewport instead.
          collisionBoundary={typeof document !== "undefined" ? document.body : undefined}
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
          {dangerLevel > 0 && leg?.danger_reasons && leg.danger_reasons.length > 0 && (
            <span className="mb-1.5 flex flex-wrap gap-1">
              {leg.danger_reasons.map((key) => {
                const reason = getDangerReasonDef(key);
                if (!reason) return null;
                const Icon = reason.icon;
                return (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-red-300/60 bg-red-50/80 px-1.5 py-0.5 text-[10px] font-medium text-red-800"
                  >
                    <Icon size={11} strokeWidth={2.4} aria-hidden />
                    {italian ? reason.label_it : reason.label_en}
                  </span>
                );
              })}
            </span>
          )}
          <span className="block text-muted-foreground">
            {leg ? getComplexityExplanation(leg, lang) : getComplexityDisclaimer(lang)}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ComplexityIndicator;
