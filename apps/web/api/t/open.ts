/**
 * Pixel di apertura delle newsletter, sul dominio del brand invece che su
 * `<project>.supabase.co` — vedi la nota in `api/t/click.ts`.
 *
 * Logica in `@pynkstudio/newsletterapp`: risponde sempre col GIF, qualunque
 * cosa accada, perché un errore di tracking non deve tradursi in un'immagine
 * rotta dentro l'email.
 */
import { createNodeOpenHandler } from "@pynkstudio/newsletterapp/node";

import { getNewsletterContext } from "../../src/server/newsletter.js";

export default createNodeOpenHandler(getNewsletterContext);
