import { parseEmailAddress } from "@pynkstudio/mailapp/core";
import { sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import {
  fromOptionById,
  jsonMethodNotAllowed,
  readMailJsonBody,
  requireAdmin,
  userDisplayName,
} from "../../src/server/mail.js";

type SendBody = {
  fromOptionId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  text?: string;
};

function splitRecipients(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((part) => parseEmailAddress(part.trim()).address.toLowerCase())
    .filter(Boolean);
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    jsonMethodNotAllowed(res);
    return;
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const body = await readMailJsonBody<SendBody>(req, res);
  if (!body) return;

  const to = splitRecipients(body.to ?? "");
  const cc = splitRecipients(body.cc ?? "");
  const bcc = splitRecipients(body.bcc ?? "");
  const subject = (body.subject ?? "").trim();
  const html = (body.html ?? "").trim();
  const text = (body.text ?? "").trim();

  if (to.length === 0 || !subject || (!html && !text)) {
    sendJson(res, 400, { error: "missing_fields" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    sendJson(res, 503, { error: "resend_not_configured" });
    return;
  }

  const fromOption = fromOptionById(body.fromOptionId);
  const emailHtml = html || text.replace(/\n/g, "<br>");

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromOption.from,
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject,
        html: emailHtml,
      }),
    });

    if (!resendResponse.ok) {
      const details = await resendResponse.text();
      console.error("[email/send] resend failed", details);
      sendJson(res, 502, { error: "resend_send_failed", details });
      return;
    }

    const result = (await resendResponse.json()) as { id?: string };
    const parsedFrom = parseEmailAddress(fromOption.from);
    const { error } = await auth.db.from("sent_emails").insert({
      resend_message_id: result.id ?? null,
      from_address: parsedFrom.address,
      from_name: parsedFrom.name,
      to_addresses: to,
      cc_addresses: cc,
      bcc_addresses: bcc,
      subject,
      html_body: emailHtml,
      text_body: text || null,
      brand: fromOption.brand,
      sent_by_user_id: auth.user.id,
      sent_by_name: userDisplayName(auth.user),
      status: "sent",
    });
    if (error) throw error;

    sendJson(res, 200, { ok: true, messageId: result.id ?? null });
  } catch (error) {
    console.error("[email/send] failed", error);
    sendJson(res, 500, { error: "send_failed" });
  }
}
