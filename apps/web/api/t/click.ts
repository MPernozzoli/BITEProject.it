/**
 * Redirect tracciato dei link delle newsletter, sul dominio del brand.
 *
 * Prima il tracking viveva su `<project>.supabase.co/functions/v1/...`, il che
 * significava spedire da `mail.biteproject.it` messaggi in cui il 100% dei link
 * puntava a un dominio diverso dal mittente — il segnale di spam più forte che
 * avevamo addosso.
 *
 * L'edge function `newsletter-track-click` resta pubblicata: le email già
 * spedite contengono ancora i vecchi URL e devono continuare a funzionare.
 *
 * Logica in `@pynkstudio/newsletterapp`, incluso il fail-closed: senza una
 * delivery valida si torna al sito, non al `?url=` richiesto.
 */
import { createNodeClickHandler } from "@pynkstudio/newsletterapp/node";

import { getNewsletterContext } from "../../src/server/newsletter.js";

export default createNodeClickHandler(getNewsletterContext);
