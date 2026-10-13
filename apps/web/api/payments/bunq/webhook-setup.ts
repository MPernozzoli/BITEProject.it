/**
 * GET|POST /api/payments/bunq/webhook-setup
 *
 * Operator endpoint for the Bunq → /api/payments/bunq/webhook callback. It runs here, inside the
 * deployed function, because it must reuse the Bunq installation persisted in Supabase: a
 * handshake from anywhere else would register a new device and could replace that context.
 *
 *  - GET  → read-only diagnostics: the account's current URL notification filters (secret
 *           redacted) and a dry run over the latest incoming payments — which reference each
 *           description carries, and which deposit (and amount) the webhook would match it to.
 *  - POST → registers MUTATION (every balance change, incoming transfers included) and REQUEST
 *           (request-inquiry updates, i.e. bunq.me links) on the webhook URL. Bunq replaces the
 *           whole filter list on POST, so filters pointing elsewhere are kept as they are.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. The callback URL carries BUNQ_WEBHOOK_SECRET as
 * ?secret=, which is what webhook.ts verifies.
 */
import { timingSafeEqual } from "node:crypto";
import { accountPath, bunqConfigured, bunqRequest, environment } from "../../../src/server/bunq/client.js";
import { extractReference } from "../../../src/server/bunq/payment-requests.js";
import { createServiceClient } from "../../../src/server/bunq/supabase.js";
import { bearerToken, firstQueryParam, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";

const WEBHOOK_PATH = "/api/payments/bunq/webhook";
const WEBHOOK_CATEGORIES = ["MUTATION", "REQUEST"] as const;
const DEFAULT_SCAN_COUNT = 20;

type NotificationFilter = { category: string; notification_target: string };
type NotificationFilterListResponse = Array<{ NotificationFilterUrl?: NotificationFilter }>;
type DepositRow = { status: string; amount_cents: number; payment_method: string | null };
type BunqPaymentListResponse = Array<{
  Payment?: {
    id: number;
    created?: string;
    description?: string;
    amount?: { value?: string; currency?: string };
    counterparty_alias?: { display_name?: string } | null;
  };
}>;

function sameSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorized(req: NodeRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = bearerToken(req);
  return Boolean(expected && supplied && sameSecret(supplied, expected));
}

function siteOrigin(): string {
  return (process.env.PUBLIC_SITE_URL?.trim() || "https://biteproject.it").replace(/\/+$/, "");
}

function webhookTarget(secret: string): string {
  return `${siteOrigin()}${WEBHOOK_PATH}?secret=${encodeURIComponent(secret)}`;
}

function redact(target: string): string {
  return target.replace(/([?&]secret=)[^&]+/i, "$1***");
}

function filtersPath(): string {
  return `${accountPath()}/notification-filter-url`;
}

async function listFilters(): Promise<NotificationFilter[]> {
  const result = await bunqRequest<NotificationFilterListResponse>(filtersPath());
  return result
    .map((entry) => entry.NotificationFilterUrl)
    .filter((filter): filter is NotificationFilter => Boolean(filter?.category && filter.notification_target));
}

async function dryRunIncoming(count: number) {
  const db = createServiceClient();
  const payments = (await bunqRequest<BunqPaymentListResponse>(`${accountPath()}/payment?count=${count}`))
    .map((entry) => entry.Payment)
    .filter((payment): payment is NonNullable<typeof payment> => Boolean(payment))
    .filter((payment) => Number(payment.amount?.value ?? 0) > 0);

  return Promise.all(
    payments.map(async (payment) => {
      const reference = extractReference(payment.description);
      const amountCents = Math.round(Number(payment.amount?.value ?? 0) * 100);
      let deposit = null as DepositRow | null;
      if (reference) {
        const { data } = await db
          .from("voyage_booking_deposits")
          .select("status, amount_cents, payment_method")
          .ilike("reference", `%${reference}%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        deposit = data as DepositRow | null;
      }
      return {
        id: payment.id,
        created: payment.created ?? null,
        amountEur: amountCents / 100,
        reference,
        deposit: deposit
          ? {
              status: deposit.status,
              method: deposit.payment_method,
              amountEur: deposit.amount_cents / 100,
              amountMatches: Math.abs(deposit.amount_cents - amountCents) <= 1,
              // What the webhook would do with this payment if it arrived now.
              webhookWouldSettle: deposit.status === "pending" && Math.abs(deposit.amount_cents - amountCents) <= 1,
            }
          : null,
      };
    }),
  );
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (!bunqConfigured()) {
    sendJson(res, 503, { error: "bunq_not_configured" });
    return;
  }
  const webhookSecret = process.env.BUNQ_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    sendJson(res, 503, { error: "bunq_webhook_secret_unset" });
    return;
  }

  try {
    const target = webhookTarget(webhookSecret);

    if (req.method === "POST") {
      const others = (await listFilters()).filter((filter) => !filter.notification_target.includes(WEBHOOK_PATH));
      const filters: NotificationFilter[] = [
        ...others,
        ...WEBHOOK_CATEGORIES.map((category) => ({ category, notification_target: target })),
      ];
      await bunqRequest(filtersPath(), { method: "POST", body: { notification_filters: filters } });
    }

    const filters = await listFilters();
    const count = Math.min(Math.max(Number(firstQueryParam(req, "count")) || DEFAULT_SCAN_COUNT, 1), 200);
    sendJson(res, 200, {
      environment: environment(),
      registered: WEBHOOK_CATEGORIES.every((category) =>
        filters.some((filter) => filter.category === category && filter.notification_target === target),
      ),
      filters: filters.map((filter) => ({ category: filter.category, target: redact(filter.notification_target) })),
      incoming: await dryRunIncoming(count),
    });
  } catch (error) {
    console.error("[bunq/webhook-setup] failed", error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : "webhook_setup_failed" });
  }
}
