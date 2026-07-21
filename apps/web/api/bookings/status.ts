import {
  DepositHttpError,
  resolveCaller,
} from "../../src/server/bunq/deposit-resolver.js";
import {
  assertRefundActionAllowed,
  markBookingCancelledAfterRefund,
  refundBookingDeposits,
  type RefundTrigger,
} from "../../src/server/bunq/refunds.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

type Body = {
  bookingRequestId?: string;
  status?: string;
  trigger?: RefundTrigger;
  adminNotes?: string | null;
};

function isRefundTrigger(value: string): value is RefundTrigger {
  return (
    value === "admin_cancelled" ||
    value === "admin_rejected" ||
    value === "user_cancelled" ||
    value === "admin_plan_change_declined"
  );
}

function eventFor(trigger: RefundTrigger): "cancelled" | "rejected" {
  return trigger === "admin_rejected" ? "rejected" : "cancelled";
}

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

  const bookingRequestId = String(body.bookingRequestId ?? "").trim();
  const status = String(body.status ?? "").trim();
  const trigger = String(body.trigger ?? "").trim();
  if (!bookingRequestId || !isRefundTrigger(trigger)) {
    sendJson(res, 400, { error: "invalid_refund_request" });
    return;
  }
  if ((trigger === "admin_rejected" && status !== "rejected") || (trigger !== "admin_rejected" && status !== "cancelled")) {
    sendJson(res, 400, { error: "status_trigger_mismatch" });
    return;
  }

  try {
    const { db, user } = await resolveCaller(token);
    const booking = await assertRefundActionAllowed(db, user, bookingRequestId, trigger);
    const refund = await refundBookingDeposits(db, booking, trigger);
    await markBookingCancelledAfterRefund(db, booking, eventFor(trigger), {
      refund_policy: trigger,
      refund_percent: refund.policyPercent,
      refund_amount_eur: refund.totalRefundCents / 100,
      refund_pending: refund.refundPending,
      refund_pending_amount_eur: refund.pendingRefundCents / 100,
      admin_message: body.adminNotes || null,
    });

    if (trigger === "admin_plan_change_declined") {
      await db
        .from("voyage_booking_plan_changes")
        .update({ status: "cancelled", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("booking_request_id", bookingRequestId)
        .eq("status", "pending_user_approval");
      await db
        .from("voyage_booking_requests")
        .update({
          plan_change_status: "none",
          plan_change_resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingRequestId);
    }

    sendJson(res, 200, {
      ok: true,
      status,
      refundPercent: refund.policyPercent,
      refundAmountEur: refund.totalRefundCents / 100,
      refunded: refund.refundable,
      refundPending: refund.refundPending,
      refundPendingAmountEur: refund.pendingRefundCents / 100,
    });
  } catch (error) {
    if (error instanceof DepositHttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    const statusCode =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "booking_status_failed";
    console.error("[bookings/status] failed", error);
    sendJson(res, statusCode, { error: message });
  }
}
