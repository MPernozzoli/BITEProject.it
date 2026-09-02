/**
 * POST /api/payments/bunq/quote
 *
 * Prices the *next* contribution payment for a booking without arming anything: no Bunq request,
 * no bank-transfer reference, no payment deadline. It exists so every screen that asks a
 * traveller for money shows the amount the payment endpoints will actually charge, instead of
 * each one re-deriving the acconto/saldo split client-side (they used to, and they drifted).
 *
 * It calls the very same resolveDepositPayer used to create a real payment, so the figures are
 * authoritative by construction — including the cases the formula alone cannot know: a partially
 * settled deposit, a route change that only owes the difference, a contribution proposal that is
 * collected in full up front.
 *
 * Body: { bookingRequestId: string, participantId?: string | null }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { BUNQ_SINGLE_TRANSACTION_LIMIT_EUR } from "../../../src/lib/booking-deposit.js";
import {
  DepositHttpError,
  resolveCaller,
  resolveDepositPayer,
} from "../../../src/server/bunq/deposit-resolver.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http.js";

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
    const resolved = await resolveDepositPayer(db, user, bookingRequestId, body.participantId ?? null);
    sendJson(res, 200, {
      amountEur: resolved.amountEur,
      perPersonEur: resolved.perPersonEur,
      coveredPersons: resolved.coveredPersons,
      phase: resolved.phase,
      totalDueEur: resolved.totalDueEur,
      depositTargetEur: resolved.depositTargetEur,
      maxSingleTransactionEur: BUNQ_SINGLE_TRANSACTION_LIMIT_EUR,
    });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      // "Nothing left to collect" is a legitimate answer to a quote, not a failure: the caller
      // shows "already settled" rather than an error.
      if (error.body.error === "already_settled" || error.body.error === "zero_deposit") {
        sendJson(res, 200, { nothingDue: true, reason: error.body.error });
        return;
      }
      sendJson(res, error.status, error.body);
      return;
    }
    console.error("[bunq/quote] failed", error);
    sendJson(res, 500, { error: "quote_failed" });
  }
}
