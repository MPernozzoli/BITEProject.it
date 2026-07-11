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
import { readJsonBody, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";

const REFERENCE_PATTERN = /\b(?:CON|DEP)-[A-Z0-9]{8}-[A-Z0-9]{4}\b/i;

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

async function markPaidByBunqRequestId(requestId: number): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("voyage_booking_deposits")
    .select("id")
    .eq("environment", environment())
    .eq("bunq_request_id", requestId)
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  await db
    .from("voyage_booking_deposits")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", (data as { id: string }).id)
    .eq("status", "pending");
  return true;
}

async function markPaidByReference(reference: string): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("voyage_booking_deposits")
    .select("id")
    .eq("reference", reference.toUpperCase())
    .eq("status", "pending")
    .maybeSingle();
  if (!data) return false;
  await db
    .from("voyage_booking_deposits")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", (data as { id: string }).id)
    .eq("status", "pending");
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
