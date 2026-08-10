import { useMemo, useState } from "react";
import { Info, Upload, X } from "lucide-react";
import type { Language } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDepositEur } from "@/lib/booking-deposit";
import {
  proposedVariancePercent,
  proposedVariancePercentLabel,
  type ContributionProposal,
  type WorkawayHoursCommitmentType,
} from "@/lib/booking-workaway-proposal";
import type { WorkawayRole } from "@/lib/booking-utils";

type ContributionProposalFormProps = {
  lang: Language;
  proposal: ContributionProposal;
  onChange: (proposal: ContributionProposal) => void;
  standardVariableEur: number;
  contributionProposalEnabled: boolean;
  workawayEnabled: boolean;
  bounds: { minPercent: number; maxPercent: number };
  workawayRoles: WorkawayRole[];
  activeWorkawayRoleKeys: string[];
  cvFile: File | null;
  onCvFileChange: (file: File | null) => void;
  portfolioFile: File | null;
  onPortfolioFileChange: (file: File | null) => void;
};

const ContributionProposalForm = ({
  lang,
  proposal,
  onChange,
  standardVariableEur,
  contributionProposalEnabled,
  workawayEnabled,
  bounds,
  workawayRoles,
  activeWorkawayRoleKeys,
  cvFile,
  onCvFileChange,
  portfolioFile,
  onPortfolioFileChange,
}: ContributionProposalFormProps) => {
  const [roleSearch, setRoleSearch] = useState("");
  const it = lang === "it";

  const percent = proposal.proposedVariableEur != null
    ? proposedVariancePercent(proposal.proposedVariableEur, standardVariableEur)
    : null;
  const percentLabel = proposal.proposedVariableEur != null
    ? proposedVariancePercentLabel(proposal.proposedVariableEur, standardVariableEur)
    : null;
  const percentOutOfRange = percent != null && (percent < bounds.minPercent || percent > bounds.maxPercent);

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
      {contributionProposalEnabled && (
        <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={proposal.wantsAlternativeContribution}
              onCheckedChange={(value) =>
                onChange({ ...proposal, wantsAlternativeContribution: value === true })
              }
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm font-medium text-foreground">
              {it ? "Voglio proporre un contributo diverso" : "I want to propose a different contribution"}
            </span>
          </label>

          {proposal.wantsAlternativeContribution && (
            <div className="mt-3 space-y-2 pl-7">
              <Label htmlFor="proposed-variable-eur" className="text-xs text-muted-foreground">
                {it
                  ? `Quota variabile stimata: ${formatDepositEur(standardVariableEur, "it")} (+ €20 fisso invariato)`
                  : `Estimated variable contribution: ${formatDepositEur(standardVariableEur, "en")} (+ unchanged €20 fixed)`}
              </Label>
              <Input
                id="proposed-variable-eur"
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={proposal.proposedVariableEur ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({
                    ...proposal,
                    proposedVariableEur: value === "" ? null : Math.max(0, Number(value)),
                  });
                }}
                className="max-w-[10rem]"
              />
              {proposal.proposedVariableEur != null && percentLabel == null && (
                <p className="text-xs text-muted-foreground">
                  {it
                    ? "La quota variabile stimata e €0 per le tratte selezionate: puoi proporre qualsiasi importo."
                    : "The estimated variable contribution is €0 for the selected legs: you can propose any amount."}
                </p>
              )}
              {percentLabel != null && (
                <p className={`text-xs ${percentOutOfRange ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                  {it
                    ? `Stai proponendo il ${percentLabel}% della quota stimata${percentLabel < 100 ? " (in meno)" : percentLabel > 100 ? " (in piu)" : ""}.`
                    : `You're proposing ${percentLabel}% of the estimated contribution${percentLabel < 100 ? " (lower)" : percentLabel > 100 ? " (higher)" : ""}.`}
                  {percentOutOfRange
                    ? it
                      ? ` Deve restare tra il ${bounds.minPercent}% e il ${bounds.maxPercent}%.`
                      : ` It must stay between ${bounds.minPercent}% and ${bounds.maxPercent}%.`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {workawayEnabled && (
        <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
          <label className="flex items-start gap-3">
            <Checkbox
              checked={proposal.wantsWorkaway}
              onCheckedChange={(value) => onChange({ ...proposal, wantsWorkaway: value === true })}
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm font-medium text-foreground">
              {it
                ? "Voglio proporre una collaborazione (workaway) invece del contributo, o in parte"
                : "I want to propose a workaway trade instead of, or alongside, the contribution"}
            </span>
          </label>

          {proposal.wantsWorkaway && (
            <div className="mt-3 space-y-4 pl-7">
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
