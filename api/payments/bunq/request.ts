/**
 * POST /api/payments/bunq/request
 *
 * Creates a Bunq voyage-contribution payment request. The payer is either:
 *   - the lead (booking owner): pays contribution × party_size when payment_mode = lead_pays_all,
 *     otherwise just their own share; or
 *   - a guest participant (payment_mode = each_pays_own): pays their own single share.
 *
 * The amount is always recomputed server-side from the leg complexity — never trusted from
 * the client. Returns the shareable bunq.me link the payer is redirected to.
 *
 * Body: { bookingRequestId: string, participantId?: string }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { randomUUID } from "node:crypto";
import { bunqConfigured, environment } from "../../../src/server/bunq/client.js";
import { createBunqPaymentRequest } from "../../../src/server/bunq/payment-requests.js";
import {
  armBookingPaymentDeadline,
  DepositHttpError,
  enqueuePaymentPendingNotifications,
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

function siteUrl(): string {
  return (
    process.env.PUBLIC_SITE_URL ||
    process.env.VITE_SITE_URL ||
    "https://biteproject.it"
  ).replace(/\/$/, "");
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

  if (!bunqConfigured()) {
    sendJson(res, 503, { error: "not_configured" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);
    const resolved = await resolveDepositPayer(db, user, bookingRequestId, participantId);
    const { payerParticipantId, coveredPersons, perPersonEur, amountEur, counterpartyEmail } = resolved;

    // Idempotency: reuse an existing Bunq-link payment row for this exact payer.
    const existing = await findExistingDeposit(db, bookingRequestId, payerParticipantId, "bunq_link");
    if (existing) {
      if (existing.status === "paid") {
        sendJson(res, 200, { alreadyPaid: true });
        return;
      }
      if (existing.status === "pending" && existing.share_url) {
        sendJson(res, 200, {
          shareUrl: existing.share_url,
          amountEur: existing.amount_cents / 100,
          perPersonEur: existing.per_person_cents / 100,
          partySize: existing.party_size,
        });
        return;
      }
    }

    const reference = `CON-${bookingRequestId.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const description = `Quota spese viaggio BITE — ${reference}`;

    const created = await createBunqPaymentRequest({
      amountEur,
      description,
      counterpartyEmail,
      redirectUrl: `${siteUrl()}/bookings?deposit=processing`,
    });

    const { error: insertError } = await db.from("voyage_booking_deposits").insert({
      booking_request_id: bookingRequestId,
      participant_id: payerParticipantId,
      environment: environment(),
      payment_method: "bunq_link",
      per_person_cents: Math.round(perPersonEur * 100),
      party_size: coveredPersons,
      amount_cents: Math.round(amountEur * 100),
      currency: "EUR",
      status: "pending",
      bunq_request_id: created.id,
      share_url: created.shareUrl,
      reference,
    });
    if (insertError) throw new Error(insertError.message);
    const expiresAt = await armBookingPaymentDeadline(db, bookingRequestId);
    try {
      await enqueuePaymentPendingNotifications(resolved, {
        paymentMethod: "bunq_link",
        reference,
        expiresAt,
      });
    } catch (error) {
      console.error("[bunq/request] payment notification enqueue failed", error);
    }

    sendJson(res, 200, {
      shareUrl: created.shareUrl,
      amountEur,
      perPersonEur,
      partySize: coveredPersons,
      reference,
    });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    console.error("[bunq/request] failed", error);
    sendJson(res, 500, { error: "bunq_request_failed" });
  }
}
