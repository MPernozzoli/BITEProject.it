/**
 * GET /api/cron/reconcile-expired-bunq-links
 *
 * Runs on the same cadence as the SQL sweeps that cancel a deposit's booking
 * (expire_pending_voyage_booking_payments, expire_unpaid_voyage_booking_contribution_settlement):
 * pg_cron is pure SQL and cannot reach the Bunq REST API itself, so a bunq.me link survives our
 * own deadline unless something on the Node side closes it, and a matching bank transfer that
 * arrives late is never even looked at unless something scans for it.
 *
 * For each recently-cancelled deposit whose payment we have not closed out yet:
 *  - bunq_link, still PENDING on Bunq's side → revoke it. The link stops being payable, closing
 *    the window that let a late payment vanish into a deposit no reconciliation path still reads.
 *  - bunq_link, already ACCEPTED (the payer beat the sweep, or paid in the few seconds between
 *    the sweep and this run) → behaviour depends on WHY it was cancelled (deposit.expiry_kind):
 *      - null/legacy (the first-payment-gate sweep, before the application was ever reviewed):
 *        reconcile it exactly as an admin's manual confirmation would, via
 *        reconcile_stale_bunq_deposit — the booking is put back in play, unchanged from before.
 *      - 'contribution_settlement' (the 24h post-negotiation deadline): the booking is not
 *        coming back — refund the payment instead, and tell the payer why.
 *  - bank_transfer, tagged 'contribution_settlement' → the only kind that can arrive without a
 *    Bunq object to poll: scan incoming payments by reference/amount, and if one landed, refund
 *    it the same way. Legacy bank-transfer cancellations are not scanned here: they were never
 *    reactivated automatically even before this endpoint existed (expire_stale_voyage_booking_
 *    topup_deposits just lets a fresh reference be minted), so this does not change that.
 *
 * Auth: Vercel's own Cron Jobs call this with `Authorization: Bearer $CRON_SECRET`
 * (see vercel.json `crons` + the CRON_SECRET env var) — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs.
 */
