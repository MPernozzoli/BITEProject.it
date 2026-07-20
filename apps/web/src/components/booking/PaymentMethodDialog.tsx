import { CreditCard, Landmark, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayNow: () => void;
  onBankTransfer: () => void;
  loading?: boolean;
}

const PaymentMethodDialog = ({
  open,
  onOpenChange,
  onPayNow,
  onBankTransfer,
  loading = false,
}: PaymentMethodDialogProps) => {
  const { lang } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lang === "it" ? "Come vuoi pagare?" : "How would you like to pay?"}</DialogTitle>
          <DialogDescription>
            {lang === "it"
              ? "Scegli se completare subito il contributo online o ricevere i dati per il bonifico."
              : "Choose whether to complete the contribution online now or use a bank transfer."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onPayNow}
            disabled={loading}
            className="min-h-32 rounded-lg border border-accent/70 bg-accent/10 p-4 text-left text-foreground transition-colors hover:bg-accent/15 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? <Loader2 size={18} className="mb-3 animate-spin" /> : <CreditCard size={18} className="mb-3" />}
            <span className="block text-sm font-semibold">{lang === "it" ? "Paga adesso" : "Pay now"}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {lang === "it"
                ? "Apri Bunq e paga con carta, Apple Pay, Google Pay o altri metodi disponibili."
                : "Open Bunq and pay by card, Apple Pay, Google Pay, or other available methods."}
            </span>
          </button>

          <button
            type="button"
            onClick={onBankTransfer}
            disabled={loading}
            className="min-h-32 rounded-lg border border-border/70 bg-background/50 p-4 text-left text-foreground transition-colors hover:border-accent/50 disabled:cursor-wait disabled:opacity-70"
          >
            <Landmark size={18} className="mb-3" />
            <span className="block text-sm font-semibold">{lang === "it" ? "Bonifico" : "Bank transfer"}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {lang === "it"
                ? "Mostra IBAN, importo e causale obbligatoria. Lo validiamo automaticamente quando arriva."
                : "Show IBAN, amount and required reference. We validate it automatically when it arrives."}
            </span>
          </button>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {lang === "it" ? "Annulla" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentMethodDialog;
