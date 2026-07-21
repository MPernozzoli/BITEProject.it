import { bunqRequest, accountPath } from "./client.js";

type BunqPaymentRequestCreateResponse = Array<{
  Id: { id: number };
}>;

type BunqPaymentRequestGetResponse = Array<{
  RequestInquiry: {
    id: number;
    bunqme_share_url: string | null;
    status: string;
    amount_inquired: { value: string; currency: string };
    amount_responded?: { value: string; currency: string } | null;
    counterparty_alias?: BunqCounterpartyAlias | null;
  };
}>;

export type BunqCounterpartyAlias = {
  iban?: string;
  display_name?: string;
  name?: string;
  type?: string;
  value?: string;
  label_user?: { display_name?: string | null; public_nick_name?: string | null } | null;
};

const EMAIL_POINTER_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A Bunq-to-Bunq payer often surfaces only as an email in `label_user` (no IBAN, no
 * top-level pointer). Recover a routable EMAIL pointer from those fields so we can still
 * refund them — EMAIL is the same pointer type used when creating the request.
 */
export function aliasEmailPointer(alias: BunqCounterpartyAlias | null | undefined): string | null {
  if (!alias) return null;
  const candidates = [
    alias.type?.toUpperCase() === "EMAIL" ? alias.value : null,
    alias.label_user?.public_nick_name,
    alias.label_user?.display_name,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && EMAIL_POINTER_RE.test(trimmed)) return trimmed;
  }
  return null;
}

/** A Bunq alias can receive a refund only if it carries an IBAN, a pointer, or a payer email. */
export function isRefundableAlias(alias: BunqCounterpartyAlias | null | undefined): alias is BunqCounterpartyAlias {
  return Boolean(alias && (alias.iban || (alias.type && alias.value) || aliasEmailPointer(alias)));
}

export type CreatePaymentRequestInput = {
  amountEur: number;
  description: string;
  counterpartyEmail?: string;
  redirectUrl?: string;
};

/** Create a Bunq request-inquiry and return its id + shareable bunq.me link. */
export async function createBunqPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<{ id: number; shareUrl: string }> {
  const result = await bunqRequest<BunqPaymentRequestCreateResponse>(
    `${accountPath()}/request-inquiry`,
    {
      method: "POST",
      body: {
        amount_inquired: {
          value: input.amountEur.toFixed(2),
          currency: "EUR",
        },
        ...(input.counterpartyEmail
          ? {
              counterparty_alias: {
                type: "EMAIL",
                value: input.counterpartyEmail,
                name: input.counterpartyEmail,
              },
            }
          : {}),
        description: input.description,
        allow_bunqme: true,
        ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
      },
    },
  );

  const requestId = result[0]?.Id?.id;
  if (!requestId) throw new Error("bunq_payment_request_no_id");
  const request = await getBunqPaymentRequest(requestId);
  if (!request.shareUrl) throw new Error("bunq_payment_request_no_url");

  return { id: requestId, shareUrl: request.shareUrl };
}

/** Read the current state of a Bunq request-inquiry (used for status polling). */
export async function getBunqPaymentRequest(requestId: number): Promise<{
  id: number;
  status: string;
  amountValue: string;
  amountRespondedValue: string | null;
  shareUrl: string;
  counterpartyAlias: BunqCounterpartyAlias | null;
}> {
  const result = await bunqRequest<BunqPaymentRequestGetResponse>(
    `${accountPath()}/request-inquiry/${requestId}`,
  );

  const entry = result[0]?.RequestInquiry;
  if (!entry) throw new Error("bunq_payment_request_not_found");
  return {
    id: entry.id,
    status: entry.status,
    amountValue: entry.amount_inquired.value,
    amountRespondedValue: entry.amount_responded?.value ?? null,
    shareUrl: entry.bunqme_share_url ?? "",
    counterpartyAlias: entry.counterparty_alias ?? null,
  };
}

/** Whether a Bunq request-inquiry status means the payer has settled it. */
export function isPaidStatus(status: string): boolean {
  return status.toUpperCase() === "ACCEPTED";
}

type BunqPayment = {
  id: number;
  description: string;
  amount: { value: string; currency: string };
  counterparty_alias?: BunqCounterpartyAlias | null;
};

