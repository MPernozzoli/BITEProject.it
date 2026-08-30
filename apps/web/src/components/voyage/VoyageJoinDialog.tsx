import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, LogIn, Minus, Plus, Route } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import ContributionEstimateNote from "@/components/booking/ContributionEstimateNote";
import type { CandidateInfo } from "@/lib/booking-candidate-info";
import type { BookingApplicationBlocker } from "@/lib/booking-application-gate";
import { depositTargetEur, formatDepositEur } from "@/lib/booking-deposit";

type WizardStep = "party" | "about";

interface VoyageJoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: "it" | "en";
  voyageName: string;
  /** "Atene → Siracusa", already built from the selection. */
  routeLine: string;
  legLabels: string[];
  partySize: number;
  onPartySizeChange: (partySize: number) => void;
  maxGuests: number;
  message: string;
  onMessageChange: (message: string) => void;
  candidateInfo: CandidateInfo;
  onCandidateInfoChange: (candidateInfo: CandidateInfo) => void;
  depositPerPersonEur: number;
  depositTotalEur: number;
  workawayEnabled?: boolean | null;
  /** What still blocks the application, so the last button explains itself instead of dying. */
  blocker: BookingApplicationBlocker | null;
  isSignedIn: boolean;
  submitting: boolean;
  /** Which half to open on. Backing out of the conditions dialog returns to "about", where the
   * traveller actually was, instead of making them walk the wizard again. */
  initialStep?: "party" | "about";
  /** Closes the dialog and hands control back to the leg cards on the page. */
  onEditLegs: () => void;
  /** Everything is filled in: move on to the conditions + payment dialog. */
  onContinue: () => void;
}

/**
 * Step 2 of the in-page join flow: how many of you, and who are you.
 *
 * It is deliberately a two-screen wizard rather than one long form — on a phone, "quante
 * persone" and the whole candidate questionnaire in one scroll is where people give up. The
 * footer never changes place, always has exactly one primary action, and always says what that
 * action leads to. Step 3 (conditions and payment) is the existing BookingConfirmDialog, which
 * this hands over to.
 */
