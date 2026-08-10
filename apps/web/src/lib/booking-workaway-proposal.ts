/**
 * Client-side shape and validation for a candidate's contribution/workaway counter-proposal,
 * submitted alongside the application via /api/bookings/apply-with-proposal. Mirrors the
 * shape/validation split of booking-candidate-info.ts. CV/portfolio files themselves are
 * uploaded directly to Storage after the application is created (the path needs the resulting
 * booking_request_id) — this module only carries the resulting storage paths/URL.
 */

export type ProposalKind = "contribution" | "workaway" | "hybrid";
export type WorkawayHoursCommitmentType = "per_day" | "per_week";

export type WorkawayProposalDetails = {
  roleKeys: string[];
  otherRoleText: string;
  message: string;
  hoursCommitmentType: WorkawayHoursCommitmentType | null;
  hoursCommitmentValue: number | null;
  /** External link (portfolio, website, profile...) — independent of the uploaded file, if any. */
  portfolioUrl: string;
  requestsCompensation: boolean;
  requestedCompensationEur: number | null;
};

export const emptyWorkawayProposalDetails: WorkawayProposalDetails = {
  roleKeys: [],
  otherRoleText: "",
  message: "",
  hoursCommitmentType: null,
  hoursCommitmentValue: null,
  portfolioUrl: "",
  requestsCompensation: false,
  requestedCompensationEur: null,
};

export type ContributionProposal = {
  wantsAlternativeContribution: boolean;
  proposedVariableEur: number | null;
  wantsWorkaway: boolean;
  workaway: WorkawayProposalDetails;
  candidateMessage: string;
};

export const emptyContributionProposal: ContributionProposal = {
  wantsAlternativeContribution: false,
  proposedVariableEur: null,
  wantsWorkaway: false,
  workaway: emptyWorkawayProposalDetails,
  candidateMessage: "",
};

/**
 * null when neither alternative is selected — i.e. the candidate stayed on the standard quote.
 * The two top-level choices are mutually exclusive in the UI (workaway always carries its own
 * amount field, so there is no separate "both at once" state to represent): workaway is "hybrid"
 * once it has an amount attached (the normal case — the field is always shown, prefilled), or
 * bare "workaway" only in the transient moment the candidate has cleared that field.
 */
export function contributionProposalKind(proposal: ContributionProposal): ProposalKind | null {
  if (proposal.wantsWorkaway) return proposal.proposedVariableEur != null ? "hybrid" : "workaway";
  if (proposal.wantsAlternativeContribution) return "contribution";
  return null;
}

/** The normal total contribution for this application: the negotiable variable share plus the
 * €20 fixed minimum (0 only in the rare case where it's waived — see shouldApplyContributionFixedMinimum
 * in booking-deposit.ts). This is the number the slider UI works in, since "propose the variable
 * part, the fixed always adds on top separately" was confusing in practice. */
export function standardTotalEur(standardVariableEur: number, fixedMinimumEur: number): number {
  return standardVariableEur + fixedMinimumEur;
}

/**
 * Percentage the proposed TOTAL (variable + fixed) represents of the standard TOTAL, kept at
 * full precision for the range check below. There is no floor beyond the fixed minimum itself
 * (already enforced structurally — see getContributionProposalValidationError), so only ever
 * used against a ceiling.
 */
export function proposedTotalPercent(
  proposedVariableEur: number,
  standardVariableEur: number,
  fixedMinimumEur: number,
): number {
  const standardTotal = standardTotalEur(standardVariableEur, fixedMinimumEur);
  if (standardTotal <= 0) return 0;
  return ((proposedVariableEur + fixedMinimumEur) / standardTotal) * 100;
}

/** Same as {@link proposedTotalPercent}, rounded to a whole number for display in the UI. */
export function proposedTotalPercentLabel(
  proposedVariableEur: number,
  standardVariableEur: number,
  fixedMinimumEur: number,
): number {
  return Math.round(proposedTotalPercent(proposedVariableEur, standardVariableEur, fixedMinimumEur));
}

