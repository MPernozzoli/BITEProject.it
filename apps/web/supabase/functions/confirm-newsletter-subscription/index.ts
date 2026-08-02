/**
 * Conferma del double opt-in (pagina `/newsletter/confirm`).
 *
 * `GET` ispeziona il token — valido, già usato o scaduto — così la pagina può
 * mostrare lo stato prima di agire; `POST` attiva l'iscrizione.
 * Logica in `@pynkstudio/newsletterapp`.
 */
import { createConfirmHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createConfirmHandler)