const VoyageJoinDialog = ({
  open,
  onOpenChange,
  lang,
  voyageName,
  routeLine,
  legLabels,
  partySize,
  onPartySizeChange,
  maxGuests,
  message,
  onMessageChange,
  candidateInfo,
  onCandidateInfoChange,
  depositPerPersonEur,
  depositTotalEur,
  workawayEnabled,
  blocker,
  isSignedIn,
  submitting,
  initialStep = "party",
  onEditLegs,
  onContinue,
}: VoyageJoinDialogProps) => {
  const it = lang === "it";
  const [step, setStep] = useState<WizardStep>(initialStep);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setStep(initialStep);
  }, [initialStep, open]);

  // Each screen starts at the top: a phone that keeps the previous scroll position hides the
  // question the traveller was just moved to.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  const safeMaxGuests = Math.max(1, maxGuests || 1);
  const canLeaveParty = !blocker || blocker.step !== "party";
  // A missing answer from the questionnaire is not a problem yet while the traveller is still on
  // the "how many of you" screen: warning about it there is noise about a question not yet asked.
  const visibleBlocker = blocker && (step === "about" || blocker.step !== "about") ? blocker : null;

  // On the last screen the button has to name what it will actually do, and when something is
  // missing that is not "sign in and continue" — it is "go and fill this in".
  const primaryLabel = step === "party"
    ? it ? "Avanti: dicci di te" : "Next: tell us about you"
    : visibleBlocker
      ? it ? "Completa i dati mancanti" : "Fill in what's missing"
      : !isSignedIn
        ? it ? "Accedi e continua" : "Sign in and continue"
        : it ? "Avanti: conferma e paga" : "Next: confirm and pay";

  const primaryHelper = step === "party"
    ? it
      ? "Poche domande su esperienza, lingue e vita a bordo."
      : "A few questions about experience, languages and life on board."
    : visibleBlocker
      ? it
        ? "Prima sistema quello che manca qui sopra."
        : "First sort out what is missing above."
      : it
        ? "Nel passaggio finale leggi le condizioni e versi il contributo."
        : "In the final step you read the conditions and pay the contribution.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-xl sm:rounded-2xl">
        <div className="shrink-0 border-b border-border/60 bg-background px-4 pb-4 pt-5 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
            {it ? "Passo 2 di 3" : "Step 2 of 3"}
            <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
              {step === "party"
                ? it ? "· prima parte" : "· first half"
                : it ? "· seconda parte" : "· second half"}
            </span>
          </p>
          <DialogTitle className="mt-1 text-lg leading-snug sm:text-xl">
            {step === "party"
              ? it ? "Quante persone siete?" : "How many of you are coming?"
              : it ? "Dicci di te" : "Tell us about you"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-relaxed">
            {step === "party"
              ? it
                ? "Il contributo qui sotto si aggiorna da solo. Puoi ancora tornare indietro e cambiare le tratte."
                : "The contribution below updates on its own. You can still go back and change the legs."
              : it
                ? "Serve a valutare incastri, sicurezza e vita a bordo. Sono quasi tutte scelte rapide, niente temi."
                : "This helps us judge fit, safety and life aboard. Almost all quick choices, no essays."}
          </DialogDescription>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {/* The selection stays on screen in both steps: it is what the money and the questions
              are about, and losing sight of it is how people end up applying for the wrong legs. */}
          <div className="rounded-[20px] border border-emerald-200/80 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 p-3.5 dark:border-emerald-400/30 dark:bg-emerald-400/10 sm:p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-300 dark:text-emerald-200">
              <Route size={13} /> {it ? "Le tue tratte" : "Your legs"}
            </p>
            <p className="mt-1.5 text-[15px] font-semibold text-emerald-950 dark:text-emerald-300 dark:text-emerald-50">{routeLine}</p>
            <p className="mt-0.5 text-[12.5px] text-emerald-900/70 dark:text-emerald-300 dark:text-emerald-100/70">{voyageName}</p>
            <ul className="mt-2 space-y-0.5 text-[12.5px] text-emerald-900/80 dark:text-emerald-300 dark:text-emerald-100/80">
              {legLabels.map((label) => (
                <li key={label}>· {label}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onEditLegs}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 dark:border-emerald-500/30 bg-glass px-3 py-2 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10 dark:border-emerald-400/50 dark:text-emerald-200 dark:hover:bg-emerald-400/10"
            >
              <ArrowLeft size={13} /> {it ? "Cambia le tratte" : "Change the legs"}
            </button>
          </div>

          {step === "party" ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[20px] border border-border/70 bg-background/60 p-4">
                <label className="block text-sm font-semibold text-foreground" htmlFor="voyage-join-party-size">
                  {it ? "Persone che salgono a bordo" : "People coming aboard"}
                </label>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {it
                    ? "Conta anche te stesso. Gli altri li inviterai per nome subito dopo."
                    : "Count yourself too. You will invite the others by name straight after."}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onPartySizeChange(Math.max(1, partySize - 1))}
                    disabled={partySize <= 1}
                    aria-label={it ? "Una persona in meno" : "One person fewer"}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-foreground transition-colors hover:border-accent disabled:opacity-40"
                  >
                    <Minus size={18} />
                  </button>
                  <input
                    id="voyage-join-party-size"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={safeMaxGuests}
                    value={partySize}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      onPartySizeChange(Number.isFinite(next) ? Math.max(1, next) : 1);
                    }}
                    className="h-12 w-20 rounded-2xl border-2 border-border bg-background text-center text-xl font-bold tabular-nums focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onPartySizeChange(Math.min(safeMaxGuests, partySize + 1))}
                    disabled={partySize >= safeMaxGuests}
                    aria-label={it ? "Una persona in più" : "One more person"}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-foreground transition-colors hover:border-accent disabled:opacity-40"
                  >
                    <Plus size={18} />
                  </button>
                  <span className="text-[12.5px] text-muted-foreground">
                    {it ? `massimo ${safeMaxGuests}` : `max ${safeMaxGuests}`}
                  </span>
                </div>
              </div>

              <div className="rounded-[20px] border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-4 dark:border-amber-400/30 dark:bg-amber-400/10">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300 dark:text-amber-200">
                    {it ? "Contributo spese vive" : "Cost contribution"}
                  </span>
                  <span className="text-xl font-bold text-amber-950 dark:text-amber-300 dark:text-amber-100">
                    {formatDepositEur(depositTotalEur, lang)}
                  </span>
                </div>
                {partySize > 1 && (
                  <p className="mt-1 text-[12.5px] text-amber-900 dark:text-amber-300 dark:text-amber-100/90">
                    {formatDepositEur(depositPerPersonEur, lang)} × {partySize}
                  </p>
                )}
                <p className="mt-2 text-[12.5px] font-medium leading-relaxed text-amber-900 dark:text-amber-300 dark:text-amber-100/90">
                  {it
                    ? `Adesso versi l'acconto: ${formatDepositEur(depositTargetEur(depositTotalEur), "it")}. Il resto, ${formatDepositEur(depositTotalEur - depositTargetEur(depositTotalEur), "it")}, entro 15 giorni dalla partenza.`
                    : `You pay the deposit now: ${formatDepositEur(depositTargetEur(depositTotalEur), "en")}. The rest, ${formatDepositEur(depositTotalEur - depositTargetEur(depositTotalEur), "en")}, within 15 days of departure.`}
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-amber-950/85 dark:text-amber-300 dark:text-amber-100/80">
                  {it
                    ? "Non è un prezzo, un biglietto o un servizio commerciale: è la tua quota equa delle spese vive di un viaggio privato che l'equipaggio farebbe comunque."
                    : "This is not a price, a ticket or a commercial service: it is your fair share of the out-of-pocket costs of a private voyage the crew is making anyway."}
                </p>
                <ContributionEstimateNote
                  lang={lang}
                  workawayEnabled={workawayEnabled}
                  className="mt-2 text-[12px] leading-relaxed text-amber-950/85 dark:text-amber-300 dark:text-amber-100/80"
                />
              </div>

              <div className="rounded-[20px] border border-border/70 bg-background/60 p-4">
                <label className="block text-sm font-semibold text-foreground" htmlFor="voyage-join-message">
                  {it ? "Vuoi aggiungere una nota? (facoltativo)" : "Want to add a note? (optional)"}
                </label>
                <textarea
                  id="voyage-join-message"
                  value={message}
                  onChange={(event) => onMessageChange(event.target.value)}
                  rows={3}
                  placeholder={
                    it
                      ? "Es. arrivo il giorno prima, viaggio con mia sorella…"
                      : "E.g. arriving the day before, travelling with my sister…"
                  }
                  className="mt-2 w-full rounded-2xl border-2 border-border bg-background px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[20px] border border-border/70 bg-background/60 p-4">
              <CandidateInfoForm value={candidateInfo} onChange={onCandidateInfoChange} lang={lang} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/60 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {visibleBlocker && (
            <div className="mb-3 flex items-start gap-2.5 rounded-[18px] border border-amber-400/80 bg-amber-50/85 dark:bg-amber-500/10 p-3 text-amber-950 dark:text-amber-300 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{visibleBlocker.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed opacity-90">{visibleBlocker.detail}</p>
              </div>
            </div>
          )}
          {!isSignedIn && step === "about" && !visibleBlocker && (
            <p className="mb-3 rounded-[18px] border border-sky-300/70 dark:border-sky-500/30 bg-sky-50/80 dark:bg-sky-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-sky-950 dark:text-sky-300 dark:border-sky-400/35 dark:bg-sky-400/10 dark:text-sky-100">
              {it
                ? "Per inviare la candidatura serve un account: al prossimo passo ti portiamo all'accesso e teniamo da parte quello che hai scritto."
                : "Sending the application needs an account: the next step takes you to sign-in and keeps what you have filled in."}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (step === "party") {
                if (canLeaveParty) setStep("about");
                return;
              }
              onContinue();
            }}
            disabled={submitting || (step === "party" && !canLeaveParty)}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 text-[15px] font-bold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : step === "party" ? (
              <ArrowRight size={18} />
            ) : !isSignedIn ? (
              <LogIn size={18} />
            ) : (
              <Check size={18} />
            )}
            {primaryLabel}
          </button>
          <p className="mt-2 text-center text-[12.5px] leading-snug text-muted-foreground">{primaryHelper}</p>
          {step === "about" && (
            <button
              type="button"
              onClick={() => setStep("party")}
              disabled={submitting}
              className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border-2 border-border bg-background px-5 text-[14px] font-semibold text-foreground transition-colors hover:border-accent disabled:opacity-50"
            >
              <ArrowLeft size={16} /> {it ? "Torna a «quante persone»" : "Back to “how many people”"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VoyageJoinDialog;
