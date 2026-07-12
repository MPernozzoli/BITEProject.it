import * as webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTOMATIC_MAIL_DOMAIN, ORDINARY_MAIL_DOMAIN, normalizeAddress } from "./mail.js";

type PushSubscriptionRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
};

type AdminProfileRow = {
  id: string;
  email: string;
  name: string | null;
};

type AliasRow = {
  profile_id: string;
  alias: string;
};

type UserRoleRow = {
  user_id: string;
};

type PushPreferenceRow = {
  email: string;
  push_mail_enabled: boolean | null;
};

export type MailAssignment = {
  assignedProfileId: string | null;
  notifyProfileIds: string[];
  reason: "alias_match" | "fallback_all_admins" | "ambiguous_alias";
};

function localPart(address: string): string {
  return normalizeAddress(address).split("@")[0] ?? "";
}

function isBiteMailbox(address: string): boolean {
  const normalized = normalizeAddress(address);
  return normalized.endsWith(`@${ORDINARY_MAIL_DOMAIN}`) || normalized.endsWith(`@${AUTOMATIC_MAIL_DOMAIN}`);
}

export async function resolveMailAssignment(db: SupabaseClient, toAddresses: string[]): Promise<MailAssignment> {
  const { error: refreshError } = await db.rpc("refresh_admin_email_aliases");
  if (refreshError) {
    console.warn("[mail-push] unable to refresh admin aliases", refreshError.message);
  }

  const { data: adminRoleRows, error: adminError } = await db
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (adminError) throw adminError;

  const adminIds = Array.from(new Set(((adminRoleRows ?? []) as UserRoleRow[]).map((row) => row.user_id).filter(Boolean)));
  const { data: adminProfiles, error: profileError } = adminIds.length
    ? await db.from("profiles").select("id,email,name").in("id", adminIds)
    : { data: [], error: null };

  if (profileError) throw profileError;

  const admins = (adminProfiles ?? []) as AdminProfileRow[];
  const allAdminIds = admins.map((admin) => admin.id);

  const candidateAliases = Array.from(new Set(toAddresses.filter(isBiteMailbox).map(localPart).filter(Boolean)));
  if (candidateAliases.length === 0 || allAdminIds.length === 0) {
    return { assignedProfileId: null, notifyProfileIds: allAdminIds, reason: "fallback_all_admins" };
  }

  const { data: aliasRows, error: aliasError } = await db
    .from("admin_email_aliases")
    .select("profile_id, alias")
    .in("alias", candidateAliases);

  if (aliasError) throw aliasError;

  const matches = (aliasRows ?? []) as AliasRow[];
  const matchedProfileIds = Array.from(new Set(matches.map((row) => row.profile_id)));

  if (matchedProfileIds.length === 1) {
    return {
      assignedProfileId: matchedProfileIds[0],
      notifyProfileIds: matchedProfileIds,
      reason: "alias_match",
    };
  }

  if (matchedProfileIds.length > 1) {
    return {
      assignedProfileId: null,
      notifyProfileIds: allAdminIds,
      reason: "ambiguous_alias",
    };
  }

  return { assignedProfileId: null, notifyProfileIds: allAdminIds, reason: "fallback_all_admins" };
}

export async function sendMailPushNotification(
  db: SupabaseClient,
  profileIds: string[],
  notification: { title: string; body: string; url: string },
): Promise<boolean> {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.VITE_WEB_PUSH_PUBLIC_KEY ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT ?? `mailto:hello@${ORDINARY_MAIL_DOMAIN}`;
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));

  if (!publicKey || !privateKey || uniqueProfileIds.length === 0) return false;

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id, profile_id, endpoint, p256dh, auth, enabled, profiles!inner(email)")
    .in("profile_id", uniqueProfileIds)
    .eq("enabled", true);

  if (error) throw error;

  const rows = (data ?? []) as Array<PushSubscriptionRow & { profiles?: { email?: string | null } | null }>;
  const recipientEmails = Array.from(
    new Set(rows.map((row) => row.profiles?.email?.trim().toLowerCase()).filter((value): value is string => Boolean(value))),
  );
  const { data: preferenceRows, error: preferenceError } = recipientEmails.length
    ? await db
        .from("email_notification_preferences")
        .select("email, push_mail_enabled")
        .in("email", recipientEmails)
    : { data: [], error: null };

  if (preferenceError) throw preferenceError;

  const preferencesByEmail = new Map(
    ((preferenceRows ?? []) as PushPreferenceRow[]).map((row) => [row.email.trim().toLowerCase(), row]),
  );
  const subscriptions = rows.filter((row) => {
    const email = row.profiles?.email?.trim().toLowerCase();
    if (!email) return false;
    return preferencesByEmail.get(email)?.push_mail_enabled ?? true;
  });
  if (subscriptions.length === 0) return false;

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(notification),
        {
          TTL: 60 * 5,
          vapidDetails: {
            subject,
            publicKey,
            privateKey,
          },
        },
      ),
    ),
  );

  const invalidEndpoints = results
    .map((result, index) => ({ result, subscription: subscriptions[index] }))
    .filter(({ result }) => result.status === "rejected")
    .filter(({ result }) => {
      const reason = (result as PromiseRejectedResult).reason;
      const statusCode =
        typeof reason?.statusCode === "number" ? reason.statusCode : typeof reason?.status === "number" ? reason.status : null;
      return statusCode === 404 || statusCode === 410;
    })
    .map(({ subscription }) => subscription.endpoint);

  if (invalidEndpoints.length > 0) {
    await db
      .from("push_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in("endpoint", invalidEndpoints);
  }

  return results.some((result) => result.status === "fulfilled");
}
