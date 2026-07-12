import type { SupabaseClient, User } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { bunqConfigured, environment } from "./client.js";
import {
  createBunqOutgoingPayment,
  findIncomingPaymentDetailsByReference,
  getBunqPaymentRequest,
  isPaidStatus,
  type BunqCounterpartyAlias,
} from "./payment-requests.js";

export type RefundTrigger =
  | "admin_cancelled"
  | "admin_rejected"
  | "user_cancelled"
  | "admin_plan_change_declined";

export type RefundSummary = {
  refundable: boolean;
  policyPercent: number;
  totalRefundCents: number;
  refundedDepositIds: string[];
};

type BookingRefundContext = {
  id: string;
  profile_id: string;
  voyage_id: string;
  status: string;
  plan_change_status?: string | null;
};

type DepositRefundRow = {
  id: string;
  booking_request_id: string;
  participant_id: string | null;
  environment: string;
  payment_method: "bunq_link" | "bank_transfer";
  amount_cents: number;
  status: string;
  bunq_request_id: number | null;
  reference: string;
  payer_alias: BunqCounterpartyAlias | null;
  refund_amount_cents: number | null;
};

const ACTIVE_BOOKING_STATUSES = ["requested", "waitlisted", "admin_approved", "user_confirmed"];

function centsToEur(cents: number): number {
  return Math.round(cents) / 100;
}

function daysUntil(departure: string | null): number | null {
  if (!departure) return null;
  const departureTime = new Date(departure).getTime();
  if (!Number.isFinite(departureTime)) return null;
  return (departureTime - Date.now()) / 86_400_000;
}

async function isAdmin(db: SupabaseClient, user: User): Promise<boolean> {
  const { data, error } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function assertRefundActionAllowed(
  db: SupabaseClient,
  user: User,
  bookingRequestId: string,
  trigger: RefundTrigger,
): Promise<BookingRefundContext> {
  const { data, error } = await db
    .from("voyage_booking_requests")
    .select("id, profile_id, voyage_id, status, plan_change_status")
    .eq("id", bookingRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("booking_not_found"), { status: 404 });

  const booking = data as BookingRefundContext;
  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
    throw Object.assign(new Error("booking_not_active"), { status: 409 });
  }

  if (trigger === "user_cancelled" || trigger === "admin_plan_change_declined") {
    if (booking.profile_id !== user.id) {
      throw Object.assign(new Error("booking_not_found"), { status: 404 });
    }
    if (trigger === "admin_plan_change_declined" && booking.plan_change_status !== "pending_user_approval") {
      throw Object.assign(new Error("plan_change_not_pending"), { status: 409 });
    }
    return booking;
  }

  if (!(await isAdmin(db, user))) {
    throw Object.assign(new Error("admin_required"), { status: 403 });
  }
  return booking;
}

async function departureForBooking(db: SupabaseClient, booking: BookingRefundContext): Promise<string | null> {
  const { data: legRows, error: legError } = await db
    .from("voyage_booking_request_legs")
    .select("voyage_bookable_legs(starts_at_window_start, starts_at_window_end)")
    .eq("booking_request_id", booking.id);
  if (legError) throw new Error(legError.message);

  const legDepartures = (legRows ?? [])
    .map((row) => {
      const leg = (row as { voyage_bookable_legs?: { starts_at_window_start?: string | null; starts_at_window_end?: string | null } | null })
        .voyage_bookable_legs;
      return leg?.starts_at_window_start ?? leg?.starts_at_window_end ?? null;
    })
    .filter((value): value is string => Boolean(value))
    .sort();
  if (legDepartures[0]) return legDepartures[0];

  const { data: voyage, error: voyageError } = await db
    .from("voyages")
    .select("departure_window_start, start_date")
    .eq("id", booking.voyage_id)
    .maybeSingle();
  if (voyageError) throw new Error(voyageError.message);
  const row = voyage as { departure_window_start?: string | null; start_date?: string | null } | null;
  return row?.departure_window_start ?? row?.start_date ?? null;
}

export async function refundPolicyPercent(
  db: SupabaseClient,
  booking: BookingRefundContext,
  trigger: RefundTrigger,
): Promise<number> {
  if (trigger === "admin_cancelled" || trigger === "admin_rejected" || trigger === "admin_plan_change_declined") {
    return 100;
  }

  const days = daysUntil(await departureForBooking(db, booking));
  if (days === null) return 0;
  if (days > 30) return 100;
  if (days >= 15) return 50;
  return 0;
}

