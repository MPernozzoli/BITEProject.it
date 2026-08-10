/**
 * BITE mailbox wiring for @pynkstudio/mailapp.
 *
 * All mail behavior (threading, search, assignment, push, Resend I/O) lives in
 * the package; this file only declares what is specific to BITE — the two
 * domains, the sender identities — and injects the Supabase clients and the
 * push transport.
 */

import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveMailboxConfig, type MailFromOption } from "@pynkstudio/mailapp/mailbox";
import type { PushSubscriptionTarget } from "@pynkstudio/mailapp/mailbox/server";
import type { MailboxNodeContext } from "@pynkstudio/mailapp/node";

export const ORDINARY_MAIL_DOMAIN = "biteproject.it";
export const AUTOMATIC_MAIL_DOMAIN = "mail.biteproject.it";

export const MAIL_FROM_OPTIONS: readonly MailFromOption[] = [
  { id: "hello", label: "Hello", from: `BITE <hello@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
  { id: "massimo", label: "Massimo", from: `Massimo <massimo@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
  { id: "sami", label: "Sami", from: `Sami <sami@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
  { id: "pack", label: "Pack", from: `Pack <pack@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
  { id: "viaggi", label: "Viaggi", from: `Viaggi <viaggi@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
  { id: "support", label: "Support", from: `Support <support@${ORDINARY_MAIL_DOMAIN}>`, brand: "bite_ordinary" },
];

export const mailboxConfig = resolveMailboxConfig({
  ordinaryDomain: ORDINARY_MAIL_DOMAIN,
  automaticDomain: AUTOMATIC_MAIL_DOMAIN,
  ordinaryBrand: "bite_ordinary",
  automaticBrand: "bite_automatic",
  fromOptions: MAIL_FROM_OPTIONS,
});

/**
 * Service-role client. Also used by the newsletter tracking routes under
 * `api/t/`, which need to write events without a user session.
 */
export function createMailServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("supabase_url_unset");
  if (!serviceKey) throw new Error("supabase_service_role_key_unset");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createMailAuthClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error("supabase_url_unset");
  if (!anonKey) throw new Error("supabase_anon_key_unset");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function vapidDetails() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.VITE_WEB_PUSH_PUBLIC_KEY ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT ?? `mailto:hello@${ORDINARY_MAIL_DOMAIN}`;
  if (!publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

/**
 * Push transport handed to the package. `web-push` must be imported as a default
 * ESM binding on Vercel for `sendNotification` to be exposed, and it rejects with
 * a `statusCode`, which is what lets the package prune retired endpoints.
 */
async function sendMailPush(target: PushSubscriptionTarget, payload: string): Promise<unknown> {
  const vapid = vapidDetails();
  if (!vapid) throw new Error("web_push_not_configured");
  return webpush.sendNotification(
    { endpoint: target.endpoint, expirationTime: null, keys: target.keys },
    payload,
    { TTL: 60 * 5, vapidDetails: vapid },
  );
}

export const mailContext: MailboxNodeContext = {
  config: mailboxConfig,
  createServiceClient: () => createMailServiceClient(),
  getUserFromToken: async (token) => {
    const { data, error } = await createMailAuthClient().auth.getUser(token);
    if (error || !data?.user) return null;
    const { id, email, user_metadata } = data.user;
    return { id, email, user_metadata };
  },
  resendApiKey: () => process.env.RESEND_API_KEY,
  webhookSecret: () => process.env.RESEND_WEBHOOK_SECRET,
  internalTestSecret: () => process.env.INTERNAL_MAIL_WEBHOOK_TEST_SECRET,
  ...(vapidDetails()
    ? {
        push: {
          send: sendMailPush,
          title: (assigned: boolean) => (assigned ? "Nuova mail assegnata" : "Nuova mail BITE"),
        },
      }
    : {}),
};
