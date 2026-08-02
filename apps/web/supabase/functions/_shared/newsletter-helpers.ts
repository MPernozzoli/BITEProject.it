/**
 * Adattatore verso `@pynkstudio/newsletterapp` per le function che non sono
 * newsletter ma condividono la risoluzione della lingua (notifiche articolo,
 * story, engagement, profilo).
 *
 * Le funzioni del package prendono la config come primo argomento; qui è
 * applicata quella di BITE, così i chiamanti restano invariati.
 *
 * Non aggiungere logica qui: qualsiasi comportamento nuovo va nel package.
 */
import {
  buildFallbackLanguages as packageBuildFallbackLanguages,
  localizeValue as packageLocalizeValue,
  normalizeLanguage as packageNormalizeLanguage,
  parseTranslations,
  resolveTranslatedEntry as packageResolveTranslatedEntry,
  rewriteTrackedLinks,
  stripHtml,
} from './newsletterapp.ts'
import { newsletterConfig } from './newsletter.ts'

export { parseTranslations, rewriteTrackedLinks, stripHtml }

export const normalizeLanguage = (value?: string | null): string =>
  packageNormalizeLanguage(newsletterConfig, value)

export const buildFallbackLanguages = (
  preferred?: string | null,
  secondary?: string | null,
): string[] => packageBuildFallbackLanguages(newsletterConfig, preferred, secondary)

export const resolveTranslatedEntry = (
  value: unknown,
  preferred?: string | null,
  secondary?: string | null,
) => packageResolveTranslatedEntry(newsletterConfig, value, preferred, secondary)

export const localizeValue = (
  language: string | null | undefined,
  values: Record<string, string | null | undefined>,
  fallback = '',
) => packageLocalizeValue(newsletterConfig, language, values, fallback)
