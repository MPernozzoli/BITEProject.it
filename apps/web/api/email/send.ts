import { parseEmailAddress } from "@pynkstudio/mailapp/core";
import { sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import {
  fromOptionById,
  jsonMethodNotAllowed,
  ORDINARY_MAIL_DOMAIN,
  readMailJsonBody,
  requireAdmin,
  userDisplayName,
} from "../../src/server/mail.js";
import {
  fallbackThreadKey,
  generateOutboundMessageId,
  resolveConversationThreadKey,
  threadParticipants,
  type ThreadableMail,
} from "../../src/server/mail-threading.js";

type SendBody = {
  fromOptionId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename?: string;
    content?: string;
    contentType?: string;
    size?: number;
  }>;
  replyToMessageId?: string;
};

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

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
  const replyToMessageId = (body.replyToMessageId ?? "").trim();
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .map((attachment) => ({
          filename: (attachment.filename ?? "").trim(),
          content: (attachment.content ?? "").trim(),
          contentType: (attachment.contentType ?? "").trim(),
          size: Number.isFinite(attachment.size) ? Number(attachment.size) : 0,
        }))
        .filter((attachment) => attachment.filename && attachment.content)
    : [];

  if (to.length === 0 || !subject || (!html && !text)) {
    sendJson(res, 400, { error: "missing_fields" });
    return;
  }

  const attachmentBytes = attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size), 0);
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    sendJson(res, 413, { error: "attachments_too_large" });
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
    let replyToMessage: ThreadableMail | null = null;
    if (replyToMessageId) {
      const { data: inboundReplyTarget, error: inboundReplyError } = await auth.db
        .from("inbound_emails")
        .select("id,message_id,thread_key,in_reply_to,references,from_address,to_addresses,cc_addresses,subject")
        .eq("id", replyToMessageId)
        .maybeSingle();
      if (inboundReplyError) throw inboundReplyError;

      if (inboundReplyTarget) {
        replyToMessage = inboundReplyTarget as ThreadableMail;
      } else {
        const { data: sentReplyTarget, error: sentReplyError } = await auth.db
          .from("sent_emails")
          .select("id,message_id,thread_key,in_reply_to,references,from_address,to_addresses,cc_addresses,bcc_addresses,subject")
          .eq("id", replyToMessageId)
          .maybeSingle();
        if (sentReplyError) throw sentReplyError;
        replyToMessage = (sentReplyTarget as ThreadableMail | null) ?? null;
      }
    }

    const parsedFrom = parseEmailAddress(fromOption.from);
    const outboundMessageId = generateOutboundMessageId(ORDINARY_MAIL_DOMAIN);
    const replyMessageId = replyToMessage?.message_id ?? null;
    const replyReferences = Array.from(
      new Set([...(replyToMessage?.references ?? []), ...(replyMessageId ? [replyMessageId] : [])]),
    );
    const threadKey =
      replyToMessage?.thread_key ??
      (await resolveConversationThreadKey(
        auth.db,
        replyReferences.length > 0 ? replyReferences : replyMessageId ? [replyMessageId] : [outboundMessageId],
        fallbackThreadKey({
          subject,
          addresses: [parsedFrom.address, ...to, ...cc, ...bcc, ...(replyToMessage ? threadParticipants(replyToMessage) : [])],
        }),
      ));

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
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
              })),
            }
          : {}),
        headers: {
          "Message-ID": `<${outboundMessageId}>`,
          ...(replyMessageId ? { "In-Reply-To": `<${replyMessageId}>` } : {}),
          ...(replyReferences.length > 0 ? { References: replyReferences.map((id) => `<${id}>`).join(" ") } : {}),
        },
      }),
    });

    if (!resendResponse.ok) {
      const details = await resendResponse.text();
      console.error("[email/send] resend failed", details);
      sendJson(res, 502, { error: "resend_send_failed", details });
      return;
    }

    const result = (await resendResponse.json()) as { id?: string };
    const { error } = await auth.db.from("sent_emails").insert({
      resend_message_id: result.id ?? null,
      message_id: outboundMessageId,
      thread_key: threadKey,
      in_reply_to: replyMessageId,
      references: replyReferences,
      from_address: parsedFrom.address,
      from_name: parsedFrom.name,
      to_addresses: to,
      cc_addresses: cc,
      bcc_addresses: bcc,
      subject,
      html_body: emailHtml,
      text_body: text || null,
      attachments: attachments.map(({ content: _content, ...attachment }) => attachment),
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
