/**
 * Shared resolution logic for creating a voyage-contribution deposit, used by both payment
 * methods (Bunq online link and bank transfer). Authorizes the caller, resolves who is
 * paying (lead or guest), and recomputes the authoritative amount server-side from the leg
 * complexity — never trusted from the client.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAuthClient, createServiceClient } from "./supabase.js";
import {
  perPersonDepositEur,
  depositForPayerEur,
  depositTargetEur,
  contributionFixedMinimumEur,
  type DepositLeg,
  type PaymentMode,
} from "../../lib/booking-deposit.js";

/**
 * Statuses a booking may be in while a contribution payment is legitimately collectable.
 * `pending_payment` heads the list on purpose: that is the state a fresh application is born
 * in, and refusing to serve it here would make the contribution impossible to ever pay.
 */
const ACTIVE_STATUSES = ["pending_payment", "requested", "waitlisted", "admin_approved", "user_confirmed"];
/** Statuses that count as an existing booking when deciding to waive the fixed minimum. */
const PRIOR_BOOKING_STATUSES = ["requested", "waitlisted", "admin_approved", "user_confirmed"];
export type PaymentMethod = "bunq_link" | "bank_transfer";

/**
 * How long an armed payment may stay unsettled, by method. A Bunq link is paid in the same
 * session or not at all; a bank transfer needs a banking day. Mirrors
 * public.voyage_booking_payment_deadline_hours — keep both in sync.
 */
export const PAYMENT_DEADLINE_HOURS: Record<PaymentMethod, number> = {
  bunq_link: 1,
  bank_transfer: 24,
};

export type ParticipantRow = {
  id: string;
  booking_request_id: string;
  profile_id: string | null;
  email: string;
  is_lead: boolean;
  status: string;
};

/** Thrown for every expected (4xx/409) early-exit; callers translate it straight to a response. */
export class DepositHttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "deposit_error");
    this.status = status;
    this.body = body;
  }
}

export type PaymentPhase = "deposit" | "balance";

/** Infers the phase a settled deposit was collecting from its ACC-/SAL- reference prefix. */
export function paymentPhaseFromReference(reference: string | null | undefined): PaymentPhase | null {
  if (!reference) return null;
  if (reference.startsWith("ACC-")) return "deposit";
  if (reference.startsWith("SAL-")) return "balance";
  return null;
}

export type ResolvedDeposit = {
  db: SupabaseClient;
  user: User;
  bookingRequestId: string;
  payerParticipantId: string | null;
  isLead: boolean;
  partySize: number;
  paymentMode: PaymentMode;
  coveredPersons: number;
  perPersonEur: number;
  amountEur: number;
  /** Whether this payment collects the upfront deposit or the later balance. */
  phase: PaymentPhase;
  /** This payer's full obligation (deposit + balance), regardless of what has been paid so far. */
  totalDueEur: number;
  /** This payer's required upfront deposit — min(50% of totalDueEur, €499). */
  depositTargetEur: number;
};

type BookingNotificationEvent =
  | "payment_pending"
  | "payment_received"
  | "payment_failed"
  | "payment_expired"
  | "admin_payment_pending"
  | "admin_payment_received"
  | "late_payment_after_cancellation"
  | "admin_late_payment_after_cancellation";

function paymentDeadlineHours(paymentMethod: PaymentMethod): number {
  return PAYMENT_DEADLINE_HOURS[paymentMethod] ?? PAYMENT_DEADLINE_HOURS.bunq_link;
}

async function hasPriorActiveVoyageBookingForPayer(
  db: SupabaseClient,
  params: {
    voyageId: string;
    currentBookingRequestId: string;
    profileId: string | null;
    email: string;
  },
): Promise<boolean> {
  const { data: priorRequests, error: requestError } = await db
    .from("voyage_booking_requests")
    .select("id, profile_id")
    .eq("voyage_id", params.voyageId)
    .neq("id", params.currentBookingRequestId)
    .in("status", [...PRIOR_BOOKING_STATUSES]);
  if (requestError) throw new Error(requestError.message);

  const requestRows = (priorRequests ?? []) as Array<{ id: string; profile_id: string | null }>;
  if (params.profileId && requestRows.some((request) => request.profile_id === params.profileId)) {
    return true;
  }

  const priorRequestIds = requestRows.map((request) => request.id);
  if (priorRequestIds.length === 0) return false;

  const participantFilters = [`email.eq.${params.email.toLowerCase()}`];
  if (params.profileId) participantFilters.push(`profile_id.eq.${params.profileId}`);

  const { data: participant, error: participantError } = await db
    .from("voyage_booking_participants")
    .select("id")
    .in("booking_request_id", priorRequestIds)
    .in("status", ["pending", "accepted"])
    .or(participantFilters.join(","))
    .limit(1)
    .maybeSingle();
  if (participantError) throw new Error(participantError.message);
  return Boolean(participant);
}

