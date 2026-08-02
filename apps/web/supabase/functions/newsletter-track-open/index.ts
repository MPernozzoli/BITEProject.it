/**
 * Pixel di apertura, versione edge function.
 *
 * I nuovi invii usano `/api/t/open` sul dominio del brand; questa resta
 * pubblicata perché le email già spedite contengono i vecchi URL.
 * Logica in `@pynkstudio/newsletterapp`.
 */
import { createOpenTrackingHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createOpenTrackingHandler)
