/**
 * POST /api/payments/bunq/request
 *
 * Creates a Bunq security-deposit ("caparra") payment request. The payer is either:
 *   - the lead (booking owner): pays deposit × party_size when payment_mode = lead_pays_all,
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
import { createAuthClient, createServiceClient } from "../../../src/server/bunq/supabase";
import { bunqConfigured, environment } from "../../../src/server/bunq/client";
import { createBunqPaymentRequest } from "../../../src/server/bunq/payment-requests";
import {
  perPersonDepositEur,
  depositForPayerEur,
  type DepositLeg,
  type PaymentMode,
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

type ParticipantRow = {
  id: string;
  booking_request_id: string;
  profile_id: string | null;
  email: string;
  is_lead: boolean;
  status: string;
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
    // 1. Resolve the caller.
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }
    const user = userData.user;
    const userEmail = (user.email ?? "").toLowerCase();

    const db = createServiceClient();

    // 2. Load the booking request.
    const { data: request, error: requestError } = await db
      .from("voyage_booking_requests")
      .select("id, profile_id, party_size, status, payment_mode")
      .eq("id", bookingRequestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) {
      sendJson(res, 404, { error: "booking_not_found" });
      return;
    }
    const bookingOwnerId = (request as { profile_id: string }).profile_id;
    const bookingStatus = (request as { status: string }).status;
    const partySize = Math.max(1, Number((request as { party_size: number }).party_size) || 1);
    const paymentMode = ((request as { payment_mode?: string }).payment_mode ?? "lead_pays_all") as PaymentMode;
    if (!ACTIVE_STATUSES.includes(bookingStatus)) {
      sendJson(res, 409, { error: "booking_not_active", status: bookingStatus });
      return;
    }

    // 3. Resolve the payer (lead or guest) and authorize.
    let payer: ParticipantRow | null = null;
    if (participantId) {
      const { data: p } = await db
        .from("voyage_booking_participants")
        .select("id, booking_request_id, profile_id, email, is_lead, status")
        .eq("id", participantId)
        .maybeSingle();
      payer = (p as ParticipantRow | null) ?? null;
      if (!payer || payer.booking_request_id !== bookingRequestId) {
        sendJson(res, 404, { error: "participant_not_found" });
        return;
      }
      const matchesCaller =
        payer.profile_id === user.id || payer.email.toLowerCase() === userEmail;
      if (!matchesCaller) {
        sendJson(res, 403, { error: "not_your_participation" });
        return;
      }
      // A guest must have accepted the conditions before paying.
      if (!payer.is_lead && payer.status !== "accepted") {
        sendJson(res, 409, { error: "participation_not_accepted" });
        return;
      }
    } else {
      // Lead flow: the caller must own the booking.
      if (bookingOwnerId !== user.id) {
        sendJson(res, 404, { error: "booking_not_found" });
        return;
      }
      const { data: lead } = await db
        .from("voyage_booking_participants")
        .select("id, booking_request_id, profile_id, email, is_lead, status")
        .eq("booking_request_id", bookingRequestId)
        .eq("is_lead", true)
        .maybeSingle();
      payer = (lead as ParticipantRow | null) ?? null; // null for solo (pax=1) bookings
    }

    const isLead = payer?.is_lead ?? true;
    const payerParticipantId = payer?.id ?? null;

    // 4. Idempotency: reuse an existing deposit for this exact payer.
    let existingQuery = db
      .from("voyage_booking_deposits")
      .select("id, status, share_url, amount_cents, per_person_cents")
      .eq("booking_request_id", bookingRequestId)
      .in("status", ["pending", "paid"]);
    existingQuery = payerParticipantId
      ? existingQuery.eq("participant_id", payerParticipantId)
      : existingQuery.is("participant_id", null);
    const { data: existing } = await existingQuery
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

    // 5. Recompute the authoritative amount from the leg complexity.
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
    const amountEur = depositForPayerEur(legs, { isLead, paymentMode, partySize });
    if (amountEur <= 0) {
      sendJson(res, 409, { error: "zero_deposit" });
      return;
    }
    // The number of persons this single deposit covers (for the stored party_size).
    const coveredPersons = isLead && paymentMode === "lead_pays_all" ? partySize : 1;

    // 6. Create the Bunq payment request.
    const reference = `DEP-${bookingRequestId.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const description = `Deposito cauzionale viaggio BITE — ${reference}`;
    const counterpartyEmail = user.email;
    if (!counterpartyEmail) {
      sendJson(res, 409, { error: "missing_user_email" });
      return;
    }

    const created = await createBunqPaymentRequest({
      amountEur,
      description,
      counterpartyEmail,
      redirectUrl: `${siteUrl()}/bookings?deposit=processing`,
    });

    // 7. Persist the deposit row.
    const { error: insertError } = await db.from("voyage_booking_deposits").insert({
      booking_request_id: bookingRequestId,
      participant_id: payerParticipantId,
      environment: environment(),
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

    sendJson(res, 200, {
      shareUrl: created.shareUrl,
      amountEur,
      perPersonEur,
      partySize: coveredPersons,
      reference,
    });
  } catch (error) {
    console.error("[bunq/request] failed", error);
    sendJson(res, 500, { error: "bunq_request_failed" });
  }
}
