import type { Language } from "@/lib/i18n";

export const SITE_URL = "https://biteproject.it";
export const SUPPORTED_LANGS: Language[] = ["it", "en"];
export const DEFAULT_LANG: Language = "en";

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

export const HREFLANG_DEFAULT: Language = "en";

/**
 * Build the canonical URL and full hreflang alternates for a localized path.
 * @param lang current language
 * @param pathWithoutLang path WITHOUT the /it or /en prefix (e.g. "/logbook")
 */
export function buildAlternates(lang: Language, pathWithoutLang: string) {
  const clean = pathWithoutLang.startsWith("/") ? pathWithoutLang : `/${pathWithoutLang}`;
  const canonical = `${SITE_URL}${withLang(lang, clean)}`;
  const alternates = SUPPORTED_LANGS.map((l) => ({
    hreflang: l,
    href: `${SITE_URL}${withLang(l, clean)}`,
  }));
  const xDefault = `${SITE_URL}${withLang(HREFLANG_DEFAULT, clean)}`;
  return { canonical, alternates, xDefault };
}