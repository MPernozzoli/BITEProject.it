/**
 * POST /api/payments/bunq/bank-transfer
 *
 * Alternative to the Bunq online payment link: returns the fixed bank details plus a unique,
 * recognizable causale (reference) the payer must include in their transfer. The amount is
 * recomputed server-side exactly like the online flow. Reconciliation happens against the
 * same Bunq account — see /api/payments/bunq/status (live poll) and /api/payments/bunq/webhook
 * (event push), both of which match incoming transfers by this reference.
 *
 * Body: { bookingRequestId: string, participantId?: string }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { randomUUID } from "node:crypto";
import { environment } from "../../../src/server/bunq/client.js";
import { BANK_TRANSFER_DETAILS } from "../../../src/server/bunq/bank-details.js";
import {
  DepositHttpError,
  findExistingDeposit,
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

  let bookingRequestId: string;
  let participantId: string | null;
  try {
    const body = await readJsonBody<{ bookingRequestId?: string; participantId?: string }>(req);
    bookingRequestId = String(body.bookingRequestId ?? "").trim();
    participantId = body.participantId ? String(body.participantId).trim() : null;
    if (!bookingRequestId) {
      sendJson(res, 400, { error: "missing_booking_request_id" });
      return;
    }
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);

    // Idempotency: resend the same causale/amount for this exact payer instead of minting a new one.
    const existing = await findExistingDeposit(db, bookingRequestId, participantId, "bank_transfer");
    if (existing) {
      if (existing.status === "paid") {
        sendJson(res, 200, { alreadyPaid: true });
        return;
      }
      if (existing.status === "pending") {
        sendJson(res, 200, {
          ...BANK_TRANSFER_DETAILS,
          reference: existing.reference,
          amountEur: existing.amount_cents / 100,
          perPersonEur: existing.per_person_cents / 100,
          partySize: existing.party_size,
        });
        return;
      }
    }

    const resolved = await resolveDepositPayer(db, user, bookingRequestId, participantId);
    const { payerParticipantId, coveredPersons, perPersonEur, amountEur } = resolved;

    const reference = `BON-${bookingRequestId.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();

    const { error: insertError } = await db.from("voyage_booking_deposits").insert({
      booking_request_id: bookingRequestId,
      participant_id: payerParticipantId,
      environment: environment(),
      payment_method: "bank_transfer",
      per_person_cents: Math.round(perPersonEur * 100),
      party_size: coveredPersons,
      amount_cents: Math.round(amountEur * 100),
      currency: "EUR",
      status: "pending",
      bunq_request_id: null,
      share_url: null,
      reference,
    });
    if (insertError) throw new Error(insertError.message);

    sendJson(res, 200, {
      ...BANK_TRANSFER_DETAILS,
      reference,
      amountEur,
      perPersonEur,
      partySize: coveredPersons,
    });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    console.error("[bunq/bank-transfer] failed", error);
    sendJson(res, 500, { error: "bank_transfer_request_failed" });
  }
}