/**
 * Total already settled by one payer on a booking. Deposits are per-payer, so a guest paying
 * their own share never sees the lead's payment counted against their own balance.
 *
 * The lead is the one payer whose tag changes mid-flow: a payment made before their participant
 * row exists (a party that paid straight from /bookings without naming guests first) is tagged
 * `participant_id IS NULL`, while every later payment resolves onto their participant row. Both
 * tags are the same human, so `includeUntagged` folds them together — without it the lead would
 * be asked to pay the deposit a second time as soon as guests are configured. This mirrors
 * expire_unpaid_voyage_booking_balance, which already treats
 * `participant_id is null or participant_id = lead.id` as one payer.
 */
async function paidDepositTotalEur(
  db: SupabaseClient,
  bookingRequestId: string,
  payerParticipantId: string | null,
  options: { includeUntagged: boolean } = { includeUntagged: false },
): Promise<number> {
  let query = db
    .from("voyage_booking_deposits")
    .select("amount_cents")
    .eq("booking_request_id", bookingRequestId)
    .eq("status", "paid");
  if (!payerParticipantId) {
    query = query.is("participant_id", null);
  } else if (options.includeUntagged) {
    query = query.or(`participant_id.is.null,participant_id.eq.${payerParticipantId}`);
  } else {
    query = query.eq("participant_id", payerParticipantId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const cents = (data ?? []).reduce(
    (acc, row) => acc + Number((row as { amount_cents?: number }).amount_cents ?? 0),
    0,
  );
  return cents / 100;
}

/** Verifies the bearer token and returns the caller + a service-role db client. */
export async function resolveCaller(token: string): Promise<{ db: SupabaseClient; user: User }> {
  const auth = createAuthClient();
  const { data: userData, error: userError } = await auth.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new DepositHttpError(401, { error: "unauthenticated" });
  }
  return { db: createServiceClient(), user: userData.user };
}

/**
 * Resolves the payer for a booking request and recomputes the authoritative contribution
 * amount. Throws {@link DepositHttpError} for every expected failure (not found, not active,
 * not authorized, zero/over-limit amount).
 */
export async function resolveDepositPayer(
  db: SupabaseClient,
  user: User,
  bookingRequestId: string,
  participantId: string | null,
): Promise<ResolvedDeposit> {
  const userEmail = (user.email ?? "").toLowerCase();
  if (!userEmail) throw new DepositHttpError(409, { error: "missing_user_email" });

  const { data: request, error: requestError } = await db
    .from("voyage_booking_requests")
    .select(
      "id, profile_id, voyage_id, party_size, status, payment_mode, expires_at, contribution_fixed_only_payment, contribution_proposal_status, contribution_resolved_variable_cents",
    )
    .eq("id", bookingRequestId)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);
  if (!request) throw new DepositHttpError(404, { error: "booking_not_found" });

  const bookingOwnerId = (request as { profile_id: string }).profile_id;
  const voyageId = (request as { voyage_id: string }).voyage_id;
  const bookingStatus = (request as { status: string }).status;
  const partySize = Math.max(1, Number((request as { party_size: number }).party_size) || 1);
  const paymentMode = ((request as { payment_mode?: string }).payment_mode ?? "lead_pays_all") as PaymentMode;
  if (!ACTIVE_STATUSES.includes(bookingStatus)) {
    throw new DepositHttpError(409, { error: "booking_not_active", status: bookingStatus });
  }
  // The short per-attempt window only guards the *initial* payment gate — once the booking has
  // ever had a paid deposit it already holds its place, and a stale expires_at can otherwise
  // linger forever in a split-payment booking where a different payer's own attempt lapsed
  // (armBookingPaymentDeadline only clears it once every pending deposit is resolved). Without
  // this, a legitimate balance/top-up payment could be permanently blocked by someone else's
  // abandoned attempt.
  const expiresAt = (request as { expires_at?: string | null }).expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now() && !(await bookingHasEverBeenPaid(db, bookingRequestId))) {
    throw new DepositHttpError(409, { error: "payment_deadline_expired" });
  }

  let payer: ParticipantRow | null = null;
  if (participantId) {
    const { data: p } = await db
      .from("voyage_booking_participants")
      .select("id, booking_request_id, profile_id, email, is_lead, status")
      .eq("id", participantId)
      .maybeSingle();
    payer = (p as ParticipantRow | null) ?? null;
    if (!payer || payer.booking_request_id !== bookingRequestId) {
      throw new DepositHttpError(404, { error: "participant_not_found" });
    }
    const matchesCaller = payer.profile_id === user.id || payer.email.toLowerCase() === userEmail;
    if (!matchesCaller) throw new DepositHttpError(403, { error: "not_your_participation" });
    if (!payer.is_lead && payer.status !== "accepted") {
      throw new DepositHttpError(409, { error: "participation_not_accepted" });
    }
  } else {
    if (bookingOwnerId !== user.id) throw new DepositHttpError(404, { error: "booking_not_found" });
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
  const payerProfileId = isLead ? bookingOwnerId : payer?.profile_id ?? null;

  // A guest's share is exactly the figure the booker is still negotiating, so collecting it now
  // would charge an amount nobody has agreed to. Guests wait: once the negotiation resolves,
  // arm_voyage_booking_guest_shares emails them with their own two-day window. Only the booker
  // pays during the negotiation, and only the fixed minimum.
  const contributionProposalStatusRaw =
    (request as { contribution_proposal_status?: string | null }).contribution_proposal_status ?? "none";
  const negotiationOpen =
    Boolean((request as { contribution_fixed_only_payment?: boolean | null }).contribution_fixed_only_payment) &&
    (contributionProposalStatusRaw === "pending_admin_review" ||
      contributionProposalStatusRaw === "pending_user_approval");
  if (!isLead && negotiationOpen) {
    throw new DepositHttpError(409, {
      error: "guest_payment_suspended",
      contributionProposalStatus: contributionProposalStatusRaw,
    });
  }

  const { data: legLinks, error: legLinkError } = await db
    .from("voyage_booking_request_legs")
    .select("bookable_leg_id")
    .eq("booking_request_id", bookingRequestId);
  if (legLinkError) throw new Error(legLinkError.message);
  const legIds = (legLinks ?? []).map((l) => (l as { bookable_leg_id: string }).bookable_leg_id);
  if (legIds.length === 0) throw new DepositHttpError(409, { error: "booking_has_no_legs" });

  const { data: legRows, error: legError } = await db
    .from("voyage_bookable_legs")
    .select(
      "planned_nautical_miles, open_sea, danger_level, starts_at_window_start, ends_at_window_start",
    )
    .in("id", legIds);
  if (legError) throw new Error(legError.message);
  const legs = (legRows ?? []) as DepositLeg[];

  const { data: voyageRow, error: voyageError } = await db
    .from("voyages")
    .select("booking_contribution_per_nm_eur")
    .eq("id", voyageId)
    .maybeSingle();
  if (voyageError) throw new Error(voyageError.message);
  const contributionPerNmEur = Number(
    (voyageRow as { booking_contribution_per_nm_eur?: number } | null)?.booking_contribution_per_nm_eur ?? 0.9,
  );

  const payerAlreadyHasVoyageBooking = await hasPriorActiveVoyageBookingForPayer(db, {
    voyageId,
    currentBookingRequestId: bookingRequestId,
    profileId: payerProfileId,
    email: userEmail,
  });
  const contributionOpts = {
    contributionPerNmEur,
    fixedMinimumEur: payerAlreadyHasVoyageBooking ? 0 : undefined,
  };
  const coveredPersons = isLead && paymentMode === "lead_pays_all" ? partySize : 1;

  const contributionProposalStatus = contributionProposalStatusRaw;
  const contributionFixedOnlyPayment = Boolean(
    (request as { contribution_fixed_only_payment?: boolean | null }).contribution_fixed_only_payment,
  );
  const contributionResolvedVariableCents =
    (request as { contribution_resolved_variable_cents?: number | null }).contribution_resolved_variable_cents ?? null;

  let perPersonEur: number;
  let dueEur: number;
  let depositTarget: number;

  if (
    contributionFixedOnlyPayment &&
    (contributionProposalStatus === "pending_admin_review" || contributionProposalStatus === "pending_user_approval")
  ) {
    // A contribution/workaway proposal is still being negotiated: only the fixed minimum is
    // collected up front — the variable part is not charged until the negotiation resolves.
    perPersonEur = contributionFixedMinimumEur(contributionOpts.fixedMinimumEur);
    dueEur = Math.round((perPersonEur * coveredPersons + Number.EPSILON) * 100) / 100;
    depositTarget = dueEur; // 100% up front — always far under the €499 Bunq cap.
  } else if (contributionProposalStatus === "accepted") {
    // Negotiation resolved: the agreed variable amount (0 for a pure workaway trade) is added
    // to the fixed minimum to form the new total due — then split exactly like any other
    // payer's contribution (50% deposit capped at €499, balance due 15 days before departure
    // via expire_unpaid_voyage_booking_balance). alreadyPaidEur below (the €20 fixed already
    // settled while negotiating) is what turns the deposit leg into "just the delta", exactly
    // like a route-change settlement does.
    const resolvedVariableEur = Math.max(0, contributionResolvedVariableCents ?? 0) / 100;
    perPersonEur = contributionFixedMinimumEur(contributionOpts.fixedMinimumEur) + resolvedVariableEur;
    dueEur = Math.round((perPersonEur * coveredPersons + Number.EPSILON) * 100) / 100;
    depositTarget = depositTargetEur(dueEur);
  } else {
    perPersonEur = perPersonDepositEur(legs, contributionOpts);
    dueEur = depositForPayerEur(legs, { isLead, paymentMode, partySize }, contributionOpts);
    depositTarget = depositTargetEur(dueEur);
  }

  // Charge only what is still outstanding, and only up to the deposit target until it is fully
  // reached — the first payment(s) collect the upfront deposit (50% of dueEur, capped at €499),
  // and only once that target is met does a further payment collect (the rest of) the balance.
  // This is also what makes an accepted route change collect the *difference* rather than the
  // whole contribution again: dueEur/depositTarget are recomputed from the current legs, so
  // subtracting what this payer already settled leaves exactly the delta. Retries stay idempotent
  // in value either way.
  // Snapshot this payer's obligation so the balance-deadline sweep (pure SQL) can tell whether
  // it has been met without duplicating the mileage-based contribution formula in SQL. Written
  // on the entity the sweep will actually query: the booking request for a null payer (solo
  // travellers, or a lead before guests are configured / paying for the whole lead_pays_all
  // party), the participant row otherwise (an each_pays_own guest, or the lead once they have
  // their own participant row).
  //
  // This MUST run before the amountEur<=0 early-return below: a route change can make a payer's
  // dueEur *drop* below what they already paid, and that "already settled" outcome is exactly
  // when a stale (too high) snapshot would matter most — the balance-deadline sweep would keep
  // seeing an inflated due_cents forever and could wrongly cancel/forfeit an already-fully-paid
  // booking. Every resolveDepositPayer call refreshes the truth, whether or not it ends up
  // collecting anything.
  const dueCents = Math.round(dueEur * 100);
  const depositCents = Math.round(depositTarget * 100);
  const stampedAt = new Date().toISOString();
  if (payerParticipantId) {
    const { error: stampError } = await db
      .from("voyage_booking_participants")
      .update({
        contribution_due_cents: dueCents,
        contribution_deposit_cents: depositCents,
        contribution_due_stamped_at: stampedAt,
      })
      .eq("id", payerParticipantId);
    if (stampError) throw new Error(stampError.message);
  } else {
    const { error: stampError } = await db
      .from("voyage_booking_requests")
      .update({
        contribution_due_cents: dueCents,
        contribution_deposit_cents: depositCents,
        contribution_due_stamped_at: stampedAt,
      })
      .eq("id", bookingRequestId);
    if (stampError) throw new Error(stampError.message);
  }

  const alreadyPaidEur = await paidDepositTotalEur(db, bookingRequestId, payerParticipantId, {
    includeUntagged: isLead,
  });
  const phase: PaymentPhase = alreadyPaidEur < depositTarget ? "deposit" : "balance";
  const targetEur = phase === "deposit" ? depositTarget : dueEur;
  const amountEur = Math.round((targetEur - alreadyPaidEur + Number.EPSILON) * 100) / 100;

  // Nothing left to collect: either fully settled, or the new route costs less than what was
  // already paid. The overpayment is not auto-refunded here — the money has already left the
  // payer's account, so it goes through the admin refund flow instead.
  if (amountEur <= 0) {
    throw new DepositHttpError(409, {
      error: alreadyPaidEur > 0 ? "already_settled" : "zero_deposit",
      dueEur,
      alreadyPaidEur,
      overpaidEur: alreadyPaidEur > dueEur ? Math.round((alreadyPaidEur - dueEur) * 100) / 100 : 0,
    });
  }
  // NB: the €500 Bunq single-transaction cap is enforced only by the Bunq-link endpoint
  // (api/payments/bunq/request.ts), NOT here — a bank transfer has no such limit, and this
  // resolver is shared by both methods. Blocking it here would make large contributions
  // (e.g. a long multi-leg reroute) impossible to pay by any method.

  return {
    db,
    user,
    bookingRequestId,
    payerParticipantId,
    isLead,
    partySize,
    paymentMode,
    phase,
    totalDueEur: dueEur,
    depositTargetEur: depositTarget,
    coveredPersons,
    perPersonEur,
    amountEur,
  };
}

