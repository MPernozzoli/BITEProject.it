/**
 * POST /api/payments/bunq/request
 *
 * Creates a Bunq security-deposit ("caparra") payment request for a booking the caller
 * owns. The amount is recomputed server-side from the leg complexity (never trusted from
 * the client). Returns the shareable bunq.me link the user is redirected to.
 *
 * Body: { bookingRequestId: string }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { randomUUID } from "node:crypto";
import { createAuthClient, createServiceClient } from "../../../src/server/bunq/supabase";
import { bunqConfigured, environment } from "../../../src/server/bunq/client";
import { createBunqPaymentRequest } from "../../../src/server/bunq/payment-requests";
import {
  perPersonDepositEur,
  totalDepositEur,
  type DepositLeg,
} from "../../../src/lib/booking-deposit";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../src/server/http";

const ACTIVE_STATUSES = ["requested", "waitlisted", "admin_approved", "user_confirmed"];

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
  try {
    const body = await readJsonBody<{ bookingRequestId?: string }>(req);
    bookingRequestId = String(body.bookingRequestId ?? "").trim();
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
    // 1. Resolve the caller.
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }
    const user = userData.user;

    const db = createServiceClient();

    // 2. Load the booking request and verify ownership + state.
    const { data: request, error: requestError } = await db
      .from("voyage_booking_requests")
      .select("id, profile_id, party_size, status, voyage_id")
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request || (request as { profile_id: string }).profile_id !== user.id) {
      sendJson(res, 404, { error: "booking_not_found" });
      return;
    }
    const bookingStatus = (request as { status: string }).status;
    if (!ACTIVE_STATUSES.includes(bookingStatus)) {
      sendJson(res, 409, { error: "booking_not_active", status: bookingStatus });
      return;
    }
    const partySize = Math.max(1, Number((request as { party_size: number }).party_size) || 1);

    // 3. Idempotency: reuse an existing deposit for this booking.
    const { data: existing } = await db
      .from("voyage_booking_deposits")
      .select("id, status, share_url, amount_cents, per_person_cents")
      .eq("booking_request_id", bookingRequestId)
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const row = existing as {
        status: string;
        share_url: string | null;
        amount_cents: number;
        per_person_cents: number;
      };
      if (row.status === "paid") {
        sendJson(res, 200, { alreadyPaid: true });
        return;
      }
      if (row.status === "pending" && row.share_url) {
        sendJson(res, 200, {
          shareUrl: row.share_url,
          amountEur: row.amount_cents / 100,
          perPersonEur: row.per_person_cents / 100,
          partySize,
        });
        return;
      }
    }

    // 4. Recompute the authoritative amount from the leg complexity.
    const { data: legLinks, error: legLinkError } = await db
      .from("voyage_booking_request_legs")
      .select("bookable_leg_id")
      .eq("booking_request_id", bookingRequestId);
    if (legLinkError) throw new Error(legLinkError.message);
    const legIds = (legLinks ?? []).map((l) => (l as { bookable_leg_id: string }).bookable_leg_id);
    if (legIds.length === 0) {
      sendJson(res, 409, { error: "booking_has_no_legs" });
      return;
    }

    const { data: legRows, error: legError } = await db
      .from("voyage_bookable_legs")
      .select(
        "open_sea, complexity_override, danger_level, starts_at_window_start, starts_at_window_end, ends_at_window_start, ends_at_window_end",
      )
      .in("id", legIds);
    if (legError) throw new Error(legError.message);
    const legs = (legRows ?? []) as DepositLeg[];

    const perPersonEur = perPersonDepositEur(legs);
    const totalEur = totalDepositEur(legs, partySize);
    if (totalEur <= 0) {
      sendJson(res, 409, { error: "zero_deposit" });
      return;
    }

    // 5. Create the Bunq payment request.
    const reference = `DEP-${bookingRequestId.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const description = `Deposito cauzionale viaggio BITE — ${reference}`;
    const counterpartyEmail = user.email;
    if (!counterpartyEmail) {
      sendJson(res, 409, { error: "missing_user_email" });
      return;
    }

    const created = await createBunqPaymentRequest({
      amountEur: totalEur,
      description,
      counterpartyEmail,
      redirectUrl: `${siteUrl()}/bookings?deposit=processing`,
    });

    // 6. Persist the deposit row.
    const { error: insertError } = await db.from("voyage_booking_deposits").insert({
      booking_request_id: bookingRequestId,
      environment: environment(),
      per_person_cents: Math.round(perPersonEur * 100),
      party_size: partySize,
      amount_cents: Math.round(totalEur * 100),
      currency: "EUR",
      status: "pending",
      bunq_request_id: created.id,
      share_url: created.shareUrl,
      reference,
    });
    if (insertError) throw new Error(insertError.message);

    sendJson(res, 200, {
      shareUrl: created.shareUrl,
      amountEur: totalEur,
      perPersonEur,
      partySize,
      reference,
    });
  } catch (error) {
    console.error("[bunq/request] failed", error);
    sendJson(res, 500, { error: "bunq_request_failed" });
  }
}
