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
  /** Contribution due (EUR). When above the Bunq single-transaction cap, only bank transfer works. */
  amountEur?: number;
}

const PaymentMethodDialog = ({
  open,
  onOpenChange,
  onPayNow,
  onBankTransfer,
  loading = false,
  amountEur,
}: PaymentMethodDialogProps) => {
  const { lang } = useI18n();
  const it = lang === "it";

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
          <DialogTitle>{it ? "Completa il pagamento del contributo" : "Complete the contribution payment"}</DialogTitle>
          <DialogDescription>
            {it
              ? "Per concludere la candidatura devi versare il contributo. Senza pagamento la prenotazione non si conclude e non potrai partecipare al viaggio."
              : "To complete your application you must pay the contribution. Without payment the booking is not finalised and you cannot take part in the voyage."}
          </DialogDescription>
        </DialogHeader>

        {typeof amountEur === "number" && amountEur > 0 && (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {it ? "Importo da versare" : "Amount to pay"}
            </p>
            <p className="text-2xl font-semibold">{formatDepositEur(amountEur, it ? "it" : "en")}</p>
          </div>
        )}

        {cardTooHigh && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100/90">
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
              {it ? "Entro 1 ora" : "Within 1 hour"}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {it
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
              {it ? "Entro 24 ore" : "Within 24 hours"}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {it
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
