/**
 * GET /api/payments/bunq/membership/status
 *
 * Polls the latest pending BITE Crew payment for the authenticated user and activates
 * the subscription when Bunq marks the request-inquiry as paid.
 */
import { createAuthClient, createServiceClient } from "../../../../src/server/bunq/supabase.js";
import { bunqConfigured } from "../../../../src/server/bunq/client.js";
import { getBunqPaymentRequest, isPaidStatus } from "../../../../src/server/bunq/payment-requests.js";
import {
  bearerToken,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../../src/server/http.js";

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return;
  }

  try {
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }

    const db = createServiceClient();
    const { data: payment } = await db
      .from("membership_payments")
      .select("id, tier_id, status, amount_cents, bunq_request_id, period_start, period_end")
      .eq("profile_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = payment as {
      id: string;
      tier_id: string;
      status: string;
      amount_cents: number;
      bunq_request_id: number | null;
      period_start: string;
      period_end: string | null;
    } | null;

    if (!row) {
      sendJson(res, 200, { status: "none" });
      return;
    }

    if (row.status === "pending" && row.bunq_request_id && bunqConfigured()) {
      const live = await getBunqPaymentRequest(row.bunq_request_id);
      if (isPaidStatus(live.status)) {
        const { data: existingSubscription } = await db
          .from("membership_subscriptions")
          .select("id")
          .eq("profile_id", userData.user.id)
          .in("status", ["trialing", "active", "past_due"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const subscriptionPayload = {
          profile_id: userData.user.id,
          tier_id: row.tier_id,
          status: "active",
          current_period_start: row.period_start,
          current_period_end: row.period_end,
          cancel_at_period_end: false,
          renewal_reminder_sent_at: null,
          expired_reminder_sent_at: null,
          grace_period_end: row.period_end,
        };

        const subscriptionResult = existingSubscription
          ? await db
              .from("membership_subscriptions")
              .update(subscriptionPayload)
              .eq("id", (existingSubscription as { id: string }).id)
              .select("id")
              .single()
          : await db
              .from("membership_subscriptions")
              .insert(subscriptionPayload)
              .select("id")
              .single();

        await db
          .from("membership_payments")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            subscription_id: (subscriptionResult.data as { id: string } | null)?.id ?? null,
          })
          .eq("id", row.id);

        sendJson(res, 200, { status: "paid", amountEur: row.amount_cents / 100 });
        return;
      }
    }

    sendJson(res, 200, { status: row.status, amountEur: row.amount_cents / 100 });
  } catch (error) {
    console.error("[bunq/membership/status] failed", error);
    sendJson(res, 500, { error: "membership_status_failed" });
  }
}
