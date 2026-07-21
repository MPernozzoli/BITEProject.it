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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PLAN_CHANGE_REASONS,
  planChangeReasonOption,
  type PlanChangeReason,
} from "@/lib/plan-change-reasons";

const DEFAULT_NOTE =
  "Ti proponiamo una modifica alle tratte per incastrare meglio equipaggio, meteo e disponibilità.";

export type PlanChangeProposal = {
  reason: PlanChangeReason;
  note: string | null;
  /** When true, accepting the proposal leaves the difference in contribution to settle. */
  requireSettlement: boolean;
};

interface PlanChangeProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (proposal: PlanChangeProposal) => void;
  /** Shown so the admin knows who receives the proposal. */
  travellerName?: string | null;
}

/**
 * Collects the reason for a proposed plan change. The reason is not cosmetic: a force-majeure
 * change that the traveller declines refunds on the withdrawal tiers, while any other reason
 * refunds in full — so the dialog spells out the consequence before the admin sends it.
 */
const PlanChangeProposalDialog = ({
  open,
  onOpenChange,
  onConfirm,
  travellerName,
}: PlanChangeProposalDialogProps) => {
  const [reason, setReason] = useState<PlanChangeReason | "">("");
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [requireSettlement, setRequireSettlement] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setNote(DEFAULT_NOTE);
      setRequireSettlement(false);
    }
  }, [open]);

  const selected = planChangeReasonOption(reason || null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Proponi una modifica al piano</DialogTitle>
          <DialogDescription>
            {travellerName
              ? `La proposta viene inviata a ${travellerName}.`
              : "La proposta viene inviata al viaggiatore."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan-change-reason">Motivazione della modifica</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as PlanChangeReason)}>
              <SelectTrigger id="plan-change-reason">
                <SelectValue placeholder="Seleziona una motivazione" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_CHANGE_REASONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {selected.forceMajeure
                  ? "Forza maggiore: se il viaggiatore rifiuta, il rimborso segue le fasce della rinuncia (100% oltre 30 giorni, 50% tra 15 e 30, 0% sotto i 15). Potrai comunque alzarlo al momento del rifiuto."
                  : "Non è forza maggiore: se il viaggiatore rifiuta, il rimborso è sempre del 100%."}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Conguaglio del contributo</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRequireSettlement(false)}
                aria-pressed={!requireSettlement}
                className={`rounded-lg border p-3 text-left text-xs leading-relaxed transition-colors ${
                  !requireSettlement
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                }`}
              >
                <span className="block text-sm font-semibold">Senza conguaglio</span>
                Accettando, le tratte cambiano e non viene chiesto nessun altro pagamento.
              </button>
              <button
                type="button"
                onClick={() => setRequireSettlement(true)}
                aria-pressed={requireSettlement}
                className={`rounded-lg border p-3 text-left text-xs leading-relaxed transition-colors ${
                  requireSettlement
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                }`}
              >
                <span className="block text-sm font-semibold">Con conguaglio</span>
                Accettando, resta da versare la differenza fra il nuovo contributo e quanto già pagato.
              </button>
            </div>
            {requireSettlement && (
              <p className="text-xs text-muted-foreground">
                Se la candidatura non è ancora approvata, torna in attesa di pagamento finché la
                differenza non arriva. Se il posto è già confermato non viene revocato: la differenza
                resta come importo dovuto. Se la nuova tratta costa meno, l'eccedenza va rimborsata
                manualmente dalla sezione rimborsi.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-change-note">Messaggio per il viaggiatore</Label>
            <Textarea
              id="plan-change-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={!reason}
            onClick={() => {
              if (!reason) return;
              onConfirm({ reason, note: note.trim() || null, requireSettlement });
            }}
          >
            Invia proposta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlanChangeProposalDialog;
