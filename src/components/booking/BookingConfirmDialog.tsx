import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, TicketCheck } from "lucide-react";
import type { Language } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDepositEur, getContributionExplanation } from "@/lib/booking-deposit";
import {
  getComplexityLabel,
  getLegComplexity,
  getLegDangerLevel,
  type BookableLeg,
} from "@/lib/booking-utils";
import { getDangerReasonDef, getDangerReasonLabels } from "@/lib/danger-reasons";

/** Complexity level at/above which the confirm dialog surfaces the challenging-leg warning. */
const CHALLENGING_COMPLEXITY_THRESHOLD = 4;

type ConfirmDialogLeg = Pick<
  BookableLeg,
  | "complexity_override"
  | "danger_level"
  | "danger_reasons"
  | "open_sea"
  | "planned_nautical_miles"
  | "starts_at_window_start"
  | "ends_at_window_start"
>;

/**
 * Booking conditions the user must explicitly accept before a request is sent.
 * `paymentOnly` conditions are shown only when a contribution / Bunq payment flow is
 * part of the booking (pass `requiresPayment` to the dialog).
 */
interface BookingCondition {
  id: string;
  it: string;
  en: string;
  paymentOnly?: boolean;
  /** Optional (non-blocking) consent — does not gate the confirm button. */
  optional?: boolean;
}

const BOOKING_CONDITIONS: BookingCondition[] = [
  {
    id: "indicative-dates",
    it: "Ho compreso che le date indicate al momento dell'adesione sono puramente indicative e possono variare per esigenze tecniche, organizzative o meteorologiche.",
    en: "I understand that the dates shown at the time of joining are purely indicative and may change for technical, organisational or weather-related reasons.",
  },
  {
    id: "risks-liability",
    it: "Sono consapevole che la navigazione in mare comporta rischi per la salute, la vita e i beni personali. Scegliendo di partecipare al viaggio me ne assumo personalmente ogni responsabilità e sollevo gli organizzatori e l'equipaggio da qualsiasi pretesa o rivalsa legale.",
    en: "I am aware that sailing at sea involves risks to health, life and personal property. By choosing to take part in this voyage I personally assume full responsibility for it and release the organisers and crew from any claim or legal recourse.",
  },
  {
    id: "route-changes",
    it: "Sono consapevole che la rotta può subire variazioni e comportare spostamenti aggiuntivi, a mia cura e spese, rispetto a quelli previsti per raggiungere o lasciare l'imbarcazione.",
    en: "I am aware that the route may change and may require additional travel, at my own care and expense, beyond what was planned to reach or leave the boat.",
  },
  {
    id: "active-crew",
    it: "Sono consapevole che non si tratta di una vacanza: mi sarà richiesto di prendere parte attiva alle operazioni di manovra dell'imbarcazione, incluse attività di pulizia, timoneria, regolazione delle vele e turni di guardia, anche notturni.",
    en: "I understand that this is not a holiday: I will be required to take an active part in handling the boat, including cleaning, helming, sail trimming and watch shifts, including at night.",
  },
  {
    id: "private-cost-sharing",
    paymentOnly: true,
    it: "Ho compreso che BITE non è un charter, un'attività turistica o un servizio commerciale: è un viaggio privato che l'equipaggio deve comunque effettuare, aperto a persone che vogliono partecipare condividendo in modo equo una parte delle spese vive.",
    en: "I understand that BITE is not a charter, a tourism business or a commercial service: it is a private voyage the crew is already making, open to people who want to join by fairly sharing part of the out-of-pocket costs.",
  },
  {
    id: "deposit-nature",
    paymentOnly: true,
    it: "Ho compreso che l'importo richiesto è la mia quota equa di contributo alle spese di navigazione e di esercizio dell'imbarcazione durante la traversata. Non include le spese alimentari, che saranno gestite a bordo durante il viaggio.",
    en: "I understand that the requested amount is my fair-share contribution to navigation and vessel operating expenses during the crossing. It does not include food expenses, which will be managed on board during the voyage.",
  },
  {
    id: "cancellation-policy",
    paymentOnly: true,
    it: "Ho compreso che il contributo potrà essere versato tramite link di pagamento o tramite bonifico, secondo le modalità che verranno indicate dopo la conferma.",
    en: "I understand that the contribution may be paid by payment link or bank transfer, according to the instructions provided after confirmation.",
  },
  {
    id: "physical-fitness",
    it: "Dichiaro di essere in condizioni psico-fisiche idonee alla navigazione e mi impegno a comunicare tempestivamente all'equipaggio eventuali patologie o condizioni mediche rilevanti.",
    en: "I declare that I am in a psychophysical condition suitable for sailing and undertake to promptly inform the crew of any relevant illness or medical condition.",
  },
  {
    id: "captain-authority",
    it: "Mi impegno a seguire le istruzioni del comandante e dell'equipaggio in materia di sicurezza e di condotta a bordo per tutta la durata del viaggio.",
    en: "I undertake to follow the instructions of the captain and crew regarding safety and conduct on board for the entire duration of the voyage.",
  },
  {
    id: "insurance-belongings",
    it: "Sono consapevole che l'eventuale copertura assicurativa per infortuni e beni personali è a mio carico e che gli organizzatori non rispondono di smarrimenti o danni ai miei effetti personali.",
    en: "I am aware that any insurance cover for injuries and personal property is my own responsibility, and that the organisers are not liable for loss of or damage to my personal belongings.",
  },
  {
    id: "media-consent",
    optional: true,
    it: "Autorizzo l'uso di foto e video che mi ritraggono, realizzati durante il viaggio, per la comunicazione del progetto. (facoltativo)",
    en: "I authorise the use of photos and videos portraying me, taken during the voyage, for the project's communication. (optional)",
  },
];

