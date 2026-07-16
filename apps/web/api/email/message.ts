import { sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { jsonMethodNotAllowed, normalizeAddress, readMailJsonBody, requireAdmin } from "../../src/server/mail.js";
import { revokeMailPushNotification } from "../../src/server/mail-push.js";

type MessageAction = "read" | "unread" | "star" | "unstar" | "archive" | "restore" | "spam" | "not_spam" | "delete";

type MessageBody = {
  id?: string;
  action?: MessageAction;
};

function shouldRevokePushForAction(action: MessageAction): boolean {
  return action === "read" || action === "archive" || action === "spam" || action === "delete";
}

async function revokePushIfNeeded(auth: Awaited<ReturnType<typeof requireAdmin>>, id: string, action: MessageAction) {
  if (!auth || !shouldRevokePushForAction(action)) return;

  const { data: message, error } = await auth.db
    .from("inbound_emails")
    .select("id, assigned_to_profile_id, assignment_reason, push_notified_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!message) return;

  await revokeMailPushNotification(auth.db, message).catch((pushError) => {
    console.error("[email/message] push revocation failed", pushError);
  });
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "POST") {
    jsonMethodNotAllowed(res);
    return;
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const body = await readMailJsonBody<MessageBody>(req, res);
  if (!body) return;

  const id = (body.id ?? "").trim();
  const action = body.action;
  if (!id || !action) {
    sendJson(res, 400, { error: "missing_fields" });
    return;
  }

  try {
    if (action === "delete") {
      await revokePushIfNeeded(auth, id, action);
      const { error } = await auth.db.from("inbound_emails").delete().eq("id", id);
      if (error) throw error;
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === "spam") {
      const { data: email } = await auth.db.from("inbound_emails").select("from_address").eq("id", id).maybeSingle();
      const { error } = await auth.db.from("inbound_emails").update({ spam: true, read: true }).eq("id", id);
      if (error) throw error;
      await revokePushIfNeeded(auth, id, action);
      if (email?.from_address) {
        await auth.db
          .from("email_spam_senders")
          .upsert({ address: normalizeAddress(email.from_address) }, { onConflict: "address" });
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === "not_spam") {
      const { data: email } = await auth.db.from("inbound_emails").select("from_address").eq("id", id).maybeSingle();
      const { error } = await auth.db.from("inbound_emails").update({ spam: false }).eq("id", id);
      if (error) throw error;
      if (email?.from_address) {
        await auth.db.from("email_spam_senders").delete().eq("address", normalizeAddress(email.from_address));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const patch =
      action === "read"
        ? { read: true }
        : action === "unread"
          ? { read: false }
          : action === "star"
            ? { starred: true }
            : action === "unstar"
              ? { starred: false }
              : action === "archive"
                ? { archived: true, read: true }
                : { archived: false };

    const { error } = await auth.db.from("inbound_emails").update(patch).eq("id", id);
    if (error) throw error;
    await revokePushIfNeeded(auth, id, action);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[email/message] failed", error);
    sendJson(res, 500, { error: "message_action_failed" });
  }
}
