import { supabase } from "@/integrations/supabase/client";
import type { CandidateInfo } from "@/lib/booking-candidate-info";

export type PaymentMode = "lead_pays_all" | "each_pays_own";

export interface ParticipantInput {
  first_name: string;
  last_name: string;
  email: string;
}

export interface BookingParticipant {
  id: string;
  booking_request_id: string;
  profile_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_lead: boolean;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  invite_sent_at: string | null;
  accepted_at: string | null;
  expires_at: string | null;
}

/** A guest's own participation with the voyage context (from get_my_participations). */
export interface MyParticipation {
  participant_id: string;
  booking_request_id: string;
  status: BookingParticipant["status"];
  is_lead: boolean;
  voyage_id: string;
  voyage_name: string | null;
  voyage_name_it: string | null;
  voyage_name_en: string | null;
  party_size: number;
  payment_mode: PaymentMode;
  requires_payment: boolean;
  deposit_paid: boolean;
  expires_at: string | null;
  /** True while the booker is still negotiating the amount: this guest must not be charged yet. */
  negotiation_open: boolean;
  /** This guest's own obligation once the amount is settled — null when the lead covers everyone. */
  share_due_cents: number | null;
  share_paid_cents: number;
  /** Two-day window opened when the negotiation resolved. Null until then. */
  share_payment_due_at: string | null;
}

type RpcClient = {
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>;
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (column: string, value: unknown) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
};

const client = supabase as unknown as RpcClient;

/** Lead saves the guest list + payment mode. Returns all participant rows. */
export async function saveBookingParticipants(
  bookingRequestId: string,
  paymentMode: PaymentMode,
  participants: ParticipantInput[],
): Promise<BookingParticipant[]> {
  const { data, error } = await client.rpc<BookingParticipant[]>("set_booking_participants", {
    _booking_request_id: bookingRequestId,
    _payment_mode: paymentMode,
    _participants: participants,
  });
  if (error) throw new Error(error.message ?? "set_booking_participants_failed");
  return (data ?? []) as BookingParticipant[];
}

/** Lead's view of a booking's participants. */
export async function listBookingParticipants(bookingRequestId: string): Promise<BookingParticipant[]> {
  const { data, error } = await client
    .from("voyage_booking_participants")
    .select("*")
    .eq("booking_request_id", bookingRequestId)
    .order("is_lead", { ascending: false });
  if (error) throw new Error(error.message ?? "list_participants_failed");
  return (data ?? []) as BookingParticipant[];
}

/** The current user's pending/accepted participations (guest side). */
export async function listMyParticipations(): Promise<MyParticipation[]> {
  const { data, error } = await client.rpc<MyParticipation[]>("get_my_participations");
  if (error) throw new Error(error.message ?? "get_my_participations_failed");
  return (data ?? []) as MyParticipation[];
}

export async function acceptParticipation(participantId: string, candidateInfo?: CandidateInfo): Promise<BookingParticipant> {
  const { data, error } = await client.rpc<BookingParticipant>("accept_booking_participation", {
    _participant_id: participantId,
    _candidate_info: candidateInfo ?? null,
  });
  if (error) throw new Error(error.message ?? "accept_failed");
  return data as BookingParticipant;
}

export async function declineParticipation(participantId: string): Promise<void> {
  const { error } = await client.rpc("decline_booking_participation", { _participant_id: participantId });
  if (error) throw new Error(error.message ?? "decline_failed");
}

/** One row per person on a booking, as every member of that party may see them. */
export interface BookingPartyMember {
  participant_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  is_lead: boolean;
  status: BookingParticipant["status"] | "balance_unpaid";
  /** What this member owes for themselves — null when the lead covers the whole party. */
  share_due_cents: number | null;
  share_paid_cents: number;
  /** Deadline for their own share, armed when the contribution negotiation resolved. */
  share_payment_due_at: string | null;
  is_me: boolean;
}

/** Everyone on a booking with their own share and whether it is settled. Members only. */
export async function getBookingPartyOverview(bookingRequestId: string): Promise<BookingPartyMember[]> {
  const { data, error } = await client.rpc<BookingPartyMember[]>("get_booking_party_overview", {
    _booking_request_id: bookingRequestId,
  });
  if (error) throw new Error(error.message ?? "party_overview_failed");
  return (data ?? []) as BookingPartyMember[];
}

/**
 * The booker drops a guest who missed their share deadline. The other half of that decision —
 * calling the whole booking off — is the ordinary cancellation through /api/bookings/status,
 * so the refund tiers apply to it.
 */
export async function dropUnpaidGuestShare(participantId: string): Promise<void> {
  const { error } = await client.rpc("lead_drop_unpaid_guest_share", { _participant_id: participantId });
  if (error) throw new Error(error.message ?? "drop_guest_share_failed");
}

/** Trigger invite emails for a booking's pending guests. */
export async function sendBookingInvites(
  bookingRequestId: string,
  language: "it" | "en" = "it",
): Promise<{ sent: number; total: number } | { notConfigured: true }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("unauthenticated");

  const response = await fetch("/api/bookings/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingRequestId, language }),
  });
  if (response.status === 503) return { notConfigured: true };
  const payload = (await response.json().catch(() => ({}))) as { sent?: number; total?: number };
  return { sent: Number(payload.sent ?? 0), total: Number(payload.total ?? 0) };
}
