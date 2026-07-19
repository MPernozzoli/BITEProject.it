/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<Record<string, unknown>>
  subject: string | ((data: Record<string, unknown>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, unknown>
}

import { template as newsletterSubscriptionConfirmation } from './newsletter-subscription-confirmation.tsx'
import { template as newsletterWelcome } from './newsletter-welcome.tsx'
import { template as newsletterDigest } from './newsletter-digest.tsx'
import { template as newChapterNotification } from './new-chapter-notification.tsx'
import { template as engagementNotification } from './engagement-notification.tsx'
import { template as voyageBookingNotification } from './voyage-booking-notification.tsx'
import { template as voyageBookingAdminNotification } from './voyage-booking-admin-notification.tsx'
import { template as voyageParticipantInvite } from './voyage-participant-invite.tsx'
import { template as voyageBriefing } from './voyage-briefing.tsx'
import { template as voyageAvailabilityUpdate } from './voyage-availability-update.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'newsletter-subscription-confirmation': newsletterSubscriptionConfirmation,
  'newsletter-welcome': newsletterWelcome,
  'newsletter-digest': newsletterDigest,
  'new-chapter-notification': newChapterNotification,
  'engagement-notification': engagementNotification,
  'voyage-booking-notification': voyageBookingNotification,
  'voyage-booking-admin-notification': voyageBookingAdminNotification,
  'voyage-participant-invite': voyageParticipantInvite,
  'voyage-briefing': voyageBriefing,
  'voyage-availability-update': voyageAvailabilityUpdate,
}
