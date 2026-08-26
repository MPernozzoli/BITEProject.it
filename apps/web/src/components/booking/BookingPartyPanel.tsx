/**
 * Everyone on a multi-person booking, as seen by the people on it.
 *
 * Two audiences share this panel deliberately: a guest opens it to see that the amount was
 * agreed for the whole party and where the others stand, and the booker opens it to act on
 * someone who did not pay. Splitting them into two components would have meant keeping two
 * renderings of the same list in step.
 */
import { useMemo } from "react";
import { AlertTriangle, Check, Clock, Loader2, UserMinus } from "lucide-react";
import type { Language } from "@/lib/i18n";
import { formatDepositEur } from "@/lib/booking-deposit";
import type { BookingPartyMember } from "@/lib/booking-participants";

interface BookingPartyPanelProps {
  lang: Language;
  members: BookingPartyMember[];
  /** True when the viewer owns the booking: only they get the "someone did not pay" actions. */
  isLead: boolean;
  /**
   * How the party pays. Needed to read a missing share amount correctly: under 'lead_pays_all'
   * a guest genuinely owes nothing, while under 'each_pays_own' it only means the figure has not
   * been computed for them yet.
   */
  paymentMode?: "lead_pays_all" | "each_pays_own" | null;
  /** Set while a drop request is in flight, so the row can show it. */
  droppingParticipantId?: string | null;
  onDropParticipant?: (participantId: string) => void;
  onCancelWholeBooking?: () => void;
}

const memberName = (member: BookingPartyMember, lang: Language): string => {
  const full = [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  return member.email || (lang === "it" ? "Partecipante" : "Participant");
};

const BookingPartyPanel = ({
  lang,
  members,
  isLead,
  paymentMode = null,
  droppingParticipantId = null,
  onDropParticipant,
  onCancelWholeBooking,
}: BookingPartyPanelProps) => {
  const it = lang === "it";
  const now = Date.now();

  // Overdue means the deadline passed *and* the share is genuinely still short — a payment that
  // landed after the deadline settles the matter, so the row must stop nagging about it.
  const overdueMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          !member.is_lead &&
          member.status === "accepted" &&
          member.share_due_cents != null &&
          member.share_paid_cents < member.share_due_cents &&
          member.share_payment_due_at != null &&
          new Date(member.share_payment_due_at).getTime() <= now
      ),
    [members, now]
  );

  if (members.length === 0) return null;

  const statusLabel = (member: BookingPartyMember): { text: string; tone: "ok" | "wait" | "late" | "out" } => {
    if (member.status === "declined") return { text: it ? "Ha rifiutato" : "Declined", tone: "out" };
    if (member.status === "expired") return { text: it ? "Invito scaduto" : "Invite expired", tone: "out" };
    if (member.status === "cancelled") return { text: it ? "Annullato" : "Cancelled", tone: "out" };
    if (member.status === "balance_unpaid") return { text: it ? "Uscito, quota non versata" : "Left, share unpaid", tone: "out" };
    if (member.status === "pending") return { text: it ? "Invito da accettare" : "Invite pending", tone: "wait" };
    if (member.share_due_cents == null) {
      return paymentMode === "each_pays_own"
        ? { text: it ? "Quota ancora da calcolare" : "Share not computed yet", tone: "wait" }
        : { text: it ? "Coperto da chi ha prenotato" : "Covered by the booker", tone: "ok" };
    }
    if (member.share_paid_cents >= member.share_due_cents) return { text: it ? "Quota versata" : "Share paid", tone: "ok" };
    if (member.share_payment_due_at && new Date(member.share_payment_due_at).getTime() <= now) {
      return { text: it ? "Quota non versata" : "Share unpaid", tone: "late" };
    }
    if (member.share_payment_due_at) return { text: it ? "Quota da versare" : "Share due", tone: "wait" };
    return { text: it ? "In attesa dell'importo concordato" : "Waiting for the agreed amount", tone: "wait" };
  };

  const toneClass: Record<"ok" | "wait" | "late" | "out", string> = {
    ok: "text-emerald-700 dark:text-emerald-300",
    wait: "text-muted-foreground",
    late: "text-orange-700 dark:text-orange-300",
    out: "text-muted-foreground line-through",
  };

  return (
    <div className="rounded-[22px] border border-border/70 bg-background/40 p-4 text-sm">
      <p className="font-medium text-foreground">{it ? "Il tuo gruppo" : "Your party"}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {it
          ? "L'importo del contributo è concordato una volta sola da chi ha prenotato e vale per ciascun partecipante: i singoli non possono rinegoziarlo."
          : "The contribution is agreed once by whoever booked and applies to every participant: individuals cannot renegotiate it."}
      </p>

      <ul className="mt-3 space-y-2">
        {members.map((member) => {
          const status = statusLabel(member);
          return (
            <li
              key={member.participant_id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/40 pb-2 last:border-0 last:pb-0"
            >
              <span className="text-sm text-foreground">
                {memberName(member, lang)}
                {member.is_lead && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {it ? "ha prenotato" : "booker"}
                  </span>
                )}
                {member.is_me && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-accent">
                    {it ? "tu" : "you"}
                  </span>
                )}
              </span>
              <span className={`text-xs ${toneClass[status.tone]}`}>
                {status.tone === "ok" && <Check size={12} className="mr-1 inline align-[-1px]" aria-hidden />}
                {status.tone === "wait" && <Clock size={12} className="mr-1 inline align-[-1px]" aria-hidden />}
                {status.tone === "late" && <AlertTriangle size={12} className="mr-1 inline align-[-1px]" aria-hidden />}
                {status.text}
                {member.share_due_cents != null && (
                  <span className="ml-2 text-muted-foreground">
                    {formatDepositEur(member.share_due_cents / 100, it ? "it" : "en")}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {isLead && overdueMembers.length > 0 && (
        <div className="mt-4 rounded-2xl border border-orange-300/60 bg-orange-50/70 p-3 dark:border-orange-400/30 dark:bg-orange-400/10">
          <p className="text-xs font-semibold text-orange-900 dark:text-orange-200">
            {it ? "Una quota non è stata versata in tempo" : "A share was not paid in time"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-orange-900/90 dark:text-orange-100/80">
            {it
              ? "Decidi tu come procedere: puoi proseguire senza chi non ha pagato, oppure annullare la prenotazione per tutto il gruppo. Annullando per tutti si applicano le condizioni di rimborso previste dai Termini."
              : "It's your call: continue without whoever did not pay, or cancel the booking for the whole party. Cancelling for everybody follows the refund terms."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {overdueMembers.map((member) => (
              <button
                key={member.participant_id}
                type="button"
                onClick={() => onDropParticipant?.(member.participant_id)}
                disabled={droppingParticipantId === member.participant_id}
                className="inline-flex items-center gap-2 rounded-full border border-orange-400/70 bg-white/70 px-3 py-2 text-xs font-semibold text-orange-950 hover:bg-white disabled:opacity-50"
              >
                {droppingParticipantId === member.participant_id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <UserMinus size={13} />
                )}
                {it ? `Prosegui senza ${memberName(member, lang)}` : `Continue without ${memberName(member, lang)}`}
              </button>
            ))}
            {onCancelWholeBooking && (
              <button
                type="button"
                onClick={onCancelWholeBooking}
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-2 text-xs font-semibold text-foreground hover:border-destructive/60 hover:text-destructive"
              >
                {it ? "Annulla per tutto il gruppo" : "Cancel for the whole party"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingPartyPanel;
