/**
 * GET /api/payments/bunq/status?bookingRequestId=...
 *
 * Returns the payment status for a booking the caller owns. When the stored status is
 * still "pending", it re-checks the live Bunq request-inquiry and settles it if the payer
 * has paid — so the flow works even without webhooks configured.
 *
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { createAuthClient, createServiceClient } from "../../../src/server/bunq/supabase.js";
import { bunqConfigured } from "../../../src/server/bunq/client.js";
import { getBunqPaymentRequest, isPaidStatus } from "../../../src/server/bunq/payment-requests.js";
import {
  bearerToken,
  firstQueryParam,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http.js";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  const bookingRequestId = (firstQueryParam(req, "bookingRequestId") ?? "").trim();
  const participantId = (firstQueryParam(req, "participantId") ?? "").trim();
  if (!bookingRequestId) {
    sendJson(res, 400, { error: "missing_booking_request_id" });
    return;
  }

  try {
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }
    const user = userData.user;

    const db = createServiceClient();
    const userEmail = (user.email ?? "").toLowerCase();

    // Authorize: the booking owner, or the guest whose participation this is.
    const { data: request } = await db
      .from("voyage_booking_requests")
      .select("id, profile_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (!request) {
      sendJson(res, 404, { error: "booking_not_found" });
      return;
    }
    const isOwner = (request as { profile_id: string }).profile_id === user.id;

    if (participantId) {
      const { data: p } = await db
        .from("voyage_booking_participants")
        .select("id, booking_request_id, profile_id, email")
        .eq("id", participantId)
        .maybeSingle();
      const part = p as { booking_request_id: string; profile_id: string | null; email: string } | null;
      const matches =
        part &&
        part.booking_request_id === bookingRequestId &&
        (part.profile_id === user.id || part.email.toLowerCase() === userEmail);
      if (!isOwner && !matches) {
        sendJson(res, 404, { error: "booking_not_found" });
        return;
      }
    } else if (!isOwner) {
      sendJson(res, 404, { error: "booking_not_found" });
      return;
    }

    let depositQuery = db
      .from("voyage_booking_deposits")
      .select("id, status, amount_cents, bunq_request_id")
      .eq("booking_request_id", bookingRequestId);
    if (participantId) depositQuery = depositQuery.eq("participant_id", participantId);
    const { data: deposit } = await depositQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!deposit) {
      sendJson(res, 200, { status: "none" });
      return;
    }

    const row = deposit as {
      id: string;
      status: string;
      amount_cents: number;
      bunq_request_id: number | null;
    };

    // If still pending, ask Bunq whether the payer has settled it.
    if (row.status === "pending" && row.bunq_request_id && bunqConfigured()) {
      try {
        const live = await getBunqPaymentRequest(row.bunq_request_id);
        if (isPaidStatus(live.status)) {
          await db
            .from("voyage_booking_deposits")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .eq("status", "pending");
          sendJson(res, 200, { status: "paid", amountEur: row.amount_cents / 100 });
          return;
        }
      } catch (error) {
        console.error("[bunq/status] live check failed", error);
      }
    }

    sendJson(res, 200, { status: row.status, amountEur: row.amount_cents / 100 });
  } catch (error) {
    console.error("[bunq/status] failed", error);
    sendJson(res, 500, { error: "status_failed" });
  }
}
