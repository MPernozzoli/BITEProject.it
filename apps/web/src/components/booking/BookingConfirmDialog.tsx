import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Info, Landmark, Loader2, TicketCheck } from "lucide-react";
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
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import type { CandidateInfo } from "@/lib/booking-candidate-info";
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
    it: "Accetto che le date mostrate al momento dell'adesione siano indicative e possano variare per esigenze tecniche, organizzative o meteorologiche: verranno confermate appena possibile.",
    en: "I accept that the dates shown when I join are indicative and may vary for technical, organisational or weather reasons, and will be confirmed as soon as possible.",
  },
  {
    id: "risks-liability",
    it: "Sono consapevole che la navigazione in mare comporta rischi per la salute, la vita e i beni personali. Scelgo di partecipare assumendomene la responsabilità e sollevo organizzatori ed equipaggio da pretese o rivalse legali connesse a tali rischi.",
    en: "I understand that sailing at sea carries risks to health, life and personal property. I choose to take part, accepting responsibility for these risks and releasing the organisers and crew from related claims or legal recourse.",
  },
  {
    id: "route-changes",
    it: "Accetto che la rotta possa variare e richiedere spostamenti aggiuntivi, a mia cura e spese, rispetto a quelli previsti per raggiungere o lasciare l'imbarcazione.",
    en: "I accept that the route may change and require additional travel, at my own care and expense, beyond what was planned to reach or leave the boat.",
  },
  {
    id: "active-crew",
    it: "So che questo è un viaggio in equipaggio, in cui si naviga insieme e non si è ospiti: partecipo attivamente alla conduzione dell'imbarcazione — manovre, timoneria, regolazione delle vele, pulizie e turni di guardia, anche notturni.",
    en: "I know this is a crewed voyage, where we sail together rather than being guests: I take an active part in running the boat — manoeuvres, helming, sail trimming, cleaning and watch shifts, including at night.",
  },
  {
    id: "private-cost-sharing",
    paymentOnly: true,
    it: "So che BITE è un viaggio privato che l'equipaggio compie comunque, aperto a chi desidera unirsi condividendo in modo equo una parte delle spese vive. Non è un charter, un'attività turistica o un servizio commerciale.",
    en: "I know BITE is a private voyage the crew is making anyway, open to those who wish to join by fairly sharing part of the out-of-pocket costs. It is not a charter, a tourism business or a commercial service.",
  },
  {
    id: "deposit-nature",
    paymentOnly: true,
    it: "So che l'importo richiesto è la mia quota equa di contributo alle spese di navigazione e di esercizio dell'imbarcazione durante la traversata. Non comprende le spese alimentari, che gestiremo insieme a bordo durante il viaggio.",
    en: "I know the requested amount is my fair share of the navigation and vessel operating costs during the crossing. It does not include food, which we manage together on board during the voyage.",
  },
  {
    id: "cancellation-policy",
    paymentOnly: true,
    it: "So che il contributo potrà essere versato tramite link di pagamento o bonifico, secondo le modalità indicate dopo la conferma.",
    en: "I know the contribution can be paid by payment link or bank transfer, according to the instructions provided after confirmation.",
  },
  {
    id: "physical-fitness",
    it: "Dichiaro di essere in condizioni psico-fisiche idonee alla navigazione e mi impegno a comunicare per tempo all'equipaggio eventuali patologie o condizioni mediche rilevanti.",
    en: "I declare that I am in a psychophysical condition suitable for sailing and undertake to inform the crew in good time of any relevant illness or medical condition.",
  },
  {
    id: "captain-authority",
    it: "Mi impegno a seguire le indicazioni del comandante e dell'equipaggio in materia di sicurezza e di condotta a bordo per tutta la durata del viaggio.",
    en: "I undertake to follow the guidance of the captain and crew regarding safety and conduct on board for the entire duration of the voyage.",
  },
  {
    id: "insurance-belongings",
    it: "So che l'eventuale copertura assicurativa per infortuni e beni personali è a mio carico e che gli organizzatori non rispondono di smarrimenti o danni ai miei effetti personali.",
    en: "I know that any insurance cover for injuries and personal belongings is my own responsibility, and that the organisers are not liable for loss of or damage to my personal effects.",
  },
  {
    id: "media-consent",
    it: "Partecipando al viaggio accetto di essere ripreso in foto e video durante la traversata e di essere incluso nelle produzioni editoriali e nella comunicazione del progetto BITE.",
    en: "By taking part in the voyage, I accept to be filmed and photographed during the crossing and to be included in BITE's editorial productions and communications.",
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
  /** When false, payment conditions are shown but the actual method is chosen in a later step. */
  showPaymentMethodChoice?: boolean;
  candidateInfo?: CandidateInfo;
  onCandidateInfoChange?: (candidateInfo: CandidateInfo) => void;
  /** Per-person contribution (EUR), shown when requiresPayment. */
  depositPerPersonEur?: number;
  /** Total contribution charged (per-person × pax), shown when requiresPayment. */
  depositTotalEur?: number;
  /** Configurable EUR per planned nautical mile for this voyage. */
  contributionPerNmEur?: number | null;
  mode?: "confirmation" | "application";
  submitting?: boolean;
  onConfirm: (paymentMethod: PaymentMethodChoice) => void;
}