import { createServiceClient } from "../../src/server/bunq/supabase.js";
import { bunqConfigured } from "../../src/server/bunq/client.js";
import {
  findIncomingPaymentDetailsByReference,
  getBunqPaymentRequest,
  isPaidStatus,
  revokeBunqPaymentRequest,
} from "../../src/server/bunq/payment-requests.js";
import { refundLateCancelledDeposit, type DepositRefundRow } from "../../src/server/bunq/refunds.js";
import { enqueueAdminBookingNotification, enqueueBookingNotification } from "../../src/server/bunq/deposit-resolver.js";
import { sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";

// Bounds how far back the sweep looks: a deposit cancelled longer ago than this was almost
// certainly already handled by an earlier run, or is old enough that manual follow-up (refunds,
// support) has already taken over. Keeps each run cheap regardless of history.
const LOOKBACK_DAYS = 3;
const BATCH_LIMIT = 50;

type CandidateDeposit = DepositRefundRow & {
  expiry_kind: string | null;
};

function verifyCronSecret(req: NodeRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim() === `Bearer ${expected}`;
}

async function notifyLatePayment(
  db: ReturnType<typeof createServiceClient>,
  deposit: CandidateDeposit,
  outcome: { refunded: boolean; pending: boolean; amountCents: number },
): Promise<void> {
  const { data: request } = await db
    .from("voyage_booking_requests")
    .select("profile_id")
    .eq("id", deposit.booking_request_id)
    .maybeSingle();
  const recipientProfileId = (request as { profile_id?: string | null } | null)?.profile_id;
  const metadata = {
    amount_eur: outcome.amountCents / 100,
    refunded: outcome.refunded,
    refund_pending: outcome.pending,
    refund_pending_amount_eur: outcome.pending ? outcome.amountCents / 100 : 0,
  };
  if (recipientProfileId) {
    await enqueueBookingNotification(db, {
      bookingRequestId: deposit.booking_request_id,
      recipientProfileId,
      eventType: "late_payment_after_cancellation",
      metadata,
      resend: true,
    });
  }
  await enqueueAdminBookingNotification(db, deposit.booking_request_id, "admin_late_payment_after_cancellation", metadata, {
    resend: true,
  });
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!verifyCronSecret(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (!bunqConfigured()) {
    sendJson(res, 200, { skipped: "bunq_not_configured" });
    return;
  }

  const db = createServiceClient();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("voyage_booking_deposits")
    .select(
      "id, booking_request_id, participant_id, environment, payment_method, amount_cents, status, bunq_request_id, reference, payer_alias, refund_amount_cents, expiry_kind",
    )
    .eq("status", "cancelled")
    .is("bunq_request_closed_at", null)
    .gte("updated_at", since)
    // bunq_link is always worth checking (revoke-if-pending applies regardless of why it was
    // cancelled); a bank_transfer only has anything to scan for in the new settlement-deadline
    // case — the legacy one never reconciled a late bank transfer automatically either.
    .or("payment_method.eq.bunq_link,and(payment_method.eq.bank_transfer,expiry_kind.eq.contribution_settlement)")
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  const candidates = (data ?? []) as CandidateDeposit[];
  let revoked = 0;
  let reconciled = 0;
  let refunded = 0;
  let refundPending = 0;
  const failed: Array<{ depositId: string; error: string }> = [];

  for (const deposit of candidates) {
    try {
      if (deposit.payment_method === "bunq_link") {
        if (!deposit.bunq_request_id) continue;
        const live = await getBunqPaymentRequest(deposit.bunq_request_id);
        if (isPaidStatus(live.status)) {
          // Bunq's own confirmed amount is the source of truth for what actually moved, not
          // whatever we had originally requested.
          const actualAmountCents = Math.round(
            Number(live.amountRespondedValue ?? live.amountValue ?? deposit.amount_cents / 100) * 100,
          );
          if (deposit.expiry_kind === "contribution_settlement") {
            const outcome = await refundLateCancelledDeposit(db, deposit, actualAmountCents, "no_payer_alias");
            await notifyLatePayment(db, deposit, outcome);
            if (outcome.refunded) refunded += 1;
            if (outcome.pending) refundPending += 1;
          } else {
            const { error: rpcError } = await db.rpc("reconcile_stale_bunq_deposit", {
              _deposit_id: deposit.id,
              _amount_eur: actualAmountCents / 100,
              _reference: deposit.reference,
            });
            if (rpcError) throw new Error(rpcError.message);
            reconciled += 1;
          }
        } else {
          await revokeBunqPaymentRequest(deposit.bunq_request_id);
          const { error: updateError } = await db
            .from("voyage_booking_deposits")
            .update({ bunq_request_closed_at: new Date().toISOString() })
            .eq("id", deposit.id);
          if (updateError) throw new Error(updateError.message);
          revoked += 1;
        }
      } else {
        // bank_transfer + expiry_kind === 'contribution_settlement' (the only combination the
        // query above returns): no Bunq object to revoke, only an incoming payment to look for.
        const transfer = await findIncomingPaymentDetailsByReference(deposit.reference, deposit.amount_cents / 100);
        if (transfer) {
          const outcome = await refundLateCancelledDeposit(db, deposit, deposit.amount_cents, "no_payer_alias");
          await notifyLatePayment(db, deposit, outcome);
          if (outcome.refunded) refunded += 1;
          if (outcome.pending) refundPending += 1;
        }
        // Not found: nothing arrived (yet) — leave it for a later run within the lookback window.
      }
    } catch (itemError) {
      // One bad item (a request Bunq already can't find, a transient API error) must never
      // block the rest of the batch — same resilience posture as the webhook handler.
      console.error("[cron/reconcile-expired-bunq-links] item failed", deposit.id, itemError);
      failed.push({
        depositId: deposit.id,
        error: itemError instanceof Error ? itemError.message : String(itemError),
      });
    }
  }

  sendJson(res, 200, { scanned: candidates.length, revoked, reconciled, refunded, refundPending, failed });
}