type BunqPagination = {
  older_url?: string | null;
  newer_url?: string | null;
  future_url?: string | null;
};

type BunqPaymentListResponse = Array<
  | { Payment: BunqPayment }
  | { Pagination: BunqPagination }
>;

const BUNQ_PAYMENT_SCAN_COUNT = 200;
const BUNQ_PAYMENT_SCAN_MAX_PAGES = 5;

/**
 * Scans the account's recent incoming payments for one whose description carries the given
 * reference — used to reconcile manual bank transfers, which have no request-inquiry to poll.
 */
export async function findIncomingPaymentByReference(
  reference: string,
  expectedAmountEur: number,
): Promise<boolean> {
  return Boolean(await findIncomingPaymentDetailsByReference(reference, expectedAmountEur));
}

export async function findIncomingPaymentDetailsByReference(
  reference: string,
  expectedAmountEur: number,
): Promise<{
  id: number;
  amountValue: string;
  counterpartyAlias: BunqCounterpartyAlias | null;
} | null> {
  const target = reference.toUpperCase();
  const expectedCents = Math.round(expectedAmountEur * 100);
  let path = `${accountPath()}/payment?count=${BUNQ_PAYMENT_SCAN_COUNT}`;

  for (let page = 0; page < BUNQ_PAYMENT_SCAN_MAX_PAGES; page += 1) {
    const result = await bunqRequest<BunqPaymentListResponse>(path);
    const matched = result
      .map((entry) => ("Payment" in entry ? entry.Payment : null))
      .find((payment) => {
        if (!payment?.description?.toUpperCase().includes(target)) return false;
        // Incoming transfers post as a positive amount. Match the exact expected amount,
        // allowing only the unavoidable 1-cent floating/formatting tolerance.
        const amountCents = Math.round(Number(payment.amount?.value ?? 0) * 100);
        return Math.abs(amountCents - expectedCents) <= 1;
      });
    if (matched) {
      return {
        id: matched.id,
        amountValue: matched.amount.value,
        counterpartyAlias: matched.counterparty_alias ?? null,
      };
    }

    const pagination = result.find((entry): entry is { Pagination: BunqPagination } => "Pagination" in entry)?.Pagination;
    const olderPath = normalizeBunqPaginationPath(pagination?.older_url);
    if (!olderPath) return null;
    path = olderPath;
  }

  return null;
}

function normalizeBunqPaginationPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const rawPath = url.startsWith("http")
    ? `${new URL(url).pathname}${new URL(url).search}`
    : url;
  const path = rawPath.replace(/^\/v1(?=\/)/, "");
  return path.startsWith("/") ? path : `/${path}`;
}

type BunqPaymentCreateResponse = Array<{
  Id: { id: number };
}>;

export async function createBunqOutgoingPayment(input: {
  amountEur: number;
  description: string;
  counterpartyAlias: BunqCounterpartyAlias;
}): Promise<{ id: number }> {
  const alias = normalizeCounterpartyAlias(input.counterpartyAlias);
  const result = await bunqRequest<BunqPaymentCreateResponse>(`${accountPath()}/payment`, {
    method: "POST",
    body: {
      amount: {
        value: (-Math.abs(input.amountEur)).toFixed(2),
        currency: "EUR",
      },
      counterparty_alias: alias,
      description: input.description.slice(0, 140),
    },
  });
  const paymentId = result[0]?.Id?.id;
  if (!paymentId) throw new Error("bunq_refund_payment_no_id");
  return { id: paymentId };
}

function normalizeCounterpartyAlias(alias: BunqCounterpartyAlias): Record<string, string> {
  const displayName = alias.display_name || alias.name || alias.label_user?.display_name || "BITE traveller";
  if (alias.iban) {
    return { type: "IBAN", value: alias.iban, name: displayName };
  }
  if (alias.type && alias.value) {
    return { type: alias.type, value: alias.value, name: displayName };
  }
  const email = aliasEmailPointer(alias);
  if (email) {
    return { type: "EMAIL", value: email, name: displayName };
  }
  throw new Error("bunq_counterparty_alias_not_refundable");
}
