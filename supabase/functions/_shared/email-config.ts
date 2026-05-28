export const SITE_NAME = 'BITE'
export const FROM_DOMAIN = 'biteproject.it'
export const SENDER_DOMAIN = 'notify.biteproject.it'
export const PUBLIC_SITE_URL = 'https://biteproject.it'

export function buildFromAddress(fromName?: string | null): string {
  const senderName = fromName?.trim() || SITE_NAME
  return `${senderName} <noreply@${FROM_DOMAIN}>`
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
 * Routes that are not bilingual (e.g. /unsubscribe, /profile/:id, /privacy-policy)
 * should not be passed through here — use PUBLIC_SITE_URL directly.
 */
export function localizedUrl(lang: string | null | undefined, path: string): string {
  const l = normalizeSiteLang(lang)
  const clean = path.startsWith('/') ? path : `/${path}`
  if (clean === '/' || clean === '') return `${PUBLIC_SITE_URL}/${l}`
  return `${PUBLIC_SITE_URL}/${l}${clean}`
}
