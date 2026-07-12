export type EmailNotificationPreferences = {
  article_notifications_enabled: boolean
  newsletter_enabled: boolean
  digest_enabled: boolean
  story_notifications_enabled: boolean
  like_notifications_frequency: EngagementNotificationFrequency
  comment_notifications_frequency: EngagementNotificationFrequency
  push_engagement_enabled: boolean
  push_publication_enabled: boolean
  push_mail_enabled: boolean
  push_voyage_admin_enabled: boolean
  push_voyage_user_enabled: boolean
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
  article_notifications_enabled: true,
  like_notifications_frequency: 'instant',
  comment_notifications_frequency: 'instant',
  push_engagement_enabled: true,
  push_publication_enabled: true,
  push_mail_enabled: true,
  push_voyage_admin_enabled: true,
  push_voyage_user_enabled: true,
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
    article_notifications_enabled:
      typeof value?.article_notifications_enabled === 'boolean'
        ? value.article_notifications_enabled
        : DEFAULT_PREFERENCES.article_notifications_enabled,
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
    push_engagement_enabled:
      typeof value?.push_engagement_enabled === 'boolean'
        ? value.push_engagement_enabled
        : DEFAULT_PREFERENCES.push_engagement_enabled,
    push_publication_enabled:
      typeof value?.push_publication_enabled === 'boolean'
        ? value.push_publication_enabled
        : DEFAULT_PREFERENCES.push_publication_enabled,
    push_mail_enabled:
      typeof value?.push_mail_enabled === 'boolean'
        ? value.push_mail_enabled
        : DEFAULT_PREFERENCES.push_mail_enabled,
    push_voyage_admin_enabled:
      typeof value?.push_voyage_admin_enabled === 'boolean'
        ? value.push_voyage_admin_enabled
        : DEFAULT_PREFERENCES.push_voyage_admin_enabled,
    push_voyage_user_enabled:
      typeof value?.push_voyage_user_enabled === 'boolean'
        ? value.push_voyage_user_enabled
        : DEFAULT_PREFERENCES.push_voyage_user_enabled,
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
