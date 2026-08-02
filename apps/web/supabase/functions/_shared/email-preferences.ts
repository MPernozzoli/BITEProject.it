/**
 * Adattatore verso `@pynkstudio/newsletterapp` per le preferenze di notifica.
 *
 * Il package tiene i canali email; BITE ci appoggia sulla stessa riga anche i
 * canali push, dichiarati in `newsletter.ts` come `preferenceDefaults` — vanno
 * passati qui altrimenti una normalizzazione li leggerebbe come assenti.
 *
 * Non aggiungere logica qui: qualsiasi comportamento nuovo va nel package.
 */
import {
  hasAnyEmailNotificationsEnabled,
  hasAnyNewsletterNotificationsEnabled,
  normalizeNewsletterPreferences,
  type EngagementNotificationFrequency,
  type NewsletterPreferences,
} from './newsletterapp.ts'
import { BITE_PREFERENCE_DEFAULTS } from './newsletter.ts'

export type { EngagementNotificationFrequency }
export type EmailNotificationPreferences = NewsletterPreferences & {
  push_engagement_enabled: boolean
  push_publication_enabled: boolean
  push_mail_enabled: boolean
  push_voyage_admin_enabled: boolean
  push_voyage_user_enabled: boolean
}

export { hasAnyEmailNotificationsEnabled, hasAnyNewsletterNotificationsEnabled }

export const normalizeEmailNotificationPreferences = (
  value?: Partial<EmailNotificationPreferences> | null,
): EmailNotificationPreferences =>
  normalizeNewsletterPreferences(value, BITE_PREFERENCE_DEFAULTS) as EmailNotificationPreferences
