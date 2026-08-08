import type { Language } from "@/lib/language";

interface ContributionTrustNoteProps {
  lang: Language | "it" | "en";
  /** Visual emphasis: "box" draws a bordered panel, "plain" is inline muted text. */
  variant?: "box" | "plain";
}

/**
 * Shared copy shown wherever the contribution is requested (first booking, plan-change accept,
 * payment dialogs): why it is paid up front (commitment) and that it is fully refunded if the
 * application is declined or cancelled within the Terms deadlines. Kept in one place so the
 * wording never drifts between masks.
 */
const ContributionTrustNote = ({ lang, variant = "box" }: ContributionTrustNoteProps) => {
  const it = lang === "it";
  const body = (
    <>
      <p>
        {it
          ? "Ti chiediamo di versare subito un acconto (50% del contributo, fino a un massimo di €499) come dimostrazione di serietà e impegno a intraprendere il viaggio. Il saldo va versato entro 15 giorni dalla partenza della tua tratta di imbarco."
          : "We ask you to pay a deposit right away (50% of the contribution, up to €499) as proof of seriousness and commitment to undertake the voyage. The balance is due within 15 days of the departure of your own embarkation leg."}
      </p>
      <p className="mt-1">
        {it
          ? "Se la candidatura non viene accolta, o se annulli entro i termini previsti dai "
          : "If your application is not accepted, or if you cancel within the deadlines set out in the "}
        <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
          {it ? "Termini e Condizioni" : "Terms & Conditions"}
        </a>
        {it
          ? ", quanto versato ti viene rimborsato per intero. Se invece non versi il saldo entro la scadenza, la prenotazione decade e l'acconto non è rimborsabile."
          : ", what you paid is fully refunded. If instead you do not pay the balance by the deadline, the booking lapses and the deposit is not refundable."}
      </p>
    </>
  );

  if (variant === "plain") {
    return <div className="text-[11px] leading-relaxed text-muted-foreground">{body}</div>;
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
      {body}
    </div>
  );
};

export default ContributionTrustNote;
