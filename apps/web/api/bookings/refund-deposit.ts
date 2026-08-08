/**
 * POST /api/bookings/refund-deposit
 *
 * Admin-only, single-deposit payout. Covers two cases outside the booking-level cancellation
 * refund flow (api/bookings/status.ts):
 *   - a deposit the balance-deadline sweep flagged `refund_pending` (a co-participant who had
 *     already paid in full when someone else's missed balance forfeited the booking or their
 *     own seat) — pays out the amount the sweep already decided;
 *   - a discretionary refund of an acconto the system forfeited by default
 *     (`refund_policy = 'balance_deadline_missed'`) — requires `percentOverride` since the
 *     policy default is 0%.
 *
 * Body: { depositId: string, percentOverride?: number }
 * Auth: Supabase access token in the Authorization: Bearer header (admin only).
 */
import { adminPayoutDeposit } from "../../src/server/bunq/refunds.js";
import { DepositHttpError, resolveCaller } from "../../src/server/bunq/deposit-resolver.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

type Body = { depositId?: string; percentOverride?: number };

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
  const percentOverride = typeof body.percentOverride === "number" ? body.percentOverride : null;

  try {
    const { db, user } = await resolveCaller(token);
    const result = await adminPayoutDeposit(db, user, depositId, percentOverride);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    const statusCode =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "refund_deposit_failed";
    if (statusCode >= 500) console.error("[bookings/refund-deposit] failed", error);
    sendJson(res, statusCode, { error: message });
  }
}
