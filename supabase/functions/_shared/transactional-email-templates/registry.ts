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

export const TEMPLATES: Record<string, TemplateEntry> = {
  'newsletter-subscription-confirmation': newsletterSubscriptionConfirmation,
  'newsletter-welcome': newsletterWelcome,
  'newsletter-digest': newsletterDigest,
  'new-chapter-notification': newChapterNotification,
}
