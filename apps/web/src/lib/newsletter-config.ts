/**
 * Configurazione newsletter di BITE, isomorfa.
 *
 * Vive qui e non in `src/server/newsletter.ts` perché la serve anche la console
 * admin: quel modulo tira dentro `web-push` e il client Supabase service-role,
 * che non devono finire in un bundle client.
 *
 * Le edge function mantengono una dichiarazione gemella in
 * `supabase/functions/_shared/newsletter.ts`: girano su un runtime diverso e
 * non possono importare da `src/`. Se cambia un valore qui, va cambiato anche
 * là.
 */
import { resolveNewsletterConfig } from "@pynkstudio/newsletterapp/core";

export const newsletterConfig = resolveNewsletterConfig({
  siteUrl: "https://biteproject.it",
  siteName: "BITE",
  senderDomain: "mail.biteproject.it",
  // Le newsletter si scrivono in sei lingue, ma il sito pubblico è bilingue:
  // i link nel corpo devono comunque risolvere su /it o /en.
  supportedLanguages: ["it", "en", "fr", "de", "es", "pt"],
  defaultLanguage: "it",
  siteLanguages: ["it", "en"],
  defaultSiteLanguage: "en",
  // Embed qualificato col nome del vincolo: senza, PostgREST non risolve la
  // relazione in modo deterministico.
  subscriberProfileEmbed:
    "profiles:profiles!newsletter_subscribers_profile_id_fkey(name, preferred_language, secondary_language)",
});
