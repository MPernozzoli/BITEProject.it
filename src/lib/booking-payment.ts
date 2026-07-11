import { supabase } from "@/integrations/supabase/client";

export type StartDepositResult =
  | { ok: true; shareUrl: string; amountEur: number; perPersonEur: number }
  | { ok: true; alreadyPaid: true }
  | { ok: false; notConfigured: true }
  | { ok: false; error: string };

/**
 * Ask the backend to create a Bunq contribution payment request for a freshly-created booking.
 * On success returns the bunq.me share URL the caller should redirect the user to.
 */
export async function startDepositPayment(
  bookingRequestId: string,
  participantId?: string,
): Promise<StartDepositResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/payments/bunq/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bookingRequestId, participantId }),
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (response.status === 503) return { ok: false, notConfigured: true };

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* ignore malformed body */
  }

  if (!response.ok) {
    return { ok: false, error: String(payload.error ?? `http_${response.status}`) };
  }
  if (payload.alreadyPaid === true) return { ok: true, alreadyPaid: true };
  if (typeof payload.shareUrl === "string" && payload.shareUrl.length > 0) {
    return {
      ok: true,
      shareUrl: payload.shareUrl,
      amountEur: Number(payload.amountEur ?? 0),
      perPersonEur: Number(payload.perPersonEur ?? 0),
    };
  }
  return { ok: false, error: "no_share_url" };
}
