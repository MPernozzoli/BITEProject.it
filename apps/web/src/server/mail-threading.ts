import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAddress } from "./mail.js";

export type MailHeader = { name: string; value: string };

export type ThreadableMail = {
  id?: string | null;
  message_id?: string | null;
  thread_key?: string | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  from_address?: string | null;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
  bcc_addresses?: string[] | null;
  subject?: string | null;
};

function cleanMessageId(value: string): string {
  return value.trim().replace(/^<+/, "").replace(/>+$/, "").toLowerCase();
}

export function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const id = cleanMessageId(match?.[1] ?? value);
  return id.includes("@") ? id : null;
}

export function extractHeaderValue(headers: MailHeader[] | null | undefined, name: string): string | null {
  const header = headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return header?.value?.trim() || null;
}

export function extractMessageIds(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const bracketed = Array.from(value.matchAll(/<([^<>@\s]+@[^<>\s]+)>/g))
    .map((match) => normalizeMessageId(match[1]))
    .filter((id): id is string => Boolean(id));
  if (bracketed.length > 0) return Array.from(new Set(bracketed));
  const single = normalizeMessageId(value);
  return single ? [single] : [];
}

export function normalizeSubjectForThread(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd|rif|i)\s*:\s*)+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function fallbackThreadKey(input: { subject: string; addresses: string[] }): string {
  const subject = normalizeSubjectForThread(input.subject) || "(nessun oggetto)";
  const participants = Array.from(new Set(input.addresses.map((address) => normalizeAddress(address)).filter(Boolean))).sort();
  return `fallback:${createHash("sha256").update(`${subject}|${participants.join("|")}`).digest("hex")}`;
}

export function generateOutboundMessageId(domain = "biteproject.it"): string {
  return `${Date.now()}.${randomUUID()}@${domain}`;
}

export async function resolveConversationThreadKey(
  db: SupabaseClient,
  relatedMessageIds: string[],
  fallbackKey: string,
): Promise<string> {
  const ids = Array.from(new Set(relatedMessageIds.map(cleanMessageId).filter(Boolean)));
  if (ids.length === 0) return fallbackKey;

  const filters = ids.map((id) => `message_id.eq.${id}`).join(",");
  for (const table of ["inbound_emails", "sent_emails"]) {
    const { data, error } = await db
      .from(table)
      .select("thread_key")
      .or(filters)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.thread_key) return data.thread_key;
  }

  return fallbackKey;
}

export function threadParticipants(message: ThreadableMail): string[] {
  return [
    message.from_address,
    ...(message.to_addresses ?? []),
    ...(message.cc_addresses ?? []),
    ...(message.bcc_addresses ?? []),
  ].filter((value): value is string => Boolean(value));
}
