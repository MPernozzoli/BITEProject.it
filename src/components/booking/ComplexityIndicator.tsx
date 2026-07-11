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

/**
 * Icon(s) for the leg's specific hazard tags. `withLabel` spells the reason out next to the
 * icon (used inside the tooltip, where there's room to be readable); without it, only the
 * bare icon shows (used on the compact pill itself — the tooltip carries the label).
 */
const DangerReasonIcons = ({
  leg,
  lang,
  withLabel = false,
}: {
  leg?: ComplexityLegFactors;
  lang: Language | "it" | "en";
  withLabel?: boolean;
}) => {
  if (!leg?.danger_reasons?.length) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${withLabel ? "gap-x-2 gap-y-1" : ""}`}>
      {leg.danger_reasons.map((key) => {
        const reason = getDangerReasonDef(key);
        if (!reason) return null;
        const Icon = reason.icon;
        const label = lang === "it" ? reason.label_it : reason.label_en;
        if (!withLabel) return <Icon key={key} size={12} strokeWidth={2.4} aria-label={label} />;
        return (
          <span key={key} className="inline-flex items-center gap-1 text-foreground/80">
            <Icon size={12} strokeWidth={2.4} aria-hidden />
            {label}
          </span>
        );
      })}
    </span>
  );
};

interface ComplexityIndicatorProps {
  level: number;
  lang: Language | "it" | "en";
  /** Optional danger level (0–3); when > 0 it is surfaced in the tooltip (and as a chip in badge mode). */
  dangerLevel?: number;
  /**
   * The leg the estimate is for. When provided, the tooltip explains the specific factors
   * behind the level (offshore navigation, duration, night navigation, danger) instead of a generic
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

  const ariaLabel =
    dangerLevel > 0
      ? `${complexityPrefix}: ${getComplexityLabel(level, lang)} · ${dangerPrefix}: ${getDangerLabel(dangerLevel, lang)}`
      : `${complexityPrefix}: ${getComplexityLabel(level, lang)}`;
  const badgePadding = compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        {/* A single trigger element wraps both pills — hovering the danger pill (icons
            included) opens the same rich tooltip as hovering the complexity pill, instead
            of relying on the icons' barebones native `title` tooltip. */}
        <TooltipTrigger asChild>
          <button type="button" aria-label={ariaLabel} className={`inline-flex cursor-help items-center gap-1 ${className}`}>
            {variant === "dot" ? (
              <span
                className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border text-[10px] font-bold leading-none ${getComplexityClass(level)} ${
                  dangerLevel > 0 ? "ring-2 ring-red-400/60" : ""
                }`}
              >
                {level}
              </span>
            ) : (
              <span
                className={`inline-flex items-center rounded-full border font-semibold ${badgePadding} ${getComplexityClass(level)}`}
              >
                {complexityPrefix}: {getComplexityLabel(level, lang)}
                <span aria-hidden className="ml-1 opacity-60">ⓘ</span>
              </span>
            )}

            {variant === "badge" && dangerLevel > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border font-semibold ${badgePadding} ${getDangerClass(dangerLevel)}`}
              >
                {dangerPrefix}: {getDangerLabel(dangerLevel, lang)}
                <DangerReasonIcons leg={leg} lang={lang} />
              </span>
            )}
          </button>
        </TooltipTrigger>
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
              {leg?.danger_reasons && leg.danger_reasons.length > 0 && (
                <span className="mt-1 flex text-[10.5px] font-normal text-foreground/70">
                  <DangerReasonIcons leg={leg} lang={lang} withLabel />
                </span>
              )}
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
