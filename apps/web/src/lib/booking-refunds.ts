import { supabase } from "@/integrations/supabase/client";

export type BookingRefundTrigger =
  | "admin_cancelled"
  | "admin_rejected"
  | "user_cancelled"
  | "admin_plan_change_declined";

export type BookingRefundResult =
  | { ok: true; status: "cancelled" | "rejected"; refundPercent: number; refundAmountEur: number; refunded: boolean }
  | { ok: false; error: string };

async function authToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

export async function updateBookingStatusWithRefund(params: {
  bookingRequestId: string;
  status: "cancelled" | "rejected";
  trigger: BookingRefundTrigger;
  adminNotes?: string | null;
}): Promise<BookingRefundResult> {
  const token = await authToken();
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/bookings/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* ignore malformed body */
  }

  if (!response.ok) {
    return { ok: false, error: String(payload.error ?? `http_${response.status}`) };
  }

  return {
    ok: true,
    status: params.status,
    refundPercent: Number(payload.refundPercent ?? 0),
    refundAmountEur: Number(payload.refundAmountEur ?? 0),
    refunded: payload.refunded === true,
  };
}
