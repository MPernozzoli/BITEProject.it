import { firstQueryParam, type NodeRequest, type NodeResponse } from "../../src/server/http.js";

/**
 * Proxy del link di verifica delle email di autenticazione.
 *
 * `/auth/v1/verify` vive sul gateway Kong del progetto Supabase e pretende un
 * `apikey`: metterlo direttamente nell'email significa spedire da
 * `mail.biteproject.it` un messaggio il cui unico link punta a
 * `*.supabase.co`, cosa che i filtri antispam segnalano come dominio
 * disallineato (ed espone la anon key in chiaro dentro ogni messaggio).
 *
 * Qui il link nell'email resta sul dominio del brand e la chiave viene
 * aggiunta lato server subito prima del redirect, quindi il vincolo del
 * gateway resta soddisfatto: senza `apikey` la verifica risponderebbe
 * "No API key found in request".
 */

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://biteproject.it";

// Tipi accettati da /auth/v1/verify. Whitelist esplicita: non inoltriamo
// valori arbitrari al gateway.
const ALLOWED_TYPES = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email_change_current",
  "email_change_new",
  "reauthentication",
]);

function isAllowedRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "biteproject.it" || host.endsWith(".biteproject.it") || host === "localhost";
  } catch {
    return false;
  }
}

function redirect(res: NodeResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end();
    return;
  }

  const token = firstQueryParam(req, "token");
  const type = firstQueryParam(req, "type");
  const redirectTo = firstQueryParam(req, "redirect_to");

  if (!token || !type || !ALLOWED_TYPES.has(type)) {
    // Link malformato o manomesso: portiamo la persona al login invece di
    // mostrarle un errore del gateway.
    redirect(res, `${SITE_URL}/login`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error("[auth/verify] SUPABASE_URL o anon key non configurati");
    redirect(res, `${SITE_URL}/login`);
    return;
  }

  const target = new URL("/auth/v1/verify", supabaseUrl);
  target.searchParams.set("token", token);
  target.searchParams.set("type", type);
  // Supabase valida comunque `redirect_to` contro la propria allow-list; qui
  // lo restringiamo ai nostri domini per non prestare il redirect a nessuno.
  if (redirectTo && isAllowedRedirect(redirectTo)) {
    target.searchParams.set("redirect_to", redirectTo);
  }
  target.searchParams.set("apikey", anonKey);

  redirect(res, target.toString());
}
