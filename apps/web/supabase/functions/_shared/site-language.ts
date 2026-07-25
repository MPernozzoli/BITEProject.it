/**
 * Maps any declared language onto the two languages the site and its transactional emails
 * actually speak. Server-side mirror of resolveToSiteLanguage() in src/lib/i18n.tsx — keep the
 * two in sync, otherwise a user reads the site in one language and their emails in another.
 *
 * The rule this replaces was `preferred_language === 'en' ? 'en' : 'it'`, which is not a mapping
 * but a coin toss: every language that is not literally 'en' — Polish, German, Spanish, or a null
 * profile — came out Italian. Users who never chose Italian were getting Italian email.
 *
 * Order of preference:
 *   1. the declared language, when it is one we publish in;
 *   2. the secondary language, same condition — someone who declares pl/en gets English;
 *   3. romance languages fall back to Italian, everything else to English.
 */
export type SiteLanguage = 'it' | 'en'

const ROMANCE_FALLBACK_TO_IT = ['fr', 'es', 'pt', 'ca', 'ro']

function normalize(value?: string | null): string {
  // Accepts full locales ('en-GB', 'it_IT') as well as bare codes.
  return (value ?? '').trim().toLowerCase().split(/[-_]/)[0]
}

export function resolveSiteLanguage(
  preferred?: string | null,
  secondary?: string | null
): SiteLanguage {
  const primary = normalize(preferred)
  if (primary === 'it' || primary === 'en') return primary

  const fallback = normalize(secondary)
  if (fallback === 'it' || fallback === 'en') return fallback

  if (ROMANCE_FALLBACK_TO_IT.includes(primary)) return 'it'

  // Includes the empty case: a profile that never declared a language is far more likely to be
  // international than Italian, and English is the site's own default (see _shared/email-config.ts).
  return 'en'
}
