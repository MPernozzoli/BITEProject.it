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
  label_user?: { display_name?: string | null } | null;
};

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

type BunqPaymentListResponse = Array<{
  Payment: {
    id: number;
    description: string;
    amount: { value: string; currency: string };
    counterparty_alias?: BunqCounterpartyAlias | null;
  };
}>;

/**
 * Scans the account's recent incoming payments for one whose description carries the given
 * reference — used to reconcile manual bank transfers, which have no request-inquiry to poll.
 */
export async function findIncomingPaymentByReference(
  reference: string,
  minAmountEur: number,
): Promise<boolean> {
  return Boolean(await findIncomingPaymentDetailsByReference(reference, minAmountEur));
}

export async function findIncomingPaymentDetailsByReference(
  reference: string,
  minAmountEur: number,
): Promise<{
  id: number;
  amountValue: string;
  counterpartyAlias: BunqCounterpartyAlias | null;
} | null> {
  const result = await bunqRequest<BunqPaymentListResponse>(`${accountPath()}/payment?count=50`);
  const target = reference.toUpperCase();
  const matched = result.find(({ Payment: payment }) => {
    if (!payment?.description?.toUpperCase().includes(target)) return false;
    const amount = Number(payment.amount?.value ?? 0);
    // Incoming transfers post as a positive amount; require it to cover the expected share.
    return amount >= minAmountEur - 0.01;
  });
  if (!matched?.Payment) return null;
  return {
    id: matched.Payment.id,
    amountValue: matched.Payment.amount.value,
    counterpartyAlias: matched.Payment.counterparty_alias ?? null,
  };
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
  throw new Error("bunq_counterparty_alias_not_refundable");
}
