import type { Language } from "@/lib/i18n";

export const SITE_URL = "https://biteproject.it";
export const SUPPORTED_LANGS: Language[] = ["it", "en"];
export const DEFAULT_LANG: Language = "it";

// ---------------------------------------------------------------------------
// Legacy constants (used across pages and SeoManager)
// ---------------------------------------------------------------------------

export const DEFAULT_DESCRIPTION =
  "BITE is a storytelling project from aboard S/Y Spritz about life at sea, refit, remote work, slow travel, and intentional living.";

export const DEFAULT_DESCRIPTION_IT =
  "BITE è un progetto editoriale a bordo di S/Y Spritz: vita in mare, refit, lavoro remoto, viaggio lento e scelte intenzionali.";

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpeg`;

/**
 * Public routes that exist under both /it and /en prefixes.
 * Admin, auth, profile and legal routes live outside the lang prefix
 * and don't need bilingual indexing.
 */
export const LOCALIZED_ROUTES = [
  "",            // home → /it or /en
  "crew",
  "manifesto",
  "logbook",
  "voyages",
  "links",
  "collaborations",
  "contact",
] as const;

const LANG_PREFIX_RE = /^\/(it|en)(\/|$)/i;

export function getLangFromPath(pathname: string): Language | null {
  const match = pathname.match(LANG_PREFIX_RE);
  if (!match) return null;
  const code = match[1].toLowerCase();
  return code === "it" || code === "en" ? (code as Language) : null;
}

/** Strip the /it or /en prefix from the path. Returns path WITHOUT leading lang. */
export function stripLangPrefix(pathname: string): string {
  const match = pathname.match(LANG_PREFIX_RE);
  if (!match) return pathname;
  const stripped = pathname.slice(match[0].length - (match[2] === "/" ? 1 : 0));
  return stripped || "/";
}

/** Build a localized path: prepends /{lang} to a path that does NOT include the lang prefix. */
export function withLang(lang: Language, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return `/${lang}`;
  return `/${lang}${clean}`;
}

/** Swap the lang prefix of the current path to another language. */
export function swapLangInPath(pathname: string, nextLang: Language, search = ""): string {
  const stripped = stripLangPrefix(pathname);
  return withLang(nextLang, stripped) + search;
}

/**
 * Detect the preferred language for a first-time visitor.
 * Priority: localStorage > cookie > browser language > default.
 */
export function detectPreferredLang(): Language {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem("bite-lang");
    if (stored === "it" || stored === "en") return stored;
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") {
    const cookie = document.cookie.split("; ").find((c) => c.startsWith("bite-lang="));
    if (cookie) {
      const value = cookie.split("=")[1];
      if (value === "it" || value === "en") return value;
    }
  }
  if (typeof navigator !== "undefined") {
    const candidates: string[] = [];
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
    for (const raw of candidates) {
      const code = raw?.toLowerCase().split("-")[0];
      if (code === "it") return "it";
      if (code === "en") return "en";
    }
  }
  return DEFAULT_LANG;
}

export function persistLangPreference(lang: Language) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("bite-lang", lang);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") {
    document.cookie = `bite-lang=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
}

export const OG_LOCALE: Record<Language, string> = {
  it: "it_IT",
  en: "en_US",
};

export const HREFLANG_DEFAULT: Language = "it";

/**
 * Build the canonical URL and full hreflang alternates for a localized path.
 * @param lang current language
 * @param pathWithoutLang path WITHOUT the /it or /en prefix (e.g. "/logbook")
 * @param localizedPaths optional per-language path overrides (e.g. for articles
 *        with different IT vs EN slugs). When provided, alternates use the
 *        per-language path; the current-lang canonical uses the matching entry.
 */
export function buildAlternates(
  lang: Language,
  pathWithoutLang: string,
  localizedPaths?: Partial<Record<Language, string>>
) {
  const clean = pathWithoutLang.startsWith("/") ? pathWithoutLang : `/${pathWithoutLang}`;
  const pathFor = (l: Language) => {
    const candidate = localizedPaths?.[l];
    if (candidate && candidate.trim()) {
      return candidate.startsWith("/") ? candidate : `/${candidate}`;
    }
    return clean;
  };
  const canonical = `${SITE_URL}${withLang(lang, pathFor(lang))}`;
  const alternates = SUPPORTED_LANGS.map((l) => ({
    hreflang: l,
    href: `${SITE_URL}${withLang(l, pathFor(l))}`,
  }));
  const xDefault = `${SITE_URL}${withLang(HREFLANG_DEFAULT, pathFor(HREFLANG_DEFAULT))}`;
  return { canonical, alternates, xDefault };
}

// ---------------------------------------------------------------------------
// applySeo — imperative DOM-mutation system used across the app.
// Bilingual-aware: emits canonical with /it or /en prefix and full hreflang.
// ---------------------------------------------------------------------------

export type SeoStructuredData = Record<string, unknown> | Record<string, unknown>[];

