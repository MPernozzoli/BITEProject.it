export type EmailNotificationPreferences = {
  newsletter_enabled: boolean
  digest_enabled: boolean
  story_notifications_enabled: boolean
  like_notifications_frequency: EngagementNotificationFrequency
  comment_notifications_frequency: EngagementNotificationFrequency
}

export type EngagementNotificationFrequency =
  | 'instant'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'none'

const DEFAULT_PREFERENCES: EmailNotificationPreferences = {
  newsletter_enabled: true,
  digest_enabled: true,
  story_notifications_enabled: true,
  like_notifications_frequency: 'instant',
  comment_notifications_frequency: 'instant',
}

function normalizeEngagementFrequency(
  value: unknown,
  fallback: EngagementNotificationFrequency
): EngagementNotificationFrequency {
  if (typeof value !== 'string') return fallback

  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'instant':
    case 'daily':
    case 'weekly':
    case 'monthly':
    case 'none':
      return normalized
    default:
      return fallback
  }
}

export function normalizeEmailNotificationPreferences(
  value?: Partial<EmailNotificationPreferences> | null
): EmailNotificationPreferences {
  return {
    newsletter_enabled:
      typeof value?.newsletter_enabled === 'boolean'
        ? value.newsletter_enabled
        : DEFAULT_PREFERENCES.newsletter_enabled,
    digest_enabled:
      typeof value?.digest_enabled === 'boolean'
        ? value.digest_enabled
        : DEFAULT_PREFERENCES.digest_enabled,
    story_notifications_enabled:
      typeof value?.story_notifications_enabled === 'boolean'
        ? value.story_notifications_enabled
        : DEFAULT_PREFERENCES.story_notifications_enabled,
    like_notifications_frequency: normalizeEngagementFrequency(
      value?.like_notifications_frequency,
      DEFAULT_PREFERENCES.like_notifications_frequency
    ),
    comment_notifications_frequency: normalizeEngagementFrequency(
      value?.comment_notifications_frequency,
      DEFAULT_PREFERENCES.comment_notifications_frequency
    ),
  }
}

export function hasAnyEmailNotificationsEnabled(
  preferences: EmailNotificationPreferences
): boolean {
  return (
    preferences.newsletter_enabled ||
    preferences.digest_enabled ||
    preferences.story_notifications_enabled ||
    preferences.like_notifications_frequency !== 'none' ||
    preferences.comment_notifications_frequency !== 'none'
  )
}

export function hasAnyNewsletterNotificationsEnabled(
  preferences: EmailNotificationPreferences
): boolean {
  return preferences.newsletter_enabled || preferences.digest_enabled
}
