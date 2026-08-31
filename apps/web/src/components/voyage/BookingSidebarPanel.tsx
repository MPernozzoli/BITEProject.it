import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, TicketCheck, Users, X } from "lucide-react";
import type { Language } from "@/lib/i18n";
import {
  type BookableLegAvailability,
  type BookingWaypoint,
  formatLegScheduleSummary,
  getComplexityLabel,
  getLegComplexity,
  getLegDangerLevel,
  getLegLabel,
} from "@/lib/booking-utils";
import type { Voyage } from "@/lib/voyage-utils";
import { getLocalizedVoyageName } from "@/lib/voyage-utils";
import { getDangerReasonDef } from "@/lib/danger-reasons";
import ComplexityIndicator from "@/components/booking/ComplexityIndicator";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import ContributionEstimateNote from "@/components/booking/ContributionEstimateNote";
import type { CandidateInfo } from "@/lib/booking-candidate-info";
import { depositTargetEur, formatDepositEur } from "@/lib/booking-deposit";

interface BookingSidebarPanelProps {
  voyage: Voyage | null;
  legs: BookableLegAvailability[];
  waypointsById: Record<string, BookingWaypoint>;
  selectedLegIds: string[];
  rejectedLegIds: string[];
  partySize: number;
  message: string;
  candidateInfo: CandidateInfo;
  depositPerPersonEur?: number;
  depositTotalEur?: number;
  /** Whether this voyage also accepts a workaway trade, named in the estimate note. */
  workawayEnabled?: boolean | null;
  submitting: boolean;
  isSignedIn: boolean;
  lang: Language;
  isMobile: boolean;
  mobileSidebarMode: "peek" | "expanded" | "collapsed";
  onMobileTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onMobileTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onMobileTouchEnd: (event?: TouchEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onToggleLeg: (legId: string) => void;
  onPartySizeChange: (partySize: number) => void;
  onMessageChange: (message: string) => void;
  onCandidateInfoChange: (candidateInfo: CandidateInfo) => void;
  onSubmit: () => void;
  initialStep?: "legs" | "about";
  stepResetKey?: string;
  onStepChange?: (step: "legs" | "about") => void;
}

const BookingSidebarPanel = ({
  voyage,
  legs,
  waypointsById,
  selectedLegIds,
  rejectedLegIds,
  partySize,
  message,
  candidateInfo,
  depositPerPersonEur,
  depositTotalEur,
  workawayEnabled,
  submitting,
  isSignedIn,
  lang,
  isMobile,
  mobileSidebarMode,
  onMobileTouchStart,
  onMobileTouchMove,
  onMobileTouchEnd,
  onClose,
  onToggleLeg,
  onPartySizeChange,
  onMessageChange,
  onCandidateInfoChange,
  onSubmit,
  initialStep = "legs",
  stepResetKey,
  onStepChange,
}: BookingSidebarPanelProps) => {
  const [step, setStep] = useState<"legs" | "about">(initialStep);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedLegs = selectedLegIds.map((id) => legs.find((leg) => leg.id === id)).filter(Boolean) as BookableLegAvailability[];
  const rejectedLegs = rejectedLegIds.map((id) => legs.find((leg) => leg.id === id)).filter(Boolean) as BookableLegAvailability[];

  useEffect(() => {
    setStep(initialStep);
  }, [initialStep, stepResetKey]);

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  useLayoutEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  const hazardSummary = (() => {
    if (selectedLegs.length === 0) return null;
    let maxComplexity = 0;
    let maxDanger = 0;
    const reasonKeys = new Set<string>();
    for (const leg of selectedLegs) {
      maxComplexity = Math.max(maxComplexity, getLegComplexity(leg));
      maxDanger = Math.max(maxDanger, getLegDangerLevel(leg));
      (leg.danger_reasons ?? []).forEach((key) => reasonKeys.add(key));
    }
    if (maxComplexity < 4 && maxDanger === 0) return null;
    return { maxComplexity, reasonKeys: Array.from(reasonKeys) };
  })();

  const voyageName = voyage ? getLocalizedVoyageName(voyage, lang) : lang === "it" ? "Selezione" : "Selection";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-glass-edge/45 bg-background/55 p-4 backdrop-blur-xl">
        {isMobile && (
          <div className="mb-3 flex flex-col items-center gap-2">
            <div
              className="flex w-full flex-col items-center gap-2"
              style={{ touchAction: "none" }}
              onTouchStart={onMobileTouchStart}
              onTouchMove={onMobileTouchMove}
              onTouchEnd={onMobileTouchEnd}
              onTouchCancel={onMobileTouchEnd}
            >
              <div className={`h-1.5 w-14 rounded-full bg-foreground/20 ${mobileSidebarMode !== "expanded" ? "mobile-sheet-handle-hint" : ""}`} />
              <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
                {mobileSidebarMode === "expanded"
                  ? (lang === "it" ? "Scorri verso il basso" : "Swipe down")
                  : (lang === "it" ? "Scorri verso l'alto" : "Swipe up")}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
              {lang === "it" ? "Partecipa al viaggio" : "Join the voyage"}
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold text-foreground">{voyageName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-glass-edge/60 bg-glass/60 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={lang === "it" ? "Chiudi booking" : "Close booking"}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 ${isMobile ? "overscroll-contain" : ""}`}
        style={isMobile ? { touchAction: "pan-y" } : undefined}
      >
        {step === "about" ? (
          <div className="space-y-4">
            <div className="rounded-[22px] border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/65 dark:bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-950 dark:text-amber-300">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-800 dark:text-amber-300">
                {lang === "it" ? "Riepilogo tratte" : "Leg summary"}
              </p>
              <div className="mt-3 space-y-1.5">
                {selectedLegs.map((leg) => (
                  <p key={leg.id} className="font-medium text-foreground">
                    {getLegLabel(leg, waypointsById, lang)}
                  </p>
                ))}
              </div>
              <p className="mt-3 text-muted-foreground">
                {lang === "it" ? "Persone" : "People"}: <span className="font-medium text-foreground">{partySize}</span>
              </p>
              {typeof depositTotalEur === "number" && (
                <div className="mt-3 rounded-2xl border border-amber-300/70 dark:border-amber-500/30 bg-glass/65 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">
                      {lang === "it" ? "Contributo spese vive" : "Cost contribution"}
                    </span>
                    <span className="text-base font-bold text-amber-950 dark:text-amber-300">
                      {formatDepositEur(depositTotalEur, lang === "it" ? "it" : "en")}
                    </span>
                  </div>
                  {typeof depositPerPersonEur === "number" && partySize > 1 && (
                    <p className="mt-1 text-[11px] text-amber-900 dark:text-amber-300">
                      {formatDepositEur(depositPerPersonEur, lang === "it" ? "it" : "en")} × {partySize}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] font-medium text-amber-900 dark:text-amber-300">
                    {lang === "it"
                      ? `Acconto ora: ${formatDepositEur(depositTargetEur(depositTotalEur), "it")} · Saldo entro 15gg dalla partenza: ${formatDepositEur(depositTotalEur - depositTargetEur(depositTotalEur), "it")}`
                      : `Deposit now: ${formatDepositEur(depositTargetEur(depositTotalEur), "en")} · Balance within 15 days of departure: ${formatDepositEur(depositTotalEur - depositTargetEur(depositTotalEur), "en")}`}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-950/85 dark:text-amber-300">
                    {lang === "it"
                      ? "Non e un prezzo, un biglietto o un servizio commerciale: e una quota equa delle spese vive di un viaggio privato che l'equipaggio deve comunque effettuare."
                      : "This is not a price, ticket, or commercial service: it is a fair share of the out-of-pocket costs of a private voyage the crew is already making."}
                  </p>
                  <ContributionEstimateNote
                    lang={lang}
                    workawayEnabled={workawayEnabled}
                    className="mt-2 text-[11px] leading-relaxed text-amber-950/85 dark:text-amber-300"
                  />
                </div>
              )}
            </div>
            <div className="rounded-[24px] border border-glass-edge/60 bg-glass/45 p-4">
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {lang === "it" ? "Dicci di te" : "Tell us about you"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {lang === "it"
                    ? "Questa e una candidatura: la partecipazione sara confermata solo dopo la revisione dell'organizzatore."
                    : "This is an application: participation is confirmed only after the organiser reviews it."}
                </p>
              </div>
              <CandidateInfoForm value={candidateInfo} onChange={onCandidateInfoChange} lang={lang} compact />
            </div>
          </div>
        ) : legs.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-emerald-300/70 dark:border-emerald-500/30 bg-emerald-50/75 dark:bg-emerald-500/10 px-3 py-3 text-xs text-emerald-800 dark:text-emerald-300">
            {lang === "it"
              ? "Al momento non ci sono tratte disponibili su questo viaggio."
              : "There are currently no open legs on this voyage."}
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className={`rounded-[18px] border px-3 py-2.5 text-[11.5px] leading-relaxed ${
                selectedLegIds.length > 0
                  ? "border-emerald-300/70 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-300"
                  : "border-amber-300/70 dark:border-amber-500/30 bg-amber-50/75 dark:bg-amber-500/10 text-amber-950 dark:text-amber-300"
              }`}
            >
              <p className="font-semibold">
                {selectedLegIds.length > 0
                  ? (lang === "it"
                    ? `${selectedLegIds.length} ${selectedLegIds.length === 1 ? "tratta selezionata" : "tratte selezionate"}`
                    : `${selectedLegIds.length} ${selectedLegIds.length === 1 ? "leg selected" : "legs selected"}`)
                  : (lang === "it" ? "Passo 1 — Scegli le tratte" : "Step 1 — Pick your legs")}
              </p>
              <p className="mt-0.5 opacity-85">
                {selectedLegIds.length > 0
                  ? (lang === "it"
                    ? "Tocca una tratta per aggiungerla o toglierla, poi vai al riepilogo."
                    : "Tap a leg to add or remove it, then move on to the summary.")
                  : (lang === "it"
                    ? "Tocca qui sotto le tratte a cui vuoi partecipare: senza almeno una tratta non si può proseguire."
                    : "Tap the legs you want to join below: without at least one leg you can't continue.")}
              </p>
            </div>
            {legs.map((leg) => {
              const selected = selectedLegIds.includes(leg.id);
              const rejected = rejectedLegIds.includes(leg.id);
              const unavailable = !leg.available || leg.remaining < partySize;
              const scheduleSummary = formatLegScheduleSummary(leg, lang);
              return (
                <button
                  key={leg.id}
                  type="button"
                  onClick={() => onToggleLeg(leg.id)}
                  className={`group flex w-full items-center gap-3 rounded-[20px] border px-3 py-3 text-left text-xs transition-colors ${
                    selected
                      ? "border-emerald-300/80 dark:border-emerald-500/30 bg-emerald-50/85 dark:bg-emerald-500/10 text-foreground"
                      : rejected || unavailable
                        ? "border-red-200/70 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/10 text-red-950/80 dark:text-red-300"
                        : "border-glass-edge/60 bg-glass/52 text-foreground hover:bg-glass/72"
                  }`}
                  aria-pressed={selected}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : rejected || unavailable
                          ? "border-red-300 dark:border-red-500/30 bg-glass/70 text-red-600 dark:text-red-300"
                          : "border-emerald-300 dark:border-emerald-500/30 bg-glass/70 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {selected ? <TicketCheck size={13} /> : rejected || unavailable ? <X size={12} /> : <span className="h-2 w-2 rounded-full bg-current" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{getLegLabel(leg, waypointsById, lang)}</span>
                    {scheduleSummary && (
                      <span className="mt-1 block text-[10.5px] leading-snug text-muted-foreground">
                        {scheduleSummary}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} />
                        {leg.remaining}/{leg.capacity}
                      </span>
                      {unavailable ? (
                        <span className="text-red-700 dark:text-red-300">{lang === "it" ? "Non disponibile" : "Unavailable"}</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-300">{lang === "it" ? "Disponibile" : "Available"}</span>
                      )}
                    </span>
                  </span>
                  <ComplexityIndicator
                    variant="dot"
                    compact
                    level={getLegComplexity(leg)}
                    dangerLevel={getLegDangerLevel(leg)}
                    leg={leg}
                    lang={lang}
                  />
                </button>
              );
            })}
          </div>
        )}

        {hazardSummary && (
          <div className="mt-3 rounded-[18px] border border-orange-200/75 dark:border-orange-500/30 bg-orange-50/80 dark:bg-orange-500/10 px-3 py-2 text-xs text-orange-900 dark:text-orange-300">
            <p className="flex items-center gap-1.5 font-medium text-orange-800 dark:text-orange-300">
              <AlertTriangle size={13} className="shrink-0" />
              {lang === "it"
                ? `Tratta ${getComplexityLabel(hazardSummary.maxComplexity, lang).toLowerCase()}`
                : `${getComplexityLabel(hazardSummary.maxComplexity, lang)} leg`}
            </p>
            {hazardSummary.reasonKeys.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {hazardSummary.reasonKeys.map((key) => {
                  const reason = getDangerReasonDef(key);
                  if (!reason) return null;
                  const Icon = reason.icon;
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-full border border-orange-300/70 dark:border-orange-500/30 bg-glass/70 px-1.5 py-0.5 text-[10.5px] font-medium text-orange-800 dark:text-orange-300"
                    >
                      <Icon size={11} strokeWidth={2.4} aria-hidden />
                      {lang === "it" ? reason.label_it : reason.label_en}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {rejectedLegs.length > 0 ? (
          <div className="mt-3 rounded-[18px] border border-red-200/75 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-300">
            <p className="font-medium">
              {lang === "it" ? "Tratte escluse perché non disponibili" : "Legs excluded because unavailable"}
            </p>
            <p className="mt-1 line-clamp-3">
              {rejectedLegs.map((leg) => getLegLabel(leg, waypointsById, lang)).join(" · ")}
            </p>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-glass-edge/45 bg-background/88 px-3 py-3 backdrop-blur-xl">
        <div className="grid gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pax</span>
            <input
              type="number"
              min={1}
              value={partySize}
              onChange={(event) => onPartySizeChange(Math.max(1, Number(event.target.value) || 1))}
              className="w-full rounded-full border border-glass-edge/70 bg-glass/65 px-3 py-2 text-xs focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "it" ? "Messaggio" : "Message"}
            </span>
            <input
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder={lang === "it" ? "Note opzionali" : "Optional notes"}
              className="w-full rounded-full border border-glass-edge/70 bg-glass/65 px-3 py-2 text-base md:text-xs focus:outline-none"
            />
          </label>
          {selectedLegIds.length === 0 && (
            <p className="flex items-start gap-1.5 rounded-[16px] border border-amber-300/75 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                {lang === "it"
                  ? "Manca la scelta delle tratte: selezionane almeno una qui sopra per proseguire."
                  : "The legs are still missing: pick at least one above to continue."}
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (step === "legs") {
                setStep("about");
                return;
              }
              onSubmit();
            }}
            disabled={submitting || selectedLegIds.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : step === "legs" ? <ArrowRight size={14} /> : <TicketCheck size={14} />}
            {!isSignedIn
              ? (lang === "it" ? "Accedi" : "Sign in")
              : step === "legs"
                ? (lang === "it" ? "Riepilogo e dati" : "Summary and info")
                : (lang === "it" ? "Invia candidatura" : "Send application")}
          </button>
          {step === "about" && (
            <button
              type="button"
              onClick={() => setStep("legs")}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-glass-edge/70 bg-glass/60 px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-glass/80 disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              {lang === "it" ? "Modifica tratte" : "Edit legs"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingSidebarPanel;
