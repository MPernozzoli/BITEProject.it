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
import { clearBookingPaymentDeadlineIfSettled } from "../../../src/server/bunq/deposit-resolver.js";
import { firstQueryParam, readJsonBody, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import { timingSafeEqual } from "node:crypto";

const REFERENCE_PATTERN = /\b(?:CON|DEP|BON)-[A-Z0-9]{8}-[A-Z0-9]{4}\b/i;

type BunqNotificationPayload = {
  NotificationUrl?: {
    event_type?: string;
    object?: {
      Payment?: { id?: number; description?: string };
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
    .select("id, booking_request_id")
    .eq("environment", environment())
    .eq("bunq_request_id", requestId)
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  const row = data as { id: string; booking_request_id: string };
  await db
    .from("voyage_booking_deposits")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  try {
    await clearBookingPaymentDeadlineIfSettled(db, row.booking_request_id);
  } catch (error) {
    console.error("[bunq/webhook] clearing payment deadline failed", error);
  }
  return true;
}

async function markPaidByReference(reference: string): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id")
    .eq("reference", reference.toUpperCase())
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  const row = data as { id: string; booking_request_id: string };
  await db
    .from("voyage_booking_deposits")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  try {
    await clearBookingPaymentDeadlineIfSettled(db, row.booking_request_id);
  } catch (error) {
    console.error("[bunq/webhook] clearing payment deadline failed", error);
  }
  return true;
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
      // Some events carry only the id; fetch the payment to read its description.
      if (!description && object.Payment.id && bunqConfigured()) {
        try {
          const payments = await bunqRequest<Array<{ Payment: { description: string } }>>(
            `${accountPath()}/payment/${object.Payment.id}`,
          );
          description = payments[0]?.Payment?.description;
        } catch (error) {
          console.error("[bunq/webhook] payment fetch failed", error);
        }
      }
      const reference = extractReference(description);
      if (reference) {
        const matched = await markPaidByReference(reference);
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