async function resolvePayerAlias(db: SupabaseClient, deposit: DepositRefundRow): Promise<BunqCounterpartyAlias | null> {
  if (deposit.payer_alias) return deposit.payer_alias;

  if (deposit.payment_method === "bunq_link" && deposit.bunq_request_id && bunqConfigured()) {
    const request = await getBunqPaymentRequest(deposit.bunq_request_id);
    if (!isPaidStatus(request.status)) return null;
    if (request.counterpartyAlias) {
      await db.from("voyage_booking_deposits").update({ payer_alias: request.counterpartyAlias }).eq("id", deposit.id);
    }
    return request.counterpartyAlias;
  }

  if (deposit.payment_method === "bank_transfer" && bunqConfigured()) {
    const payment = await findIncomingPaymentDetailsByReference(deposit.reference, deposit.amount_cents / 100);
    if (payment?.counterpartyAlias) {
      await db.from("voyage_booking_deposits").update({ payer_alias: payment.counterpartyAlias }).eq("id", deposit.id);
    }
    return payment?.counterpartyAlias ?? null;
  }

  return null;
}

export async function refundBookingDeposits(
  db: SupabaseClient,
  booking: BookingRefundContext,
  trigger: RefundTrigger,
): Promise<RefundSummary> {
  const policyPercent = await refundPolicyPercent(db, booking, trigger);
  if (policyPercent <= 0) {
    return { refundable: false, policyPercent, totalRefundCents: 0, refundedDepositIds: [] };
  }
  if (!bunqConfigured()) {
    throw Object.assign(new Error("bunq_not_configured"), { status: 503 });
  }

  const { data, error } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id, participant_id, environment, payment_method, amount_cents, status, bunq_request_id, reference, payer_alias, refund_amount_cents")
    .eq("booking_request_id", booking.id)
    .eq("environment", environment())
    .eq("status", "paid");
  if (error) throw new Error(error.message);

  const deposits = (data ?? []) as DepositRefundRow[];
  const refundedDepositIds: string[] = [];
  let totalRefundCents = 0;

  for (const deposit of deposits) {
    const alreadyRefundedCents = Math.max(0, Number(deposit.refund_amount_cents ?? 0) || 0);
    const targetRefundCents = Math.round((deposit.amount_cents * policyPercent) / 100);
    const refundCents = Math.max(0, Math.min(deposit.amount_cents - alreadyRefundedCents, targetRefundCents - alreadyRefundedCents));
    if (refundCents <= 0) continue;

    const payerAlias = await resolvePayerAlias(db, deposit);
    if (!payerAlias) {
      throw Object.assign(new Error("refund_counterparty_missing"), { status: 409 });
    }

    const reference = `REF-${booking.id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const payment = await createBunqOutgoingPayment({
      amountEur: centsToEur(refundCents),
      counterpartyAlias: payerAlias,
      description: `Rimborso BITE ${reference}`,
    });

    const nextRefundedCents = alreadyRefundedCents + refundCents;
    const { error: updateError } = await db
      .from("voyage_booking_deposits")
      .update({
        status: nextRefundedCents >= deposit.amount_cents ? "refunded" : "partially_refunded",
        refunded_at: new Date().toISOString(),
        refund_amount_cents: nextRefundedCents,
        refund_policy: trigger,
        refund_reference: reference,
        refund_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deposit.id);
    if (updateError) throw new Error(updateError.message);

    refundedDepositIds.push(deposit.id);
    totalRefundCents += refundCents;
  }

  return {
    refundable: totalRefundCents > 0,
    policyPercent,
    totalRefundCents,
    refundedDepositIds,
  };
}

export async function markBookingCancelledAfterRefund(
  db: SupabaseClient,
  booking: BookingRefundContext,
  eventType: "cancelled" | "rejected",
  metadata: Record<string, unknown>,
): Promise<void> {
  const { data: links, error: linksError } = await db
    .from("voyage_booking_request_legs")
    .select("bookable_leg_id")
    .eq("booking_request_id", booking.id);
  if (linksError) throw new Error(linksError.message);
  const legIds = (links ?? []).map((row) => (row as { bookable_leg_id: string }).bookable_leg_id);

  const patch =
    eventType === "cancelled"
      ? { status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: "rejected", updated_at: new Date().toISOString() };
  const { error: updateError } = await db.from("voyage_booking_requests").update(patch).eq("id", booking.id);
  if (updateError) throw new Error(updateError.message);

  await db.rpc("enqueue_voyage_booking_notification", {
    _booking_request_id: booking.id,
    _event_type: eventType,
    _metadata: metadata,
  });

  if (booking.status !== "waitlisted") {
    await db.rpc("promote_waitlisted_voyage_bookings", {
      _voyage_id: booking.voyage_id,
      _changed_leg_ids: legIds,
    });
  }
}
