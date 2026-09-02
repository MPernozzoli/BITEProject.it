import { supabase } from "@/integrations/supabase/client";

/** "deposit" collects the upfront acconto; "balance" collects the remaining saldo. */
export type PaymentPhase = "deposit" | "balance";

/**
 * What the next payment on a booking will actually collect, straight from the server's own
 * pricing (POST /api/payments/bunq/quote). Every screen that shows a traveller an amount before
 * they pay it reads it from here: the acconto/saldo split, a partially settled deposit, or the
 * difference owed after a route change are all decided in one place instead of being guessed
 * from the leg formula by each caller.
 */
export type PaymentQuote = {
  amountEur: number;
  perPersonEur: number;
  coveredPersons: number;
  phase: PaymentPhase;
  totalDueEur: number;
  depositTargetEur: number;
  maxSingleTransactionEur: number;
};

export type PaymentQuoteResult =
  | { ok: true; quote: PaymentQuote }
  | { ok: true; nothingDue: true }
  | { ok: false; error: string };

export async function fetchPaymentQuote(
  bookingRequestId: string,
  participantId?: string | null,
): Promise<PaymentQuoteResult> {
  const token = await authToken();
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/payments/bunq/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bookingRequestId, participantId: participantId ?? null }),
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

  if (!response.ok) return { ok: false, error: String(payload.error ?? `http_${response.status}`) };
  if (payload.nothingDue === true) return { ok: true, nothingDue: true };
  return {
    ok: true,
    quote: {
      amountEur: Number(payload.amountEur ?? 0),
      perPersonEur: Number(payload.perPersonEur ?? 0),
      coveredPersons: Number(payload.coveredPersons ?? 1),
      phase: payload.phase === "balance" ? "balance" : "deposit",
      totalDueEur: Number(payload.totalDueEur ?? 0),
      depositTargetEur: Number(payload.depositTargetEur ?? 0),
      maxSingleTransactionEur: Number(payload.maxSingleTransactionEur ?? 500),
    },
  };
}

export type StartDepositResult =
  | {
      ok: true;
      shareUrl: string;
      amountEur: number;
      perPersonEur: number;
      phase: PaymentPhase;
      totalDueEur: number;
      depositTargetEur: number;
    }
  | { ok: true; alreadyPaid: true }
  | { ok: false; notConfigured: true }
  | { ok: false; error: string };

async function authToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

function normalizeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?bunq\.me\//i.test(trimmed)) return `https://${trimmed}`;
  return null;
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
    const shareUrl = normalizeExternalUrl(payload.shareUrl);
    if (!shareUrl) return { ok: false, error: "invalid_share_url" };
    return {
      ok: true,
      shareUrl,
      amountEur: Number(payload.amountEur ?? 0),
      perPersonEur: Number(payload.perPersonEur ?? 0),
      phase: payload.phase === "balance" ? "balance" : "deposit",
      totalDueEur: Number(payload.totalDueEur ?? 0),
      depositTargetEur: Number(payload.depositTargetEur ?? 0),
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
  phase: PaymentPhase;
  totalDueEur: number;
  depositTargetEur: number;
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
        phase: payload.phase === "balance" ? "balance" : "deposit",
        totalDueEur: Number(payload.totalDueEur ?? 0),
        depositTargetEur: Number(payload.depositTargetEur ?? 0),
      },
    };
  }
  return { ok: false, error: "no_bank_details" };
}

export type SettleIfZeroDueResult = { ok: true } | { ok: false; amountDue: true; amountEur: number } | { ok: false; error: string };

/**
 * Promotes a booking out of pending_payment with no deposit at all, for the one case where
 * that's legitimate: the server-side recompute confirms €0 is genuinely due (most commonly a
 * contribution-proposal application whose fixed share was waived because the candidate already
 * holds another active application on the same voyage).
 */
export async function settleBookingIfZeroDue(
  bookingRequestId: string,
  participantId?: string,
): Promise<SettleIfZeroDueResult> {
  const token = await authToken();
  if (!token) return { ok: false, error: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch("/api/bookings/settle-if-zero-due", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

  if (response.status === 409 && payload.error === "amount_due") {
    return { ok: false, amountDue: true, amountEur: Number(payload.amountEur ?? 0) };
  }
  if (!response.ok) {
    return { ok: false, error: String(payload.error ?? `http_${response.status}`) };
  }
  return { ok: true };
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
