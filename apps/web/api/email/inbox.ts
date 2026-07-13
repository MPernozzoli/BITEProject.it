import type { SupabaseClient } from "@supabase/supabase-js";
import { firstQueryParam, sendJson, type NodeRequest, type NodeResponse } from "../../src/server/http.js";
import { jsonMethodNotAllowed, MAIL_FROM_OPTIONS, requireAdmin } from "../../src/server/mail.js";

const PAGE_SIZE = 40;
const SEARCH_RESULT_LIMIT = 500;

type MailboxView = "inbox" | "unread" | "starred" | "archived" | "spam" | "sent";

type ReceivedEmailContent = {
  html?: string | null;
  text?: string | null;
  headers?: Record<string, unknown> | Array<{ name?: unknown; value?: unknown }>;
  attachments?: unknown[];
  message_id?: string;
};

type MailProfile = {
  id: string;
  name: string | null;
  email: string;
};

type InboundMessage = {
  id: string;
  message_id?: string | null;
  resend_email_id?: string | null;
  thread_key?: string | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  text_body?: string | null;
  html_body?: string | null;
  headers?: unknown;
  assigned_to_profile_id?: string | null;
  [key: string]: unknown;
};

type ThreadMailMessage = SearchableMessage & {
  id: string;
  created_at: string;
  thread_key?: string | null;
  assigned_to_profile_id?: string | null;
  source?: "inbound" | "sent";
  thread_messages?: ThreadMailMessage[];
};

type SearchableMessage = {
  created_at?: unknown;
  from_address?: unknown;
  from_name?: unknown;
  to_addresses?: unknown;
  cc_addresses?: unknown;
  bcc_addresses?: unknown;
  subject?: unknown;
  text_body?: unknown;
  html_body?: unknown;
  status?: unknown;
  [key: string]: unknown;
};

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

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function htmlToText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function arrayText(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).join(" ") : stringValue(value);
}

function dateSearchText(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return [
    value,
    date.toISOString(),
    new Intl.DateTimeFormat("it-IT", { dateStyle: "short" }).format(date),
    new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(date),
    new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  ].join(" ");
}

function mailSearchHaystack(message: SearchableMessage) {
  return normalizeSearchText(
    [
      stringValue(message.from_address),
      stringValue(message.from_name),
      arrayText(message.to_addresses),
      arrayText(message.cc_addresses),
      arrayText(message.bcc_addresses),
      stringValue(message.subject),
      stringValue(message.text_body),
      htmlToText(message.html_body),
      stringValue(message.status),
      dateSearchText(message.created_at),
    ].join(" "),
  );
}

function matchesMailSearch(message: SearchableMessage, search: string) {
  const terms = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = mailSearchHaystack(message);
  return terms.every((term) => haystack.includes(term));
}

function pageMessages<T>(messages: T[], page: number) {
  const from = (page - 1) * PAGE_SIZE;
  return messages.slice(from, from + PAGE_SIZE);
}

async function hydrateInboundAssignments(db: SupabaseClient, messages: InboundMessage[]) {
  const profileIds = Array.from(
    new Set(messages.map((message) => message.assigned_to_profile_id).filter((value): value is string => Boolean(value))),
  );
  if (profileIds.length === 0) return messages;

  const { data, error } = await db.from("profiles").select("id,name,email").in("id", profileIds);
  if (error) throw error;
  const profilesById = new Map((data ?? []).map((profile: MailProfile) => [profile.id, profile]));
  return messages.map((message) => ({
    ...message,
    assigned_profile: message.assigned_to_profile_id ? profilesById.get(message.assigned_to_profile_id) ?? null : null,
  }));
}

