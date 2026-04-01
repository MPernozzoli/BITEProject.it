const SUPPORTED_LANGUAGES = ['it', 'en', 'fr', 'de', 'es', 'pt'] as const

type TranslationRecord = Record<string, string>
type MergeVariables = Record<string, string>

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

  return Object.fromEntries(entries) as TranslationRecord
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

function getFirstName(name?: string | null): string {
  if (!name?.trim()) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

export function buildMergeVariables(params: {
  userName?: string | null
  userEmail: string
  preferredLanguage?: string | null
  profileId?: string | null
  siteUrl: string
  unsubscribeUrl: string
  messageName: string
  deliveryType: 'campaign' | 'automation'
  eventType?: string | null
  subscriberSource?: string | null
}): MergeVariables {
  const normalizedDate = new Date().toISOString().slice(0, 10)
  const firstName = getFirstName(params.userName)
  const profileUrl = params.profileId
    ? `${params.siteUrl}/profile/${params.profileId}`
    : ''

  return {
    user_name: params.userName?.trim() || '',
    first_name: firstName,
    greeting_name: firstName || params.userName?.trim() || 'friend',
    user_email: params.userEmail,
    preferred_language: params.preferredLanguage || '',
    profile_url: profileUrl,
    unsubscribe_url: params.unsubscribeUrl,
    site_url: params.siteUrl,
    message_name: params.messageName,
    delivery_type: params.deliveryType,
    event_type: params.eventType || '',
    subscriber_source: params.subscriberSource || '',
    today: normalizedDate,
    current_year: String(new Date().getFullYear()),
  }
}

export function renderMergeTags(
  template: string,
  variables: MergeVariables
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    variables[key] ?? ''
  )
}
