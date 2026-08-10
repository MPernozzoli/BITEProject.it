import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the Bunq payment functions. Runs only inside Vercel
 * serverless functions — never import this from client-side code, it holds the service key.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("supabase_url_unset");
  if (!serviceKey) throw new Error("supabase_service_role_key_unset");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anon client used only to resolve the caller's identity from their access token. */
export function createAuthClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error("supabase_url_unset");
  if (!anonKey) throw new Error("supabase_anon_key_unset");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Anon-key client that forwards the caller's own bearer token on every request, so
 * PostgREST/RPC calls run as that user (auth.uid() resolves, RLS applies) instead of as the
 * service role. Unlike {@link createServiceClient}, this is for RPCs that are meant to be
 * called by the browser under the user's own identity (e.g. request_voyage_booking) but need
 * to be proxied through a Node function first.
 */
export function createUserScopedClient(token: string): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error("supabase_url_unset");
  if (!anonKey) throw new Error("supabase_anon_key_unset");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
