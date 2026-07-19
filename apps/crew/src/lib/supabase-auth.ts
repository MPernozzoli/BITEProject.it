import { supabase } from "@/integrations/supabase/client";
import { removeSharedSupabaseAuthItem } from "@/lib/supabase-auth-storage";

export function getSupabaseAuthStorageKey(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname;
    const ref = host.split(".")[0];
    return ref ? `sb-${ref}-auth-token` : "";
  } catch {
    return "";
  }
}

export function removeSupabaseAuthStorage() {
  const key = getSupabaseAuthStorageKey();
  if (key) removeSharedSupabaseAuthItem(key);
}

export async function getCurrentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
