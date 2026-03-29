export const SITE_NAME = "BITE";
export const SITE_URL = "https://biteproject.it";
export const DEFAULT_IMAGE_URL = `${SITE_URL}/og-image.jpeg`;
export const DEFAULT_DESCRIPTION =
  "BITE is a storytelling project from aboard S/Y Spritz about life at sea, refit, remote work, slow travel, and intentional living.";
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

type StructuredData = Record<string, unknown>;

type ApplySeoOptions = {
  title: string;
  description: string;
  pathname: string;
  image?: string | null;
  robots?: string;
  type?: "website" | "article" | "collection";
  structuredData?: StructuredData | StructuredData[];
};

const setOrCreateMeta = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;

  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
};

const setOrCreateLink = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector(selector) as HTMLLinkElement | null;

  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
};

const setOrCreateJsonLd = (id: string, value: StructuredData | StructuredData[]) => {
  let element = document.head.querySelector(`#${id}`) as HTMLScriptElement | null;

  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.id = id;
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify(value);
};

const getBaseStructuredData = ({
  canonicalUrl,
  title,
  description,
  imageUrl,
  type,
}: {
  canonicalUrl: string;
  title: string;
  description: string;
  imageUrl: string;
  type: "website" | "article" | "collection";
}) => {
  if (type === "article") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      mainEntityOfPage: canonicalUrl,
      headline: title,
      description,
      image: [imageUrl],
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORGANIZATION_ID },
      url: canonicalUrl,
      inLanguage: "en",
    } satisfies StructuredData;
  }

  if (type === "collection") {
    return {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      url: canonicalUrl,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORGANIZATION_ID },
      primaryImageOfPage: imageUrl,
      inLanguage: "en",
    } satisfies StructuredData;
  }

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonicalUrl,
    isPartOf: { "@id": WEBSITE_ID },
    primaryImageOfPage: imageUrl,
    inLanguage: "en",
  } satisfies StructuredData;
};

export const applySeo = ({
  title,
  description,
  pathname,
  image,
  robots = "index, follow",
  type = "website",
  structuredData,
}: ApplySeoOptions) => {
  const canonicalUrl = new URL(pathname, SITE_URL).toString();
  const imageUrl = image || DEFAULT_IMAGE_URL;

  document.title = title;

  setOrCreateMeta('meta[name="author"]', { name: "author", content: SITE_NAME });
  setOrCreateMeta('meta[name="application-name"]', { name: "application-name", content: SITE_NAME });
  setOrCreateMeta('meta[name="description"]', { name: "description", content: description });
  setOrCreateMeta('meta[name="robots"]', { name: "robots", content: robots });
  setOrCreateMeta('meta[name="googlebot"]', {
    name: "googlebot",
    content: `${robots}, max-image-preview:large, max-snippet:-1, max-video-preview:-1`,
  });
  setOrCreateMeta('meta[name="bingbot"]', {
    name: "bingbot",
    content: `${robots}, max-image-preview:large, max-snippet:-1, max-video-preview:-1`,
  });
  setOrCreateMeta('meta[property="og:type"]', {
    property: "og:type",
    content: type === "article" ? "article" : "website",
  });
  setOrCreateMeta('meta[property="og:site_name"]', { property: "og:site_name", content: SITE_NAME });
  setOrCreateMeta('meta[property="og:locale"]', { property: "og:locale", content: "en_US" });
  setOrCreateMeta('meta[property="og:title"]', { property: "og:title", content: title });
  setOrCreateMeta('meta[property="og:description"]', { property: "og:description", content: description });
  setOrCreateMeta('meta[property="og:url"]', { property: "og:url", content: canonicalUrl });
  setOrCreateMeta('meta[property="og:image"]', { property: "og:image", content: imageUrl });
  setOrCreateMeta('meta[property="og:image:alt"]', {
    property: "og:image:alt",
    content: "BITE, stories and voyages aboard S/Y Spritz.",
  });
  setOrCreateMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  setOrCreateMeta('meta[name="twitter:url"]', { name: "twitter:url", content: canonicalUrl });
  setOrCreateMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  setOrCreateMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  setOrCreateMeta('meta[name="twitter:image"]', { name: "twitter:image", content: imageUrl });
  setOrCreateLink('link[rel="canonical"]', { rel: "canonical", href: canonicalUrl });
  setOrCreateLink('link[rel="alternate"][type="text/markdown"]', {
    rel: "alternate",
    type: "text/markdown",
    href: `${SITE_URL}/llms.txt`,
    title: "LLMs.txt for AI agents",
  });

  setOrCreateJsonLd("bite-page-structured-data", getBaseStructuredData({
    canonicalUrl,
    title,
    description,
    imageUrl,
    type,
  }));

  if (structuredData) {
    setOrCreateJsonLd("bite-route-structured-data", structuredData);
    return;
  }

  const routeStructuredData = document.head.querySelector("#bite-route-structured-data");
  routeStructuredData?.remove();
};
