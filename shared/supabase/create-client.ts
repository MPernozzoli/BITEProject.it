import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSharedSupabaseAuthStorage } from "@shared/supabase/auth-storage";

/**
 * Factory del client Supabase browser, condivisa dalle quattro app.
 *
 * Ogni app resta proprietaria del **proprio** tipo `Database`: `apps/pack` e `apps/data`
 * generano di proposito uno schema ridotto (181 e 502 righe contro le 6643 di `web`/`crew`),
 * quindi il parametro di tipo va passato dal chiamante e non è centralizzabile qui.
 *
 * L'unica differenza reale fra le app era il flag passkey — attivo dove esiste un login
 * utente (`web`, `crew`), assente dove l'app è di sola lettura (`pack`, `data`).
 */
export function createBiteSupabaseClient<Database>(
  options: { passkey?: boolean } = {},
): SupabaseClient<Database> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  return createClient<Database>(url, publishableKey, {
    auth: {
      storage: createSharedSupabaseAuthStorage(),
      persistSession: true,
      autoRefreshToken: true,
      ...(options.passkey ? { experimental: { passkey: true } } : {}),
    },
  });
}