export type PaymentMethodChoice = "bunq_link" | "bank_transfer";

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
  showPaymentMethodChoice = requiresPayment,
  candidateInfo,
  onCandidateInfoChange,
  depositPerPersonEur,
  depositTotalEur,
  contributionPerNmEur,
  mode = "confirmation",
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodChoice>("bunq_link");

  // Reset the acceptances whenever the dialog is (re)opened so a previous
  // session never carries over.
  useEffect(() => {
    if (open) {
      setAccepted({});
      setPaymentMethod("bunq_link");
    }
  }, [open]);

  const allAccepted = conditions.every(
    (condition) => condition.optional || accepted[condition.id]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 px-6 pt-6">
          <DialogTitle className="text-lg">
            {mode === "application"
              ? lang === "it" ? "Invia la candidatura" : "Send your application"
              : lang === "it" ? "Conferma la partecipazione" : "Confirm your participation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "application"
              ? lang === "it"
                ? "La candidatura verra registrata e poi esaminata dall'organizzatore."
                : "Your application will be registered and then reviewed by the organiser."
              : lang === "it"
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

          {candidateInfo && onCandidateInfoChange && (
            <div className="mb-4 rounded-2xl border border-border/70 bg-muted/25 p-4">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {lang === "it" ? "Dicci di te" : "Tell us about you"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {lang === "it"
                    ? "Prima di accettare l'invito ci serve qualche informazione utile per bordo, sicurezza e convivenza."
                    : "Before accepting the invitation we need a few useful details for life aboard, safety and fit."}
                </p>
              </div>
              <CandidateInfoForm value={candidateInfo} onChange={onCandidateInfoChange} lang={lang} compact />
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

          {requiresPayment && showPaymentMethodChoice && (
            <div className="mb-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {lang === "it" ? "Metodo di pagamento" : "Payment method"}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("bunq_link")}
                  className={`min-h-24 rounded-lg border p-3 text-left transition-colors ${
                    paymentMethod === "bunq_link"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-foreground"
                  }`}
                  aria-pressed={paymentMethod === "bunq_link"}
                >
                  <CreditCard size={17} className="mb-2" />
                  <span className="block text-sm font-semibold">
                    {lang === "it" ? "Paga adesso" : "Pay now"}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed">
                    {lang === "it"
                      ? "Apri il link Bunq e paga con carta, Apple Pay, Google Pay o altri metodi disponibili. Se hai Bunq con questa email, puoi accettare la richiesta anche dall'app."
                      : "Open the Bunq link and pay by card, Apple Pay, Google Pay, or other available methods. If you use Bunq with this email, you can also accept the request in the app."}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className={`min-h-24 rounded-lg border p-3 text-left transition-colors ${
                    paymentMethod === "bank_transfer"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-foreground"
                  }`}
                  aria-pressed={paymentMethod === "bank_transfer"}
                >
                  <Landmark size={17} className="mb-2" />
                  <span className="block text-sm font-semibold">
                    {lang === "it" ? "Bonifico" : "Bank transfer"}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed">
                    {lang === "it"
                      ? "Mostra IBAN e causale obbligatoria. Il pagamento viene validato automaticamente quando arriva."
                      : "Show IBAN and required reference. Payment is validated automatically when it arrives."}
                  </span>
                </button>
              </div>
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
            onClick={() => onConfirm(paymentMethod)}
            disabled={!allAccepted || submitting}
            className="gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <TicketCheck size={16} />}
            {requiresPayment
              ? showPaymentMethodChoice && paymentMethod === "bank_transfer"
                ? lang === "it"
                  ? "Conferma e mostra bonifico"
                  : "Confirm & show transfer"
                : showPaymentMethodChoice
                  ? lang === "it"
                    ? "Conferma e paga adesso"
                    : "Confirm & pay now"
                  : lang === "it"
                    ? "Conferma e continua"
                    : "Confirm & continue"
              : mode === "application"
                ? lang === "it"
                  ? "Registra candidatura"
                  : "Register application"
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
