import { firstQueryParam, sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { jsonMethodNotAllowed, MAIL_FROM_OPTIONS, requireAdmin } from "../../src/server/mail.js";

const PAGE_SIZE = 40;

type MailboxView = "inbox" | "unread" | "starred" | "archived" | "spam" | "sent";

function parseView(value: string | null): MailboxView {
  return value === "unread" ||
    value === "starred" ||
    value === "archived" ||
    value === "spam" ||
    value === "sent"
    ? value
    : "inbox";
}

function parsePage(value: string | null): number {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : 1;
}

async function hydrateInboundAssignments(db: any, messages: any[]) {
  const profileIds = Array.from(
    new Set(messages.map((message) => message.assigned_to_profile_id).filter((value): value is string => Boolean(value))),
  );
  if (profileIds.length === 0) return messages;

  const { data, error } = await db.from("profiles").select("id,name,email").in("id", profileIds);
  if (error) throw error;
  const profilesById = new Map((data ?? []).map((profile: any) => [profile.id, profile]));
  return messages.map((message) => ({
    ...message,
    assigned_profile: message.assigned_to_profile_id ? profilesById.get(message.assigned_to_profile_id) ?? null : null,
  }));
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET") {
    jsonMethodNotAllowed(res);
    return;
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const view = parseView(firstQueryParam(req, "view"));
  const page = parsePage(firstQueryParam(req, "page"));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const db = auth.db;

    if (view === "sent") {
      const [{ data, count, error }, { count: inboxUnread }, { count: inboxTotal }] = await Promise.all([
        db
          .from("sent_emails")
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(from, to),
        db
          .from("inbound_emails")
          .select("*", { count: "exact", head: true })
          .eq("read", false)
          .eq("archived", false)
          .eq("spam", false),
        db.from("inbound_emails").select("*", { count: "exact", head: true }).eq("archived", false).eq("spam", false),
      ]);
      if (error) throw error;
      sendJson(res, 200, {
        view,
        page,
        pageSize: PAGE_SIZE,
        messages: data ?? [],
        total: count ?? 0,
        counts: { inbox: inboxTotal ?? 0, unread: inboxUnread ?? 0 },
        fromOptions: MAIL_FROM_OPTIONS,
      });
      return;
    }

    let query = db
      .from("inbound_emails")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (view === "unread") query = query.eq("read", false).eq("archived", false).eq("spam", false);
    if (view === "starred") query = query.eq("starred", true).eq("spam", false);
    if (view === "archived") query = query.eq("archived", true).eq("spam", false);
    if (view === "spam") query = query.eq("spam", true);
    if (view === "inbox") query = query.eq("archived", false).eq("spam", false);

    const [{ data, count, error }, { count: inboxUnread }, { count: inboxTotal }, { count: sentTotal }] = await Promise.all([
      query,
      db
        .from("inbound_emails")
        .select("*", { count: "exact", head: true })
        .eq("read", false)
        .eq("archived", false)
        .eq("spam", false),
      db.from("inbound_emails").select("*", { count: "exact", head: true }).eq("archived", false).eq("spam", false),
      db.from("sent_emails").select("*", { count: "exact", head: true }),
    ]);
    if (error) throw error;

    sendJson(res, 200, {
      view,
      page,
      pageSize: PAGE_SIZE,
      messages: await hydrateInboundAssignments(db, data ?? []),
      total: count ?? 0,
      counts: { inbox: inboxTotal ?? 0, unread: inboxUnread ?? 0, sent: sentTotal ?? 0 },
      fromOptions: MAIL_FROM_OPTIONS,
    });
  } catch (error) {
    console.error("[email/inbox] failed", error);
    sendJson(res, 500, { error: "mailbox_load_failed" });
  }
}
