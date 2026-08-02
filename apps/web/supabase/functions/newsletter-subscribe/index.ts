/**
 * Iscrizione pubblica alla newsletter ("Appunti dalla barca").
 *
 * Honeypot, consenso obbligatorio, rate limit per IP, cooldown per indirizzo,
 * double opt-in e attivazione diretta per l'utente autenticato vivono in
 * `@pynkstudio/newsletterapp`. Qui resta solo il montaggio.
 */
import { createSubscribeHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

serveNewsletter(createSubscribeHandler)
