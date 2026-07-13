import { parseEmailAddress } from "@pynkstudio/mailapp/core";
import { bearerToken, sendJson, type NodeRequest, type NodeResponse } from "../../../src/server/http.js";
import {
  createMailServiceClient,
  detectMailBrand,
  normalizeAddress,
  readRawBody,
  verifySvixSignature,
} from "../../../src/server/mail.js";
import {
  extractHeaderValue,
  extractMessageIds,
  fallbackThreadKey,
  normalizeMessageId,
  resolveConversationThreadKey,
} from "../../../src/server/mail-threading.js";
import { resolveMailAssignment, sendMailPushNotification } from "../../../src/server/mail-push.js";

type ResendPayload = {
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type ReceivedEmailContent = {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, unknown> | Array<{ name?: unknown; value?: unknown }>;
  attachments?: unknown[];
  message_id?: string;
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

function receivedEmailId(data: Record<string, unknown>): string {
  return typeof data.email_id === "string" ? data.email_id : typeof data.id === "string" ? data.id : nestedEmailId(data);
}

async function retrieveReceivedEmailContent(emailId: string): Promise<ReceivedEmailContent | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return null;

  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("[webhooks/email/inbound] received email fetch failed", response.status, details);
    return null;
  }

  return (await response.json()) as ReceivedEmailContent;
}

async function isSpamSender(address: string): Promise<boolean> {
  const db = createMailServiceClient();
  const { data } = await db.from("email_spam_senders").select("id").eq("address", normalizeAddress(address)).maybeSingle();
  return Boolean(data);
}

function isAuthorizedInternalTest(req: NodeRequest): boolean {
  const secret = process.env.INTERNAL_MAIL_WEBHOOK_TEST_SECRET;
  const token = bearerToken(req);
  return Boolean(secret && token && token === secret);
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  const isInternalTest = isAuthorizedInternalTest(req);
  if (!isInternalTest && !verifySvixSignature(req, rawBody)) {
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
    if (eventType === "email.received" || (!eventType && typeof data.from === "string")) {
      const inboundEmailId = receivedEmailId(data);
      const content = inboundEmailId ? await retrieveReceivedEmailContent(inboundEmailId) : null;
      const from = String(content?.from ?? data.from ?? "");
      const to = content?.to?.length ? content.to : asStringArray(data.to);
      if (!from || to.length === 0) {
        sendJson(res, 400, { error: "missing_from_to" });
        return;
      }

      const parsedFrom = parseEmailAddress(from);
      const headers = normalizeHeaders(content?.headers ?? data.headers);
      const subject = typeof content?.subject === "string" ? content.subject : typeof data.subject === "string" ? data.subject : "(nessun oggetto)";
      const messageId =
        normalizeMessageId(content?.message_id) ??
        normalizeMessageId(data.message_id) ??
        normalizeMessageId(extractHeaderValue(headers, "message-id"));
      const inReplyTo = normalizeMessageId(data.in_reply_to) ?? extractMessageIds(extractHeaderValue(headers, "in-reply-to"))[0] ?? null;
      const references = Array.from(
        new Set([
          ...extractMessageIds(data.references),
          ...extractMessageIds(extractHeaderValue(headers, "references")),
          ...(inReplyTo ? [inReplyTo] : []),
        ]),
      );
      const threadKey = await resolveConversationThreadKey(
        db,
        references.length > 0 ? references : messageId ? [messageId] : [],
        fallbackThreadKey({ subject, addresses: [parsedFrom.address, ...to] }),
      );
      const brand = detectMailBrand(to);
      const assignment = await resolveMailAssignment(db, to);
      const { data: insertedEmail, error } = await db.from("inbound_emails").insert({
        resend_email_id: inboundEmailId || null,
        message_id: messageId,
        thread_key: threadKey,
        in_reply_to: inReplyTo,
        references,
        from_address: parsedFrom.address,
        from_name: parsedFrom.name,
        to_addresses: to,
        subject,
        text_body: typeof content?.text === "string" ? content.text : typeof data.text === "string" ? data.text : null,
        html_body: typeof content?.html === "string" ? content.html : typeof data.html === "string" ? data.html : null,
        headers,
        attachments: Array.isArray(content?.attachments) ? content.attachments : Array.isArray(data.attachments) ? data.attachments : [],
        brand,
        assigned_to_profile_id: assignment.assignedProfileId,
        assignment_reason: assignment.reason,
        spam: await isSpamSender(parsedFrom.address),
      }).select("id, subject").maybeSingle();
      if (error) throw error;

      const pushSent = await sendMailPushNotification(db, assignment.notifyProfileIds, {
        title: assignment.assignedProfileId ? "Nuova mail assegnata" : "Nuova mail BITE",
        body: `${parsedFrom.name || parsedFrom.address}: ${typeof content?.subject === "string" ? content.subject : typeof data.subject === "string" ? data.subject : "(nessun oggetto)"}`,
        url: insertedEmail?.id ? `/admin/mail?message=${encodeURIComponent(insertedEmail.id)}` : "/admin/mail",
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
