export type EmailNotificationPreferences = {
  newsletter_enabled: boolean
  digest_enabled: boolean
  story_notifications_enabled: boolean
}

const DEFAULT_PREFERENCES: EmailNotificationPreferences = {
  newsletter_enabled: true,
  digest_enabled: true,
  story_notifications_enabled: true,
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
  }
}

export function hasAnyEmailNotificationsEnabled(
  preferences: EmailNotificationPreferences
): boolean {
  return (
    preferences.newsletter_enabled ||
    preferences.digest_enabled ||
    preferences.story_notifications_enabled
  )
}

export function hasAnyNewsletterNotificationsEnabled(
  preferences: EmailNotificationPreferences
): boolean {
  return preferences.newsletter_enabled || preferences.digest_enabled
}
