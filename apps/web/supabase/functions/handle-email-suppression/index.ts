/**
 * Soppressioni segnalate dal provider: bounce definitivi, reclami spam e
 * disiscrizioni fatte dal mailbox provider.
 *
 * La gestione (spegnimento di tutti i canali, riga di soppressione che
 * sopravvive a una re-iscrizione, evento e feedback solo per le disiscrizioni
 * vere, log append-only) vive in `@pynkstudio/newsletterapp`. Qui resta
 * l'autorizzazione del chiamante, che dipende da come BITE espone l'endpoint.
 */
import { createSuppressionHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'
import { isInjectedServiceKey, timingSafeEqual } from '../_shared/service-auth.ts'

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Tre chiamanti ammessi: la service-role key iniettata dalla piattaforma, un
 * JWT con claim `service_role`, e il secret dedicato del webhook. Un endpoint
 * di soppressione non autenticato permetterebbe di far sparire dalle liste
 * indirizzi arbitrari.
 */
function authorize(request: Request): boolean {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return false

  const token = header.slice('Bearer '.length).trim()
  if (isInjectedServiceKey(token)) return true
  if (parseJwtClaims(token)?.role === 'service_role') return true

  const secret = Deno.env.get('EMAIL_SUPPRESSION_WEBHOOK_SECRET')
  return Boolean(secret && timingSafeEqual(token, secret))
}

serveNewsletter((source) => createSuppressionHandler(source, { authorize }))
