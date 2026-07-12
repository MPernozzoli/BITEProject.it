import type { Language } from "@/lib/i18n";

/**
 * Article/story records that may have per-language slugs.
 * `slug` is the canonical / legacy identifier (always present).
 * `slug_it` and `slug_en` are SEO-optimized per-language slugs (optional).
 */
export type WithBilingualSlugs = {
  slug?: string | null;
  slug_it?: string | null;
  slug_en?: string | null;
};

/**
 * Resolve the slug to use for a given language.
 * Priority: slug_{lang} → slug_{other} → slug (legacy fallback).
 */
export function slugForLang(record: WithBilingualSlugs | null | undefined, lang: Language): string {
  if (!record) return "";
  const own = lang === "it" ? record.slug_it : record.slug_en;
  if (own && own.trim()) return own.trim();
  const other = lang === "it" ? record.slug_en : record.slug_it;
  if (other && other.trim()) return other.trim();
  return (record.slug || "").trim();
}

/**
 * Build the path WITHOUT lang prefix for an article in a given language.
 */
export function articlePathForLang(article: WithBilingualSlugs | null | undefined, lang: Language): string {
  return `/logbook/${slugForLang(article, lang)}`;
}

/**
 * Build the path WITHOUT lang prefix for a story in a given language.
 */
export function storyPathForLang(story: WithBilingualSlugs | null | undefined, lang: Language): string {
  return `/logbook/story/${slugForLang(story, lang)}`;
}

/**
 * For SEO `applySeo({ localizedPaths })`: returns the per-language path map
 * for a record. Each entry is the path WITHOUT the /it or /en prefix.
 */
export function articleLocalizedPaths(article: WithBilingualSlugs | null | undefined) {
  return {
    it: articlePathForLang(article, "it"),
    en: articlePathForLang(article, "en"),
  };
}

export function storyLocalizedPaths(story: WithBilingualSlugs | null | undefined) {
  return {
    it: storyPathForLang(story, "it"),
    en: storyPathForLang(story, "en"),
  };
}

/**
 * Build a PostgREST .or() filter that matches a slug across the three columns.
 * Escape commas (slugs shouldn't contain them, but be defensive).
 */
export function bilingualSlugOrFilter(slug: string): string {
  const safe = slug.replace(/,/g, "");
  return `slug.eq.${safe},slug_it.eq.${safe},slug_en.eq.${safe}`;
}