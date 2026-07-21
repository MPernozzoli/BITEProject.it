import { supabase } from "@/integrations/supabase/client";

export type BookingRefundTrigger =
  | "admin_cancelled"
  | "admin_rejected"
  | "user_cancelled"
  | "admin_plan_change_declined";

/**
 * Narrow with `result.ok === false`, not `!result.ok`: the project compiles with
 * strictNullChecks off, and TypeScript only discriminates a boolean tag on an
 * explicit comparison.
 */
export type BookingRefundResult =
  | {
      ok: true;
      status: "cancelled" | "rejected";
      refundPercent: number;
      refundAmountEur: number;
      refunded: boolean;
      /** A refund is owed but could not be paid automatically (no IBAN on file). */
      refundPending: boolean;
      refundPendingAmountEur: number;
    }
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
  /** Raises the refund above the policy result; ignored when lower than what the policy owes. */
  refundPercentOverride?: number | null;
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
    refundPending: payload.refundPending === true,
    refundPendingAmountEur: Number(payload.refundPendingAmountEur ?? 0),
  };
}
