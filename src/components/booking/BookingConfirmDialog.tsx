import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, TicketCheck } from "lucide-react";
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
import { formatDepositEur } from "@/lib/booking-deposit";
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
  "complexity_override" | "danger_level" | "danger_reasons" | "open_sea" | "starts_at_window_start" | "ends_at_window_start"
>;

/**
 * Booking conditions the user must explicitly accept before a request is sent.
 * `paymentOnly` conditions are shown only when a deposit / Bunq payment flow is
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
    it: "Ho compreso che le date indicate al momento della prenotazione sono puramente indicative e possono variare per esigenze tecniche, organizzative o meteorologiche.",
    en: "I understand that the dates shown at the time of booking are purely indicative and may change for technical, organisational or weather-related reasons.",
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
    id: "deposit-nature",
    paymentOnly: true,
    it: "Ho compreso che l'importo richiesto è un deposito cauzionale, restituito al termine del viaggio: non è un biglietto, non è una quota di partecipazione e non dà diritto al viaggio né all'erogazione di alcun servizio. Il pagamento non garantisce la partecipazione.",
    en: "I understand that the amount requested is a refundable security deposit, returned at the end of the voyage: it is not a ticket, not a participation fee, and grants no right to the voyage or to any service. Payment does not guarantee participation.",
  },
  {
    id: "cancellation-policy",
    paymentOnly: true,
    it: "Ho compreso che il deposito viene trattenuto solo se non mi presento alla partenza o se annullo con meno di 14 giorni di preavviso; se sono gli organizzatori ad annullare o a modificare le date impedendomi di partecipare, il deposito mi sarà restituito.",
    en: "I understand that the deposit is withheld only if I do not show up at departure or if I cancel with less than 14 days' notice; if the organisers cancel or change the dates in a way that prevents me from taking part, the deposit will be returned to me.",
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
  /** When true, shows the deposit conditions + payment box (Bunq flow). */
  requiresPayment?: boolean;
  /** Per-person deposit (EUR), shown when requiresPayment. */
  depositPerPersonEur?: number;
  /** Total deposit charged (per-person × pax), shown when requiresPayment. */
  depositTotalEur?: number;
  /** Whether the per-person amount hit the €250 cap (surfaces the ceiling note). */
  depositCapped?: boolean;
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
  depositCapped = false,
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
            {lang === "it" ? "Conferma la prenotazione" : "Confirm your booking"}
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
                  {lang === "it" ? "Deposito cauzionale" : "Security deposit"}
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
                  {depositCapped ? (lang === "it" ? " (tetto di €250 a persona)" : " (€250 per-person cap)") : ""}
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/80">
                {lang === "it"
                  ? "Questo importo è un deposito cauzionale, non un biglietto: serve solo come impegno a partecipare davvero al viaggio ed evitare che un posto resti occupato da chi poi non si presenta. Non costituisce alcun diritto al viaggio né all'erogazione di servizi e ti verrà restituito al termine del viaggio. Le spese effettive (vitto, attività, ecc.) saranno calcolate e divise tra l'equipaggio durante il viaggio, tramite strumenti come Splitwise. Il viaggio di andata/ritorno e ogni spesa connessa sono a tuo carico. Prenotando più tratte gli importi si sommano fino a un massimo di €250 a persona. Il deposito viene trattenuto solo in caso di mancata presentazione o annullamento con meno di 14 giorni di preavviso; se siamo noi ad annullare o a cambiare le date impedendoti di partecipare, viene sempre rimborsato."
                  : "This amount is a refundable security deposit, not a ticket: it only serves as a commitment to genuinely take part in the voyage and to prevent a seat being held by someone who then does not show up. It grants no right to the voyage or to any service, and it will be returned to you at the end of the voyage. The actual costs (food, activities, etc.) will be calculated and split among the crew during the voyage, using tools such as Splitwise. Travel to and from the boat and any related expenses are your responsibility. Booking multiple legs sums the amounts up to a maximum of €250 per person. The deposit is withheld only in case of a no-show or cancellation with less than 14 days' notice; if we cancel or change the dates in a way that prevents you from taking part, it is always refunded."}
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
                ? "Conferma e paga il deposito"
                : "Confirm & pay deposit"
              : lang === "it"
                ? "Conferma prenotazione"
                : "Confirm booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BookingConfirmDialog;
