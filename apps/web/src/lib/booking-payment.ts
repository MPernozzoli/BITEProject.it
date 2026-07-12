import { supabase } from "@/integrations/supabase/client";

export type StartDepositResult =
  | { ok: true; shareUrl: string; amountEur: number; perPersonEur: number }
  | { ok: true; alreadyPaid: true }
  | { ok: false; notConfigured: true }
  | { ok: false; error: string };

async function authToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

/**
 * Ask the backend to create a Bunq contribution payment request for a freshly-created booking.
 * On success returns the bunq.me share URL the caller should redirect the user to.
 */
export async function startDepositPayment(
  bookingRequestId: string,
  participantId?: string,
): Promise<StartDepositResult> {
  const token = await authToken();
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

export type BankTransferDetails = {
  iban: string;
  bic: string;
  holder: string;
  reference: string;
  amountEur: number;
  perPersonEur: number;
};

export type StartBankTransferResult =
  | { ok: true; details: BankTransferDetails }
  | { ok: true; alreadyPaid: true }
  | { ok: false; error: string };

/**
 * Ask the backend for the bank-transfer details (IBAN, BIC, holder, causale) for a booking's
 * contribution — the manual fallback when the Bunq online link can't be used.
 */
export async function startBankTransferDeposit(
  bookingRequestId: string,
  participantId?: string,
): Promise<StartBankTransferResult> {
  const token = await authToken();
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/payments/bunq/bank-transfer", {
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
  if (typeof payload.iban === "string" && typeof payload.reference === "string") {
    return {
      ok: true,
      details: {
        iban: payload.iban,
        bic: String(payload.bic ?? ""),
        holder: String(payload.holder ?? ""),
        reference: payload.reference,
        amountEur: Number(payload.amountEur ?? 0),
        perPersonEur: Number(payload.perPersonEur ?? 0),
      },
    };
  }
  return { ok: false, error: "no_bank_details" };
}

export type DepositStatus = "none" | "pending" | "paid" | "refunded" | "failed" | "cancelled";

/** Polls the current settlement status of a booking's contribution deposit. */
export async function checkDepositStatus(
  bookingRequestId: string,
  participantId?: string,
): Promise<{ status: DepositStatus } | null> {
  const token = await authToken();
  if (!token) return null;

  const params = new URLSearchParams({ bookingRequestId });
  if (participantId) params.set("participantId", participantId);

  let response: Response;
  try {
    response = await fetch(`/api/payments/bunq/status?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    const payload = (await response.json()) as { status?: string };
    const status = payload.status;
    if (
      status === "none" ||
      status === "pending" ||
      status === "paid" ||
      status === "refunded" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return { status };
    }
    return null;
  } catch {
    return null;
  }
}
