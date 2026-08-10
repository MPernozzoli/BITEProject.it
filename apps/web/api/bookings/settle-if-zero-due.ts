/**
 * POST /api/bookings/settle-if-zero-due
 *
 * Promotes a pending_payment booking out of that state without ever creating a deposit, for the
 * one case where that's legitimate: resolveDepositPayer's authoritative recompute confirms €0 is
 * actually due (most commonly a contribution-proposal application whose fixed share was waived
 * because the candidate already holds another active application on the same voyage — see
 * request_voyage_booking_with_contribution_proposal / settle_voyage_booking_payment_if_zero_due).
 *
 * The amount is never trusted from the client: this calls the exact same resolveDepositPayer used
 * to price a real payment, and only proceeds when IT says there's nothing to collect. If it says
 * an amount is actually due, the caller should fall back to the normal payment flow instead.
 *
 * Body: { bookingRequestId: string, participantId?: string | null }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import {
  DepositHttpError,
  resolveCaller,
  resolveDepositPayer,
  settleBookingPaymentIfZeroDue,
} from "../../src/server/bunq/deposit-resolver.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

type Body = {
  bookingRequestId?: string;
  participantId?: string | null;
};

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

  const bookingRequestId = String(body.bookingRequestId ?? "").trim();
  if (!bookingRequestId) {
    sendJson(res, 400, { error: "missing_booking_request_id" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);

    try {
      const resolved = await resolveDepositPayer(db, user, bookingRequestId, body.participantId ?? null);
      // resolveDepositPayer only returns (rather than throwing) when there is a genuine positive
      // amount left to collect — nothing to settle here, the client should open the normal
      // payment flow instead.
      sendJson(res, 409, { error: "amount_due", amountEur: resolved.amountEur });
      return;
    } catch (error) {
      if (!(error instanceof DepositHttpError) || error.body.error !== "zero_deposit") {
        throw error;
      }
      // Exactly the "nothing to collect, ever" case this endpoint exists for.
    }

    await settleBookingPaymentIfZeroDue(db, bookingRequestId);
    sendJson(res, 200, { ok: true, bookingRequestId });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    const statusCode =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "settle_if_zero_due_failed";
    console.error("[bookings/settle-if-zero-due] failed", error);
    sendJson(res, statusCode, { error: message });
  }
}
