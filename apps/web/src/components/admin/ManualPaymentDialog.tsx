import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDepositEur } from "@/lib/booking-deposit";
import type { VoyageBookingStatus } from "@/lib/booking-utils";

export type ManualPayment = {
  amountEur: number;
  /** The causale actually used on the transfer, when known; null falls back to a generated one. */
  reference: string | null;
  note: string | null;
};

interface ManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payment: ManualPayment) => void;
  saving: boolean;
  travellerName?: string | null;
  /** Current booking status: drives the warning about what confirming will do to it. */
  bookingStatus?: VoyageBookingStatus | null;
  /** Contribution due for this booking's legs, used to prefill the amount. */
  dueEur?: number | null;
  /** Already settled on this booking, so the admin can see what is still outstanding. */
  alreadyPaidEur?: number;
}

/**
 * Records a contribution the automated matcher could not settle on its own — typically a bonifico
 * that arrived with the wrong causale, or one sent outside the payment dialog entirely, so no
 * deposit row exists to match against.
 *
 * The amount is asked for rather than assumed: what actually landed on the account is the only
 * thing the ledger should record, and it is frequently not the amount the calculator asks for
 * (partial transfers, old tariffs, rounding by the payer's bank).
 */
const ManualPaymentDialog = ({
  open,
  onOpenChange,
  onConfirm,
  saving,
  travellerName,
  bookingStatus,
  dueEur,
  alreadyPaidEur = 0,
}: ManualPaymentDialogProps) => {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const outstandingEur =
    dueEur == null ? null : Math.round((dueEur - alreadyPaidEur + Number.EPSILON) * 100) / 100;

  useEffect(() => {
    if (!open) return;
    setAmount(outstandingEur != null && outstandingEur > 0 ? outstandingEur.toFixed(2) : "");
    setReference("");
    setNote("");
    // Only reset when the dialog opens: retyping while it is open must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedAmount = Number(amount.replace(",", "."));
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registra un pagamento ricevuto</DialogTitle>
          <DialogDescription>
            {travellerName
              ? `Conferma manualmente il contributo di ${travellerName}.`
              : "Conferma manualmente il contributo di questa prenotazione."}{" "}
            Usalo quando il bonifico è arrivato ma non è stato agganciato in automatico (causale
            sbagliata o pagamento fatto fuori dal flusso).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-payment-amount">Importo ricevuto (EUR)</Label>
            <Input
              id="manual-payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            {dueEur != null && (
              <p className="text-xs text-muted-foreground">
                Contributo totale calcolato sulle tratte attuali: {formatDepositEur(dueEur)} (acconto 50%, max
                €499, più saldo entro 15gg dalla partenza)
                {alreadyPaidEur > 0 && ` · già versati ${formatDepositEur(alreadyPaidEur)}`}
                {outstandingEur != null && outstandingEur > 0 && ` · residuo ${formatDepositEur(outstandingEur)}`}
              </p>
            )}
            {amountValid && outstandingEur != null && parsedAmount < outstandingEur && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Meno del dovuto: il posto risulta pagato, ma resteranno{" "}
                {formatDepositEur(Math.round((outstandingEur - parsedAmount + Number.EPSILON) * 100) / 100)} da
                incassare fuori piattaforma.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-payment-reference">Causale del bonifico (opzionale)</Label>
            <Input
              id="manual-payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Copia la causale reale, se la conosci"
            />
            <p className="text-xs text-muted-foreground">
              Incollala se ce l'hai: in caso di rimborso è la stringa con cui si risale al bonifico
              in entrata e quindi all'IBAN del pagatore. Senza, il rimborso andrà gestito a mano.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-payment-note">Nota interna (opzionale)</Label>
            <Textarea
              id="manual-payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Perché stai confermando a mano"
            />
            <p className="text-xs text-muted-foreground">
              Finisce nelle note admin della prenotazione, in coda a quelle esistenti.
            </p>
          </div>

          {bookingStatus === "expired" && (
            <p className="rounded-lg border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-300">
              La candidatura è scaduta: confermando il pagamento viene riattivata e torna in
              revisione come candidatura pagata. Dovrai poi approvarla.
            </p>
          )}
          {bookingStatus === "pending_payment" && (
            <p className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
              La candidatura è in attesa di pagamento: confermando diventa una candidatura in
              revisione, esattamente come se il bonifico fosse stato agganciato in automatico.
            </p>
          )}
          {bookingStatus === "admin_approved" && (
            <p className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
              Se si tratta di un invito già accettato, la prenotazione passa direttamente a
              confermata.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Annulla
          </Button>
          <Button
            disabled={!amountValid || saving}
            onClick={() => {
              if (!amountValid) return;
              onConfirm({
                amountEur: parsedAmount,
                reference: reference.trim() || null,
                note: note.trim() || null,
              });
            }}
          >
            Conferma pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualPaymentDialog;
