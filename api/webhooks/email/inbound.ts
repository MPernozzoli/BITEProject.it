import { parseEmailAddress } from "@pynkstudio/mailapp/core";
import { sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import {
  createMailServiceClient,
  detectMailBrand,
  normalizeAddress,
  readRawBody,
  verifySvixSignature,
} from "../../../src/server/mail.js";
import { resolveMailAssignment, sendMailPushNotification } from "../../../src/server/mail-push.js";

type ResendPayload = {
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function normalizeHeaders(raw: unknown): Array<{ name: string; value: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        item && typeof item === "object"
          ? { name: String((item as { name?: unknown }).name ?? ""), value: String((item as { value?: unknown }).value ?? "") }
          : null,
      )
      .filter(Boolean) as Array<{ name: string; value: string }>;
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({ name, value: String(value ?? "") }));
  }
  return [];
}

function extractMessageId(headers: Array<{ name: string; value: string }>): string | null {
  return headers.find((header) => header.name.toLowerCase() === "message-id")?.value ?? null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function eventToStatus(type: string): string | null {
  if (type === "email.delivered") return "delivered";
  if (type === "email.delivery_delayed") return "delivery_delayed";
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "complained";
  if (type === "email.opened") return "opened";
  if (type === "email.clicked") return "clicked";
  return null;
}

function nestedEmailId(data: Record<string, unknown>): string {
  const email = data.email;
  if (email && typeof email === "object" && "id" in email) {
    const id = (email as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  }
  return "";
}

async function isSpamSender(address: string): Promise<boolean> {
  const db = createMailServiceClient();
  const { data } = await db.from("email_spam_senders").select("id").eq("address", normalizeAddress(address)).maybeSingle();
  return Boolean(data);
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifySvixSignature(req, rawBody)) {
    sendJson(res, 401, { error: "invalid_signature" });
    return;
  }

  let payload: ResendPayload;
  try {
    payload = JSON.parse(rawBody) as ResendPayload;
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return;
  }

  const eventType = String(payload.type ?? "");
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const db = createMailServiceClient();

  try {
    if (eventType === "email.received" || typeof data.from === "string") {
      const from = String(data.from ?? "");
      const to = asStringArray(data.to);
      if (!from || to.length === 0) {
        sendJson(res, 400, { error: "missing_from_to" });
        return;
      }

      const parsedFrom = parseEmailAddress(from);
      const headers = normalizeHeaders(data.headers);
      const brand = detectMailBrand(to);
      const assignment = await resolveMailAssignment(db, to);
      const { data: insertedEmail, error } = await db.from("inbound_emails").insert({
        resend_email_id: typeof data.email_id === "string" ? data.email_id : typeof data.id === "string" ? data.id : null,
        message_id: typeof data.message_id === "string" ? data.message_id : extractMessageId(headers),
        from_address: parsedFrom.address,
        from_name: parsedFrom.name,
        to_addresses: to,
        subject: typeof data.subject === "string" ? data.subject : "(nessun oggetto)",
        text_body: typeof data.text === "string" ? data.text : null,
        html_body: typeof data.html === "string" ? data.html : null,
        headers,
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        brand,
        assigned_to_profile_id: assignment.assignedProfileId,
        assignment_reason: assignment.reason,
        spam: await isSpamSender(parsedFrom.address),
      }).select("id, subject").maybeSingle();
      if (error) throw error;

      const pushSent = await sendMailPushNotification(db, assignment.notifyProfileIds, {
        title: assignment.assignedProfileId ? "Nuova mail assegnata" : "Nuova mail BITE",
        body: `${parsedFrom.name || parsedFrom.address}: ${typeof data.subject === "string" ? data.subject : "(nessun oggetto)"}`,
        url: "/admin/mail",
      }).catch((pushError) => {
        console.error("[webhooks/email/inbound] push failed", pushError);
        return false;
      });

      if (pushSent && insertedEmail?.id) {
        await db
          .from("inbound_emails")
          .update({ push_notified_at: new Date().toISOString() })
          .eq("id", insertedEmail.id);
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    const resendEmailId =
      typeof data.email_id === "string" ? data.email_id : typeof data.id === "string" ? data.id : nestedEmailId(data);
    const status = eventToStatus(eventType);
    if (resendEmailId && eventType) {
      await db.from("email_tracking_events").insert({
        resend_email_id: resendEmailId,
        event_type: eventType,
        from_address: typeof data.from === "string" ? parseEmailAddress(data.from).address : null,
        to_address: typeof data.to === "string" ? parseEmailAddress(data.to).address : null,
        subject: typeof data.subject === "string" ? data.subject : null,
        metadata: data,
      });

      if (status) {
        await db.from("sent_emails").update({ status }).eq("resend_message_id", resendEmailId);
      }
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[webhooks/email/inbound] failed", error);
    sendJson(res, 500, { error: "webhook_failed" });
  }
}
