/**
 * Invio di un evento di analytics mentre la pagina si sta chiudendo.
 *
 * Durata della visita e profondità di scroll si conoscono solo alla fine, e la
 * fine coincide spesso con l'unload: lì il client supabase-js non garantisce di
 * portare a termine la richiesta. Si usa quindi una `fetch` grezza con
 * `keepalive: true` — a differenza di `navigator.sendBeacon` permette di
 * impostare gli header `apikey`/`Authorization` che PostgREST pretende.
 *
 * Il token si passa dall'esterno perché va letto *prima*, quando la pagina è
 * ancora viva: durante il teardown non c'è tempo per una promise.
 */
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Chiama una RPC PostgREST in modalità best-effort, anche a pagina in chiusura. */
export function postRpcKeepalive(
  fn: string,
  body: Record<string, unknown>,
  accessToken?: string | null
): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  try {
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Analytics best-effort: non deve mai arrivare al visitatore.
  }
}

/** Legge il token di accesso corrente dalla sessione già in cache. */
export async function getCachedAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
