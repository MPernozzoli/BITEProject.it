import { bunqRequest, accountPath } from "./client";

type BunqPaymentRequestCreateResponse = Array<{
  Id: { id: number };
}>;

type BunqPaymentRequestGetResponse = Array<{
  RequestInquiry: {
    id: number;
    bunqme_share_url: string | null;
    status: string;
    amount_inquired: { value: string; currency: string };
  };
}>;

export type CreatePaymentRequestInput = {
  amountEur: number;
  description: string;
  counterpartyEmail: string;
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
        counterparty_alias: {
          type: "EMAIL",
          value: input.counterpartyEmail,
          name: input.counterpartyEmail,
        },
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
  shareUrl: string;
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
    shareUrl: entry.bunqme_share_url ?? "",
  };
}

/** Whether a Bunq request-inquiry status means the payer has settled it. */
export function isPaidStatus(status: string): boolean {
  return status.toUpperCase() === "ACCEPTED";
}
