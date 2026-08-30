import { buildTrackedUrl, type TrackingParams } from './tracking.ts'

export const SITE_NAME = 'BITE'
export const FROM_DOMAIN = 'biteproject.it'
export const SENDER_DOMAIN = 'mail.biteproject.it'
export const PUBLIC_SITE_URL = 'https://biteproject.it'

export function buildFromAddress(fromName?: string | null): string {
  const senderName = fromName?.trim() || SITE_NAME
  return `${senderName} <support@${SENDER_DOMAIN}>`
}

/** Supported public-site languages. Mirrors src/lib/seo.ts. */
export type SiteLang = 'it' | 'en'
export const DEFAULT_SITE_LANG: SiteLang = 'en'

/** Coerce any string into a supported site language, falling back to default. */
export function normalizeSiteLang(value?: string | null): SiteLang {
  if (!value) return DEFAULT_SITE_LANG
  const code = value.toLowerCase().split('-')[0]
  if (code === 'it' || code === 'en') return code
  return DEFAULT_SITE_LANG
}

/**
 * Build a full localized public URL. Path may or may not start with "/".
 * Routes that are not bilingual (e.g. /unsubscribe, /profile/:id)
 * should not be passed through here — use PUBLIC_SITE_URL directly.
 */
export function localizedUrl(lang: string | null | undefined, path: string): string {
  const l = normalizeSiteLang(lang)
  const clean = path.startsWith('/') ? path : `/${path}`
  if (clean === '/' || clean === '') return `${PUBLIC_SITE_URL}/${l}`
  return `${PUBLIC_SITE_URL}/${l}${clean}`
}

/**
 * URL pubblico localizzato **con i tracker di sorgente**: la forma da mettere
 * dentro un'email o una push, perché quel click arriva da fuori il sito e
 * senza `utm_*` finirebbe indistinguibile dal traffico diretto.
 *
 * Da non usare per i link interni al sito: sovrascriverebbero la provenienza
 * reale della sessione di chi sta già navigando.
 */
export function trackedUrl(
  lang: string | null | undefined,
  path: string,
  tracking: TrackingParams,
): string {
  return buildTrackedUrl(localizedUrl(lang, path), tracking)
}
