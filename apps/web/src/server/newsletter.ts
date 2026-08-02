/**
 * BITE wiring per `@pynkstudio/newsletterapp`, lato Vercel.
 *
 * Tutto il comportamento newsletter — iscrizione, preferenze, disiscrizione,
 * dispatch, digest, tracking — vive nel package. La configurazione di BITE
 * (dominio, mittente, lingue) sta in `../lib/newsletter-config`, condivisa con
 * la console admin.
 *
 * Le route Vercel che usano questo contesto sono quelle che *devono* stare sul
 * dominio del brand: pixel di apertura, redirect dei click e target
 * `List-Unsubscribe`. Non renderizzano né spediscono nulla, quindi il contesto
 * non dichiara `renderNewsletter`/`sendTemplate`.
 */

import type { NewsletterContext } from "@pynkstudio/newsletterapp/server";

import { newsletterConfig } from "../lib/newsletter-config.js";
import { createMailServiceClient } from "./mail.js";

export { newsletterConfig };

let cached: NewsletterContext | null = null;

/**
 * Costruito su richiesta e memoizzato: un modulo di route viene valutato
 * all'import, e creare qui il client Supabase trasformerebbe una env mancante
 * in un crash a cold start invece che in un errore gestito sulla richiesta.
 */
export function getNewsletterContext(): NewsletterContext {
  if (!cached) {
    cached = { config: newsletterConfig, db: createMailServiceClient() };
  }
  return cached;
}
