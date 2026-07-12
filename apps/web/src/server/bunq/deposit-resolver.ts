/**
 * Shared resolution logic for creating a voyage-contribution deposit, used by both payment
 * methods (Bunq online link and bank transfer). Authorizes the caller, resolves who is
 * paying (lead or guest), and recomputes the authoritative amount server-side from the leg
 * complexity — never trusted from the client.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAuthClient, createServiceClient } from "./supabase.js";
import {
  BUNQ_SINGLE_TRANSACTION_LIMIT_EUR,
  perPersonDepositEur,
  depositForPayerEur,
  type DepositLeg,
  type PaymentMode,
} from "../../lib/booking-deposit.js";

const ACTIVE_STATUSES = ["requested", "waitlisted", "admin_approved", "user_confirmed"];
const PAYMENT_PENDING_DEADLINE_HOURS = 48;

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
  counterpartyEmail: string;
};

type BookingNotificationEvent =
  | "payment_pending"
  | "payment_received"
  | "payment_failed"
  | "payment_expired"
  | "admin_payment_pending"
  | "admin_payment_received";

function paymentDeadlineIso(base = new Date()): string {
  return new Date(base.getTime() + PAYMENT_PENDING_DEADLINE_HOURS * 60 * 60 * 1000).toISOString();
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
    .in("status", [...ACTIVE_STATUSES]);
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
  const counterpartyEmail = user.email;
  if (!counterpartyEmail) throw new DepositHttpError(409, { error: "missing_user_email" });

  const { data: request, error: requestError } = await db
    .from("voyage_booking_requests")
    .select("id, profile_id, voyage_id, party_size, status, payment_mode, expires_at")
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
  const expiresAt = (request as { expires_at?: string | null }).expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
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
  const perPersonEur = perPersonDepositEur(legs, contributionOpts);
  const amountEur = depositForPayerEur(legs, { isLead, paymentMode, partySize }, contributionOpts);
  if (amountEur <= 0) throw new DepositHttpError(409, { error: "zero_deposit" });
  if (amountEur > BUNQ_SINGLE_TRANSACTION_LIMIT_EUR) {
    throw new DepositHttpError(409, {
      error: "bunq_amount_exceeds_single_transaction_limit",
      amountEur,
      maxSingleTransactionEur: BUNQ_SINGLE_TRANSACTION_LIMIT_EUR,
    });
  }

  const coveredPersons = isLead && paymentMode === "lead_pays_all" ? partySize : 1;
  return {
    db,
    user,
    bookingRequestId,
    payerParticipantId,
    isLead,
    partySize,
    paymentMode,
    coveredPersons,
    perPersonEur,
    amountEur,
    counterpartyEmail,
  };
}

/**
 * Starts the 48h payment window when a new pending payment is created. Existing deadlines are
 * kept as-is so polling or retrying the same payment cannot extend the booking hold forever.
 */
export async function armBookingPaymentDeadline(db: SupabaseClient, bookingRequestId: string): Promise<string | null> {
  const now = new Date().toISOString();
  const nextExpiresAt = paymentDeadlineIso();
  const { error } = await db
    .from("voyage_booking_requests")
    .update({ expires_at: nextExpiresAt, updated_at: now })
    .eq("id", bookingRequestId)
    .in("status", ACTIVE_STATUSES)
    .is("expires_at", null);
  if (error) throw new Error(error.message);

  const { data, error: readError } = await db
    .from("voyage_booking_requests")
    .select("expires_at")
    .eq("id", bookingRequestId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  return (data as { expires_at?: string | null } | null)?.expires_at ?? null;
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

  const { error } = await db
    .from("voyage_booking_requests")
    .update({ expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", bookingRequestId);
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

export async function enqueueBookingNotification(
  db: SupabaseClient,
  params: {
    bookingRequestId: string;
    recipientProfileId: string;
    eventType: BookingNotificationEvent | "plan_change_pending";
    metadata?: Record<string, unknown>;
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
  };
  await enqueueBookingNotification(resolved.db, {
    bookingRequestId: resolved.bookingRequestId,
    recipientProfileId: resolved.user.id,
    eventType: "payment_pending",
    metadata,
  });
  await enqueueAdminBookingNotification(resolved.db, resolved.bookingRequestId, "admin_payment_pending", metadata);
}

export async function enqueuePaymentReceivedNotifications(
  db: SupabaseClient,
  params: {
    bookingRequestId: string;
    recipientProfileId: string;
    amountEur: number;
    paymentMethod?: string | null;
    reference?: string | null;
  },
): Promise<void> {
  const metadata = {
    amount_eur: params.amountEur,
    payment_method: params.paymentMethod,
    payment_reference: params.reference,
  };
  await enqueueBookingNotification(db, {
    bookingRequestId: params.bookingRequestId,
    recipientProfileId: params.recipientProfileId,
    eventType: "payment_received",
    metadata,
  });
  await enqueueAdminBookingNotification(db, params.bookingRequestId, "admin_payment_received", metadata);
}
