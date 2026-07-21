import { DepositHttpError, resolveCaller } from "../../src/server/bunq/deposit-resolver.js";
import { submitManualRefund } from "../../src/server/bunq/refunds.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

type Body = {
  depositId?: string;
  accountHolder?: string;
  iban?: string;
  bic?: string | null;
};

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  let body: Body;
  try {
    body = await readJsonBody<Body>(req);
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const depositId = String(body.depositId ?? "").trim();
  const accountHolder = String(body.accountHolder ?? "").trim();
  const iban = String(body.iban ?? "").trim();
  const bic = body.bic == null ? "" : String(body.bic).trim();
  if (!depositId) {
    sendJson(res, 400, { error: "invalid_refund_request" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);
    const result = await submitManualRefund(db, user, { depositId, accountHolder, iban, bic });
    sendJson(res, 200, { ok: true, amountEur: result.amountEur, reference: result.reference });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    const statusCode =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    // A rejected Bunq payment is an expected, user-actionable outcome (bad IBAN etc.) — pass
    // the message through so the form can show it, but never leak an unexpected 500 body.
    const rejected = Boolean(error && typeof error === "object" && "refundRejected" in error);
    const message = error instanceof Error ? error.message : "booking_refund_failed";
    if (statusCode >= 500 && !rejected) {
      console.error("[bookings/refund] failed", error);
    }
    sendJson(res, statusCode, { error: message, ...(rejected ? { refundRejected: true } : {}) });
  }
}
