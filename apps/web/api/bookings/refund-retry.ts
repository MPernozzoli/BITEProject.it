import { DepositHttpError, resolveCaller } from "../../src/server/bunq/deposit-resolver.js";
import { retryQueuedRefund } from "../../src/server/bunq/refunds.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

type Body = { depositId?: string };

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
  if (!depositId) {
    sendJson(res, 400, { error: "invalid_refund_request" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);
    const result = await retryQueuedRefund(db, user, depositId);
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
    const message = error instanceof Error ? error.message : "refund_retry_failed";
    if (statusCode >= 500) console.error("[bookings/refund-retry] failed", error);
    sendJson(res, statusCode, { error: message });
  }
}
