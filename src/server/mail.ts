import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseEmailAddress } from "@pynkstudio/mailapp/core";
import { bearerToken, readJsonBody, sendJson, type NodeRequest, type NodeResponse } from "./http.js";

export const ORDINARY_MAIL_DOMAIN = "biteproject.it";
export const AUTOMATIC_MAIL_DOMAIN = "mail.biteproject.it";

export const MAIL_FROM_OPTIONS = [
  {
    id: "ordinary-hello",
    label: "BITE ordinaria",
    from: `BITE <hello@${ORDINARY_MAIL_DOMAIN}>`,
    brand: "bite_ordinary",
  },
  {
    id: "ordinary-crew",
    label: "Crew",
    from: `BITE Crew <crew@${ORDINARY_MAIL_DOMAIN}>`,
    brand: "bite_ordinary",
  },
  {
    id: "automatic-admin",
    label: "Automatiche",
    from: `BITE <noreply@${AUTOMATIC_MAIL_DOMAIN}>`,
    brand: "bite_automatic",
  },
  {
    id: "newsletter",
    label: "Newsletter",
    from: `BITE Newsletter <newsletter@${AUTOMATIC_MAIL_DOMAIN}>`,
    brand: "newsletter",
  },
] as const;

export type MailBrand = (typeof MAIL_FROM_OPTIONS)[number]["brand"];

export type AuthenticatedAdmin = {
  db: SupabaseClient;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
};

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

export async function requireAdmin(req: NodeRequest, res: NodeResponse): Promise<AuthenticatedAdmin | null> {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "unauthenticated" });
    return null;
  }

  const auth = createMailAuthClient();
  const { data, error } = await auth.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    sendJson(res, 401, { error: "unauthenticated" });
    return null;
  }

  const db = createMailServiceClient();
  const { data: isAdmin, error: roleError } = await db.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (roleError || isAdmin !== true) {
    sendJson(res, 403, { error: "forbidden" });
    return null;
  }

  return { db, user };
}

export async function readMailJsonBody<T>(req: NodeRequest, res: NodeResponse): Promise<T | null> {
  try {
    return await readJsonBody<T>(req);
  } catch {
    sendJson(res, 400, { error: "invalid_body" });
    return null;
  }
}

export function readRawBody(req: NodeRequest): Promise<string> {
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (req.body && typeof req.body === "object") return Promise.resolve(JSON.stringify(req.body));
  if (typeof req.on !== "function") return Promise.resolve("");

  return new Promise((resolve, reject) => {
    let data = "";
    req.on!("data", (chunk) => {
      data += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    req.on!("end", () => resolve(data));
    req.on!("error", (err) => reject(err));
  });
}

export function firstHeader(req: NodeRequest, name: string): string | null {
  const direct = req.headers[name] ?? req.headers[name.toLowerCase()] ?? req.headers[name.toUpperCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return value ?? null;
}

export function verifySvixSignature(req: NodeRequest, rawBody: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true;

  const svixId = firstHeader(req, "svix-id");
  const svixTimestamp = firstHeader(req, "svix-timestamp");
  const svixSignature = firstHeader(req, "svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  try {
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const computed = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
    return svixSignature
      .split(" ")
      .map((sig) => sig.replace(/^v1,/, ""))
      .some((sig) => {
        try {
          return timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(computed, "base64"));
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}

export function normalizeAddress(value: string): string {
  return parseEmailAddress(value).address.trim().toLowerCase();
}

export function detectMailBrand(addresses: string[]): MailBrand {
  const normalized = addresses.map(normalizeAddress);
  if (normalized.some((address) => address.endsWith(`@${AUTOMATIC_MAIL_DOMAIN}`))) return "bite_automatic";
  return "bite_ordinary";
}

export function fromOptionById(id: string | undefined) {
  return MAIL_FROM_OPTIONS.find((option) => option.id === id) ?? MAIL_FROM_OPTIONS[0];
}

export function userDisplayName(user: AuthenticatedAdmin["user"]): string | null {
  const metaName = user.user_metadata?.name || user.user_metadata?.full_name;
  if (typeof metaName === "string" && metaName.trim()) return metaName.trim();
  return user.email ?? null;
}

export function jsonMethodNotAllowed(res: NodeResponse): void {
  sendJson(res, 405, { error: "method_not_allowed" });
}
