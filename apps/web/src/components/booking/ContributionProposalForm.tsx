import { useMemo, useState } from "react";
import { Info, Upload, X } from "lucide-react";
import type { Language } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDepositEur, roundUpToNextEuro } from "@/lib/booking-deposit";
import {
  standardTotalEur,
  type ContributionProposal,
  type WorkawayHoursCommitmentType,
} from "@/lib/booking-workaway-proposal";
import type { WorkawayRole } from "@/lib/booking-utils";

type ContributionProposalFormProps = {
  lang: Language;
  proposal: ContributionProposal;
  onChange: (proposal: ContributionProposal) => void;
  standardVariableEur: number;
  /** This candidate's actual fixed minimum (normally €20, 0 only when waived). */
  fixedMinimumEur: number;
  workawayEnabled: boolean;
  /** Ceiling, as a % of the total standard contribution (variable + fixed). No floor beyond the fixed minimum itself. */
  maxPercent: number;
  /**
   * People this application covers. The negotiation is always per person — the booker settles one
   * traveller's share on everyone's behalf — so this only adds the group total next to the slider,
   * and never changes the value being proposed.
   */
  partySize?: number;
  workawayRoles: WorkawayRole[];
  activeWorkawayRoleKeys: string[];
  cvFile: File | null;
  onCvFileChange: (file: File | null) => void;
  portfolioFile: File | null;
  onPortfolioFileChange: (file: File | null) => void;
};

/** A slider over the TOTAL contribution (fixed + variable) — its own [min, max] makes an
 * out-of-range value physically impossible to pick, so there's nothing left to validate here. */
const AmountTotalSlider = ({
  lang,
  totalEur,
  minEur,
  maxEur,
  standardTotal,
  onChangeTotal,
}: {
  lang: Language;
  totalEur: number;
  minEur: number;
  maxEur: number;
  standardTotal: number;
  onChangeTotal: (totalEur: number) => void;
}) => {
  const it = lang === "it";
  const percent = standardTotal > 0 ? Math.round((totalEur / standardTotal) * 100) : 0;
  return (
    <div>
      <input
        type="range"
        min={minEur}
        max={Math.max(minEur, maxEur)}
        step={1}
        value={Math.min(Math.max(totalEur, minEur), Math.max(minEur, maxEur))}
        onChange={(event) => onChangeTotal(Number(event.target.value))}
        className="mt-2 w-full accent-accent"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDepositEur(minEur, it ? "it" : "en")}</span>
        <span className="text-sm font-semibold text-foreground">
          {formatDepositEur(totalEur, it ? "it" : "en")} · {percent}%
        </span>
        <span>{formatDepositEur(maxEur, it ? "it" : "en")}</span>
      </div>
    </div>
  );
};

