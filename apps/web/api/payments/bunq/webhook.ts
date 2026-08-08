/**
 * POST /api/payments/bunq/webhook
 *
 * Receives Bunq notification callbacks and settles the matching contribution. Reconciles by the
 * request-inquiry id (REQUEST/REQUEST_INQUIRY events) or by the reference embedded in the
 * payment description (PAYMENT/MUTATION events). Always answers 200 quickly so Bunq does
 * not retry a delivered-but-unmatched event.
 *
 * Note: the /status endpoint independently re-checks Bunq, so the flow is resilient even if
 * this webhook is not configured in the Bunq dashboard.
 */
import { createServiceClient } from "../../../src/server/bunq/supabase.js";
import { bunqConfigured, environment, accountPath, bunqRequest } from "../../../src/server/bunq/client.js";
import {
  clearBookingPaymentDeadlineIfSettled,
  enqueuePaymentReceivedNotifications,
  paymentPhaseFromReference,
} from "../../../src/server/bunq/deposit-resolver.js";
import { getBunqPaymentRequest } from "../../../src/server/bunq/payment-requests.js";
import { firstQueryParam, readJsonBody, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import { timingSafeEqual } from "node:crypto";

// CON/DEP/BON are the pre-deposit/balance-split prefixes, kept so in-flight references issued
// before this shipped still reconcile. ACC (acconto) / SAL (saldo) are current.
const REFERENCE_PATTERN = /\b(?:CON|DEP|BON|ACC|SAL)-[A-Z0-9]{8}-[A-Z0-9]{4}\b/i;

type BunqNotificationPayload = {
  NotificationUrl?: {
    event_type?: string;
    object?: {
      Payment?: {
        id?: number;
        description?: string;
        amount?: { value?: string; currency?: string };
        counterparty_alias?: Record<string, unknown> | null;
      };
      RequestInquiry?: { id?: number };
      RequestResponse?: { id?: number };
    };
  };
};

function headerValue(req: NodeRequest, name: string): string | null {
  const direct = req.headers[name] ?? req.headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return typeof value === "string" ? value.trim() : null;
}

function sameSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWebhookSecret(req: NodeRequest): boolean {
  const expected = process.env.BUNQ_WEBHOOK_SECRET?.trim();
  if (!expected) return false;

  const supplied =
    headerValue(req, "x-bite-bunq-webhook-secret") ??
    headerValue(req, "x-webhook-secret") ??
    firstQueryParam(req, "secret")?.trim() ??
    null;

  return supplied ? sameSecret(supplied, expected) : false;
}

async function markPaidByBunqRequestId(requestId: number): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id, participant_id, amount_cents, payment_method, reference")
    .eq("environment", environment())
    .eq("bunq_request_id", requestId)
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  const row = data as {
    id: string;
    booking_request_id: string;
    participant_id: string | null;
    amount_cents: number;
    payment_method: string | null;
    reference: string | null;
  };
  let payerAlias: Record<string, unknown> | null = null;
  try {
    payerAlias = (await getBunqPaymentRequest(requestId)).counterpartyAlias;
  } catch (error) {
    console.error("[bunq/webhook] request-inquiry fetch failed", error);
  }
  await db
    .from("voyage_booking_deposits")
    .update({ status: "paid", paid_at: new Date().toISOString(), payer_alias: payerAlias, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  // Notification first, settlement second: settle_voyage_booking_payment merges the resulting
  // booking status into the row queued here, so the payer receives a single email covering both
  // "we received your contribution" and what happened to the application. Its own try/catch:
  // a failed enqueue must never stop the money from actually promoting the booking.
  try {
    await enqueuePaymentReceivedForDeposit(db, row);
  } catch (error) {
    console.error("[bunq/webhook] payment notification enqueue failed", error);
  }
  try {
    await clearBookingPaymentDeadlineIfSettled(db, row.booking_request_id);
  } catch (error) {
    console.error("[bunq/webhook] settling payment failed", error);
  }
  return true;
}

function amountMatchesExpected(paymentAmountValue: string | undefined, expectedAmountCents: number): boolean {
  const amountCents = Math.round(Number(paymentAmountValue ?? 0) * 100);
  return Math.abs(amountCents - expectedAmountCents) <= 1;
}

async function markPaidByReference(params: {
  reference: string;
  paymentAmountValue?: string;
  payerAlias?: Record<string, unknown> | null;
}): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id, participant_id, amount_cents, payment_method, reference")
    .eq("reference", params.reference.toUpperCase())
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  const row = data as {
    id: string;
    booking_request_id: string;
    participant_id: string | null;
    amount_cents: number;
    payment_method: string | null;
    reference: string | null;
  };
  if (!amountMatchesExpected(params.paymentAmountValue, row.amount_cents)) {
    console.warn("[bunq/webhook] reference matched but amount did not", {
      reference: row.reference,
      expectedAmountCents: row.amount_cents,
      paymentAmountValue: params.paymentAmountValue ?? null,
    });
    return false;
  }
  await db
    .from("voyage_booking_deposits")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payer_alias: params.payerAlias ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending");
  // Notification first, settlement second: settle_voyage_booking_payment merges the resulting
  // booking status into the row queued here, so the payer receives a single email covering both
  // "we received your contribution" and what happened to the application. Its own try/catch:
  // a failed enqueue must never stop the money from actually promoting the booking.
  try {
    await enqueuePaymentReceivedForDeposit(db, row);
  } catch (error) {
    console.error("[bunq/webhook] payment notification enqueue failed", error);
  }
  try {
    await clearBookingPaymentDeadlineIfSettled(db, row.booking_request_id);
  } catch (error) {
    console.error("[bunq/webhook] settling payment failed", error);
  }
  return true;
}

async function enqueuePaymentReceivedForDeposit(
  db: ReturnType<typeof createServiceClient>,
  row: {
    booking_request_id: string;
    participant_id: string | null;
    amount_cents: number;
    payment_method: string | null;
    reference: string | null;
  },
): Promise<void> {
  const [{ data: request }, { data: participant }] = await Promise.all([
    db.from("voyage_booking_requests").select("profile_id").eq("id", row.booking_request_id).maybeSingle(),
    row.participant_id
      ? db.from("voyage_booking_participants").select("profile_id").eq("id", row.participant_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const recipientProfileId =
    (participant as { profile_id?: string | null } | null)?.profile_id ||
    (request as { profile_id?: string | null } | null)?.profile_id;
  if (!recipientProfileId) return;

  await enqueuePaymentReceivedNotifications(db, {
    bookingRequestId: row.booking_request_id,
    recipientProfileId,
    amountEur: row.amount_cents / 100,
    paymentMethod: row.payment_method,
    reference: row.reference,
    phase: paymentPhaseFromReference(row.reference),
  });
}

function extractReference(description: string | undefined): string | null {
  if (!description) return null;
  const match = description.match(REFERENCE_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (!verifyWebhookSecret(req)) {
    sendJson(res, 401, { error: "invalid_webhook_secret" });
    return;
  }

  try {
    const payload = await readJsonBody<BunqNotificationPayload>(req);
    const event = payload.NotificationUrl;
    const eventType = event?.event_type ?? "";
    const object = event?.object ?? {};

    // Request-inquiry / request-response acceptance → match by our stored request id.
    const requestId = object.RequestInquiry?.id ?? object.RequestResponse?.id;
    if (requestId && (eventType.startsWith("REQUEST") || eventType.startsWith("MUTATION"))) {
      const matched = await markPaidByBunqRequestId(requestId);
      if (matched) {
        sendJson(res, 200, { matched: true });
        return;
      }
    }

    // Incoming payment → match by the reference embedded in the description.
    if (object.Payment) {
      let description = object.Payment.description;
      let amountValue = object.Payment.amount?.value;
      let payerAlias = object.Payment.counterparty_alias ?? null;
      // Some events carry only the id; fetch the payment to read its description.
      if ((!description || !amountValue) && object.Payment.id && bunqConfigured()) {
        try {
          const payments = await bunqRequest<Array<{
            Payment: {
              description?: string;
              amount?: { value?: string; currency?: string };
              counterparty_alias?: Record<string, unknown> | null;
            };
          }>>(
            `${accountPath()}/payment/${object.Payment.id}`,
          );
          description = description ?? payments[0]?.Payment?.description;
          amountValue = amountValue ?? payments[0]?.Payment?.amount?.value;
          payerAlias = payerAlias ?? payments[0]?.Payment?.counterparty_alias ?? null;
        } catch (error) {
          console.error("[bunq/webhook] payment fetch failed", error);
        }
      }
      const reference = extractReference(description);
      if (reference) {
        const matched = await markPaidByReference({ reference, paymentAmountValue: amountValue, payerAlias });
        if (matched) {
          sendJson(res, 200, { matched: true });
          return;
        }
      }
    }

    sendJson(res, 200, { matched: false });
  } catch (error) {
    console.error("[bunq/webhook] failed", error);
    // Still answer 200: a 5xx makes Bunq retry a payload we can't process.
    sendJson(res, 200, { matched: false });
  }
}
