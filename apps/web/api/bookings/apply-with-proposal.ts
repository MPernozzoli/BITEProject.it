/**
 * POST /api/bookings/apply-with-proposal
 *
 * Same effect as calling request_voyage_booking directly (as the standard application flow
 * does from the browser), plus attaching a contribution/workaway proposal to the resulting
 * application — atomically, via request_voyage_booking_with_contribution_proposal. Kept as a
 * separate endpoint rather than widening request_voyage_booking itself — see the plan: that RPC
 * is load-bearing (advisory lock, capacity check, duplicate-leg guard) and the team already
 * treats RPC-overload drift as a real risk (see the explicit `drop function if exists` cleanups
 * in the booking migrations).
 *
 * The standard variable contribution is always recomputed here from the leg complexity — never
 * trusted from the client — and the proposed amount is validated against the voyage's
 * contribution_proposal_min/max_percent both here (fast feedback, no round trip) and again
 * inside the RPC (authoritative, and — since request_voyage_booking_with_contribution_proposal
 * runs both steps in one transaction — a rejected proposal now never leaves a dangling
 * pending_payment application behind even if this pre-check somehow disagreed with the DB).
 *
 * party_size is always 1: contribution/workaway proposals are v1-scoped to solo applications,
 * enforced server-side by the RPC itself (it does not even accept a party size argument).
 *
 * Body: {
 *   voyageId: string, legIds: string[], message?: string | null, candidateInfo?: object,
 *   proposalKind: "contribution" | "workaway" | "hybrid",
 *   proposedVariableCents?: number | null,
 *   workaway?: {
 *     roleKeys?: string[], otherRoleText?: string | null, message?: string | null,
 *     hoursCommitmentType?: "per_day" | "per_week" | null, hoursCommitmentValue?: number | null,
 *     portfolioUrl?: string | null,
 *     requestsCompensation?: boolean, requestedCompensationCents?: number | null,
 *   },
 *   candidateMessage?: string | null,
 * }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { CONTRIBUTION_FIXED_MINIMUM_EUR, legDepositEur, type DepositLeg } from "../../src/lib/booking-deposit.js";

const FIXED_MINIMUM_CENTS = Math.round(CONTRIBUTION_FIXED_MINIMUM_EUR * 100);
import { createAuthClient, createServiceClient, createUserScopedClient } from "../../src/server/bunq/supabase.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

class ApplyWithProposalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type WorkawayBody = {
  roleKeys?: string[];
  otherRoleText?: string | null;
  message?: string | null;
  hoursCommitmentType?: "per_day" | "per_week" | null;
  hoursCommitmentValue?: number | null;
  portfolioUrl?: string | null;
  requestsCompensation?: boolean;
  requestedCompensationCents?: number | null;
};

type Body = {
  voyageId?: string;
  legIds?: string[];
  message?: string | null;
  candidateInfo?: Record<string, unknown>;
  proposalKind?: string;
  proposedVariableCents?: number | null;
  workaway?: WorkawayBody;
  candidateMessage?: string | null;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(req);
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const voyageId = String(body.voyageId ?? "").trim();
  const legIds = Array.isArray(body.legIds) ? body.legIds.map((id) => String(id)).filter(Boolean) : [];
  const proposalKind = String(body.proposalKind ?? "").trim();
  const workaway = body.workaway ?? {};

  if (!voyageId || legIds.length === 0) {
    sendJson(res, 400, { error: "missing_voyage_or_legs" });
    return;
  }
  if (!["contribution", "workaway", "hybrid"].includes(proposalKind)) {
    sendJson(res, 400, { error: "invalid_proposal_kind" });
    return;
  }

  try {
    const authClient = createAuthClient();
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) {
      throw new ApplyWithProposalError(401, "unauthenticated");
    }

    const serviceDb = createServiceClient();

    const { data: settingsRow, error: settingsError } = await serviceDb
      .from("voyage_booking_settings")
      .select("contribution_proposal_enabled, contribution_proposal_max_percent, workaway_enabled")
      .eq("voyage_id", voyageId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    const settings = settingsRow as {
      contribution_proposal_enabled: boolean;
      contribution_proposal_max_percent: number;
      workaway_enabled: boolean;
    } | null;

    if (
      (proposalKind === "contribution" || proposalKind === "hybrid") &&
      !settings?.contribution_proposal_enabled
    ) {
      throw new ApplyWithProposalError(409, "contribution_proposal_disabled");
    }
    if ((proposalKind === "workaway" || proposalKind === "hybrid") && !settings?.workaway_enabled) {
      throw new ApplyWithProposalError(409, "workaway_disabled");
    }

    const { data: legRows, error: legError } = await serviceDb
      .from("voyage_bookable_legs")
      .select("id, planned_nautical_miles, open_sea, danger_level, starts_at_window_start, ends_at_window_start")
      .in("id", legIds);
    if (legError) throw new Error(legError.message);
    const legs = (legRows ?? []) as (DepositLeg & { id: string })[];
    if (legs.length !== legIds.length) {
      throw new ApplyWithProposalError(400, "invalid_legs");
    }

    const { data: voyageRow, error: voyageError } = await serviceDb
      .from("voyages")
      .select("booking_contribution_per_nm_eur")
      .eq("id", voyageId)
      .maybeSingle();
    if (voyageError) throw new Error(voyageError.message);
    const contributionPerNmEur = Number(
      (voyageRow as { booking_contribution_per_nm_eur?: number } | null)?.booking_contribution_per_nm_eur ?? 0.9,
    );

    const standardVariableEur = round2(
      legs.reduce((acc, leg) => acc + legDepositEur(leg, { contributionPerNmEur }), 0),
    );
    const standardVariableCents = Math.round(standardVariableEur * 100);

    let proposedVariableCents: number | null = null;
    if (proposalKind === "contribution" || proposalKind === "hybrid") {
      proposedVariableCents = Math.round(Number(body.proposedVariableCents ?? NaN));
      if (!Number.isFinite(proposedVariableCents) || proposedVariableCents < 0) {
        throw new ApplyWithProposalError(400, "invalid_proposed_variable_cents");
      }
      // There is no floor beyond >= 0 above: the €20 fixed is the real minimum and is always
      // collected separately (before the proposal is even reviewed), so "propose €0 variable"
      // is already the most generous a candidate can be. The ceiling is measured against the
      // TOTAL standard contribution (variable + the €20 fixed), not the variable share alone.
      const standardTotalCents = standardVariableCents + FIXED_MINIMUM_CENTS;
      const percentOfTotal = ((proposedVariableCents + FIXED_MINIMUM_CENTS) / standardTotalCents) * 100;
      const maxPercent = Number(settings?.contribution_proposal_max_percent ?? 150);
      if (percentOfTotal > maxPercent) {
        throw new ApplyWithProposalError(409, "proposal_out_of_range");
      }
    }

    if (proposalKind === "workaway" || proposalKind === "hybrid") {
      const roleKeys = Array.isArray(workaway.roleKeys) ? workaway.roleKeys.filter(Boolean) : [];
      const otherRole = String(workaway.otherRoleText ?? "").trim();
      if (roleKeys.length === 0 && !otherRole) {
        throw new ApplyWithProposalError(400, "workaway_role_required");
      }
    }

    // From here on the application is created as the user themselves — every existing
    // invariant in request_voyage_booking (advisory lock, capacity, duplicate-leg guard,
    // RLS) applies exactly as it does for the standard flow. Both steps run inside the RPC's
    // own transaction, so a failure here can never leave a paid-for-the-wrong-amount booking.
    const userDb = createUserScopedClient(token);
    const { data: applyResult, error: applyError } = await userDb.rpc(
      "request_voyage_booking_with_contribution_proposal",
      {
        _voyage_id: voyageId,
        _leg_ids: legIds,
        _message: body.message ?? null,
        _candidate_info: body.candidateInfo ?? {},
        _proposal_kind: proposalKind,
        _standard_variable_cents: standardVariableCents,
        _proposed_variable_cents: proposedVariableCents,
        _workaway_role_keys: workaway.roleKeys ?? [],
        _workaway_other_role_text: workaway.otherRoleText ?? null,
        _workaway_message: workaway.message ?? null,
        _workaway_hours_commitment_type: workaway.hoursCommitmentType ?? null,
        _workaway_hours_commitment_value: workaway.hoursCommitmentValue ?? null,
        _workaway_portfolio_url: workaway.portfolioUrl ?? null,
        _workaway_requests_compensation: workaway.requestsCompensation ?? false,
        _workaway_requested_compensation_cents: workaway.requestedCompensationCents ?? null,
        _candidate_message: body.candidateMessage ?? null,
      },
    );

    if (applyError) {
      if ((applyError as { code?: string }).code === "BK001") {
        throw new ApplyWithProposalError(409, "duplicate_leg_booking");
      }
      throw new ApplyWithProposalError(409, applyError.message);
    }
    const bookingRequestId = (Array.isArray(applyResult) ? applyResult[0] : applyResult)?.booking_request_id as
      | string
      | undefined;
    if (!bookingRequestId) {
      throw new Error("request_voyage_booking_with_contribution_proposal_no_id");
    }

    sendJson(res, 200, {
      ok: true,
      bookingRequestId,
      standardVariableEur,
      proposedVariableEur: proposedVariableCents !== null ? proposedVariableCents / 100 : null,
    });
  } catch (error) {
    if (error instanceof ApplyWithProposalError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error("[bookings/apply-with-proposal] failed", error);
    sendJson(res, 500, { error: "apply_with_proposal_failed" });
  }
}
