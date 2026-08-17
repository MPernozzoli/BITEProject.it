/**
 * POST /api/bookings/invite
 *
 * Sends the "you're invited aboard" email to every still-pending guest of a booking the
 * caller owns, then marks them as invited. Idempotent: guests already emailed (unless
 * `resend` is set) are skipped.
 *
 * Body: { bookingRequestId: string, resend?: boolean }
 * Auth: Supabase access token in the Authorization: Bearer header.
 */
import { createAuthClient, createServiceClient } from "../../src/server/bunq/supabase.js";
import { perPersonDepositEur, type DepositLeg } from "../../src/lib/booking-deposit.js";
import {
  bearerToken,
  readJsonBody,
  sendJson,
  type NodeRequest,
  type NodeResponse,
} from "../../src/server/http.js";

function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL || process.env.VITE_SITE_URL || "https://biteproject.it").replace(/\/$/, "");
}

async function sendInviteEmail(params: {
  supabaseUrl: string;
  serviceKey: string;
  recipientEmail: string;
  templateData: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const res = await fetch(`${params.supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.serviceKey}`,
      },
      body: JSON.stringify({
        templateName: "voyage-participant-invite",
        recipientEmail: params.recipientEmail,
        templateData: params.templateData,
      }),
    });
    return res.ok;
  } catch (error) {
    console.error("[bookings/invite] email send failed", error);
    return false;
  }
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

  let bookingRequestId: string;
  let resend = false;
  let requestedLanguage: "it" | "en" = "it";
  try {
    const body = await readJsonBody<{ bookingRequestId?: string; resend?: boolean; language?: string }>(req);
    bookingRequestId = String(body.bookingRequestId ?? "").trim();
    resend = body.resend === true;
    requestedLanguage = body.language === "en" ? "en" : "it";
    if (!bookingRequestId) {
      sendJson(res, 400, { error: "missing_booking_request_id" });
      return;
    }
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) {
    sendJson(res, 503, { error: "not_configured" });
    return;
  }

  try {
    // 1. Resolve the caller and verify booking ownership/admin permission.
    const auth = createAuthClient();
    const { data: userData, error: userError } = await auth.auth.getUser(token);
    if (userError || !userData?.user) {
      sendJson(res, 401, { error: "unauthenticated" });
      return;
    }
    const user = userData.user;
    const db = createServiceClient();

    const { data: request } = await db
      .from("voyage_booking_requests")
      .select("id, profile_id, voyage_id, payment_mode")
      .eq("id", bookingRequestId)
      .maybeSingle();
    const { data: roleRows } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1);
    const isAdmin = (roleRows ?? []).length > 0;
    if (!request || ((request as { profile_id: string }).profile_id !== user.id && !isAdmin)) {
      sendJson(res, 404, { error: "booking_not_found" });
      return;
    }
    const voyageId = (request as { voyage_id: string }).voyage_id;
    const paymentMode = (request as { payment_mode?: string }).payment_mode ?? "lead_pays_all";
    const requiresPayment = paymentMode === "each_pays_own";

    // 2. Gather email context: voyage name, inviter name, per-person contribution.
    const [{ data: voyage }, { data: inviter }] = await Promise.all([
      db.from("voyages").select("name, name_it, name_en, booking_contribution_per_nm_eur").eq("id", voyageId).maybeSingle(),
      db.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    ]);
    const language = requestedLanguage;
    // The voyage name has to follow the email's own language, not default to the Italian one:
    // an English invite naming an Italian-only voyage reads as a half-translated email.
    const voyageRow = voyage as { name_it?: string; name_en?: string; name?: string } | null;
    const voyageName =
      (language === "en" ? voyageRow?.name_en : voyageRow?.name_it) ||
      (language === "en" ? voyageRow?.name_it : voyageRow?.name_en) ||
      voyageRow?.name ||
      "";
    const inviterName = (inviter as { name?: string } | null)?.name || "";
    const contributionPerNmEur = Number(
      (voyage as { booking_contribution_per_nm_eur?: number } | null)?.booking_contribution_per_nm_eur ?? 0.9,
    );

    let depositEur = 0;
    if (requiresPayment) {
      const { data: legLinks } = await db
        .from("voyage_booking_request_legs")
        .select("bookable_leg_id")
        .eq("booking_request_id", bookingRequestId);
      const legIds = (legLinks ?? []).map((l) => (l as { bookable_leg_id: string }).bookable_leg_id);
      if (legIds.length) {
        const { data: legRows } = await db
          .from("voyage_bookable_legs")
          .select(
            "planned_nautical_miles, open_sea, danger_level, starts_at_window_start, ends_at_window_start",
          )
          .in("id", legIds);
        depositEur = perPersonDepositEur((legRows ?? []) as DepositLeg[], { contributionPerNmEur });
      }
    }

    // 3. Load pending guests to invite.
    let query = db
      .from("voyage_booking_participants")
      .select("id, email, first_name, invite_sent_at")
      .eq("booking_request_id", bookingRequestId)
      .eq("is_lead", false)
      .eq("status", "pending");
    if (!resend) query = query.is("invite_sent_at", null);
    const { data: guests } = await query;

    const rows = (guests ?? []) as Array<{ id: string; email: string; first_name: string | null }>;
    let sent = 0;
    for (const guest of rows) {
      const ok = await sendInviteEmail({
        supabaseUrl,
        serviceKey,
        recipientEmail: guest.email,
        templateData: {
          language,
          recipientName: guest.first_name || "",
          inviterName,
          voyageName,
          requiresPayment,
          depositEur: requiresPayment ? depositEur : 0,
          bookingUrl: `${siteUrl()}/${language}/bookings`,
        },
      });
      if (ok) {
        await db
          .from("voyage_booking_participants")
          .update({ invite_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", guest.id);
        sent += 1;
      }
    }

    sendJson(res, 200, { sent, total: rows.length });
  } catch (error) {
    console.error("[bookings/invite] failed", error);
    sendJson(res, 500, { error: "invite_failed" });
  }
}
