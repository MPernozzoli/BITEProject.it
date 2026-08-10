import { supabase } from "@/integrations/supabase/client";
import type { ApplyWithProposalPayload } from "@/lib/booking-workaway-proposal";

/** RPCs added by migrations not yet reflected in the generated Supabase types. */
type UntypedRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};
const untypedSupabase = supabase as unknown as UntypedRpcClient;

async function authToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

export type ApplyWithProposalResult =
  | { ok: true; bookingRequestId: string; standardVariableEur: number; proposedVariableEur: number | null }
  | { ok: false; error: string };

export async function applyVoyageBookingWithProposal(params: {
  voyageId: string;
  legIds: string[];
  partySize: number;
  message: string | null;
  candidateInfo: Record<string, unknown>;
  proposal: ApplyWithProposalPayload;
  candidateMessage: string | null;
}): Promise<ApplyWithProposalResult> {
  const token = await authToken();
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/bookings/apply-with-proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        voyageId: params.voyageId,
        legIds: params.legIds,
        partySize: params.partySize,
        message: params.message,
        candidateInfo: params.candidateInfo,
        proposalKind: params.proposal.proposalKind,
        proposedVariableCents: params.proposal.proposedVariableCents,
        workaway: params.proposal.workaway,
        candidateMessage: params.candidateMessage,
      }),
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* ignore malformed body */
  }

  if (!response.ok) {
    return { ok: false, error: String(payload.error ?? `http_${response.status}`) };
  }

  return {
    ok: true,
    bookingRequestId: String(payload.bookingRequestId),
    standardVariableEur: Number(payload.standardVariableEur ?? 0),
    proposedVariableEur: payload.proposedVariableEur == null ? null : Number(payload.proposedVariableEur),
  };
}

/** Uploads the candidate's CV/portfolio (if provided) and attaches the resulting paths to their proposal. */
export async function uploadWorkawayProposalFiles(params: {
  bookingRequestId: string;
  userId: string;
  cvFile: File | null;
  portfolioFile: File | null;
}): Promise<void> {
  if (!params.cvFile && !params.portfolioFile) return;

  const extOf = (file: File) => (file.name.includes(".") ? file.name.split(".").pop() : null);
  let cvPath: string | null = null;
  let portfolioPath: string | null = null;

  if (params.cvFile) {
    const ext = extOf(params.cvFile) || "bin";
    cvPath = `${params.userId}/${params.bookingRequestId}/cv.${ext}`;
    const { error } = await supabase.storage
      .from("workaway-applications")
      .upload(cvPath, params.cvFile, { upsert: true });
    if (error) throw new Error(error.message);
  }

  if (params.portfolioFile) {
    const ext = extOf(params.portfolioFile) || "bin";
    portfolioPath = `${params.userId}/${params.bookingRequestId}/portfolio.${ext}`;
    const { error } = await supabase.storage
      .from("workaway-applications")
      .upload(portfolioPath, params.portfolioFile, { upsert: true });
    if (error) throw new Error(error.message);
  }

  const { error: rpcError } = await untypedSupabase.rpc("update_voyage_booking_contribution_proposal_files", {
    _booking_request_id: params.bookingRequestId,
    _workaway_cv_storage_path: cvPath,
    _workaway_portfolio_storage_path: portfolioPath,
    _workaway_portfolio_url: null,
  });
  if (rpcError) throw new Error(rpcError.message);
}
