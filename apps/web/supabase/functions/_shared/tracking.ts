/**
 * Tracker di sorgente per le Edge Function.
 *
 * Gemello Deno di `src/lib/utm.ts`: le function non possono importare dal
 * bundle del sito, quindi la regola vive due volte. Non è una copia lasciata a
 * sé — `src/test/tracking-parity.test.ts` importa entrambi i moduli e verifica
 * che diano lo stesso risultato sugli stessi input. Se qui si sposta una
 * virgola senza spostarla anche di là, la suite lo dice.
 *
 * Perché serve: un link mandato per email o per push **esce dal sito**. Senza
 * `utm_*` il traffico che ne deriva torna indistinguibile dal diretto, e
 * un'edizione della newsletter non si può confrontare con un post in un gruppo.
 * I link interni, invece, non si taggano mai — sovrascriverebbero la
 * provenienza vera della sessione in corso.
 */

export interface TrackingParams {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
}

/** Minuscolo, senza accenti, non alfanumerici → trattini, max 60 caratteri. */
export function normalizeTrackingToken(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const KEY_BY_FIELD: Record<keyof TrackingParams, string> = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  content: 'utm_content',
  term: 'utm_term',
}

/**
 * Aggiunge i tracker a un URL, lasciando intatto tutto il resto. Senza tracker
 * o su un indirizzo non parsabile restituisce l'originale: un tracker non vale
 * la rottura di un link dentro un'email già spedita.
 */
export function buildTrackedUrl(url: string, tracking?: TrackingParams | null): string {
  if (!url || !tracking) return url

  const normalized: Record<string, string> = {}
  for (const field of Object.keys(KEY_BY_FIELD) as (keyof TrackingParams)[]) {
    const value = normalizeTrackingToken(tracking[field])
    if (value) normalized[KEY_BY_FIELD[field]] = value
  }
  if (Object.keys(normalized).length === 0) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  for (const [key, value] of Object.entries(normalized)) {
    parsed.searchParams.set(key, value)
  }

  return parsed.toString()
}

/** Le sorgenti usate dalle function, per non riscriverle a mano ogni volta. */
export const EMAIL_TRACKING = {
  /** Digest periodico della newsletter. */
  newsletter: { source: 'newsletter', medium: 'email' },
  /** Notifiche transazionali di engagement e pubblicazione. */
  notification: { source: 'notification', medium: 'email' },
  /** La stessa notifica, ma consegnata come push del browser. */
  push: { source: 'notification', medium: 'push' },
} as const
