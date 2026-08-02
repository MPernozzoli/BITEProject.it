/**
 * Redirect tracciato dei click, versione edge function.
 *
 * I nuovi invii usano `/api/t/click` sul dominio del brand; questa resta
 * pubblicata perché le email già spedite contengono i vecchi URL.
 * Logica in `@pynkstudio/newsletterapp`, incluso il fail-closed che impedisce
 * di trasformare l'endpoint in un open redirect.
 */
import { createClickTrackingHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createClickTrackingHandler)
