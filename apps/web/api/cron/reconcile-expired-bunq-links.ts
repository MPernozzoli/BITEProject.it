/**
 * GET /api/cron/reconcile-expired-bunq-links
 *
 * Runs on the same cadence as expire_pending_voyage_booking_payments (the Postgres sweep) and
 * follows up on every Bunq-link deposit it just cancelled: pg_cron is pure SQL and cannot reach
 * the Bunq REST API itself, so a bunq.me link survives our own deadline unless something on the
 * Node side closes it.
 *
 * For each recently-cancelled bunq_link deposit whose request-inquiry we have not closed yet:
 *   - if Bunq still shows it PENDING, revoke it — the link stops being payable, closing the
 *     window that let a late payment vanish into a deposit no reconciliation path still reads;
 *   - if Bunq already shows it ACCEPTED (the payer beat the sweep, or paid in the few seconds
 *     between the sweep and this run), reconcile it exactly as an admin's manual confirmation
 *     would, via reconcile_stale_bunq_deposit — the booking is put back in play instead of the
 *     money sitting on the account with no matching application.
 *
 * Auth: Vercel's own Cron Jobs call this with `Authorization: Bearer $CRON_SECRET`
 * (see vercel.json `crons` + the CRON_SECRET env var) — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs.
 */
import { createServiceClient } from "../../src/server/bunq/supabase.js";
import { bunqConfigured } from "../../src/server/bunq/client.js";
import { getBunqPaymentRequest, isPaidStatus, revokeBunqPaymentRequest } from "../../src/server/bunq/payment-requests.js";
import { sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";

// Bounds how far back the sweep looks: a deposit cancelled longer ago than this was almost
// certainly already handled by an earlier run, or is old enough that manual follow-up (refunds,
// support) has already taken over. Keeps each run cheap regardless of history.
const LOOKBACK_DAYS = 3;
const BATCH_LIMIT = 50;

type CandidateDeposit = {
  id: string;
  booking_request_id: string;
  bunq_request_id: number;
  amount_cents: number;
  reference: string | null;
};

function verifyCronSecret(req: NodeRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim() === `Bearer ${expected}`;
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
    .select("id, booking_request_id, bunq_request_id, amount_cents, reference")
    .eq("status", "cancelled")
    .eq("payment_method", "bunq_link")
    .not("bunq_request_id", "is", null)
    .is("bunq_request_closed_at", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  const candidates = (data ?? []) as CandidateDeposit[];
  let revoked = 0;
  let reconciled = 0;
  const failed: Array<{ depositId: string; error: string }> = [];

  for (const deposit of candidates) {
    try {
      const live = await getBunqPaymentRequest(deposit.bunq_request_id);
      if (isPaidStatus(live.status)) {
        // Bunq's own confirmed amount is the source of truth for what actually moved, not
        // whatever we had originally requested.
        const amountEur = Number(live.amountRespondedValue ?? live.amountValue ?? deposit.amount_cents / 100);
        const { error: rpcError } = await db.rpc("reconcile_stale_bunq_deposit", {
          _deposit_id: deposit.id,
          _amount_eur: amountEur,
          _reference: deposit.reference,
        });
        if (rpcError) throw new Error(rpcError.message);
        reconciled += 1;
      } else {
        await revokeBunqPaymentRequest(deposit.bunq_request_id);
        const { error: updateError } = await db
          .from("voyage_booking_deposits")
          .update({ bunq_request_closed_at: new Date().toISOString() })
          .eq("id", deposit.id);
        if (updateError) throw new Error(updateError.message);
        revoked += 1;
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

  sendJson(res, 200, { scanned: candidates.length, revoked, reconciled, failed });
}
