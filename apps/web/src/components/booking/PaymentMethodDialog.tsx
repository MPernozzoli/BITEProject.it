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
import { BUNQ_SINGLE_TRANSACTION_LIMIT_EUR, formatDepositEur } from "@/lib/booking-deposit";
import ContributionTrustNote from "@/components/booking/ContributionTrustNote";

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayNow: (reservedWindow?: Window | null) => void;
  onBankTransfer: () => void;
  loading?: boolean;
  /** Amount due now (EUR): the acconto on a first payment, or the saldo once it's due. */
  amountEur?: number;
  /** When known ahead of the API call, which phase this payment is collecting. */
  phase?: "deposit" | "balance";
}

const PaymentMethodDialog = ({
  open,
  onOpenChange,
  onPayNow,
  onBankTransfer,
  loading = false,
  amountEur,
  phase,
}: PaymentMethodDialogProps) => {
  const { lang } = useI18n();
  const it = lang === "it";
  const isBalance = phase === "balance";

  // A bunq.me link is capped at €500; above that only a bank transfer can collect the amount.
  const cardTooHigh = typeof amountEur === "number" && amountEur > BUNQ_SINGLE_TRANSACTION_LIMIT_EUR;

  const handlePayNow = () => {
    if (cardTooHigh) return;
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
                ? "Per concludere la candidatura devi versare l'acconto (50% del contributo, fino a un massimo di €499). Il saldo andrà versato più avanti, entro 15 giorni dalla partenza della tua tratta di imbarco."
                : "To complete your application you must pay the deposit (50% of the contribution, up to €499). The balance is due later, within 15 days of the departure of your own embarkation leg."}
          </DialogDescription>
        </DialogHeader>

        {typeof amountEur === "number" && amountEur > 0 && (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {isBalance ? (it ? "Saldo da versare" : "Balance to pay") : it ? "Acconto da versare" : "Deposit to pay"}
            </p>
            <p className="text-2xl font-semibold">{formatDepositEur(amountEur, it ? "it" : "en")}</p>
          </div>
        )}

        {cardTooHigh && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-300 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100/90">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {it
                ? `L'importo supera il limite per carta/link (max ${formatDepositEur(BUNQ_SINGLE_TRANSACTION_LIMIT_EUR, "it")}): puoi pagare solo tramite bonifico.`
                : `The amount is above the card/link limit (max ${formatDepositEur(BUNQ_SINGLE_TRANSACTION_LIMIT_EUR, "en")}): you can only pay by bank transfer.`}
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handlePayNow}
            disabled={loading || cardTooHigh}
            aria-disabled={cardTooHigh}
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
            disabled={loading}
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
