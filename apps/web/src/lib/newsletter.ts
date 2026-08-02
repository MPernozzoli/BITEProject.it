/**
 * Adattatore client verso `@pynkstudio/newsletterapp`.
 *
 * Merge tag, validazione del composer, metriche e tolleranza alle tabelle non
 * ancora migrate vivono nel package; qui restano solo le etichette in italiano
 * e il binding alla configurazione di BITE.
 *
 * Non aggiungere logica qui: qualsiasi comportamento nuovo va nel package.
 */
import {
  NEWSLETTER_MERGE_TAGS as PACKAGE_MERGE_TAGS,
  buildPreviewVariables,
  createOptionalFunctionInvoker,
  isMissingSupabaseResourceError,
  normalizeOptionalSelectResult,
  renderMergeTags,
} from "@pynkstudio/newsletterapp/core";
import type { NewsletterBodyMode } from "@pynkstudio/newsletterapp/admin";

import { newsletterConfig } from "./newsletter-config";

export { isMissingSupabaseResourceError, normalizeOptionalSelectResult };
export type { NewsletterBodyMode };

/** Etichette del selettore tag nel composer. Il package espone solo le chiavi. */
const MERGE_TAG_LABELS: Record<string, string> = {
  user_name: "Nome completo",
  first_name: "Nome",
  greeting_name: "Nome saluto",
  user_email: "Email utente",
  preferred_language: "Lingua preferita",
  profile_url: "URL profilo",
  unsubscribe_url: "URL disiscrizione",
  site_url: "URL sito",
  message_name: "Nome messaggio",
  delivery_type: "Tipo invio",
  event_type: "Evento automazione",
  subscriber_source: "Sorgente iscrizione",
  today: "Data ISO",
  current_year: "Anno corrente",
};

export const NEWSLETTER_MERGE_TAGS = PACKAGE_MERGE_TAGS.map((tag) => ({
  token: tag.token,
  label: MERGE_TAG_LABELS[tag.labelKey] ?? tag.labelKey,
}));

export const renderNewsletterMergeTags = renderMergeTags;

/**
 * Stesse variabili di un invio reale, con valori di esempio: l'anteprima del
 * composer non può divergere da ciò che riceve un destinatario.
 */
export const buildNewsletterPreviewVariables = (messageName: string, language: string) =>
  buildPreviewVariables(newsletterConfig, {
    messageName,
    language,
    sampleName: "Massimo",
    sampleEmail: "massimo@example.com",
  });

/**
 * Le edge function newsletter vengono deployate separatamente dall'app: finché
 * una non esiste, la console deve degradare invece di rompersi. L'invoker
 * ricorda i 404 così un pannello che fa polling non li ripete a ogni refresh.
 */
export const invokeOptionalNewsletterFunction = createOptionalFunctionInvoker();
