import type { ReactNode } from "react";
import { AlertTriangle, Check, Hand, Ship, Users } from "lucide-react";
import {
  formatLegScheduleSummary,
  getComplexityClass,
  getComplexityLabel,
  getDangerClass,
  getDangerLabel,
  getLegComplexity,
  getLegDangerLevel,
  type BookableLegAvailability,
} from "@/lib/booking-utils";
import { getDangerReasonDef } from "@/lib/danger-reasons";
import { formatDepositEur, legDepositEur, roundUpToNextEuro, type ContributionOptions } from "@/lib/booking-deposit";
import {
  getLegSelectionRole,
  getLegSelectionRoleLabel,
  getSelectionRange,
  type LegSelectionRole,
} from "@/lib/booking-leg-selection";

interface VoyageJoinLegListProps {
  lang: "it" | "en";
  legs: BookableLegAvailability[];
  selectedLegIds: string[];
  /** Read-only until the traveller has pressed "Partecipa": before that the list only informs. */
  interactive: boolean;
  onTapLeg: (legId: string) => void;
  waypointLabel: (waypointId: string, fallback: string) => string;
  contributionOptions: ContributionOptions;
  /** People the application is for, so a leg too tight for the whole party reads as such. */
  partySize: number;
  disabled?: boolean;
}

const cardClassName = (role: LegSelectionRole, interactive: boolean, tooTight: boolean) => {
  if (role !== "none") return "border-emerald-500/85 bg-emerald-50/90 dark:bg-emerald-500/10 shadow-[0_2px_14px_rgba(5,150,105,0.14)] dark:bg-emerald-400/15";
  if (tooTight) return "border-red-200/80 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 dark:border-red-400/35 dark:bg-red-400/10";
  if (interactive) return "border-dashed border-emerald-300/80 dark:border-emerald-500/30 bg-glass/70 hover:border-emerald-500 hover:bg-emerald-50/60 dark:hover:bg-emerald-500/10 dark:border-emerald-400/45 dark:hover:bg-emerald-400/10";
  return "border-emerald-100 dark:border-emerald-500/30 bg-glass/55 dark:border-emerald-400/20";
};

/**
 * The legs of a voyage as a column of large, obviously tappable cards.
 *
 * It replaces the old read-only list. Once the traveller presses "Partecipa" every card grows a
 * dashed outline, a check circle and the words "Tocca per scegliere": the affordance has to be
 * readable at arm's length, not inferred from a hover state a phone never shows. Selected cards
 * then say what they are in the itinerary — "Imbarco", "A bordo", "Sbarco" — instead of only
 * turning green.
 *
 * Complexity and danger are plain labelled pills here rather than the tooltip indicator used
 * elsewhere: the card is itself a button, and a button inside a button is neither valid markup
 * nor tappable on a phone without hitting the wrong one.
 */
