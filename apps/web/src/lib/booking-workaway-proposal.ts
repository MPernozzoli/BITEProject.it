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

/** null when neither alternative is selected — i.e. the candidate stayed on the standard quote. */
export function contributionProposalKind(proposal: ContributionProposal): ProposalKind | null {
  if (proposal.wantsAlternativeContribution && proposal.wantsWorkaway) return "hybrid";
  if (proposal.wantsAlternativeContribution) return "contribution";
  if (proposal.wantsWorkaway) return "workaway";
  return null;
}

/** Percentage the proposed amount represents of the calculated variable contribution. */
export function proposedVariancePercent(proposedVariableEur: number, standardVariableEur: number): number {
  if (standardVariableEur <= 0) return 0;
  return Math.round((proposedVariableEur / standardVariableEur) * 10000) / 100;
}

export function getContributionProposalValidationError(
  proposal: ContributionProposal,
  standardVariableEur: number,
  bounds: { minPercent: number; maxPercent: number },
  lang: "it" | "en",
): string | null {
  const kind = contributionProposalKind(proposal);
  if (!kind) {
    return lang === "it"
      ? "Seleziona almeno un'alternativa: contributo diverso o workaway."
      : "Select at least one alternative: a different contribution or workaway.";
  }

  if (proposal.wantsAlternativeContribution) {
    if (proposal.proposedVariableEur == null || proposal.proposedVariableEur < 0) {
      return lang === "it" ? "Indica l'importo che proponi." : "Enter the amount you're proposing.";
    }
    const percent = proposedVariancePercent(proposal.proposedVariableEur, standardVariableEur);
    if (percent < bounds.minPercent || percent > bounds.maxPercent) {
      return lang === "it"
        ? `L'importo proposto deve essere tra il ${bounds.minPercent}% e il ${bounds.maxPercent}% della quota stimata.`
        : `The proposed amount must be between ${bounds.minPercent}% and ${bounds.maxPercent}% of the estimated contribution.`;
    }
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
      proposal.wantsAlternativeContribution && proposal.proposedVariableEur != null
        ? Math.round(proposal.proposedVariableEur * 100)
        : null,
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