export interface ApplySeoOptions {
  /** Final <title> string (we don't add a suffix here). */
  title: string;
  description: string;
  /** Path WITHOUT lang prefix (e.g. "/logbook" or "/logbook/my-slug"). */
  pathname: string;
  /**
   * Optional per-language path overrides. Use for content with different
   * slugs per language (articles, stories). Each value is the path WITHOUT
   * the /it or /en prefix.
   */
  localizedPaths?: Partial<Record<Language, string>>;
  /** Override language; defaults to language read from current URL or `<html lang>`. */
  lang?: Language;
  /** og:image and twitter:image. Defaults to site OG image. */
  image?: string | null;
  /** og:type. Defaults to "website". Use "article" for articles. */
  type?: "website" | "article" | "collection" | "profile";
  /** robots meta value. Defaults to "index, follow". */
  robots?: string;
  /** Optional JSON-LD blocks. Replaces any previously-managed ones. */
  structuredData?: SeoStructuredData;
}

const MANAGED_ATTR = "data-bite-seo-managed";

function clearManagedTags() {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll(`[${MANAGED_ATTR}]`).forEach((el) => el.remove());
}

function setManagedMeta(attr: "name" | "property", key: string, value: string) {
  const tag = document.createElement("meta");
  tag.setAttribute(attr, key);
  tag.setAttribute("content", value);
  tag.setAttribute(MANAGED_ATTR, "1");
  document.head.appendChild(tag);
}

function setManagedLink(rel: string, href: string, extra?: Record<string, string>) {
  const tag = document.createElement("link");
  tag.setAttribute("rel", rel);
  tag.setAttribute("href", href);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) tag.setAttribute(k, v);
  }
  tag.setAttribute(MANAGED_ATTR, "1");
  document.head.appendChild(tag);
}

function setManagedJsonLd(data: SeoStructuredData) {
  const items = Array.isArray(data) ? data : [data];
  items.forEach((item) => {
    const tag = document.createElement("script");
    tag.setAttribute("type", "application/ld+json");
    tag.setAttribute(MANAGED_ATTR, "1");
    tag.textContent = JSON.stringify(item);
    document.head.appendChild(tag);
  });
}

function removeStaticSeoTags() {
  // Drop the SEO tags baked into index.html (canonical, hreflang, og:*, twitter:*)
  // — only the per-route managed ones are correct once the app is running.
  if (typeof document === "undefined") return;
  document.head
    .querySelectorAll(
      [
        'link[rel="canonical"]:not([data-bite-seo-managed])',
        'link[rel="alternate"][hreflang]:not([data-bite-seo-managed])',
        'meta[property^="og:"]:not([data-bite-seo-managed])',
        'meta[name^="twitter:"]:not([data-bite-seo-managed])',
      ].join(", ")
    )
    .forEach((el) => el.remove());
}

function detectCurrentLang(override?: Language): Language {
  if (override === "it" || override === "en") return override;
  if (typeof window !== "undefined") {
    const fromPath = getLangFromPath(window.location.pathname);
    if (fromPath) return fromPath;
  }
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.getAttribute("lang");
    if (htmlLang === "it" || htmlLang === "en") return htmlLang;
  }
  return DEFAULT_LANG;
}

export function applySeo(options: ApplySeoOptions): void {
  if (typeof document === "undefined") return;

  const lang = detectCurrentLang(options.lang);
  const pathWithoutLang = stripLangPrefix(options.pathname);
  const { canonical, alternates, xDefault } = buildAlternates(
    lang,
    pathWithoutLang,
    options.localizedPaths
  );
  const image = options.image || DEFAULT_OG_IMAGE;
  const ogType = options.type === "article" ? "article" : "website";
  const robots = options.robots ?? "index, follow";

  // Title + html lang
  document.title = options.title;
  document.documentElement.setAttribute("lang", lang);

  // Robots meta (mutate existing or create)
  let robotsEl = document.head.querySelector('meta[name="robots"]');
  if (!robotsEl) {
    robotsEl = document.createElement("meta");
    robotsEl.setAttribute("name", "robots");
    document.head.appendChild(robotsEl);
  }
  robotsEl.setAttribute("content", robots);

  // Description meta (mutate existing or create)
  let descEl = document.head.querySelector('meta[name="description"]');
  if (!descEl) {
    descEl = document.createElement("meta");
    descEl.setAttribute("name", "description");
    document.head.appendChild(descEl);
  }
  descEl.setAttribute("content", options.description);

  // Clear previously-managed tags then re-emit
  removeStaticSeoTags();
  clearManagedTags();

  setManagedLink("canonical", canonical);
  alternates.forEach((alt) => {
    setManagedLink("alternate", alt.href, { hreflang: alt.hreflang });
  });
  setManagedLink("alternate", xDefault, { hreflang: "x-default" });

  setManagedMeta("property", "og:type", ogType);
  setManagedMeta("property", "og:title", options.title);
  setManagedMeta("property", "og:description", options.description);
  setManagedMeta("property", "og:url", canonical);
  setManagedMeta("property", "og:site_name", "BITE");
  setManagedMeta("property", "og:locale", OG_LOCALE[lang]);
  SUPPORTED_LANGS.filter((l) => l !== lang).forEach((l) =>
    setManagedMeta("property", "og:locale:alternate", OG_LOCALE[l])
  );
  setManagedMeta("property", "og:image", image);

  setManagedMeta("name", "twitter:card", "summary_large_image");
  setManagedMeta("name", "twitter:title", options.title);
  setManagedMeta("name", "twitter:description", options.description);
  setManagedMeta("name", "twitter:url", canonical);
  setManagedMeta("name", "twitter:image", image);

  if (options.structuredData) {
    setManagedJsonLd(options.structuredData);
  }
}
