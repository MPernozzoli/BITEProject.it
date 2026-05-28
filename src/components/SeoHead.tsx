import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { useLocation } from "react-router-dom";
import {
  buildAlternates,
  OG_LOCALE,
  stripLangPrefix,
  SUPPORTED_LANGS,
} from "@/lib/seo";
import type { Language } from "@/lib/i18n";

export interface SeoHeadProps {
  /** Page title (without site suffix). If omitted, falls back to site default. */
  title?: string;
  description?: string;
  /** Path without lang prefix (e.g. "/logbook"). Defaults to current location. */
  path?: string;
  /** Override canonical URL completely. Use only for non-bilingual routes. */
  canonicalOverride?: string;
  /** og:type, defaults to "website". Use "article" for articles. */
  ogType?: "website" | "article";
  ogImage?: string;
  /** Extra JSON-LD blocks (Article, BreadcrumbList, etc.) */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
  /** Set to true to noindex this page. */
  noindex?: boolean;
}

const SITE_NAME = "BITE";

export function SeoHead({
  title,
  description,
  path,
  canonicalOverride,
  ogType = "website",
  ogImage,
  jsonLd,
  noindex,
}: SeoHeadProps) {
  const { lang } = useI18n();
  const location = useLocation();
  const pathWithoutLang = path ?? stripLangPrefix(location.pathname);
  const { canonical, alternates, xDefault } = buildAlternates(lang as Language, pathWithoutLang);
  const finalCanonical = canonicalOverride ?? canonical;

  const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Stories from S/Y Spritz`;
  const finalDescription =
    description ??
    (lang === "it"
      ? "BITE è un progetto editoriale a bordo di S/Y Spritz: vita in mare, refit, lavoro remoto, viaggio lento."
      : "BITE is a storytelling project from aboard S/Y Spritz about life at sea, refit, remote work, slow travel, and intentional living.");

  const ldArray = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];

  return (
    <Helmet>
      <html lang={lang} />
      <title>{fullTitle}</title>
      <meta name="description" content={finalDescription} />
      {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}

      <link rel="canonical" href={finalCanonical} />
      {!canonicalOverride
        ? alternates.map((alt) => (
            <link key={alt.hreflang} rel="alternate" hrefLang={alt.hreflang} href={alt.href} />
          ))
        : null}
      {!canonicalOverride ? (
        <link rel="alternate" hrefLang="x-default" href={xDefault} />
      ) : null}

      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:url" content={finalCanonical} />
      <meta property="og:locale" content={OG_LOCALE[lang as Language]} />
      {SUPPORTED_LANGS.filter((l) => l !== lang).map((l) => (
        <meta key={l} property="og:locale:alternate" content={OG_LOCALE[l]} />
      ))}
      {ogImage ? <meta property="og:image" content={ogImage} /> : null}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={finalDescription} />
      <meta name="twitter:url" content={finalCanonical} />
      {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}

      {ldArray.map((ld, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(ld)}
        </script>
      ))}
    </Helmet>
  );
}

export default SeoHead;