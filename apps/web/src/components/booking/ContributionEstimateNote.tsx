import type { Language } from "@/lib/language";

interface ContributionEstimateNoteProps {
  lang: Language | "it" | "en";
  /**
   * Whether the voyage also accepts a workaway trade, so the copy can name it. Proposing a
   * different *amount* is available on every voyage and is stated unconditionally.
   */
  workawayEnabled?: boolean | null;
  /** Visual emphasis: "box" draws a bordered panel, "plain" is inline muted text. */
  variant?: "box" | "plain";
  /** Overrides the wrapper classes, so the note can inherit a host block's own typography. */
  className?: string;
}

/**
 * Shared copy shown wherever a contribution figure is displayed before it is agreed
 * (voyage page, booking sidebar, confirm dialog): the amount is our indicative estimate,
 * not a price, and a different one can always be proposed during the application. Kept in one
 * place so the wording never drifts between masks.
 */
const ContributionEstimateNote = ({
  lang,
  workawayEnabled,
  variant = "box",
  className,
}: ContributionEstimateNoteProps) => {
  const it = lang === "it";

  const proposalLine = workawayEnabled
    ? it
      ? "Durante la candidatura puoi sempre proporre un importo diverso, oppure una collaborazione a bordo: valutiamo ogni proposta caso per caso."
      : "During the application you can always propose a different amount, or a workaway trade on board: we assess every proposal case by case."
    : it
      ? "Durante la candidatura puoi sempre proporre un importo diverso: valutiamo ogni proposta caso per caso."
      : "During the application you can always propose a different amount: we assess every proposal case by case.";

  const body = (
    <>
      <p>
        {it
          ? "Gli importi indicati sono una nostra stima indicativa del contributo alle spese vive, calcolata sulle miglia previste di ogni tratta: non sono un prezzo e possono variare se il piano di viaggio cambia."
          : "The amounts shown are our own indicative estimate of the contribution to out-of-pocket costs, calculated on each leg's planned mileage: they are not a price and may change if the voyage plan changes."}
      </p>
      <p className="mt-1">{proposalLine}</p>
    </>
  );

  if (className) return <div className={className}>{body}</div>;

  if (variant === "plain") {
    return <div className="text-[11px] leading-relaxed text-muted-foreground">{body}</div>;
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
      {body}
    </div>
  );
};

export default ContributionEstimateNote;