async function attachThreadMessages<T extends ThreadMailMessage>(db: SupabaseClient, messages: T[]): Promise<T[]> {
  const threadKeys = Array.from(new Set(messages.map((message) => message.thread_key).filter((value): value is string => Boolean(value))));
  if (threadKeys.length === 0) {
    return messages.map((message) => ({ ...message, source: message.source ?? "inbound", thread_messages: [message] }));
  }

  const [{ data: inboundRows, error: inboundError }, { data: sentRows, error: sentError }] = await Promise.all([
    db.from("inbound_emails").select("*").in("thread_key", threadKeys).order("created_at", { ascending: true }),
    db.from("sent_emails").select("*").in("thread_key", threadKeys).order("created_at", { ascending: true }),
  ]);
  if (inboundError) throw inboundError;
  if (sentError) throw sentError;

  const hydratedInbound = await hydrateInboundAssignments(db, (inboundRows ?? []) as InboundMessage[]);
  const threadMessages = [
    ...hydratedInbound.map((message) => ({ ...message, source: "inbound" as const })),
    ...((sentRows ?? []) as ThreadMailMessage[]).map((message) => ({ ...message, source: "sent" as const })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const byThreadKey = new Map<string, ThreadMailMessage[]>();
  for (const message of threadMessages) {
    if (!message.thread_key) continue;
    const current = byThreadKey.get(message.thread_key) ?? [];
    current.push(message);
    byThreadKey.set(message.thread_key, current);
  }

  return messages.map((message) => ({
    ...message,
    source: message.source ?? "inbound",
    thread_messages: message.thread_key ? byThreadKey.get(message.thread_key) ?? [message] : [message],
  }));
}

function normalizeHeaders(raw: unknown): Array<{ name: string; value: string }> | null {
  if (!raw) return null;
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
  return null;
}

async function retrieveReceivedEmailContent(emailId: string): Promise<ReceivedEmailContent | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return null;

  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) return null;
  return (await response.json()) as ReceivedEmailContent;
}

async function hydrateMissingInboundBodies(db: SupabaseClient, messages: InboundMessage[]) {
  return Promise.all(
    messages.map(async (message) => {
      if ((message.text_body || message.html_body) || !message.resend_email_id) return message;

      const content = await retrieveReceivedEmailContent(message.resend_email_id).catch((error) => {
        console.error("[email/inbox] received email fetch failed", error);
        return null;
      });
      if (!content?.text && !content?.html) return message;

      const patch = {
        text_body: typeof content.text === "string" ? content.text : null,
        html_body: typeof content.html === "string" ? content.html : null,
        ...(typeof content.message_id === "string" && !message.message_id ? { message_id: content.message_id } : {}),
        ...(content.headers ? { headers: normalizeHeaders(content.headers) ?? message.headers } : {}),
        ...(Array.isArray(content.attachments) ? { attachments: content.attachments } : {}),
      };

      const { error } = await db.from("inbound_emails").update(patch).eq("id", message.id);
      if (error) {
        console.error("[email/inbox] received email update failed", error);
        return message;
      }

      return { ...message, ...patch };
    }),
  );
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
  const search = (firstQueryParam(req, "q") ?? "").trim();
  const isSearching = search.length > 0;
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
          .range(isSearching ? 0 : from, isSearching ? SEARCH_RESULT_LIMIT - 1 : to),
        db
          .from("inbound_emails")
          .select("*", { count: "exact", head: true })
          .eq("read", false)
          .eq("archived", false)
          .eq("spam", false),
        db.from("inbound_emails").select("*", { count: "exact", head: true }).eq("archived", false).eq("spam", false),
      ]);
      if (error) throw error;
      const filteredMessages = isSearching ? (data ?? []).filter((message) => matchesMailSearch(message, search)) : data ?? [];
      const pageItems = (isSearching ? pageMessages(filteredMessages, page) : filteredMessages).map((message) => ({
        ...(message as ThreadMailMessage),
        source: "sent" as const,
      }));
      sendJson(res, 200, {
        view,
        page,
        pageSize: PAGE_SIZE,
        messages: await attachThreadMessages(db, pageItems),
        total: isSearching ? filteredMessages.length : count ?? 0,
        counts: { inbox: inboxTotal ?? 0, unread: inboxUnread ?? 0 },
        fromOptions: MAIL_FROM_OPTIONS,
      });
      return;
    }

    let query = db
      .from("inbound_emails")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(isSearching ? 0 : from, isSearching ? SEARCH_RESULT_LIMIT - 1 : to);

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

    const hydratedMessages = await hydrateMissingInboundBodies(db, data ?? []);
    const filteredMessages = isSearching
      ? hydratedMessages.filter((message) => matchesMailSearch(message, search))
      : hydratedMessages;

    sendJson(res, 200, {
      view,
      page,
      pageSize: PAGE_SIZE,
      messages: await attachThreadMessages(
        db,
        (await hydrateInboundAssignments(db, isSearching ? pageMessages(filteredMessages, page) : filteredMessages)).map((message) => ({
          ...(message as ThreadMailMessage),
          source: "inbound" as const,
        })),
      ),
      total: isSearching ? filteredMessages.length : count ?? 0,
      counts: { inbox: inboxTotal ?? 0, unread: inboxUnread ?? 0, sent: sentTotal ?? 0 },
      fromOptions: MAIL_FROM_OPTIONS,
    });
  } catch (error) {
    console.error("[email/inbox] failed", error);
    sendJson(res, 500, { error: "mailbox_load_failed" });
  }
}