/**
 * True once the booking has cleared its initial payment gate — at least one deposit has ever
 * settled for it, by any payer. A booking in this state already holds its place (review-eligible
 * or a confirmed seat); a further payment (topping up a still-short deposit after a route change,
 * or the later balance) is a retriable top-up, not a make-or-break gate.
 */
async function bookingHasEverBeenPaid(db: SupabaseClient, bookingRequestId: string): Promise<boolean> {
  const { data, error } = await db
    .from("voyage_booking_deposits")
    .select("id")
    .eq("booking_request_id", bookingRequestId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Starts the payment window (1h Bunq link / 24h bank transfer) when a fresh application's very
 * first payment is created — abandoning it lets expire_pending_voyage_booking_payments sweep the
 * whole application away, which is the intended fate for something that was never actually paid.
 *
 * Once the booking has ever had a paid deposit, this becomes a no-op: any further payment (the
 * balance, or a top-up after a route change) must be retriable at any time without risking the
 * booking itself — the traveller already holds their place. That is enforced separately (the
 * balance's own deadline is 15 days before departure, via expire_unpaid_voyage_booking_balance /
 * expire_unpaid_voyage_booking_guest_shares, not this short per-attempt window).
 */
export async function armBookingPaymentDeadline(
  db: SupabaseClient,
  bookingRequestId: string,
  paymentMethod: PaymentMethod = "bunq_link",
): Promise<string | null> {
  const now = new Date();
  const target = new Date(now.getTime() + paymentDeadlineHours(paymentMethod) * 60 * 60 * 1000);

  const { data: current, error: readError } = await db
    .from("voyage_booking_requests")
    .select("expires_at, status")
    .eq("id", bookingRequestId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const row = current as { expires_at?: string | null; status?: string } | null;
  if (!row || !ACTIVE_STATUSES.includes(row.status ?? "")) return row?.expires_at ?? null;
  if (await bookingHasEverBeenPaid(db, bookingRequestId)) return row.expires_at ?? null;

  // Only ever move the deadline forward. A fresh application already carries the short
  // pending_payment grace window, and choosing bank transfer must widen it to a banking day —
  // but re-polling or retrying the same payment must never keep pushing it out, so the caller
  // is expected to arm once per newly created deposit.
  const currentExpiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (currentExpiresAt && currentExpiresAt.getTime() >= target.getTime()) {
    return row.expires_at ?? null;
  }

  const nextExpiresAt = target.toISOString();
  const { error } = await db
    .from("voyage_booking_requests")
    .update({ expires_at: nextExpiresAt, updated_at: now.toISOString() })
    .eq("id", bookingRequestId)
    .in("status", ACTIVE_STATUSES);
  if (error) throw new Error(error.message);
  return nextExpiresAt;
}

/**
 * Clears the booking-level payment deadline only after every pending deposit for the booking has
 * been settled or cancelled. This preserves the deadline for split payments with multiple payers.
 */
export async function clearBookingPaymentDeadlineIfSettled(
  db: SupabaseClient,
  bookingRequestId: string,
): Promise<void> {
  const { count, error: countError } = await db
    .from("voyage_booking_deposits")
    .select("id", { count: "exact", head: true })
    .eq("booking_request_id", bookingRequestId)
    .eq("status", "pending");
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) return;

  // Also clears contribution_settlement_deadline: once every pending deposit is gone, either the
  // negotiated deposit just settled (the 24h window no longer applies) or there was never one to
  // begin with — null-to-null is a harmless no-op either way.
  const { error } = await db
    .from("voyage_booking_requests")
    .update({ expires_at: null, contribution_settlement_deadline: null, updated_at: new Date().toISOString() })
    .eq("id", bookingRequestId);
  if (error) throw new Error(error.message);

  // Single choke point for "the money landed": every path that marks a deposit paid (both
  // webhook matchers and the status poller) ends up here, so this is where an application
  // stops being 'pending_payment' and finally becomes a candidature the admins can see.
  await settleBookingPayment(db, bookingRequestId);
}

/**
 * Promotes a fully-paid application out of 'pending_payment' and fires the "new candidature"
 * notifications. A no-op for bookings already past that state, so it is safe to call on every
 * settlement — including the delta payment of an accepted route change.
 *
 * Call {@link enqueuePaymentReceivedNotifications} *first*: for a paid (non-comped) settlement
 * the RPC merges the resulting booking status into that same notification row instead of
 * queueing a second, near-identical status email.
 */
export async function settleBookingPayment(
  db: SupabaseClient,
  bookingRequestId: string,
): Promise<void> {
  const { error } = await db.rpc("settle_voyage_booking_payment", {
    _booking_request_id: bookingRequestId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Promotes a booking whose resolveDepositPayer call just confirmed is genuinely €0 due (e.g. its
 * fixed share was waived because the candidate already holds another active application on the
 * same voyage) — there is no deposit to ever pay, so nothing would otherwise move it out of
 * pending_payment. The SQL side refuses to run if any deposit row already exists for the booking,
 * so this can never bypass a real payment that's merely still pending.
 */
export async function settleBookingPaymentIfZeroDue(
  db: SupabaseClient,
  bookingRequestId: string,
): Promise<void> {
  const { error } = await db.rpc("settle_voyage_booking_payment_if_zero_due", {
    _booking_request_id: bookingRequestId,
  });
  if (error) throw new Error(error.message);
}

export type ExistingDepositRow = {
  id: string;
  status: string;
  share_url: string | null;
  reference: string;
  amount_cents: number;
  per_person_cents: number;
  party_size: number;
};

/** Looks up an existing pending/paid deposit for this exact payer + payment method (idempotency). */
export async function findExistingDeposit(
  db: SupabaseClient,
  bookingRequestId: string,
  payerParticipantId: string | null,
  paymentMethod: "bunq_link" | "bank_transfer",
): Promise<ExistingDepositRow | null> {
  let query = db
    .from("voyage_booking_deposits")
    .select("id, status, share_url, reference, amount_cents, per_person_cents, party_size")
    .eq("booking_request_id", bookingRequestId)
    .eq("payment_method", paymentMethod)
    .in("status", ["pending", "paid"]);
  query = payerParticipantId ? query.eq("participant_id", payerParticipantId) : query.is("participant_id", null);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as ExistingDepositRow | null;
}

/**
 * Fields that re-arm an already-dispatched notification row. The queue keeps one row per
 * (booking, event, recipient), so without this a second legitimate occurrence of the same
 * event — a payer who first opened the Bunq link and then switched to a bonifico, a delta
 * payment settling after a route change — would silently never be emailed. queued_at is part
 * of the dispatcher's idempotency key, so bumping it is what stops the ESP from treating the
 * resend as a duplicate of the first send.
 */
function resendFields(): Record<string, unknown> {
  return {
    queued_at: new Date().toISOString(),
    processed_at: null,
    emailed_at: null,
    push_sent_at: null,
    // A re-armed row is a new event, so it gets the full retry budget again.
    attempts: 0,
    failed_at: null,
  };
}

export async function enqueueBookingNotification(
  db: SupabaseClient,
  params: {
    bookingRequestId: string;
    recipientProfileId: string;
    eventType: BookingNotificationEvent | "plan_change_pending";
    metadata?: Record<string, unknown>;
    /** Re-send even if this event was already emailed for this booking. */
    resend?: boolean;
  },
): Promise<void> {
  const { error } = await db.from("voyage_booking_notifications").upsert(
    {
      booking_request_id: params.bookingRequestId,
      recipient_profile_id: params.recipientProfileId,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
      failed_at: null,
      error_message: null,
      ...(params.resend ? resendFields() : {}),
    },
    { onConflict: "booking_request_id,event_type,recipient_profile_id" },
  );
  if (error) throw new Error(error.message);
}

export async function enqueueAdminBookingNotification(
  db: SupabaseClient,
  bookingRequestId: string,
  eventType: BookingNotificationEvent,
  metadata: Record<string, unknown> = {},
  options: { resend?: boolean } = {},
): Promise<void> {
  const { data: admins, error: adminError } = await db.from("user_roles").select("user_id").eq("role", "admin");
  if (adminError) throw new Error(adminError.message);
  const rows = (admins ?? [])
    .map((row) => (row as { user_id?: string | null }).user_id)
    .filter((userId): userId is string => Boolean(userId))
    .map((userId) => ({
      booking_request_id: bookingRequestId,
      recipient_profile_id: userId,
      event_type: eventType,
      metadata,
      failed_at: null,
      error_message: null,
      ...(options.resend ? resendFields() : {}),
    }));
  if (!rows.length) return;

  const { error } = await db
    .from("voyage_booking_notifications")
    .upsert(rows, { onConflict: "booking_request_id,event_type,recipient_profile_id" });
  if (error) throw new Error(error.message);
}

export async function enqueuePaymentPendingNotifications(
  resolved: ResolvedDeposit,
  params: {
    paymentMethod: "bunq_link" | "bank_transfer";
    reference: string;
    expiresAt: string | null;
  },
): Promise<void> {
  const metadata = {
    amount_eur: resolved.amountEur,
    per_person_eur: resolved.perPersonEur,
    covered_persons: resolved.coveredPersons,
    payment_method: params.paymentMethod,
    payment_reference: params.reference,
    payment_expires_at: params.expiresAt,
    phase: resolved.phase,
    total_due_eur: resolved.totalDueEur,
    deposit_target_eur: resolved.depositTargetEur,
  };
  // Only ever called for a freshly created deposit (both endpoints return early on an existing
  // pending one), so re-arming cannot spam: a resend here means the payer really did start a
  // new payment, most often by switching method after seeing the €500 Bunq cap.
  await enqueueBookingNotification(resolved.db, {
    bookingRequestId: resolved.bookingRequestId,
    recipientProfileId: resolved.user.id,
    eventType: "payment_pending",
    metadata,
    resend: true,
  });
  await enqueueAdminBookingNotification(resolved.db, resolved.bookingRequestId, "admin_payment_pending", metadata, {
    resend: true,
  });
}

export async function enqueuePaymentReceivedNotifications(
  db: SupabaseClient,
  params: {
    bookingRequestId: string;
    recipientProfileId: string;
    amountEur: number;
    paymentMethod?: string | null;
    reference?: string | null;
    /** "deposit" (acconto) or "balance" (saldo) — inferred by the caller from the reference prefix. */
    phase?: PaymentPhase | null;
  },
): Promise<void> {
  const metadata = {
    amount_eur: params.amountEur,
    payment_method: params.paymentMethod,
    payment_reference: params.reference,
    phase: params.phase ?? null,
  };
  // Re-armed on purpose: a booking can settle more than once (the delta payment of an accepted
  // route change), and each settlement is its own "we got your money" moment.
  await enqueueBookingNotification(db, {
    bookingRequestId: params.bookingRequestId,
    recipientProfileId: params.recipientProfileId,
    eventType: "payment_received",
    metadata,
    resend: true,
  });
  await enqueueAdminBookingNotification(db, params.bookingRequestId, "admin_payment_received", metadata, {
    resend: true,
  });
}
