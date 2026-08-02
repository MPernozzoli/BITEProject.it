/**
 * Endpoint pubblico di disiscrizione a un solo click (RFC 8058).
 *
 * È il target dell'header `List-Unsubscribe` che `process-email-queue` mette su
 * ogni email di newsletter. Vive sul dominio del brand — non su `*.supabase.co` —
 * perché è l'URL che i provider mostrano accanto al mittente, ed è quello che
 * concorre alla reputazione del dominio.
 *
 * Dal passaggio a `@pynkstudio/newsletterapp` il `POST` one-click applica la
 * disiscrizione qui invece di inoltrarla a `handle-email-unsubscribe`: la
 * logica è la stessa in entrambi i posti, quindi il percorso diventa un hop
 * solo. Il `GET` resta un redirect a `/unsubscribe`, dove la persona sceglie
 * cosa disattivare e può lasciare un motivo.
 */
import { createNodeUnsubscribeHandler } from "@pynkstudio/newsletterapp/node";

import { getNewsletterContext } from "../../src/server/newsletter.js";

export default createNodeUnsubscribeHandler(getNewsletterContext);
