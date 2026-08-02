/**
 * Adattatore verso `@pynkstudio/newsletterapp` per le automazioni di sistema.
 *
 * Il package registra conferma, benvenuto e digest; BITE aggiunge
 * `story-new-article-notification`, che è del suo content model. I default
 * dell'host si sovrappongono a quelli del package senza sostituirli.
 *
 * Non aggiungere logica qui: qualsiasi comportamento nuovo va nel package.
 */
import {
  DEFAULT_SYSTEM_AUTOMATIONS,
  normalizeSystemAutomation,
  type SystemAutomationRow,
} from './newsletterapp.ts'
import { AUTOMATION_STORY_NEW_ARTICLE, BITE_AUTOMATION_DEFAULTS } from './newsletter.ts'

export type SystemEmailAutomationKey =
  | 'newsletter-confirmation'
  | 'newsletter-welcome'
  | 'newsletter-weekly-digest'
  | typeof AUTOMATION_STORY_NEW_ARTICLE

export type SystemEmailAutomationRow = SystemAutomationRow

export const DEFAULT_SYSTEM_EMAIL_AUTOMATIONS = {
  ...DEFAULT_SYSTEM_AUTOMATIONS,
  ...BITE_AUTOMATION_DEFAULTS,
}

export const normalizeSystemEmailAutomation = (
  row?: Partial<SystemEmailAutomationRow> | null,
  key?: SystemEmailAutomationKey,
): SystemEmailAutomationRow =>
  normalizeSystemAutomation(row, key, DEFAULT_SYSTEM_EMAIL_AUTOMATIONS)
