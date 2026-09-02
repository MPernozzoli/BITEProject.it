import { useEffect, useState } from "react";
import { AlertTriangle, CreditCard, Landmark, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  balanceDeadlinePhrase,
  balanceFollowUpSentence,
  BUNQ_SINGLE_TRANSACTION_LIMIT_EUR,
  DEPOSIT_CAP_EUR,
  formatDepositEur,
} from "@/lib/booking-deposit";
import { fetchPaymentQuote, type PaymentPhase, type PaymentQuote } from "@/lib/booking-payment";
import ContributionTrustNote from "@/components/booking/ContributionTrustNote";

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayNow: (reservedWindow?: Window | null) => void;
  onBankTransfer: () => void;
  loading?: boolean;
  /**
   * The booking (and, for a guest paying their own share, the participant) this payment is for.
   * The amount is priced by the server from these, never re-derived here — see fetchPaymentQuote.
   */
  bookingRequestId?: string;
  participantId?: string | null;
  /** Phase to assume while the quote is in flight, when the caller already knows it. */
  phase?: PaymentPhase;
}

type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: PaymentQuote }
  | { status: "nothing_due" }
  | { status: "error" };

const PaymentMethodDialog = ({
  open,
  onOpenChange,
  onPayNow,
  onBankTransfer,
  loading = false,
  bookingRequestId,
  participantId,
  phase,
}: PaymentMethodDialogProps) => {
  const { lang } = useI18n();
  const it = lang === "it";
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });

  // Price the payment the moment the dialog opens, from the same server logic that will charge
  // it. This is what keeps every entry point — voyage page, bookings page, participants page,
  // guest invite — showing the same figure for the same booking.
  useEffect(() => {
    if (!open || !bookingRequestId) {
      setQuoteState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setQuoteState({ status: "loading" });
    void fetchPaymentQuote(bookingRequestId, participantId).then((result) => {
      if (cancelled) return;
      if (!result.ok) setQuoteState({ status: "error" });
      else if ("nothingDue" in result) setQuoteState({ status: "nothing_due" });
      else setQuoteState({ status: "ready", quote: result.quote });
    });
    return () => {
      cancelled = true;
    };
  }, [open, bookingRequestId, participantId]);

  const quote = quoteState.status === "ready" ? quoteState.quote : null;
  const resolvedPhase: PaymentPhase = quote?.phase ?? phase ?? "deposit";
  const isBalance = resolvedPhase === "balance";
  const nothingDue = quoteState.status === "nothing_due";

  // A bunq.me link is capped at €500; above that only a bank transfer can collect the amount.
  const singleTransactionLimit = quote?.maxSingleTransactionEur ?? BUNQ_SINGLE_TRANSACTION_LIMIT_EUR;
  const cardTooHigh = quote != null && quote.amountEur > singleTransactionLimit;
  const payDisabled = loading || cardTooHigh || nothingDue || quoteState.status === "loading";

  const handlePayNow = () => {
    if (payDisabled) return;
    const reservedWindow = window.open("about:blank", "_blank");
    if (reservedWindow) reservedWindow.opener = null;
    onPayNow(reservedWindow);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isBalance
              ? it
                ? "Completa il pagamento del saldo"
                : "Complete the balance payment"
              : it
                ? "Completa il pagamento dell'acconto"
                : "Complete the deposit payment"}
          </DialogTitle>
          <DialogDescription>
            {isBalance
              ? it
                ? "Per mantenere la prenotazione devi versare il saldo entro la scadenza indicata: oltre quel termine la prenotazione decade e l'acconto versato non è rimborsabile."
                : "To keep your booking you must pay the balance by the indicated deadline: after that the booking lapses and the deposit already paid is not refundable."
              : it
                ? `Per concludere la candidatura devi versare l'acconto: il 50% del contributo, fino a un massimo di ${formatDepositEur(DEPOSIT_CAP_EUR, "it")}. Il saldo andrà versato più avanti, ${balanceDeadlinePhrase("it")}.`
                : `To complete your application you must pay the deposit: 50% of the contribution, up to ${formatDepositEur(DEPOSIT_CAP_EUR, "en")}. The balance is due later, ${balanceDeadlinePhrase("en")}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isBalance ? (it ? "Saldo da versare" : "Balance to pay") : it ? "Acconto da versare" : "Deposit to pay"}
          </p>
          {quoteState.status === "loading" && (
            <p className="flex items-center justify-center gap-2 py-1 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              {it ? "Calcolo dell'importo…" : "Working out the amount…"}
            </p>
          )}
          {quote && <p className="text-2xl font-semibold">{formatDepositEur(quote.amountEur, it ? "it" : "en")}</p>}
          {quote && !isBalance && quote.totalDueEur > quote.depositTargetEur && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {balanceFollowUpSentence(quote.totalDueEur, quote.depositTargetEur, it ? "it" : "en")}
            </p>
          )}
          {nothingDue && (
            <p className="py-1 text-sm text-muted-foreground">
              {it ? "Non c'è nulla da versare: risulta già saldato." : "Nothing to pay: this is already settled."}
            </p>
          )}
          {quoteState.status === "error" && (
            <p className="py-1 text-sm text-muted-foreground">
              {it
                ? "Importo non disponibile al momento: te lo mostriamo al passo successivo, sul link di pagamento o nei dati per il bonifico."
                : "Amount unavailable right now: you'll see it at the next step, on the payment link or in the transfer details."}
            </p>
          )}
        </div>

        {cardTooHigh && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-300 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100/90">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {it
                ? `L'importo supera il limite per carta/link (max ${formatDepositEur(singleTransactionLimit, "it")}): puoi pagare solo tramite bonifico.`
                : `The amount is above the card/link limit (max ${formatDepositEur(singleTransactionLimit, "en")}): you can only pay by bank transfer.`}
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handlePayNow}
            disabled={payDisabled}
            aria-disabled={payDisabled}
            className="min-h-32 rounded-lg border border-accent/70 bg-accent/10 p-4 text-left text-foreground transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="mb-3 animate-spin" /> : <CreditCard size={18} className="mb-3" />}
            <span className="block text-sm font-semibold">{it ? "Paga adesso (carta)" : "Pay now (card)"}</span>
            <span className="mt-1 block text-xs font-medium text-accent">
              {isBalance ? (it ? "Rapido" : "Fast") : it ? "Entro 1 ora" : "Within 1 hour"}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {isBalance
                ? it
                  ? "Apri Bunq e paga con carta, Apple Pay, Google Pay o altri metodi."
                  : "Open Bunq and pay by card, Apple Pay, Google Pay or other methods."
                : it
                  ? "Apri Bunq e paga con carta, Apple Pay, Google Pay o altri metodi. Il pagamento va completato entro 1 ora."
                  : "Open Bunq and pay by card, Apple Pay, Google Pay or other methods. Payment must be completed within 1 hour."}
            </span>
          </button>

          <button
            type="button"
            onClick={onBankTransfer}
            disabled={loading || nothingDue}
            className={`min-h-32 rounded-lg border p-4 text-left text-foreground transition-colors disabled:cursor-wait disabled:opacity-70 ${
              cardTooHigh
                ? "border-accent/70 bg-accent/10 hover:bg-accent/15"
                : "border-border/70 bg-background/50 hover:border-accent/50"
            }`}
          >
            <Landmark size={18} className="mb-3" />
            <span className="block text-sm font-semibold">{it ? "Bonifico" : "Bank transfer"}</span>
            <span className="mt-1 block text-xs font-medium text-accent">
              {isBalance ? (it ? "Nessuna fretta" : "No rush") : it ? "Entro 24 ore" : "Within 24 hours"}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {isBalance
                ? it
                  ? "Mostra IBAN, importo e causale obbligatoria. Lo validiamo automaticamente quando arriva: nessuna scadenza stretta su questo bonifico, ma il saldo va comunque ricevuto entro la scadenza della tua prenotazione."
                  : "Shows IBAN, amount and required reference. We validate it automatically when it arrives: no strict deadline on this transfer, but the balance must still arrive by your booking's deadline."
                : it
                  ? "Mostra IBAN, importo e causale obbligatoria. Lo validiamo automaticamente quando arriva. Hai 24 ore per completarlo."
                  : "Shows IBAN, amount and required reference. We validate it automatically when it arrives. You have 24 hours to complete it."}
            </span>
          </button>
        </div>

        <ContributionTrustNote lang={lang} />

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {it ? "Chiudi" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentMethodDialog;
