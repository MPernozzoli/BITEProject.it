import { useEffect, useMemo, useState } from "react";
import { Loader2, TicketCheck } from "lucide-react";
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
    id: "cancellation-policy",
    paymentOnly: true,
    it: "Sono consapevole che, in caso di annullamento entro i 14 giorni precedenti la partenza effettiva o di mancata presentazione alla data e all'ora comunicate, l'importo versato non mi sarà rimborsato.",
    en: "I am aware that, in the event of cancellation within 14 days of the actual departure or a no-show at the communicated date and time, the amount paid will not be refunded.",
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
  partySize: number;
  message?: string;
  /** When true, shows the deposit/no-refund condition (Bunq payment flow). */
  requiresPayment?: boolean;
  submitting?: boolean;
  onConfirm: () => void;
}

const BookingConfirmDialog = ({
  open,
  onOpenChange,
  lang,
  voyageName,
  legLabels = [],
  partySize,
  message,
  requiresPayment = false,
  submitting = false,
  onConfirm,
}: BookingConfirmDialogProps) => {
  const conditions = useMemo(
    () => BOOKING_CONDITIONS.filter((condition) => requiresPayment || !condition.paymentOnly),
    [requiresPayment]
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
            {lang === "it" ? "Conferma prenotazione" : "Confirm booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BookingConfirmDialog;
