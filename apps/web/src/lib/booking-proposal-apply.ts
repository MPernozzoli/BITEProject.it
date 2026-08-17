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
  message: string | null;
  candidateInfo: Record<string, unknown>;
  proposal: ApplyWithProposalPayload;
  candidateMessage: string | null;
  /** People on the application; the proposed amounts stay per person. Defaults to a solo application. */
  partySize?: number;
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
        message: params.message,
        candidateInfo: params.candidateInfo,
        proposalKind: params.proposal.proposalKind,
        proposedVariableCents: params.proposal.proposedVariableCents,
        workaway: params.proposal.workaway,
        candidateMessage: params.candidateMessage,
        partySize: Math.max(1, Math.floor(params.partySize ?? 1) || 1),
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

/** Signed download link for a CV/portfolio file in the private workaway-applications bucket. */
export async function getWorkawayFileSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("workaway-applications").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Candidate accepts the admin's counter-proposal on their contribution/workaway negotiation. */
export async function acceptContributionCounter(
  bookingRequestId: string,
  message: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await untypedSupabase.rpc("accept_voyage_booking_contribution_counter", {
    _booking_request_id: bookingRequestId,
    _message: message,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
