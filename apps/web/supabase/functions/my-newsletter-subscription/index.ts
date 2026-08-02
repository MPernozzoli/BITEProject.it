/**
 * Stato e preferenze newsletter dell'utente autenticato.
 *
 * Senza `subscribed` nel body legge; con `subscribed` scrive. L'attivazione
 * passa dallo stesso percorso della conferma via email, così iscriversi ha
 * sempre gli stessi effetti. Logica in `@pynkstudio/newsletterapp`.
 */
import { createMySubscriptionHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createMySubscriptionHandler)
