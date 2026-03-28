const SUPPORTED_LANGUAGES = ['it', 'en', 'fr', 'de', 'es', 'pt'] as const

type TranslationRecord = Record<string, string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeLanguage(value?: string | null): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return 'it'
  return SUPPORTED_LANGUAGES.includes(normalized as (typeof SUPPORTED_LANGUAGES)[number])
    ? normalized
    : 'it'
}

export function buildFallbackLanguages(
  preferred?: string | null,
  secondary?: string | null
): string[] {
  const normalizedPreferred = normalizeLanguage(preferred)
  const normalizedSecondary =
    secondary && secondary.trim() ? normalizeLanguage(secondary) : null

  const fallbacks = new Set<string>([normalizedPreferred])

  if (normalizedSecondary) {
    fallbacks.add(normalizedSecondary)
  }

  if (['fr', 'es', 'pt'].includes(normalizedPreferred)) {
    fallbacks.add('it')
  }

  if (normalizedPreferred === 'de') {
    fallbacks.add('en')
  }

  fallbacks.add('it')
  fallbacks.add('en')

  return [...fallbacks]
}

export function parseTranslations(value: unknown): TranslationRecord {
  if (!isRecord(value)) return {}

  const entries = Object.entries(value).filter(
    ([key, entryValue]) =>
      typeof key === 'string' && typeof entryValue === 'string'
  )

  return Object.fromEntries(entries)
}

export function resolveTranslatedEntry(
  value: unknown,
  preferred?: string | null,
  secondary?: string | null
): { value: string; language: string } {
  const translations = parseTranslations(value)
  const fallbacks = buildFallbackLanguages(preferred, secondary)

  for (const language of fallbacks) {
    const translated = translations[language]
    if (translated && translated.trim()) {
      return { value: translated, language }
    }
  }

  const firstEntry = Object.entries(translations).find(([, translated]) =>
    translated?.trim()
  )

  if (firstEntry) {
    return { language: firstEntry[0], value: firstEntry[1] }
  }

  return { language: normalizeLanguage(preferred), value: '' }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(h1|h2|h3|li|blockquote)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function rewriteTrackedLinks(html: string, trackingBaseUrl: string): string {
  return html.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (_, quote: string, href: string) =>
      `href=${quote}${trackingBaseUrl}&url=${encodeURIComponent(href)}${quote}`
  )
}
