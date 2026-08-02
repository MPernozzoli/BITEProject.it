/**
 * Disiscrizione da token: one-click dei provider (RFC 8058) e scelta granulare
 * dalla pagina `/unsubscribe`, con raccolta del motivo.
 *
 * Resta pubblicata anche ora che `/api/email/unsubscribe` applica il one-click
 * direttamente: le email già spedite puntano ancora qui.
 * Logica in `@pynkstudio/newsletterapp`.
 */
import { createUnsubscribeHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createUnsubscribeHandler)
