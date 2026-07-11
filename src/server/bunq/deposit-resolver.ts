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

  const { data: request, error: requestError } = await db
    .from("voyage_booking_requests")
    .select("id, profile_id, voyage_id, party_size, status, payment_mode")
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

  const perPersonEur = perPersonDepositEur(legs, { contributionPerNmEur });
  const amountEur = depositForPayerEur(legs, { isLead, paymentMode, partySize }, { contributionPerNmEur });
  if (amountEur <= 0) throw new DepositHttpError(409, { error: "zero_deposit" });
  if (amountEur > BUNQ_SINGLE_TRANSACTION_LIMIT_EUR) {
    throw new DepositHttpError(409, {
      error: "bunq_amount_exceeds_single_transaction_limit",
      amountEur,
      maxSingleTransactionEur: BUNQ_SINGLE_TRANSACTION_LIMIT_EUR,
    });
  }

  const coveredPersons = isLead && paymentMode === "lead_pays_all" ? partySize : 1;
  const counterpartyEmail = user.email;
  if (!counterpartyEmail) throw new DepositHttpError(409, { error: "missing_user_email" });

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
