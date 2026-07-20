import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatDepositEur } from "@/lib/booking-deposit";
import {
  checkDepositStatus,
  startBankTransferDeposit,
  type BankTransferDetails,
} from "@/lib/booking-payment";

const POLL_INTERVAL_MS = 8000;

interface BankTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingRequestId: string;
  participantId?: string;
  /** Called once the transfer is detected as settled. */
  onConfirmed?: () => void;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; details: BankTransferDetails }
  | { phase: "already_paid" }
  | { phase: "error"; message: string };

const CopyRow = ({ label, value }: { label: string; value: string }) => {
  const { lang } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(lang === "it" ? "Impossibile copiare." : "Could not copy.");
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={lang === "it" ? "Copia" : "Copy"}
      >
        {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
      </button>
    </div>
  );
};

/**
 * Manual bank-transfer fallback: shows the fixed account details plus a unique causale, then
 * polls /api/payments/bunq/status (which itself re-checks the Bunq account) until the transfer
 * is detected as settled.
 */
const BankTransferDialog = ({
  open,
  onOpenChange,
  bookingRequestId,
  participantId,
  onConfirmed,
}: BankTransferDialogProps) => {
  const { lang } = useI18n();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    confirmedRef.current = false;
    setState({ phase: "loading" });

    let cancelled = false;
    void (async () => {
      const result = await startBankTransferDeposit(bookingRequestId, participantId);
      if (cancelled) return;
      if ("error" in result) {
        setState({ phase: "error", message: result.error });
        return;
      }
      if ("alreadyPaid" in result) {
        setState({ phase: "already_paid" });
        return;
      }
      setState({ phase: "ready", details: result.details });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, bookingRequestId, participantId]);

  const handleConfirmed = useCallback(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    toast.success(lang === "it" ? "Bonifico ricevuto, grazie!" : "Transfer received, thank you!");
    onConfirmed?.();
  }, [lang, onConfirmed]);

  useEffect(() => {
    if (!open || state.phase !== "ready") return;
    const interval = setInterval(() => {
      void checkDepositStatus(bookingRequestId, participantId).then((result) => {
        if (result?.status === "paid") handleConfirmed();
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [open, state.phase, bookingRequestId, participantId, handleConfirmed]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lang === "it" ? "Paga con bonifico" : "Pay by bank transfer"}</DialogTitle>
          <DialogDescription>
            {lang === "it"
              ? "Usa questi dati per inviare il bonifico. La candidatura non verrà esaminata finché non riceviamo l'importo corretto con la causale indicata."
              : "Use these details to send the transfer. Your application will not be reviewed until we receive the correct amount with the reference shown here."}
          </DialogDescription>
        </DialogHeader>

        {state.phase === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            {lang === "it" ? "Preparazione dati bonifico…" : "Preparing transfer details…"}
          </div>
        )}

        {state.phase === "error" && (
          <p className="py-4 text-sm text-destructive">
            {lang === "it"
              ? "Non è stato possibile generare i dati per il bonifico. Riprova più tardi."
              : "Could not generate the bank transfer details. Please try again later."}
          </p>
        )}

        {state.phase === "already_paid" && (
          <p className="py-4 text-sm text-muted-foreground">
            {lang === "it" ? "Questo contributo risulta già pagato." : "This contribution is already paid."}
          </p>
        )}

        {state.phase === "ready" && (
          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {lang === "it" ? "Importo da versare" : "Amount to transfer"}
              </p>
              <p className="text-2xl font-semibold">{formatDepositEur(state.details.amountEur, lang)}</p>
            </div>
            <CopyRow label="IBAN" value={state.details.iban} />
            <CopyRow label="BIC / SWIFT" value={state.details.bic} />
            <CopyRow label={lang === "it" ? "Intestatario" : "Account holder"} value={state.details.holder} />
            <CopyRow label={lang === "it" ? "Causale (obbligatoria)" : "Reference (required)"} value={state.details.reference} />

            <div className="rounded-md border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100/90">
              {lang === "it"
                ? "Per convalidare automaticamente il pagamento devono combaciare sia l'importo sia la causale. Se la causale manca o l'importo è diverso, la richiesta resterà in attesa."
                : "For automatic validation, both the amount and the reference must match. If the reference is missing or the amount differs, the request will stay pending."}
            </div>

            <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin shrink-0" />
              {lang === "it"
                ? "In attesa del bonifico: controlleremo via API Bunq i movimenti in entrata e sbloccheremo la richiesta solo quando importo e causale coincidono."
                : "Waiting for the transfer: we'll check incoming Bunq account movements via API and unlock the request only when amount and reference match."}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {lang === "it" ? "Chiudi" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BankTransferDialog;