const ContributionProposalForm = ({
  lang,
  proposal,
  onChange,
  standardVariableEur,
  fixedMinimumEur,
  workawayEnabled,
  maxPercent,
  partySize = 1,
  workawayRoles,
  activeWorkawayRoleKeys,
  cvFile,
  onCvFileChange,
  portfolioFile,
  onPortfolioFileChange,
}: ContributionProposalFormProps) => {
  const [roleSearch, setRoleSearch] = useState("");
  const it = lang === "it";

  // Raw (unrounded) total, used for the slider's own bounds — the server validates against the
  // same raw math (in cents), so the ceiling below is floored rather than rounded to the nearest
  // euro: rounding up (or to nearest) could let the slider offer a value that then fails
  // server-side validation by a few cents right at the boundary.
  const standardTotalRaw = standardTotalEur(standardVariableEur, fixedMinimumEur);
  // Rounded up, matching the site-wide convention for displayed contribution figures
  // (perPersonDepositEur/roundUpToNextEuro) — this is informational text only, not a bound.
  const standardTotal = roundUpToNextEuro(standardTotalRaw);
  const maxTotalEur = Math.max(fixedMinimumEur, Math.floor((standardTotalRaw * maxPercent) / 100));
  const defaultTotalEur = Math.min(maxTotalEur, Math.max(fixedMinimumEur, Math.round(standardTotalRaw / 2)));
  const defaultVariableEur = Math.max(0, defaultTotalEur - fixedMinimumEur);
  const currentVariableEur = proposal.proposedVariableEur ?? defaultVariableEur;
  const currentTotalEur = currentVariableEur + fixedMinimumEur;
  // The slider always works on one traveller's share; with a party, the figure that actually
  // leaves someone's account is that share times the people it covers, so it is spelled out
  // rather than left for the candidate to multiply in their head.
  const people = Math.max(1, Math.floor(partySize) || 1);
  const groupTotalNote =
    people > 1
      ? it
        ? `Per ${people} persone: ${formatDepositEur(currentTotalEur * people, "it")} in tutto. La cifra vale per ogni partecipante — se ognuno paga per sé, ciascuno verserà ${formatDepositEur(currentTotalEur, "it")}.`
        : `For ${people} people: ${formatDepositEur(currentTotalEur * people, "en")} in total. The figure applies to every participant — if each pays their own way, each will pay ${formatDepositEur(currentTotalEur, "en")}.`
      : null;

  const setTotalEur = (totalEur: number) => {
    onChange({ ...proposal, proposedVariableEur: Math.max(0, Math.round(totalEur) - fixedMinimumEur) });
  };

  const activeRoles = useMemo(
    () => workawayRoles.filter((role) => activeWorkawayRoleKeys.includes(role.key)),
    [workawayRoles, activeWorkawayRoleKeys],
  );

  const roleLabel = (role: WorkawayRole) => (it ? role.label_it : role.label_en);

  const matchedRole = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return null;
    return (
      workawayRoles.find(
        (role) =>
          role.label_it.toLowerCase() === query ||
          role.label_en.toLowerCase() === query ||
          role.key.toLowerCase() === query,
      ) || null
    );
  }, [roleSearch, workawayRoles]);

  const updateWorkaway = (patch: Partial<ContributionProposal["workaway"]>) => {
    onChange({ ...proposal, workaway: { ...proposal.workaway, ...patch } });
  };

  const toggleRoleKey = (key: string) => {
    const has = proposal.workaway.roleKeys.includes(key);
    updateWorkaway({
      roleKeys: has ? proposal.workaway.roleKeys.filter((value) => value !== key) : [...proposal.workaway.roleKeys, key],
    });
  };

  const addRoleFromSearch = () => {
    const query = roleSearch.trim();
    if (!query) return;
    if (matchedRole) {
      if (!proposal.workaway.roleKeys.includes(matchedRole.key)) {
        updateWorkaway({ roleKeys: [...proposal.workaway.roleKeys, matchedRole.key] });
      }
    } else {
      const current = proposal.workaway.otherRoleText.trim();
      updateWorkaway({ otherRoleText: current ? `${current}, ${query}` : query });
    }
    setRoleSearch("");
  };

  const selectedRoleNotActive = matchedRole && !activeWorkawayRoleKeys.includes(matchedRole.key);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
        <label className="flex items-start gap-3">
          <Checkbox
            checked={proposal.wantsAlternativeContribution}
            onCheckedChange={(value) => {
              const checked = value === true;
              onChange({
                ...proposal,
                wantsAlternativeContribution: checked,
                // Mutually exclusive with workaway: workaway always carries its own amount
                // field, so there is no separate "both at once" state to represent.
                wantsWorkaway: checked ? false : proposal.wantsWorkaway,
                proposedVariableEur: checked ? proposal.proposedVariableEur ?? defaultVariableEur : proposal.proposedVariableEur,
              });
            }}
            className="mt-0.5 shrink-0"
          />
          <span className="text-sm font-medium text-foreground">
            {it
              ? "Voglio proporre un contributo economico diverso, senza lavorare a bordo"
              : "I want to propose a different economic contribution, without working on board"}
          </span>
        </label>

        {proposal.wantsAlternativeContribution && (
          <div className="mt-3 space-y-1 pl-7">
            <Label className="text-xs text-muted-foreground">
              {it
                ? `Contributo totale che proponi (fisso + variabile). Quota normalmente calcolata per questo viaggio: ${formatDepositEur(standardTotal, "it")}.`
                : `Total contribution you're proposing (fixed + variable). Normally calculated quota for this voyage: ${formatDepositEur(standardTotal, "en")}.`}
            </Label>
            <AmountTotalSlider
              lang={lang}
              totalEur={currentTotalEur}
              minEur={fixedMinimumEur}
              maxEur={maxTotalEur}
              standardTotal={standardTotal}
              onChangeTotal={setTotalEur}
            />
            <p className="pt-1 text-xs text-muted-foreground">
              {it
                ? `Il minimo di ${formatDepositEur(fixedMinimumEur, "it")} è sempre dovuto e non è negoziabile.`
                : `The minimum of ${formatDepositEur(fixedMinimumEur, "en")} is always due and not negotiable.`}
            </p>
            {groupTotalNote && (
              <p className="pt-1 text-xs font-medium text-foreground">{groupTotalNote}</p>
            )}
          </div>
        )}
      </div>

      {workawayEnabled && (
        <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={proposal.wantsWorkaway}
              onCheckedChange={(value) => {
                const checked = value === true;
                onChange({
                  ...proposal,
                  wantsWorkaway: checked,
                  // Mutually exclusive with the pure-economic checkbox above.
                  wantsAlternativeContribution: checked ? false : proposal.wantsAlternativeContribution,
                  // Prefill at half the standard total the first time this is turned on, to
                  // suggest the work covers the other half — kept if already customised.
                  proposedVariableEur: checked ? proposal.proposedVariableEur ?? defaultVariableEur : proposal.proposedVariableEur,
                });
              }}
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm font-medium text-foreground">
              {it
                ? "Voglio proporre di lavorare a bordo (workaway)"
                : "I want to propose working on board (workaway)"}
            </span>
          </label>

          {proposal.wantsWorkaway && (
            <div className="mt-3 space-y-4 pl-7">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {it
                    ? `Contributo economico che comunque riconosci, oltre al lavoro. Quota normalmente calcolata per questo viaggio: ${formatDepositEur(standardTotal, "it")}.`
                    : `Economic contribution you still recognise, on top of the work. Normally calculated quota for this voyage: ${formatDepositEur(standardTotal, "en")}.`}
                </Label>
                <AmountTotalSlider
                  lang={lang}
                  totalEur={currentTotalEur}
                  minEur={fixedMinimumEur}
                  maxEur={maxTotalEur}
                  standardTotal={standardTotal}
                  onChangeTotal={setTotalEur}
                />
                <p className="pt-1 text-xs text-muted-foreground">
                  {it
                    ? `Il minimo di ${formatDepositEur(fixedMinimumEur, "it")} è sempre dovuto e non è negoziabile: il lavoro copre solo l'eventuale differenza rispetto alla quota normale.`
                    : `The minimum of ${formatDepositEur(fixedMinimumEur, "en")} is always due and not negotiable: the work only covers the gap below the normal quota.`}
                </p>
                {groupTotalNote && (
                  <p className="pt-1 text-xs font-medium text-foreground">{groupTotalNote}</p>
                )}
              </div>

              {activeRoles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {it ? "Cosa pensiamo possa servirci" : "What we think could help us"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeRoles.map((role) => {
                      const selected = proposal.workaway.roleKeys.includes(role.key);
                      return (
                        <button
                          key={role.key}
                          type="button"
                          onClick={() => toggleRoleKey(role.key)}
                          aria-pressed={selected}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                          }`}
                        >
                          {roleLabel(role)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="workaway-role-search" className="text-xs text-muted-foreground">
                  {it ? "Hai altre competenze da proporre?" : "Do you have other skills to propose?"}
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="workaway-role-search"
                    list="workaway-role-catalog"
                    value={roleSearch}
                    onChange={(event) => setRoleSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addRoleFromSearch();
                      }
                    }}
                    placeholder={it ? "es. Cuoco, Skipper..." : "e.g. Cook, Skipper..."}
                  />
                  <datalist id="workaway-role-catalog">
                    {workawayRoles.map((role) => (
                      <option key={role.key} value={roleLabel(role)} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={addRoleFromSearch}
                    className="shrink-0 rounded-lg border border-border/70 px-3 py-2 text-xs font-medium text-foreground hover:border-accent/50"
                  >
                    {it ? "Aggiungi" : "Add"}
                  </button>
                </div>
                {selectedRoleNotActive && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {it
                      ? "Al momento riteniamo questa posizione gia coperta, ma puoi comunque inviare la candidatura."
                      : "We currently consider this position already covered, but you can still send your application."}
                  </p>
                )}
                {(proposal.workaway.roleKeys.length > 0 || proposal.workaway.otherRoleText.trim()) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proposal.workaway.roleKeys.map((key) => {
                      const role = workawayRoles.find((candidate) => candidate.key === key);
                      const isActive = activeWorkawayRoleKeys.includes(key);
                      return (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                            isActive
                              ? "border-accent bg-accent/10 text-foreground"
                              : "border-dashed border-border/70 text-muted-foreground"
                          }`}
                        >
                          {role ? roleLabel(role) : key}
                          <button type="button" onClick={() => toggleRoleKey(key)} aria-label={it ? "Rimuovi" : "Remove"}>
                            <X size={11} />
                          </button>
                        </span>
                      );
                    })}
                    {proposal.workaway.otherRoleText.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {proposal.workaway.otherRoleText}
                        <button
                          type="button"
                          onClick={() => updateWorkaway({ otherRoleText: "" })}
                          aria-label={it ? "Rimuovi" : "Remove"}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="workaway-message" className="text-xs text-muted-foreground">
                  {it ? "Cosa proponi di fare, nel dettaglio" : "What you're proposing to do, in detail"}
                </Label>
                <Textarea
                  id="workaway-message"
                  value={proposal.workaway.message}
                  onChange={(event) => updateWorkaway({ message: event.target.value })}
                  rows={3}
                  className="mt-1"
                  placeholder={it ? "Almeno qualche riga..." : "A few lines at least..."}
                />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {it ? "Ore garantite" : "Guaranteed hours"}
                  </Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={proposal.workaway.hoursCommitmentValue ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        updateWorkaway({ hoursCommitmentValue: value === "" ? null : Math.max(0, Number(value)) });
                      }}
                      className="w-24"
                    />
                    <select
                      value={proposal.workaway.hoursCommitmentType ?? "per_day"}
                      onChange={(event) =>
                        updateWorkaway({ hoursCommitmentType: event.target.value as WorkawayHoursCommitmentType })
                      }
                      className="rounded-lg border border-border/70 bg-background/60 px-2 text-sm"
                    >
                      <option value="per_day">{it ? "al giorno" : "per day"}</option>
                      <option value="per_week">{it ? "a settimana" : "per week"}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">{it ? "CV" : "CV"}</Label>
                  <label className="mt-1 flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground hover:border-accent/50">
                    <Upload size={14} className="shrink-0" />
                    <span className="truncate">{cvFile ? cvFile.name : it ? "Carica file" : "Upload file"}</span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      className="hidden"
                      onChange={(event) => onCvFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{it ? "Portfolio" : "Portfolio"}</Label>
                  <label className="mt-1 flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground hover:border-accent/50">
                    <Upload size={14} className="shrink-0" />
                    <span className="truncate">{portfolioFile ? portfolioFile.name : it ? "Carica file" : "Upload file"}</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(event) => onPortfolioFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              </div>
              <div>
                <Label htmlFor="workaway-portfolio-url" className="text-xs text-muted-foreground">
                  {it ? "Link al portfolio (facoltativo)" : "Portfolio link (optional)"}
                </Label>
                <Input
                  id="workaway-portfolio-url"
                  type="url"
                  className="mt-1"
                  placeholder={it ? "es. instagram.com/tuoprofilo" : "e.g. instagram.com/yourprofile"}
                  value={proposal.workaway.portfolioUrl}
                  onChange={(event) => updateWorkaway({ portfolioUrl: event.target.value })}
                />
              </div>

              <label className="flex items-center gap-3">
                <Checkbox
                  checked={proposal.workaway.requestsCompensation}
                  onCheckedChange={(value) => updateWorkaway({ requestsCompensation: value === true })}
                />
                <span className="text-xs text-foreground">
                  {it
                    ? "Ritengo di dover essere retribuito, in aggiunta al viaggio"
                    : "I believe I should also be compensated, on top of the voyage"}
                </span>
              </label>
              {proposal.workaway.requestsCompensation && (
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={proposal.workaway.requestedCompensationEur ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateWorkaway({
                      requestedCompensationEur: value === "" ? null : Math.max(0, Number(value)),
                    });
                  }}
                  placeholder={it ? "Importo richiesto (EUR)" : "Requested amount (EUR)"}
                  className="max-w-[10rem]"
                />
              )}

              <p className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {it
                  ? "Proporre una collaborazione implica un impegno professionale per la durata concordata del viaggio: le ore indicate sopra sono un impegno vero e proprio, non un'indicazione di massima."
                  : "Proposing a workaway trade implies a professional commitment for the agreed duration of the voyage: the hours above are a real commitment, not a rough indication."}
              </p>
            </div>
          )}
        </div>
      )}

      {(proposal.wantsAlternativeContribution || proposal.wantsWorkaway) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {it
            ? "L'organizzatore puo accettare la tua proposta, rifiutarla o farti una contro-proposta: se ricevi una contro-proposta potrai solo accettarla o rifiutarla, senza ulteriori rilanci."
            : "The organiser can accept your proposal, reject it, or send a counter-proposal: if you receive a counter-proposal you can only accept or reject it, with no further back-and-forth."}
        </p>
      )}
    </div>
  );
};

export default ContributionProposalForm;
