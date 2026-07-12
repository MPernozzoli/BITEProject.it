import { supabase } from "@/integrations/supabase/client";

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

export async function acceptParticipation(participantId: string): Promise<BookingParticipant> {
  const { data, error } = await client.rpc<BookingParticipant>("accept_booking_participation", {
    _participant_id: participantId,
  });
  if (error) throw new Error(error.message ?? "accept_failed");
  return data as BookingParticipant;
}

export async function declineParticipation(participantId: string): Promise<void> {
  const { error } = await client.rpc("decline_booking_participation", { _participant_id: participantId });
  if (error) throw new Error(error.message ?? "decline_failed");
}

/** Trigger invite emails for a booking's pending guests. */
export async function sendBookingInvites(bookingRequestId: string): Promise<{ sent: number; total: number } | { notConfigured: true }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("unauthenticated");

  const response = await fetch("/api/bookings/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingRequestId }),
  });
  if (response.status === 503) return { notConfigured: true };
  const payload = (await response.json().catch(() => ({}))) as { sent?: number; total?: number };
  return { sent: Number(payload.sent ?? 0), total: Number(payload.total ?? 0) };
}
