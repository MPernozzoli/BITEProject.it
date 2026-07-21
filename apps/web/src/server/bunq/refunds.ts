import type { SupabaseClient, User } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { bunqConfigured, environment } from "./client.js";
import { isValidBic, isValidIban, normalizeBic, normalizeIban } from "../../lib/iban.js";
import {
  createBunqOutgoingPayment,
  findIncomingPaymentDetailsByReference,
  getBunqPaymentRequest,
  isPaidStatus,
  isRefundableAlias,
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
  /** True when at least one deposit is owed a refund we could not route automatically. */
  refundPending: boolean;
  /** Total amount still owed manually because no IBAN / Bunq account was found. */
  pendingRefundCents: number;
  pendingDepositIds: string[];
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

/**
 * True when a refund cannot be delivered because we have no routable destination:
 * the payer is not a Bunq user and we hold no IBAN, so Bunq answers "No monetary
 * account found for alias ...". These must not block the rejection/cancellation —
 * we settle them manually once the traveller replies with an IBAN. Genuine failures
 * (auth, network, insufficient balance) still propagate.
 */
function isUnroutableRefundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "bunq_counterparty_alias_not_refundable") return true;
  return /no monetary account found for alias/i.test(error.message);
}

async function markDepositRefundPending(
  db: SupabaseClient,
  deposit: DepositRefundRow,
  trigger: RefundTrigger,
  pendingCents: number,
  reason: string,
): Promise<void> {
  await db
    .from("voyage_booking_deposits")
    .update({
      refund_pending: true,
      refund_pending_amount_cents: pendingCents,
      refund_pending_reason: reason,
      refund_policy: trigger,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id);
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
  // A stored alias is only trustworthy if it can actually receive a payment.
  if (isRefundableAlias(deposit.payer_alias)) return deposit.payer_alias;
  if (!bunqConfigured()) return null;

  let alias: BunqCounterpartyAlias | null = null;

  // For bunq_link the request-inquiry's counterparty alias is the address the request was
  // *sent to* and frequently lacks the payer's IBAN, so only use it when it is refundable.
  if (deposit.payment_method === "bunq_link" && deposit.bunq_request_id) {
    const request = await getBunqPaymentRequest(deposit.bunq_request_id);
    if (!isPaidStatus(request.status)) return null;
    if (isRefundableAlias(request.counterpartyAlias)) alias = request.counterpartyAlias;
  }

  // Fallback (and primary path for bank_transfer): recover the payer's real bank details from
  // the actual incoming payment, matched by the deposit reference — that payment carries the
  // payer IBAN, so it is refundable.
  if (!alias) {
    const payment = await findIncomingPaymentDetailsByReference(deposit.reference, deposit.amount_cents / 100);
    if (payment && isRefundableAlias(payment.counterpartyAlias)) alias = payment.counterpartyAlias;
  }

  if (alias) {
    await db.from("voyage_booking_deposits").update({ payer_alias: alias }).eq("id", deposit.id);
  }
  return alias;
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
  const pendingDepositIds: string[] = [];
  let totalRefundCents = 0;
  let pendingRefundCents = 0;

  for (const deposit of deposits) {
    const alreadyRefundedCents = Math.max(0, Number(deposit.refund_amount_cents ?? 0) || 0);
    const targetRefundCents = Math.round((deposit.amount_cents * policyPercent) / 100);
    const refundCents = Math.max(0, Math.min(deposit.amount_cents - alreadyRefundedCents, targetRefundCents - alreadyRefundedCents));
    if (refundCents <= 0) continue;

    const payerAlias = await resolvePayerAlias(db, deposit);
    if (!payerAlias) {
      // No routable destination: don't block the decision — flag it for a manual
      // refund and let the traveller send an IBAN via the notification email.
      await markDepositRefundPending(db, deposit, trigger, refundCents, "no_payer_alias");
      pendingDepositIds.push(deposit.id);
      pendingRefundCents += refundCents;
      continue;
    }

    const reference = `REF-${booking.id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    let payment: { id: number };
    try {
      payment = await createBunqOutgoingPayment({
        amountEur: centsToEur(refundCents),
        counterpartyAlias: payerAlias,
        description: `Rimborso BITE ${reference}`,
      });
    } catch (error) {
      if (isUnroutableRefundError(error)) {
        await markDepositRefundPending(db, deposit, trigger, refundCents, "no_monetary_account");
        pendingDepositIds.push(deposit.id);
        pendingRefundCents += refundCents;
        continue;
      }
      throw error;
    }

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
        refund_pending: false,
        refund_pending_amount_cents: 0,
        refund_pending_reason: null,
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
    refundPending: pendingRefundCents > 0,
    pendingRefundCents,
    pendingDepositIds,
  };
}

type ManualRefundInput = {
  depositId: string;
  accountHolder: string;
  iban: string;
  bic?: string | null;
};

export type ManualRefundResult = {
  amountEur: number;
  reference: string;
};

type PendingDepositRow = {
  id: string;
  booking_request_id: string;
  environment: string;
  amount_cents: number;
  refund_amount_cents: number | null;
  refund_pending_amount_cents: number | null;
  reference: string;
};

/**
 * Self-service refund: the traveller supplies the IBAN we could not resolve automatically,
 * and we pay the amount WE already decided (never trusted from the client). The pending flag
 * is claimed optimistically before touching Bunq so a double submit cannot pay twice; a Bunq
 * failure re-arms the flag and surfaces a readable error the traveller can act on.
 */
export async function submitManualRefund(
  db: SupabaseClient,
  user: User,
  input: ManualRefundInput,
): Promise<ManualRefundResult> {
  if (!bunqConfigured()) {
    throw Object.assign(new Error("bunq_not_configured"), { status: 503 });
  }

  const holder = input.accountHolder.trim();
  const iban = normalizeIban(input.iban);
  const bic = input.bic ? normalizeBic(input.bic) : "";
  if (!holder) throw Object.assign(new Error("account_holder_required"), { status: 400 });
  if (!isValidIban(iban)) throw Object.assign(new Error("invalid_iban"), { status: 400 });
  if (!isValidBic(bic)) throw Object.assign(new Error("invalid_bic"), { status: 400 });

  // Ownership: the deposit must hang off a booking request owned by the caller.
  const { data: depositRow, error: depositError } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id, environment, amount_cents, refund_amount_cents, refund_pending_amount_cents, reference")
    .eq("id", input.depositId)
    .eq("refund_pending", true)
    .maybeSingle();
  if (depositError) throw new Error(depositError.message);
  const deposit = depositRow as PendingDepositRow | null;
  if (!deposit) throw Object.assign(new Error("refund_not_found"), { status: 404 });
  if (deposit.environment !== environment()) {
    throw Object.assign(new Error("refund_environment_mismatch"), { status: 409 });
  }

  const { data: booking, error: bookingError } = await db
    .from("voyage_booking_requests")
    .select("profile_id")
    .eq("id", deposit.booking_request_id)
    .maybeSingle();
  if (bookingError) throw new Error(bookingError.message);
  if (!booking || (booking as { profile_id: string }).profile_id !== user.id) {
    throw Object.assign(new Error("refund_not_found"), { status: 404 });
  }

  const alreadyRefundedCents = Math.max(0, Number(deposit.refund_amount_cents ?? 0) || 0);
  const owedCents = Math.max(0, Number(deposit.refund_pending_amount_cents ?? 0) || 0);
  const refundCents = Math.min(owedCents, Math.max(0, deposit.amount_cents - alreadyRefundedCents));
  if (refundCents <= 0) throw Object.assign(new Error("nothing_to_refund"), { status: 409 });

  // Claim the pending refund so a concurrent submit cannot also reach Bunq.
  const { data: claimed, error: claimError } = await db
    .from("voyage_booking_deposits")
    .update({ refund_pending: false, updated_at: new Date().toISOString() })
    .eq("id", deposit.id)
    .eq("refund_pending", true)
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw Object.assign(new Error("refund_already_processing"), { status: 409 });

  const reference = `REF-${deposit.booking_request_id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
  const payerAlias: BunqCounterpartyAlias = { iban, name: holder, display_name: holder };

  let payment: { id: number };
  try {
    payment = await createBunqOutgoingPayment({
      amountEur: centsToEur(refundCents),
      counterpartyAlias: payerAlias,
      description: `Rimborso BITE ${reference}`,
    });
  } catch (error) {
    // Re-arm the pending flag so the traveller can correct the details and retry.
    await db
      .from("voyage_booking_deposits")
      .update({ refund_pending: true, updated_at: new Date().toISOString() })
      .eq("id", deposit.id);
    const message = error instanceof Error ? error.message : "bunq_refund_failed";
    throw Object.assign(new Error(message), { status: 422, refundRejected: true });
  }

  const nextRefundedCents = alreadyRefundedCents + refundCents;
  const { error: finalizeError } = await db
    .from("voyage_booking_deposits")
    .update({
      status: nextRefundedCents >= deposit.amount_cents ? "refunded" : "partially_refunded",
      refunded_at: new Date().toISOString(),
      refund_amount_cents: nextRefundedCents,
      refund_reference: reference,
      refund_payment_id: payment.id,
      payer_alias: { ...payerAlias, bic: bic || undefined },
      refund_pending: false,
      refund_pending_amount_cents: 0,
      refund_pending_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id);
  if (finalizeError) throw new Error(finalizeError.message);

  return { amountEur: centsToEur(refundCents), reference };
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