export function getContributionProposalValidationError(
  proposal: ContributionProposal,
  standardVariableEur: number,
  fixedMinimumEur: number,
  maxPercent: number,
  lang: "it" | "en",
): string | null {
  const kind = contributionProposalKind(proposal);
  if (!kind) {
    return lang === "it"
      ? "Seleziona almeno un'alternativa: contributo diverso o workaway."
      : "Select at least one alternative: a different contribution or workaway.";
  }

  // The amount field is always shown (and always required) once either alternative is picked —
  // it represents the TOTAL contribution (fixed + variable). There is no floor beyond the fixed
  // minimum itself: the UI slider physically cannot go below it, so nothing more to check here.
  if (proposal.proposedVariableEur == null || proposal.proposedVariableEur < 0) {
    return lang === "it" ? "Indica l'importo che proponi." : "Enter the amount you're proposing.";
  }
  const percent = proposedTotalPercent(proposal.proposedVariableEur, standardVariableEur, fixedMinimumEur);
  if (percent > maxPercent) {
    return lang === "it"
      ? "Oltre una certa soglia l'importo non sarebbe più un contributo alle spese vive, ma assomiglierebbe a un pagamento per un servizio: per questo non possiamo accettarlo. Prova con una cifra più vicina alla stima."
      : "Beyond a certain point the amount would no longer be a contribution to costs, but would look like a payment for a service: we can't accept it. Try an amount closer to the estimate.";
  }

  if (proposal.wantsWorkaway) {
    const hasRole = proposal.workaway.roleKeys.length > 0 || proposal.workaway.otherRoleText.trim().length > 0;
    if (!hasRole) {
      return lang === "it" ? "Indica almeno una mansione che proponi." : "Select at least one role you're proposing.";
    }
    if (proposal.workaway.message.trim().length < 20) {
      return lang === "it"
        ? "Scrivi qualche riga su cosa proponi di fare."
        : "Write a few lines about what you're proposing to do.";
    }
    if (
      proposal.workaway.requestsCompensation &&
      (proposal.workaway.requestedCompensationEur == null || proposal.workaway.requestedCompensationEur <= 0)
    ) {
      return lang === "it"
        ? "Indica l'importo del compenso richiesto."
        : "Enter the compensation amount you're requesting.";
    }
  }

  return null;
}

export type ApplyWithProposalPayload = {
  proposalKind: ProposalKind;
  proposedVariableCents: number | null;
  workaway: {
    roleKeys: string[];
    otherRoleText: string | null;
    message: string | null;
    hoursCommitmentType: WorkawayHoursCommitmentType | null;
    hoursCommitmentValue: number | null;
    portfolioUrl: string | null;
    requestsCompensation: boolean;
    requestedCompensationCents: number | null;
  };
  candidateMessage: string | null;
};

/** null when the candidate stayed on the standard quote — nothing to attach. */
export function toApplyWithProposalPayload(proposal: ContributionProposal): ApplyWithProposalPayload | null {
  const kind = contributionProposalKind(proposal);
  if (!kind) return null;
  return {
    proposalKind: kind,
    proposedVariableCents:
      proposal.proposedVariableEur != null ? Math.round(proposal.proposedVariableEur * 100) : null,
    workaway: {
      roleKeys: proposal.workaway.roleKeys,
      otherRoleText: proposal.workaway.otherRoleText.trim() || null,
      message: proposal.workaway.message.trim() || null,
      hoursCommitmentType: proposal.workaway.hoursCommitmentType,
      hoursCommitmentValue: proposal.workaway.hoursCommitmentValue,
      portfolioUrl: proposal.workaway.portfolioUrl.trim() || null,
      requestsCompensation: proposal.workaway.requestsCompensation,
      requestedCompensationCents:
        proposal.workaway.requestsCompensation && proposal.workaway.requestedCompensationEur != null
          ? Math.round(proposal.workaway.requestedCompensationEur * 100)
          : null,
    },
    candidateMessage: proposal.candidateMessage.trim() || null,
  };
}
