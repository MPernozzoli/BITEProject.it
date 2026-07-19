/**
 * POST /api/payments/bunq/membership/request
 *
 * Creates a Bunq payment request for a BITE Crew tier. This is separate from voyage
 * deposits: amounts are recalculated from membership_tiers server-side.
 */
import { randomUUID } from "node:crypto";
import { createAuthClient, createServiceClient } from "../../../../src/server/bunq/supabase.js";
import { bunqConfigured, environment } from "../../../../src/server/bunq/client.js";
import { createBunqPaymentRequest } from "../../../../src/server/bunq/payment-requests.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../../../src/server/http.js";

const crewUrl = () =>
  (process.env.PUBLIC_CREW_URL || process.env.VITE_CREW_URL || "https://crew.biteproject.it").replace(/\/$/, "");

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

  let tierId = "";
  let quantity = 1;
  try {
    const body = await readJsonBody<{ tierId?: string; quantity?: number }>(req);
    tierId = String(body.tierId ?? "").trim();
    quantity = Math.max(1, Math.min(3, Number(body.quantity ?? 1) || 1));
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }
  if (!tierId) {
    sendJson(res, 400, { error: "missing_tier_id" });
    return;
  }

  if (!bunqConfigured()) {
    sendJson(res, 503, { error: "not_configured" });
    return;
  }

  try {
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user?.email) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }

    const db = createServiceClient();
    const { data: tier, error: tierError } = await db
      .from("membership_tiers")
      .select("id, slug, name, price_cents, currency, billing_interval, is_active")
      .eq("id", tierId)
      .maybeSingle();
    const selectedTier = tier as { id: string; slug: string; name: string; price_cents: number; currency: string; billing_interval: string; is_active: boolean } | null;
    if (tierError || !selectedTier?.is_active) {
      sendJson(res, 404, { error: "tier_not_found" });
      return;
    }

    const { data: active } = await db
      .from("membership_subscriptions")
      .select("id, tier_id, status, current_period_end")
      .eq("profile_id", userData.user.id)
      .in("status", ["trialing", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: pending } = await db
      .from("membership_payments")
      .select("id, share_url, amount_cents, reference")
      .eq("profile_id", userData.user.id)
      .eq("tier_id", selectedTier.id)
      .eq("status", "pending")
      .eq("period_count", quantity)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending?.share_url) {
      sendJson(res, 200, {
        shareUrl: (pending as { share_url: string }).share_url,
        amountEur: (pending as { amount_cents: number }).amount_cents / 100,
        reference: (pending as { reference: string }).reference,
      });
      return;
    }

    const amountCents = selectedTier.price_cents * quantity;
    const amountEur = amountCents / 100;
    const reference = `CREW-${selectedTier.slug.slice(0, 8)}-${quantity}X-${randomUUID().slice(0, 6)}`.toUpperCase();
    const description = `BITE Crew Pass ${selectedTier.name} ${quantity}x — ${reference}`;

    const created = await createBunqPaymentRequest({
      amountEur,
      description,
      counterpartyEmail: userData.user.email,
      redirectUrl: `${crewUrl()}?membership=processing`,
    });

    const activeRow = active as { tier_id: string; current_period_end: string | null } | null;
    const now = new Date();
    const activeEnd = activeRow?.tier_id === selectedTier.id && activeRow.current_period_end
      ? new Date(activeRow.current_period_end)
      : null;
    const periodStart = activeEnd && activeEnd > now ? activeEnd : now;
    const periodEnd = new Date(periodStart);
    if (selectedTier.billing_interval === "year") {
      periodEnd.setFullYear(periodEnd.getFullYear() + quantity);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + quantity);
    }

    const { error: insertError } = await db.from("membership_payments").insert({
      profile_id: userData.user.id,
      tier_id: selectedTier.id,
      environment: environment(),
      payment_method: "bunq_link",
      amount_cents: amountCents,
      currency: selectedTier.currency,
      status: "pending",
      bunq_request_id: created.id,
      share_url: created.shareUrl,
      reference,
      period_count: quantity,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      metadata: {
        renewal_policy: "manual",
        billing_interval: selectedTier.billing_interval,
        period_count: quantity,
      },
    });
    if (insertError) throw new Error(insertError.message);

    sendJson(res, 200, {
      shareUrl: created.shareUrl,
      amountEur,
      reference,
    });
  } catch (error) {
    console.error("[bunq/membership/request] failed", error);
    sendJson(res, 500, { error: "membership_request_failed" });
  }
}
