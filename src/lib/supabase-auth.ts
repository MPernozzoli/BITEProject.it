/// <reference types="vite/client" />
import { supabase } from "@/integrations/supabase/client";
import { removeSharedSupabaseAuthItem } from "@/lib/supabase-auth-storage";

/** Chiave storage usata da Supabase JS per la sessione (sb-<ref>-auth-token). */
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

/** True se l'errore PostgREST indica JWT / sessione non valida. */
export function isAuthFailureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "PGRST301" || e.code === "401") return true;
  const m = (e.message || "").toLowerCase();
  return m.includes("jwt") || m.includes("invalid token") || m.includes("session");
}

/**
 * Supabase sconsiglia chiamate async/client dentro onAuthStateChange:
 * le rimandiamo al tick successivo per evitare deadlock del client auth.
 */
export function deferSupabaseAuthWork(work: () => void | Promise<void>) {
  window.setTimeout(() => {
    void Promise.resolve(work()).catch((error) => {
      console.error("Deferred auth work failed", error);
    });
  }, 0);
}

/**
 * Valida il JWT col server. Se non è valido esegue signOut (espulsione).
 * @returns sessione aggiornata o null
 */
export async function validateSessionOrSignOut() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { session: null as null };
  }
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    await supabase.auth.signOut();
    return { session: null as null };
  }
  return { session };
}

export function removeSupabaseAuthStorage() {
  const key = getSupabaseAuthStorageKey();
  if (key) removeSharedSupabaseAuthItem(key);
}