interface BookingConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: Language;
  /** Voyage name shown in the summary header. */
  voyageName?: string;
  /** Human-readable labels of the selected legs. */
  legLabels?: string[];
  /** The selected legs, used to surface a warning when any is notably complex or dangerous. */
  legs?: ConfirmDialogLeg[];
  partySize: number;
  message?: string;
  /** When true, shows the contribution conditions + payment box (Bunq flow). */
  requiresPayment?: boolean;
  /** Per-person contribution (EUR), shown when requiresPayment. */
  depositPerPersonEur?: number;
  /** Total contribution charged (per-person × pax), shown when requiresPayment. */
  depositTotalEur?: number;
  /** Configurable EUR per planned nautical mile for this voyage. */
  contributionPerNmEur?: number | null;
  submitting?: boolean;
  onConfirm: () => void;
}

const BookingConfirmDialog = ({
  open,
  onOpenChange,
  lang,
  voyageName,
  legLabels = [],
  legs = [],
  partySize,
  message,
  requiresPayment = false,
  depositPerPersonEur,
  depositTotalEur,
  contributionPerNmEur,
  submitting = false,
  onConfirm,
}: BookingConfirmDialogProps) => {
  const conditions = useMemo(
    () => BOOKING_CONDITIONS.filter((condition) => requiresPayment || !condition.paymentOnly),
    [requiresPayment]
  );

  // Surfaced whenever at least one selected leg is genuinely demanding — high danger level
  // or "Impegnativa"/"Molto difficile" complexity — so it's not buried under fine print.
  const hazardSummary = useMemo(() => {
    if (legs.length === 0) return null;
    let maxComplexity = 0;
    let maxDanger = 0;
    const reasonKeys = new Set<string>();
    for (const leg of legs) {
      maxComplexity = Math.max(maxComplexity, getLegComplexity(leg));
      maxDanger = Math.max(maxDanger, getLegDangerLevel(leg));
      (leg.danger_reasons ?? []).forEach((key) => reasonKeys.add(key));
    }
    if (maxComplexity < CHALLENGING_COMPLEXITY_THRESHOLD && maxDanger === 0) return null;
    return { maxComplexity, maxDanger, reasonKeys: Array.from(reasonKeys) };
  }, [legs]);
  const contributionExplanation = useMemo(
    () => getContributionExplanation(legs, { contributionPerNmEur, lang: lang === "en" ? "en" : "it" }),
    [contributionPerNmEur, lang, legs]
  );

  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  // Reset the acceptances whenever the dialog is (re)opened so a previous
  // session never carries over.
  useEffect(() => {
    if (open) setAccepted({});
  }, [open]);

  const allAccepted = conditions.every(
    (condition) => condition.optional || accepted[condition.id]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 px-6 pt-6">
          <DialogTitle className="text-lg">
            {lang === "it" ? "Conferma la partecipazione" : "Confirm your participation"}
          </DialogTitle>
          <DialogDescription>
            {lang === "it"
              ? "Prima di procedere, leggi e accetta le condizioni di partecipazione."
              : "Before continuing, please read and accept the participation terms."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-13rem)] overflow-y-auto px-6 py-4">
          {(voyageName || legLabels.length > 0) && (
            <div className="mb-4 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm">
              {voyageName && (
                <p className="font-semibold text-foreground">{voyageName}</p>
              )}
              {legLabels.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {legLabels.map((label, index) => (
                    <li key={`${label}-${index}`} className="truncate">
                      · {label}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {lang === "it" ? "Persone" : "Guests"}: <span className="font-medium text-foreground">{partySize}</span>
              </p>
              {message?.trim() && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {lang === "it" ? "Nota" : "Note"}: {message.trim()}
                </p>
              )}
            </div>
          )}

          {hazardSummary && (
            <div className="mb-4 rounded-2xl border border-orange-300/70 bg-orange-50/70 p-4 text-sm dark:border-orange-400/30 dark:bg-orange-400/10">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0 text-orange-700 dark:text-orange-300" />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-300">
                  {lang === "it" ? "Tratta impegnativa" : "Challenging leg"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-orange-900/90 dark:text-orange-100/80">
                {lang === "it"
                  ? `Hai selezionato almeno una tratta di complessità "${getComplexityLabel(hazardSummary.maxComplexity, lang)}".`
                  : `You've selected at least one leg rated "${getComplexityLabel(hazardSummary.maxComplexity, lang)}" complexity.`}
                {hazardSummary.reasonKeys.length > 0
                  ? lang === "it"
                    ? ` Motivo: ${getDangerReasonLabels(hazardSummary.reasonKeys, lang).join(", ")}.`
                    : ` Reason: ${getDangerReasonLabels(hazardSummary.reasonKeys, lang).join(", ")}.`
                  : ""}
              </p>
              {hazardSummary.reasonKeys.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {hazardSummary.reasonKeys.map((key) => {
                    const reason = getDangerReasonDef(key);
                    if (!reason) return null;
                    const Icon = reason.icon;
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full border border-orange-300/70 bg-white/70 px-2 py-1 text-[11px] font-medium text-orange-800 dark:bg-white/10 dark:text-orange-200"
                      >
                        <Icon size={12} strokeWidth={2.4} aria-hidden />
                        {lang === "it" ? reason.label_it : reason.label_en}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {requiresPayment && typeof depositTotalEur === "number" && (
            <div className="mb-4 rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 text-sm dark:border-amber-400/30 dark:bg-amber-400/10">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
                  {lang === "it"
                    ? "Quota di contributo alle spese vive del viaggio"
                    : "Fair-share contribution to voyage costs"}
                  <TooltipProvider delayDuration={120}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="ml-1 inline-flex align-middle text-amber-900/70 hover:text-amber-950 dark:text-amber-200/80"
                          aria-label={lang === "it" ? "Come viene calcolato il contributo" : "How the contribution is calculated"}
                        >
                          <Info size={13} aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="z-[13000] w-[min(340px,82vw)] rounded-xl border-border/70 bg-popover/95 p-3 text-left text-[11px] font-normal leading-relaxed shadow-xl backdrop-blur">
                        {contributionExplanation}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
                <span className="text-lg font-bold text-amber-900 dark:text-amber-200">
                  {formatDepositEur(depositTotalEur, lang === "it" ? "it" : "en")}
                </span>
              </div>
              {typeof depositPerPersonEur === "number" && partySize > 1 && (
                <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/80">
                  {lang === "it"
                    ? `${formatDepositEur(depositPerPersonEur, "it")} a persona × ${partySize} persone`
                    : `${formatDepositEur(depositPerPersonEur, "en")} per person × ${partySize} guests`}
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/80">
                {lang === "it"
                  ? "Non si tratta di un prezzo per un servizio, di un biglietto o di un'attività charter: siamo privati che devono comunque effettuare questo viaggio e cerchiamo persone che vogliano partecipare condividendo una quota equa delle spese vive. Questo importo contribuisce alle spese di navigazione e di esercizio dell'imbarcazione durante la traversata. Le spese alimentari saranno gestite a bordo durante il viaggio e non sono comprese in questo importo. Il viaggio di andata/ritorno e ogni spesa connessa restano a tuo carico."
                  : "This is not a price for a service, a ticket, or a charter activity: we are private individuals already making this voyage and looking for people who want to join by sharing a fair part of the out-of-pocket costs. This amount contributes to navigation and vessel operating expenses during the crossing. Food expenses will be managed on board during the voyage and are not included in this amount. Travel to and from the boat and any related expenses remain your responsibility."}
              </p>
            </div>
          )}

          <ul className="space-y-3">
            {conditions.map((condition) => {
              const checked = Boolean(accepted[condition.id]);
              return (
                <li key={condition.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors hover:bg-muted/40 ${
                      condition.optional ? "border-dashed border-border/60 bg-muted/20" : "border-border/70"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setAccepted((current) => ({ ...current, [condition.id]: value === true }))
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <span className="text-xs leading-relaxed text-foreground">
                      {lang === "it" ? condition.it : condition.en}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {lang === "it" ? "Annulla" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!allAccepted || submitting}
            className="gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <TicketCheck size={16} />}
            {requiresPayment
              ? lang === "it"
                ? "Conferma e versa il contributo"
                : "Confirm & pay contribution"
              : lang === "it"
                ? "Conferma partecipazione"
                : "Confirm participation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BookingConfirmDialog;
