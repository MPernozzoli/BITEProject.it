import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } } }),
    },
  },
}));

import { fetchPaymentQuote } from "@/lib/booking-payment";

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("fetchPaymentQuote", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the server what the next payment collects, for the booking and payer given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        amountEur: 50,
        perPersonEur: 100,
        coveredPersons: 1,
        phase: "deposit",
        totalDueEur: 100,
        depositTargetEur: 50,
        maxSingleTransactionEur: 500,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPaymentQuote("booking-1", "participant-9");
    expect(result).toEqual({
      ok: true,
      quote: {
        amountEur: 50,
        perPersonEur: 100,
        coveredPersons: 1,
        phase: "deposit",
        totalDueEur: 100,
        depositTargetEur: 50,
        maxSingleTransactionEur: 500,
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/payments/bunq/quote");
    expect(JSON.parse(String(init.body))).toEqual({
      bookingRequestId: "booking-1",
      participantId: "participant-9",
    });
  });

  it("reports an already-settled payer as nothing due, not as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { nothingDue: true, reason: "already_settled" })));
    expect(await fetchPaymentQuote("booking-1")).toEqual({ ok: true, nothingDue: true });
  });

  it("surfaces the server's own error code so the caller can keep its fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: "payment_deadline_expired" })));
    expect(await fetchPaymentQuote("booking-1")).toEqual({ ok: false, error: "payment_deadline_expired" });
  });
});