const VoyageJoinLegList = ({
  lang,
  legs,
  selectedLegIds,
  interactive,
  onTapLeg,
  waypointLabel,
  contributionOptions,
  partySize,
  disabled = false,
}: VoyageJoinLegListProps) => {
  const it = lang === "it";
  const orderedLegIds = legs.map((leg) => leg.id);
  const range = getSelectionRange(orderedLegIds, selectedLegIds);

  return (
    <ol className="m-0 list-none space-y-2.5 p-0">
      {legs.map((leg, index) => {
        const role = getLegSelectionRole(index, range);
        const selected = role !== "none";
        const roleLabel = getLegSelectionRoleLabel(role, lang);
        const price = roundUpToNextEuro(legDepositEur(leg, contributionOptions));
        const scheduleSummary = formatLegScheduleSummary(leg, lang);
        const soldOut = !leg.available || leg.remaining <= 0;
        const tooTight = !soldOut && leg.remaining < partySize;
        const fromLabel = waypointLabel(leg.from_waypoint_id, it ? "Partenza" : "Departure");
        const toLabel = waypointLabel(leg.to_waypoint_id, it ? "Arrivo" : "Arrival");
        const complexity = getLegComplexity(leg);
        const danger = getLegDangerLevel(leg);

        const content: ReactNode = (
          <>
            {/* A real, big circle rather than a colour change only: it reads as a checkbox. */}
            <span
              aria-hidden
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold sm:h-10 sm:w-10 ${
                selected
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : interactive
                    ? "border-dashed border-emerald-400 bg-glass text-emerald-700 dark:text-emerald-300 dark:text-emerald-200"
                    : "border-emerald-200 dark:border-emerald-500/30 bg-glass text-emerald-700 dark:text-emerald-300 dark:border-emerald-400/40 dark:text-emerald-200"
              }`}
            >
              {selected ? <Check size={20} strokeWidth={3} /> : index + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15px] font-semibold leading-snug text-emerald-950 dark:text-emerald-300 dark:text-emerald-50 sm:text-base">
                  {fromLabel} <span className="text-emerald-700 dark:text-emerald-300">→</span> {toLabel}
                </span>
                <span className="text-xs text-emerald-900/60 dark:text-emerald-300 dark:text-emerald-100/60">
                  {Number(leg.planned_nautical_miles || 0).toFixed(0)} NM
                </span>
              </span>

              {scheduleSummary && (
                <span className="mt-1 block text-[13px] leading-snug text-emerald-900/70 dark:text-emerald-300 dark:text-emerald-100/70">{scheduleSummary}</span>
              )}

              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                <span className="font-semibold text-emerald-900 dark:text-emerald-300 dark:text-emerald-100">
                  {formatDepositEur(price, lang)}{" "}
                  <span className="font-normal text-emerald-900/60 dark:text-emerald-300 dark:text-emerald-100/60">{it ? "a persona" : "per person"}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    soldOut
                      ? "text-red-700 dark:text-red-300"
                      : tooTight
                        ? "text-amber-800 dark:text-amber-300 dark:text-amber-200"
                        : "text-emerald-800 dark:text-emerald-300 dark:text-emerald-200"
                  }`}
                >
                  <Users size={13} />
                  {soldOut
                    ? it
                      ? "Al completo"
                      : "Fully booked"
                    : it
                      ? `${leg.remaining} posti liberi`
                      : `${leg.remaining} seats left`}
                </span>
              </span>

              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getComplexityClass(complexity)}`}
                >
                  {it ? "Difficoltà" : "Difficulty"}: {getComplexityLabel(complexity, lang)}
                </span>
                {danger > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getDangerClass(danger)}`}
                  >
                    <AlertTriangle size={11} />
                    {getDangerLabel(danger, lang)}
                    {(leg.danger_reasons ?? []).map((key) => {
                      const reason = getDangerReasonDef(key);
                      if (!reason) return null;
                      const Icon = reason.icon;
                      return <Icon key={key} size={11} strokeWidth={2.4} aria-label={it ? reason.label_it : reason.label_en} />;
                    })}
                  </span>
                )}
              </span>

              {tooTight && (
                <span className="mt-2 block text-[12.5px] font-medium leading-snug text-amber-800 dark:text-amber-300 dark:text-amber-200">
                  {it
                    ? `Qui restano ${leg.remaining} posti: non bastano per ${partySize} persone.`
                    : `Only ${leg.remaining} seats left here: not enough for ${partySize} people.`}
                </span>
              )}

              {/* The instruction lives on the card itself, where the finger already is. */}
              {interactive && !selected && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 dark:border-emerald-500/30 bg-glass px-2.5 py-1 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300 dark:border-emerald-400/50 dark:text-emerald-200">
                  <Hand size={12} />
                  {it ? "Tocca per scegliere" : "Tap to choose"}
                </span>
              )}
              {selected && roleLabel && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.08em] text-white">
                  <Ship size={12} />
                  {roleLabel}
                </span>
              )}
            </span>
          </>
        );

        const shellClassName = `flex w-full items-start gap-3 rounded-[22px] border-2 px-3.5 py-3.5 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4 ${cardClassName(
          role,
          interactive,
          tooTight || soldOut
        )}`;

        return (
          <li key={leg.id}>
            {interactive ? (
              <button
                type="button"
                onClick={() => onTapLeg(leg.id)}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={
                  selected
                    ? it
                      ? `${fromLabel} verso ${toLabel} — selezionata`
                      : `${fromLabel} to ${toLabel} — selected`
                    : it
                      ? `Scegli la tratta da ${fromLabel} a ${toLabel}`
                      : `Choose the leg from ${fromLabel} to ${toLabel}`
                }
                className={`${shellClassName} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {content}
              </button>
            ) : (
              <div className={shellClassName}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default VoyageJoinLegList;
