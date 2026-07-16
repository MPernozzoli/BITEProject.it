import { firstQueryParam, sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { jsonMethodNotAllowed, requireAdmin } from "../../src/server/mail.js";

type StoredAttachment = {
  id?: string;
  download_url?: string;
  expires_at?: string;
  [key: string]: unknown;
};

type ResendAttachment = StoredAttachment & {
  download_url?: string;
};

function attachmentIsFresh(attachment: StoredAttachment) {
  if (!attachment.download_url) return false;
  if (!attachment.expires_at) return true;
  return Date.parse(attachment.expires_at) > Date.now() + 60_000;
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    jsonMethodNotAllowed(res);
    return;
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const messageId = firstQueryParam(req, "messageId");
  const attachmentId = firstQueryParam(req, "attachmentId");
  if (!messageId || !attachmentId) {
    sendJson(res, 400, { error: "missing_params" });
    return;
  }

  try {
    const { data: message, error } = await auth.db
      .from("inbound_emails")
      .select("id,resend_email_id,attachments")
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw error;
    if (!message?.resend_email_id) {
      sendJson(res, 404, { error: "message_not_found" });
      return;
    }

    const attachments = Array.isArray(message.attachments) ? (message.attachments as StoredAttachment[]) : [];
    const storedAttachment = attachments.find((attachment) => attachment.id === attachmentId);
    if (storedAttachment && attachmentIsFresh(storedAttachment)) {
      sendJson(res, 200, { downloadUrl: storedAttachment.download_url });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      sendJson(res, 503, { error: "resend_not_configured" });
      return;
    }

    const response = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(message.resend_email_id)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("[email/attachment] resend fetch failed", response.status, details);
      sendJson(res, 502, { error: "attachment_fetch_failed" });
      return;
    }

    const attachment = (await response.json()) as ResendAttachment;
    if (!attachment.download_url) {
      sendJson(res, 404, { error: "attachment_not_found" });
      return;
    }

    const nextAttachments = attachments.map((item) => (item.id === attachmentId ? { ...item, ...attachment } : item));
    await auth.db.from("inbound_emails").update({ attachments: nextAttachments }).eq("id", messageId);

    sendJson(res, 200, { downloadUrl: attachment.download_url });
  } catch (error) {
    console.error("[email/attachment] failed", error);
    sendJson(res, 500, { error: "attachment_failed" });
  }
}
