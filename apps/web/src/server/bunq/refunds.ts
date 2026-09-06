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
  | "admin_plan_change_declined"
  /** The balance-deadline sweep forfeited the deposit — 0% by default, admin-overridable upward. */
  | "balance_deadline_missed"
  /** The candidate rejected the admin's contribution/workaway counter-proposal — a failed
   * negotiation before any seat was ever held, not a late withdrawal, so it always refunds
   * in full regardless of the withdrawal-window tiers. */
  | "user_rejected_contribution_counter";

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
  contribution_proposal_status?: string | null;
};

export type DepositRefundRow = {
  id: string;
  booking_request_id: string;
  participant_id: string | null;
  environment: string;
  // 'manual' rows were vouched for by an admin, not observed by the bank integration: they carry
  // no bunq_request_id and often no matchable reference, so resolvePayerAlias falls through to the
  // refund_pending branch for them. That is the intended outcome, not a gap.
  payment_method: "bunq_link" | "bank_transfer" | "manual";
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

/**
 * Splits payout failures into the only two things that matter to the traveller:
 * "your bank details are wrong, fix them" versus "our side could not pay right now".
 * Anything we do not positively recognise as a bad destination is treated as ours —
 * we never dump a technical Bunq message on the traveller, and nothing is lost because
 * the deposit stays queued for an admin retry.
 */
function isBadDestinationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "bunq_counterparty_alias_not_refundable") return true;
  return /no monetary account found for alias|invalid iban|iban is invalid|invalid counterparty|account does not exist/i.test(
    error.message,
  );
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
      // "Needs IBAN", not "needs a retry" — the traveller has not given us details yet.
      refund_payout_queued: false,
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
    .select("id, profile_id, voyage_id, status, plan_change_status, contribution_proposal_status")
    .eq("id", bookingRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("booking_not_found"), { status: 404 });

  const booking = data as BookingRefundContext;
  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
    throw Object.assign(new Error("booking_not_active"), { status: 409 });
  }

  if (
    trigger === "user_cancelled" ||
    trigger === "admin_plan_change_declined" ||
    trigger === "user_rejected_contribution_counter"
  ) {
    if (booking.profile_id !== user.id) {
      throw Object.assign(new Error("booking_not_found"), { status: 404 });
    }
    if (trigger === "admin_plan_change_declined" && booking.plan_change_status !== "pending_user_approval") {
      throw Object.assign(new Error("plan_change_not_pending"), { status: 409 });
    }
    if (
      trigger === "user_rejected_contribution_counter" &&
      booking.contribution_proposal_status !== "pending_user_approval"
    ) {
      throw Object.assign(new Error("contribution_counter_not_pending"), { status: 409 });
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

/** Tiers published in the Terms: refund shrinks as departure approaches. */
async function withdrawalPercent(db: SupabaseClient, booking: BookingRefundContext): Promise<number> {
  const days = daysUntil(await departureForBooking(db, booking));
  if (days === null) return 0;
  if (days > 30) return 100;
  if (days >= 15) return 50;
  return 0;
}

/**
 * True when the plan change the traveller is declining was proposed for a force-majeure reason
 * (weather, safety, ...). Stored by `admin_propose_voyage_booking_legs`; absent on changes created
 * before that column existed, which we deliberately treat as NOT force majeure so an unknown
 * reason never silently reduces someone's refund.
 */
async function declinedChangeWasForceMajeure(
  db: SupabaseClient,
  booking: BookingRefundContext,
): Promise<boolean> {
  // Scoped to the change actually awaiting the traveller's answer — a proposal they started
  // themselves sits in 'pending_admin_approval' and must not be read here. The row is still
  // pending at this point: status.ts only marks it cancelled after the refund is computed.
  const { data, error } = await db
    .from("voyage_booking_plan_changes")
    .select("metadata")
    .eq("booking_request_id", booking.id)
    .eq("status", "pending_user_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const metadata = (data as { metadata?: Record<string, unknown> } | null)?.metadata;
  return metadata?.force_majeure === true;
}

export async function refundPolicyPercent(
  db: SupabaseClient,
  booking: BookingRefundContext,
  trigger: RefundTrigger,
): Promise<number> {
  // We cancelled or rejected: the traveller keeps none of the risk, so always refund in full.
  // A rejected counter-proposal is the same shape — the negotiation failed before any seat was
  // ever held, so the withdrawal tiers (meant for someone backing out of a confirmed place) do
  // not apply.
  if (
    trigger === "admin_cancelled" ||
    trigger === "admin_rejected" ||
    trigger === "user_rejected_contribution_counter"
  ) {
    return 100;
  }

  // A declined plan change refunds in full when the change was on us (organisational), but follows
  // the withdrawal tiers when it was forced on us by weather, safety, or similar.
  if (trigger === "admin_plan_change_declined") {
    if (!(await declinedChangeWasForceMajeure(db, booking))) return 100;
    return await withdrawalPercent(db, booking);
  }

  // The deposit was forfeited for missing the balance deadline — that is the whole point of the
  // deadline, so the traveller keeps none of it by default. An admin can still raise this via
  // resolveRefundPercent's override.
  if (trigger === "balance_deadline_missed") {
    return 0;
  }

  return withdrawalPercent(db, booking);
}

/**
 * The percentage actually refunded: the policy result, raised to `overridePercent` when an admin
 * chose to be more generous. An override below policy is ignored rather than rejected, so a stale
 * or malformed value can never pay out less than the Terms promise.
 */
export async function resolveRefundPercent(
  db: SupabaseClient,
  booking: BookingRefundContext,
  trigger: RefundTrigger,
  overridePercent?: number | null,
): Promise<number> {
  const policyPercent = await refundPolicyPercent(db, booking, trigger);
  if (overridePercent === null || overridePercent === undefined) return policyPercent;
  if (!Number.isFinite(overridePercent)) return policyPercent;
  return Math.max(policyPercent, Math.min(100, Math.round(overridePercent)));
}

export async function resolvePayerAlias(db: SupabaseClient, deposit: DepositRefundRow): Promise<BunqCounterpartyAlias | null> {
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
  /**
   * Lets an admin be more generous than the policy in a specific case (e.g. refunding in full a
   * force-majeure change declined inside 15 days). It can only raise the percentage: lowering what
   * the published Terms promise is never allowed from the UI.
   */
  overridePercent?: number | null,
): Promise<RefundSummary> {
  const policyPercent = await resolveRefundPercent(db, booking, trigger, overridePercent);
  if (policyPercent <= 0) {
    // Nothing is owed at all, so nothing can be pending either.
    return {
      refundable: false,
      policyPercent,
      totalRefundCents: 0,
      refundedDepositIds: [],
      refundPending: false,
      pendingRefundCents: 0,
      pendingDepositIds: [],
    };
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

export type LateCancelledDepositOutcome = {
  refunded: boolean;
  pending: boolean;
  amountCents: number;
};

/**
 * Refunds a payment that landed on a deposit we had already cancelled and given up on — the
 * contribution-settlement 24h deadline passed, or (legacy path) the traveller paid late and we
 * chose not to reactivate. Unlike {@link refundBookingDeposits} this never touches the booking
 * itself: the booking is not coming back, only the money that arrived for it is going back.
 *
 * `actualAmountCents` is Bunq's own confirmed figure (amountRespondedValue for a bunq_link,
 * the matched incoming payment for a bank transfer) — never the amount we originally requested,
 * which the payer may not have matched exactly.
 */
export async function refundLateCancelledDeposit(
  db: SupabaseClient,
  deposit: DepositRefundRow,
  actualAmountCents: number,
  reason: string,
): Promise<LateCancelledDepositOutcome> {
  const payerAlias = await resolvePayerAlias(db, { ...deposit, amount_cents: actualAmountCents });
  const nowIso = new Date().toISOString();

  if (!payerAlias) {
    await db
      .from("voyage_booking_deposits")
      .update({
        status: "paid",
        paid_at: nowIso,
        amount_cents: actualAmountCents,
        refund_pending: true,
        refund_pending_amount_cents: actualAmountCents,
        refund_pending_reason: reason,
        refund_policy: "contribution_settlement_deadline_missed",
        expiry_kind: "contribution_settlement",
        bunq_request_closed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", deposit.id);
    return { refunded: false, pending: true, amountCents: actualAmountCents };
  }

  const reference = `LATE-${deposit.booking_request_id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
  let payment: { id: number };
  try {
    payment = await createBunqOutgoingPayment({
      amountEur: centsToEur(actualAmountCents),
      counterpartyAlias: payerAlias,
      description: `Rimborso BITE (scadenza superata) ${reference}`,
    });
  } catch (error) {
    if (isUnroutableRefundError(error)) {
      await db
        .from("voyage_booking_deposits")
        .update({
          status: "paid",
          paid_at: nowIso,
          amount_cents: actualAmountCents,
          refund_pending: true,
          refund_pending_amount_cents: actualAmountCents,
          refund_pending_reason: "no_monetary_account",
          refund_policy: "contribution_settlement_deadline_missed",
          expiry_kind: "contribution_settlement",
          bunq_request_closed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", deposit.id);
      return { refunded: false, pending: true, amountCents: actualAmountCents };
    }
    throw error;
  }

  await db
    .from("voyage_booking_deposits")
    .update({
      status: "refunded",
      paid_at: nowIso,
      amount_cents: actualAmountCents,
      refunded_at: nowIso,
      refund_amount_cents: actualAmountCents,
      refund_policy: "contribution_settlement_deadline_missed",
      refund_reference: reference,
      refund_payment_id: payment.id,
      payer_alias: payerAlias,
      expiry_kind: "contribution_settlement",
      bunq_request_closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", deposit.id);

  return { refunded: true, pending: false, amountCents: actualAmountCents };
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
  /** True when the payout could not run yet and is waiting for an admin retry. */
  queued: boolean;
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
    .update({ refund_pending: false, refund_payout_queued: false, updated_at: new Date().toISOString() })
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
    const badDestination = isBadDestinationError(error);
    await db
      .from("voyage_booking_deposits")
      .update({
        refund_pending: true,
        // Bad details go back to "needs IBAN" so the traveller can correct them; our own
        // failures keep the details and queue the payout for an admin retry.
        refund_payout_queued: !badDestination,
        ...(badDestination
          ? {}
          : {
              payer_alias: { ...payerAlias, bic: bic || undefined },
              refund_pending_reason: "payout_failed",
            }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", deposit.id);

    if (badDestination) {
      const message = error instanceof Error ? error.message : "bunq_refund_failed";
      throw Object.assign(new Error(message), { status: 422, refundRejected: true });
    }

    // Not the traveller's problem (insufficient balance, transient Bunq error): accept the
    // request, stay quiet about the cause, and let an admin retry it.
    console.error("[bookings/refund] payout queued after failure", error);
    return { amountEur: centsToEur(refundCents), reference, queued: true };
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
      refund_payout_queued: false,
      refund_pending_amount_cents: 0,
      refund_pending_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id);
  if (finalizeError) throw new Error(finalizeError.message);

  return { amountEur: centsToEur(refundCents), reference, queued: false };
}

/**
 * Admin retry for a queued payout: reuses the bank details the traveller already gave us,
 * so nothing is asked of them a second time. Same claim-then-pay guard as the self-service
 * path, and a failure simply re-queues the deposit for another attempt.
 */
export async function retryQueuedRefund(
  db: SupabaseClient,
  user: User,
  depositId: string,
): Promise<ManualRefundResult> {
  if (!(await isAdmin(db, user))) {
    throw Object.assign(new Error("admin_required"), { status: 403 });
  }
  if (!bunqConfigured()) {
    throw Object.assign(new Error("bunq_not_configured"), { status: 503 });
  }

  const { data: depositRow, error: depositError } = await db
    .from("voyage_booking_deposits")
    .select("id, booking_request_id, environment, amount_cents, refund_amount_cents, refund_pending_amount_cents, reference, payer_alias")
    .eq("id", depositId)
    .eq("refund_pending", true)
    .eq("refund_payout_queued", true)
    .maybeSingle();
  if (depositError) throw new Error(depositError.message);
  const deposit = depositRow as (PendingDepositRow & { payer_alias: BunqCounterpartyAlias | null }) | null;
  if (!deposit) throw Object.assign(new Error("refund_not_found"), { status: 404 });
  if (deposit.environment !== environment()) {
    throw Object.assign(new Error("refund_environment_mismatch"), { status: 409 });
  }

  const payerAlias = deposit.payer_alias;
  if (!isRefundableAlias(payerAlias)) {
    throw Object.assign(new Error("refund_counterparty_missing"), { status: 409 });
  }

  const alreadyRefundedCents = Math.max(0, Number(deposit.refund_amount_cents ?? 0) || 0);
  const owedCents = Math.max(0, Number(deposit.refund_pending_amount_cents ?? 0) || 0);
  const refundCents = Math.min(owedCents, Math.max(0, deposit.amount_cents - alreadyRefundedCents));
  if (refundCents <= 0) throw Object.assign(new Error("nothing_to_refund"), { status: 409 });

  const { data: claimed, error: claimError } = await db
    .from("voyage_booking_deposits")
    .update({ refund_pending: false, refund_payout_queued: false, updated_at: new Date().toISOString() })
    .eq("id", deposit.id)
    .eq("refund_pending", true)
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw Object.assign(new Error("refund_already_processing"), { status: 409 });

  const reference = `REF-${deposit.booking_request_id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
  let payment: { id: number };
  try {
    payment = await createBunqOutgoingPayment({
      amountEur: centsToEur(refundCents),
      counterpartyAlias: payerAlias,
      description: `Rimborso BITE ${reference}`,
    });
  } catch (error) {
    await db
      .from("voyage_booking_deposits")
      .update({ refund_pending: true, refund_payout_queued: true, updated_at: new Date().toISOString() })
      .eq("id", deposit.id);
    const message = error instanceof Error ? error.message : "bunq_refund_failed";
    throw Object.assign(new Error(message), { status: 422 });
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
      refund_pending: false,
      refund_payout_queued: false,
      refund_pending_amount_cents: 0,
      refund_pending_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id);
  if (finalizeError) throw new Error(finalizeError.message);

  return { amountEur: centsToEur(refundCents), reference, queued: false };
}

type PayoutDepositRow = DepositRefundRow & {
  refund_pending: boolean;
  refund_pending_amount_cents: number;
  refund_policy: string | null;
};

/**
 * Admin-triggered payout for a single deposit, used for two related cases that both fall
 * outside the booking-level {@link refundBookingDeposits} flow (which is tied to a booking
 * status transition — cancelled/rejected):
 *  - a deposit the balance-deadline sweep flagged `refund_pending` (a co-participant who had
 *    already paid in full when someone else's missed balance forfeited the booking/their seat —
 *    see expire_unpaid_voyage_booking_balance / expire_unpaid_voyage_booking_guest_shares), where
 *    the amount owed was already decided and just needs a payout attempt; and
 *  - a discretionary refund of an acconto the system forfeited by default
 *    (`refund_policy = 'balance_deadline_missed'`), which an admin may still choose to pay back
 *    in full or in part — `percentOverride` is required for this case since the policy default
 *    is 0%.
 */
export async function adminPayoutDeposit(
  db: SupabaseClient,
  user: User,
  depositId: string,
  percentOverride?: number | null,
): Promise<ManualRefundResult & { needsIban?: boolean }> {
  if (!(await isAdmin(db, user))) {
    throw Object.assign(new Error("admin_required"), { status: 403 });
  }
  if (!bunqConfigured()) {
    throw Object.assign(new Error("bunq_not_configured"), { status: 503 });
  }

  const { data: depositRow, error: depositError } = await db
    .from("voyage_booking_deposits")
    .select(
      "id, booking_request_id, participant_id, environment, payment_method, amount_cents, status, bunq_request_id, reference, payer_alias, refund_amount_cents, refund_pending, refund_pending_amount_cents, refund_policy",
    )
    .eq("id", depositId)
    .maybeSingle();
  if (depositError) throw new Error(depositError.message);
  const deposit = depositRow as PayoutDepositRow | null;
  if (!deposit) throw Object.assign(new Error("deposit_not_found"), { status: 404 });
  if (deposit.environment !== environment()) {
    throw Object.assign(new Error("refund_environment_mismatch"), { status: 409 });
  }
  if (deposit.status !== "paid" && deposit.status !== "partially_refunded") {
    throw Object.assign(new Error("deposit_not_paid"), { status: 409 });
  }

  const alreadyRefundedCents = Math.max(0, Number(deposit.refund_amount_cents ?? 0) || 0);
  let targetCents: number;
  if (deposit.refund_pending) {
    // Amount already decided by whatever flagged this deposit (the sweep's fairness refund, or
    // the pre-existing "no payer alias found" path) — just attempt the payout.
    targetCents = Math.max(0, Number(deposit.refund_pending_amount_cents ?? 0) || 0) + alreadyRefundedCents;
  } else {
    if (deposit.refund_policy !== "balance_deadline_missed") {
      throw Object.assign(new Error("deposit_not_forfeited"), { status: 409 });
    }
    if (!Number.isFinite(percentOverride) || (percentOverride as number) <= 0) {
      throw Object.assign(new Error("percent_override_required"), { status: 400 });
    }
    const percent = Math.min(100, Math.round(percentOverride as number));
    targetCents = Math.round((deposit.amount_cents * percent) / 100);
  }

  const refundCents = Math.max(0, Math.min(deposit.amount_cents - alreadyRefundedCents, targetCents - alreadyRefundedCents));
  if (refundCents <= 0) throw Object.assign(new Error("nothing_to_refund"), { status: 409 });

  // Claim before paying — same discipline as submitManualRefund/retryQueuedRefund — so a double
  // click (or two admins acting on the same deposit at once) cannot trigger two Bunq payouts.
  // refund_pending is the lock: for an already-pending deposit it flips true->false (identical
  // to retryQueuedRefund's claim); for a discretionary forfeiture override it flips false->true,
  // additionally gated on refund_amount_cents being unchanged since we read it above.
  const { data: claimed, error: claimError } = deposit.refund_pending
    ? await db
        .from("voyage_booking_deposits")
        .update({ refund_pending: false, refund_payout_queued: false, updated_at: new Date().toISOString() })
        .eq("id", deposit.id)
        .eq("refund_pending", true)
        .select("id")
        .maybeSingle()
    : await db
        .from("voyage_booking_deposits")
        .update({ refund_pending: true, updated_at: new Date().toISOString() })
        .eq("id", deposit.id)
        .eq("refund_pending", false)
        .eq("refund_amount_cents", alreadyRefundedCents)
        .select("id")
        .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw Object.assign(new Error("refund_already_processing"), { status: 409 });

  const payerAlias = await resolvePayerAlias(db, deposit);
  if (!payerAlias) {
    await db
      .from("voyage_booking_deposits")
      .update({
        refund_pending: true,
        refund_payout_queued: false,
        refund_pending_amount_cents: refundCents,
        refund_pending_reason: "no_payer_alias",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deposit.id);
    return { amountEur: 0, reference: deposit.reference, queued: false, needsIban: true };
  }

  const reference = `REF-${deposit.booking_request_id.slice(0, 8)}-${randomUUID().slice(0, 4)}`.toUpperCase();
  let payment: { id: number };
  try {
    payment = await createBunqOutgoingPayment({
      amountEur: centsToEur(refundCents),
      counterpartyAlias: payerAlias,
      description: `Rimborso BITE ${reference}`,
    });
  } catch (error) {
    // The claim above must not leave the deposit stranded (invisible to admin_list_pending_refunds,
    // un-retryable) on a transient Bunq failure — re-arm it exactly like submitManualRefund does.
    await db
      .from("voyage_booking_deposits")
      .update({
        refund_pending: true,
        refund_payout_queued: true,
        refund_pending_amount_cents: refundCents,
        refund_pending_reason: "payout_failed",
        payer_alias: payerAlias,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deposit.id);
    const message = error instanceof Error ? error.message : "bunq_refund_failed";
    throw Object.assign(new Error(message), { status: 502 });
  }

  const nextRefundedCents = alreadyRefundedCents + refundCents;
  const { error: updateError } = await db
    .from("voyage_booking_deposits")
    .update({
      status: nextRefundedCents >= deposit.amount_cents ? "refunded" : "partially_refunded",
      refunded_at: new Date().toISOString(),
      refund_amount_cents: nextRefundedCents,
      refund_reference: reference,
      refund_payment_id: payment.id,
      refund_pending: false,
      refund_pending_amount_cents: 0,
      refund_pending_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deposit.id);
  if (updateError) throw new Error(updateError.message);

  return { amountEur: centsToEur(refundCents), reference, queued: false };
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

  // A booking being cancelled/rejected while a contribution/workaway negotiation is still open
  // (admin outright rejecting a proposal, or the candidate rejecting a counter-proposal) leaves
  // that negotiation dangling otherwise. Harmless no-op for the common case of a booking with no
  // proposal at all — the WHERE clauses simply match nothing.
  await db
    .from("voyage_booking_contribution_proposals")
    .update({ status: "rejected", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("booking_request_id", booking.id)
    .in("status", ["pending_admin_review", "pending_user_approval"]);
  await db
    .from("voyage_booking_requests")
    .update({ contribution_proposal_status: "rejected" })
    .eq("id", booking.id)
    .in("contribution_proposal_status", ["pending_admin_review", "pending_user_approval"]);

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
