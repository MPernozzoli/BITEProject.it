/**
 * Dynamic rendering for crawlers.
 *
 * The public site is a client-rendered SPA, so social crawlers (which do not
 * execute JavaScript) would otherwise see the generic index.html meta on every
 * URL. middleware.ts rewrites bot requests here; this function returns a
 * lightweight HTML document with the correct per-page title, description,
 * canonical/hreflang, Open Graph tags, JSON-LD and text content.
 *
 * Content is fetched from Supabase REST with the public (publishable) key —
 * the same data the SPA itself renders.
 */

const SITE_URL = "https://biteproject.it";
const SITE_NAME = "BITE";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpeg`;
const LANGS = ["it", "en"] as const;
const DEFAULT_LANG = "it";

type Lang = (typeof LANGS)[number];

const DEFAULT_DESCRIPTION: Record<Lang, string> = {
  en: "BITE is a storytelling project from aboard S/Y Spritz about life at sea, refit, remote work, slow travel, and intentional living.",
  it: "BITE è un progetto editoriale a bordo di S/Y Spritz: vita in mare, refit, lavoro remoto, viaggio lento e scelte intenzionali.",
};

/** Static-route meta, mirroring src/components/SeoManager.tsx. */
const STATIC_ROUTES: Record<string, { title: Record<Lang, string>; description: Record<Lang, string> }> = {
  "/": {
    title: { en: "BITE — Stories from S/Y Spritz", it: "BITE — Storie da S/Y Spritz" },
    description: DEFAULT_DESCRIPTION,
  },
  "/crew": {
    title: { en: "Crew | BITE", it: "La Ciurma | BITE" },
    description: {
      en: "Meet the crew behind BITE and the life aboard S/Y Spritz.",
      it: "Scopri la ciurma dietro BITE e la vita a bordo di S/Y Spritz.",
    },
  },
  "/manifesto": {
    title: { en: "Manifesto | BITE", it: "Manifesto | BITE" },
    description: {
      en: "Read the values behind BITE: life at sea, intentional living, and independent storytelling.",
      it: "I valori dietro BITE: vita in mare, scelte intenzionali e narrazione indipendente.",
    },
  },
  "/logbook": {
    title: { en: "Logbook | BITE", it: "Diario di bordo | BITE" },
    description: {
      en: "Explore voyages, refit notes, and stories from aboard S/Y Spritz.",
      it: "Esplora rotte, note di refit e storie da bordo di S/Y Spritz.",
    },
  },
  "/voyages": {
    title: { en: "Voyages | BITE", it: "Rotte | BITE" },
    description: {
      en: "Browse public routes with departures, arrivals, dates, and waypoints from aboard S/Y Spritz.",
      it: "Naviga le rotte pubbliche con partenze, arrivi, date e waypoint da bordo di S/Y Spritz.",
    },
  },
  "/links": {
    title: { en: "Links | BITE", it: "Link | BITE" },
    description: {
      en: "Quick links to all BITE projects, social channels and resources.",
      it: "Tutti i link al progetto BITE, ai canali social e alle risorse.",
    },
  },
  "/collaborations": {
    title: { en: "Collaborations | BITE", it: "Collaborazioni | BITE" },
    description: {
      en: "Partnerships, editorial work, and creative collaborations with BITE.",
      it: "Partnership, lavoro editoriale e collaborazioni creative con BITE.",
    },
  },
  "/contact": {
    title: { en: "Contact | BITE", it: "Contatti | BITE" },
    description: {
      en: "Get in touch with BITE for collaborations, editorial projects, and updates from aboard.",
      it: "Contatta BITE per collaborazioni, progetti editoriali e aggiornamenti da bordo.",
    },
  },
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const getLang = (pathname: string): Lang => {
  const match = pathname.match(/^\/(it|en)(\/|$)/i);
  return match ? (match[1].toLowerCase() as Lang) : DEFAULT_LANG;
};

const stripLang = (pathname: string): string => {
  const stripped = pathname.replace(/^\/(it|en)(?=\/|$)/i, "");
  return stripped || "/";
};

const withLang = (lang: Lang, path: string) => (path === "/" ? `/${lang}` : `/${lang}${path}`);

/** Extract plain-text paragraphs from TipTap rich-content JSON. */
const extractParagraphs = (content: unknown): string[] => {
  const paragraphs: string[] = [];
  const textOf = (node: any): string => {
    if (!node || typeof node !== "object") return "";
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) return node.content.map(textOf).join("");
    return "";
  };
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === "paragraph" || node.type === "heading") {
      const text = textOf(node).trim();
      if (text) paragraphs.push(text);
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(content);
  return paragraphs;
};

const supabaseFetch = async (pathAndQuery: string): Promise<any[] | null> => {
  const baseUrl = process.env.VITE_SUPABASE_URL;
  const apikey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !apikey) return null;
  try {
    const response = await fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
      headers: { apikey, Authorization: `Bearer ${apikey}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as any[];
  } catch {
    return null;
  }
};

interface PageData {
  title: string;
  description: string;
  /** Path without lang prefix, per language (for canonical + hreflang). */
  paths: Record<Lang, string>;
  image?: string | null;
  ogType: "website" | "article";
  jsonLd?: Record<string, unknown>;
  paragraphs?: string[];
  sections?: HtmlSection[];
  links?: HtmlLink[];
  status: number;
  robots: string;
}

interface HtmlLink {
  href: string;
  label: string;
  description?: string | null;
  date?: string | null;
  rel?: string;
}

interface HtmlSection {
  heading: string;
  body?: string | null;
  links?: HtmlLink[];
}

const absoluteUrl = (path: string) => `${SITE_URL}${path}`;
const localizedUrl = (lang: Lang, path: string) => absoluteUrl(withLang(lang, path));

const buildStaticPage = (lang: Lang, path: string): PageData | null => {
  const meta = STATIC_ROUTES[path];
  if (!meta) return null;
  return {
    title: meta.title[lang],
    description: meta.description[lang],
    paths: { it: path, en: path },
    ogType: "website",
    status: 200,
    robots: "index, follow",
  };
};

const notFoundPage = (lang: Lang): PageData => ({
  title: lang === "it" ? "Pagina non trovata | BITE" : "Page not found | BITE",
  description: DEFAULT_DESCRIPTION[lang],
  paths: { it: "/", en: "/" },
  ogType: "website",
  status: 404,
  robots: "noindex, nofollow",
});

const localizedField = (row: any, base: string, lang: Lang): string => {
  const own = row?.[`${base}_${lang}`];
  const other = row?.[`${base}_${lang === "it" ? "en" : "it"}`];
  return (typeof own === "string" && own.trim()) || (typeof other === "string" && other.trim()) || "";
};

const slugFor = (row: any, lang: Lang): string => {
  return localizedField(row, "slug", lang) || String(row?.slug ?? "");
};

const slugifyVoyageName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voyage";

const voyageName = (row: any, lang: Lang): string =>
  localizedField(row, "name", lang) || String(row?.name ?? "Voyage");

const voyageDescription = (row: any, lang: Lang): string =>
  localizedField(row, "description", lang) || "";

const voyagePath = (row: any) =>
  `/voyages/${row.id}--${slugifyVoyageName(String(row.name_en || row.name_it || row.name || "voyage"))}`;

const articleTitle = (row: any, lang: Lang): string =>
  localizedField(row, "title", lang) || String(row?.slug ?? "Logbook article");

const articleDescription = (row: any, lang: Lang): string =>
  localizedField(row, "excerpt", lang) || "";

const articlePath = (row: any, lang: Lang) => `/logbook/${slugFor(row, lang)}`;

const publishedAt = (row: any) =>
  typeof row?.published_at === "string" && row.published_at ? row.published_at : null;

const modifiedAt = (row: any) =>
  (typeof row?.updated_at === "string" && row.updated_at) || publishedAt(row) || null;

const fetchPublishedArticles = (select = "id,slug,slug_it,slug_en,title_en,title_it,excerpt_en,excerpt_it,published_at,updated_at,cover_image,voyage_id,category") =>
  supabaseFetch(
    `logbook_articles?select=${encodeURIComponent(select)}&status=eq.published&order=published_at.desc.nullslast&order=created_at.desc`
  );

const fetchPublishedVoyages = (select = "id,name,name_en,name_it,description,description_en,description_it,start_date,end_date,updated_at,created_at,type,status") =>
  supabaseFetch(`voyages?select=${encodeURIComponent(select)}&is_published=eq.true&order=sort_order.asc`);

const fetchArticleAuthors = async (articleId: string): Promise<Array<{ id: string; name: string; avatar_url?: string | null }>> => {
  const links = await supabaseFetch(`article_authors?select=profile_id&article_id=eq.${encodeURIComponent(articleId)}`);
  const ids = (links ?? []).map((link) => link.profile_id).filter(Boolean);
  if (!ids.length) return [];

  const profiles = await supabaseFetch(
    `public_profiles?select=id,name,avatar_url&id=in.(${ids.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",")})`
  );
  return (profiles ?? [])
    .filter((profile) => typeof profile.name === "string" && profile.name.trim())
    .map((profile) => ({ id: profile.id, name: profile.name, avatar_url: profile.avatar_url ?? null }));
};

const fetchArticleTags = async (articleId: string): Promise<string[]> => {
  const rows = await supabaseFetch(
    `article_tags?select=tags(name)&article_id=eq.${encodeURIComponent(articleId)}`
  );
  return (rows ?? [])
    .map((row) => row.tags?.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
};

const buildLogbookIndex = async (lang: Lang): Promise<PageData> => {
  const articles = (await fetchPublishedArticles()) ?? [];
  const links: HtmlLink[] = articles.flatMap((article) =>
    LANGS.map((itemLang) => ({
      href: withLang(itemLang, articlePath(article, itemLang)),
      label: `${articleTitle(article, itemLang)} (${itemLang})`,
      description: articleDescription(article, itemLang),
      date: publishedAt(article),
      rel: itemLang === lang ? undefined : "alternate",
    }))
  );
  const page = buildStaticPage(lang, "/logbook");
  return {
    ...(page ?? notFoundPage(lang)),
    sections: [
      {
        heading: lang === "it" ? "Articoli pubblicati" : "Published articles",
        body:
          lang === "it"
            ? "Archivio completo degli articoli pubblicati nel logbook."
            : "Complete archive of published logbook articles.",
        links,
      },
    ],
    links,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: STATIC_ROUTES["/logbook"].title[lang],
      description: STATIC_ROUTES["/logbook"].description[lang],
      url: localizedUrl(lang, "/logbook"),
      mainEntity: {
        "@type": "ItemList",
        itemListElement: links.map((link, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: absoluteUrl(link.href),
          name: link.label,
        })),
      },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      inLanguage: lang,
    },
  };
};

const buildVoyagesIndex = async (lang: Lang): Promise<PageData> => {
  const voyages = (await fetchPublishedVoyages()) ?? [];
  const links: HtmlLink[] = voyages.flatMap((voyage) =>
    LANGS.map((itemLang) => ({
      href: withLang(itemLang, voyagePath(voyage)),
      label: `${voyageName(voyage, itemLang)} (${itemLang})`,
      description: voyageDescription(voyage, itemLang),
      date: modifiedAt(voyage),
      rel: itemLang === lang ? undefined : "alternate",
    }))
  );
  const page = buildStaticPage(lang, "/voyages");
  return {
    ...(page ?? notFoundPage(lang)),
    sections: [
      {
        heading: lang === "it" ? "Rotte pubbliche" : "Public voyages",
        body:
          lang === "it"
            ? "Tutti i viaggi pubblici con pagina dedicata, date e tappe."
            : "All public voyages with dedicated route pages, dates, and stops.",
        links,
      },
    ],
    links,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: STATIC_ROUTES["/voyages"].title[lang],
      description: STATIC_ROUTES["/voyages"].description[lang],
      url: localizedUrl(lang, "/voyages"),
      mainEntity: {
        "@type": "ItemList",
        itemListElement: links.map((link, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: absoluteUrl(link.href),
          name: link.label,
        })),
      },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      inLanguage: lang,
    },
  };
};

const buildArticlePage = async (lang: Lang, slug: string): Promise<PageData> => {
  const rows = await supabaseFetch(
    `logbook_articles?select=*&status=eq.published&or=(slug.eq.${encodeURIComponent(slug)},slug_it.eq.${encodeURIComponent(slug)},slug_en.eq.${encodeURIComponent(slug)})&limit=1`
  );
  const article = rows?.[0];
  if (!article) return notFoundPage(lang);

  const title = articleTitle(article, lang);
  const paragraphs = extractParagraphs(lang === "it" ? article.content_it ?? article.content_en : article.content_en ?? article.content_it);
  const description =
    articleDescription(article, lang) || paragraphs.join(" ").slice(0, 160) || DEFAULT_DESCRIPTION[lang];
  const paths: Record<Lang, string> = {
    it: articlePath(article, "it"),
    en: articlePath(article, "en"),
  };
  const canonicalUrl = localizedUrl(lang, paths[lang]);
  const relatedQuery = article.voyage_id
    ? `logbook_articles?select=id,slug,slug_it,slug_en,title_en,title_it,excerpt_en,excerpt_it,published_at,updated_at,voyage_id&status=eq.published&voyage_id=eq.${encodeURIComponent(article.voyage_id)}&id=neq.${encodeURIComponent(article.id)}&order=published_at.desc.nullslast&limit=6`
    : article.category
      ? `logbook_articles?select=id,slug,slug_it,slug_en,title_en,title_it,excerpt_en,excerpt_it,published_at,updated_at,voyage_id,category&status=eq.published&category=eq.${encodeURIComponent(article.category)}&id=neq.${encodeURIComponent(article.id)}&order=published_at.desc.nullslast&limit=6`
      : `logbook_articles?select=id,slug,slug_it,slug_en,title_en,title_it,excerpt_en,excerpt_it,published_at,updated_at,voyage_id&status=eq.published&id=neq.${encodeURIComponent(article.id)}&order=published_at.desc.nullslast&limit=6`;

  const [authors, tags, linkedVoyageRows, relatedRows] = await Promise.all([
    fetchArticleAuthors(article.id),
    fetchArticleTags(article.id),
    article.voyage_id
      ? supabaseFetch(`voyages?select=id,name,name_en,name_it,description,description_en,description_it,updated_at,created_at,type,status&id=eq.${encodeURIComponent(article.voyage_id)}&is_published=eq.true&limit=1`)
      : Promise.resolve(null),
    supabaseFetch(relatedQuery),
  ]);
  const linkedVoyage = linkedVoyageRows?.[0] ?? null;
  const internalLinks: HtmlLink[] = [
    { href: withLang(lang, "/"), label: lang === "it" ? "Home" : "Home" },
    { href: withLang(lang, "/logbook"), label: lang === "it" ? "Categoria: Logbook" : "Category: Logbook" },
  ];
  if (linkedVoyage) {
    internalLinks.push({
      href: withLang(lang, voyagePath(linkedVoyage)),
      label: voyageName(linkedVoyage, lang),
      description: lang === "it" ? "Viaggio collegato" : "Linked voyage",
    });
  }
  for (const related of relatedRows ?? []) {
    internalLinks.push({
      href: withLang(lang, articlePath(related, lang)),
      label: articleTitle(related, lang),
      description: articleDescription(related, lang),
      date: publishedAt(related),
    });
  }

  return {
    title: `${title} | BITE`,
    description,
    paths,
    image: article.cover_image || null,
    ogType: "article",
    paragraphs,
    status: 200,
    robots: "index, follow",
    links: internalLinks,
    sections: [
      {
        heading: lang === "it" ? "Collegamenti interni" : "Internal links",
        links: internalLinks,
      },
    ],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      description,
      url: canonicalUrl,
      mainEntityOfPage: canonicalUrl,
      image: article.cover_image || undefined,
      datePublished: article.published_at || undefined,
      dateModified: article.updated_at || article.published_at || undefined,
      articleSection: article.category || "Logbook",
      keywords: tags.length ? tags : undefined,
      author: authors.length
        ? authors.map((author) => ({
            "@type": "Person",
            name: author.name,
            url: absoluteUrl(`/profile/${author.id}`),
          }))
        : { "@id": `${SITE_URL}/#organization` },
      inLanguage: lang,
      publisher: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
  };
};

const buildStoryPage = async (lang: Lang, slug: string): Promise<PageData> => {
  const rows = await supabaseFetch(
    `stories?select=*&or=(slug.eq.${encodeURIComponent(slug)},slug_it.eq.${encodeURIComponent(slug)},slug_en.eq.${encodeURIComponent(slug)})&limit=1`
  );
  const story = rows?.[0];
  if (!story) return notFoundPage(lang);

  const title = localizedField(story, "title", lang) || story.slug;
  const description = localizedField(story, "description", lang) || DEFAULT_DESCRIPTION[lang];
  const paths: Record<Lang, string> = {
    it: `/logbook/story/${slugFor(story, "it")}`,
    en: `/logbook/story/${slugFor(story, "en")}`,
  };
  const canonicalUrl = `${SITE_URL}${withLang(lang, paths[lang])}`;

  return {
    title: `${title} | BITE`,
    description,
    paths,
    image: story.cover_image || null,
    ogType: "article",
    status: 200,
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      url: canonicalUrl,
      mainEntityOfPage: canonicalUrl,
      image: story.cover_image || undefined,
      dateModified: story.updated_at || undefined,
      inLanguage: lang,
      publisher: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
  };
};

const buildVoyagePage = async (lang: Lang, ref: string): Promise<PageData> => {
  const id = ref.split("--")[0];
  if (!id) return notFoundPage(lang);
  const rows = await supabaseFetch(`voyages?select=*&id=eq.${encodeURIComponent(id)}&is_published=eq.true&limit=1`);
  const voyage = rows?.[0];
  if (!voyage) return notFoundPage(lang);

  const name = voyageName(voyage, lang);
  const description =
    voyageDescription(voyage, lang) ||
    (lang === "it"
      ? `Rotta pubblica "${name}" con partenza, arrivo, waypoint e date del viaggio a bordo di S/Y Spritz.`
      : `Public route "${name}" with departure, arrival, waypoints, and voyage dates aboard S/Y Spritz.`);
  const path = voyagePath(voyage);
  const [waypoints, articleRows, otherVoyages] = await Promise.all([
    supabaseFetch(`voyage_waypoints?select=name,name_it,name_en,description,description_it,description_en,lat,lng,event_date,date_start,date_end,sort_order&voyage_id=eq.${encodeURIComponent(id)}&order=sort_order.asc`),
    supabaseFetch(
      `logbook_articles?select=id,slug,slug_it,slug_en,title_en,title_it,excerpt_en,excerpt_it,published_at,updated_at,voyage_id&status=eq.published&voyage_id=eq.${encodeURIComponent(id)}&order=published_at.asc.nullslast`
    ),
    supabaseFetch(
      `voyages?select=id,name,name_en,name_it,description,description_en,description_it,updated_at,created_at,type,status&is_published=eq.true&id=neq.${encodeURIComponent(id)}&order=sort_order.asc&limit=6`
    ),
  ]);
  const articleLinks: HtmlLink[] = (articleRows ?? []).map((article) => ({
    href: withLang(lang, articlePath(article, lang)),
    label: articleTitle(article, lang),
    description: articleDescription(article, lang),
    date: publishedAt(article),
  }));
  const voyageLinks: HtmlLink[] = (otherVoyages ?? []).map((entry) => ({
    href: withLang(lang, voyagePath(entry)),
    label: voyageName(entry, lang),
    description: voyageDescription(entry, lang),
    date: modifiedAt(entry),
  }));
  const homeLinks: HtmlLink[] = [
    { href: withLang(lang, "/"), label: "Home" },
    { href: withLang(lang, "/voyages"), label: lang === "it" ? "Archivio rotte" : "Voyage archive" },
  ];
  const waypointParagraphs = (waypoints ?? []).slice(0, 24).map((waypoint, index) => {
    const label = voyageName({ name: waypoint.name, name_it: waypoint.name_it, name_en: waypoint.name_en }, lang) || `Stop ${index + 1}`;
    const body = localizedField(waypoint, "description", lang);
    const date = waypoint.event_date || waypoint.date_start || waypoint.date_end;
    return [label, date, body].filter(Boolean).join(" — ");
  });
  const canonicalUrl = localizedUrl(lang, path);

  return {
    title: `${name} | BITE`,
    description,
    paths: { it: path, en: path },
    ogType: "website",
    paragraphs: waypointParagraphs,
    sections: [
      { heading: lang === "it" ? "Articoli collegati" : "Related articles", links: articleLinks },
      { heading: lang === "it" ? "Altre rotte" : "Other voyages", links: voyageLinks },
      { heading: lang === "it" ? "Navigazione" : "Navigation", links: homeLinks },
    ],
    links: [...articleLinks, ...voyageLinks, ...homeLinks],
    status: 200,
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Trip",
      name,
      description,
      url: canonicalUrl,
      mainEntityOfPage: canonicalUrl,
      departureTime: voyage.start_date || undefined,
      arrivalTime: voyage.end_date || undefined,
      itinerary: (waypoints ?? []).map((waypoint, index) => ({
        "@type": "Place",
        name: voyageName({ name: waypoint.name, name_it: waypoint.name_it, name_en: waypoint.name_en }, lang) || `Stop ${index + 1}`,
        geo:
          typeof waypoint.lat === "number" && typeof waypoint.lng === "number"
            ? {
                "@type": "GeoCoordinates",
                latitude: waypoint.lat,
                longitude: waypoint.lng,
              }
            : undefined,
      })),
      subjectOf: articleLinks.map((link) => ({
        "@type": "BlogPosting",
        headline: link.label,
        url: absoluteUrl(link.href),
      })),
      provider: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      inLanguage: lang,
    },
  };
};

const renderHtml = (lang: Lang, page: PageData): string => {
  const canonical = `${SITE_URL}${withLang(lang, page.paths[lang])}`;
  const image = page.image || DEFAULT_OG_IMAGE;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);

  const hreflangLinks = [
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}${withLang(l, page.paths[l])}" />`),
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}${withLang(DEFAULT_LANG, page.paths[DEFAULT_LANG])}" />`,
  ].join("\n    ");

  const jsonLdBlocks: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${SITE_URL}/#organization`,
          name: "BITE Project",
          alternateName: "BITE",
          url: `${SITE_URL}/`,
          logo: DEFAULT_OG_IMAGE,
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          url: `${SITE_URL}/`,
          name: "BITE Project",
          description: DEFAULT_DESCRIPTION.it,
          publisher: { "@id": `${SITE_URL}/#organization` },
          inLanguage: ["en", "it"],
        },
      ],
    },
  ];
  if (page.jsonLd) jsonLdBlocks.push(page.jsonLd);

  const bodyParagraphs = (page.paragraphs || [])
    .map((text) => `<p>${escapeHtml(text)}</p>`)
    .join("\n      ");
  const renderLink = (link: HtmlLink) => {
    const rel = link.rel ? ` rel="${escapeHtml(link.rel)}"` : "";
    return `<li><a href="${escapeHtml(link.href)}"${rel}>${escapeHtml(link.label)}</a>${link.date ? ` <time datetime="${escapeHtml(link.date)}">${escapeHtml(link.date.slice(0, 10))}</time>` : ""}${link.description ? `<p>${escapeHtml(link.description)}</p>` : ""}</li>`;
  };
  const bodySections = (page.sections || [])
    .map((section) => {
      const body = section.body ? `<p>${escapeHtml(section.body)}</p>` : "";
      const links = section.links?.length ? `<ul>\n        ${section.links.map(renderLink).join("\n        ")}\n      </ul>` : "";
      return `<section>\n      <h2>${escapeHtml(section.heading)}</h2>\n      ${body}\n      ${links}\n    </section>`;
    })
    .join("\n    ");

  const navLinks = ["/logbook", "/voyages", "/crew", "/manifesto", "/collaborations", "/contact"]
    .map((path) => `<a href="${withLang(lang, path)}">${escapeHtml(STATIC_ROUTES[path]?.title[lang] ?? path)}</a>`)
    .join(" · ");

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="${page.robots}" />
    <link rel="canonical" href="${canonical}" />
    ${hreflangLinks}
    <meta property="og:type" content="${page.ogType}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:locale" content="${lang === "it" ? "it_IT" : "en_US"}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:url" content="${canonical}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    ${jsonLdBlocks.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join("\n    ")}
  </head>
  <body>
    <header><a href="${SITE_URL}${withLang(lang, "/")}">${SITE_NAME}</a></header>
    <main>
      <h1>${title}</h1>
      ${page.image ? `<img src="${escapeHtml(page.image)}" alt="${title}" loading="eager" fetchpriority="high" />` : ""}
      <p>${description}</p>
      ${bodyParagraphs}
      ${bodySections}
    </main>
    <footer><nav>${navLinks}</nav></footer>
  </body>
</html>
`;
};

const buildPage = async (lang: Lang, path: string): Promise<PageData> => {
  if (path === "/logbook") return buildLogbookIndex(lang);
  if (path === "/voyages") return buildVoyagesIndex(lang);

  const staticPage = buildStaticPage(lang, path);
  if (staticPage) return staticPage;

  const storyMatch = path.match(/^\/logbook\/story\/([^/]+)$/);
  if (storyMatch) return buildStoryPage(lang, decodeURIComponent(storyMatch[1]));

  const articleMatch = path.match(/^\/logbook\/([^/]+)$/);
  if (articleMatch) return buildArticlePage(lang, decodeURIComponent(articleMatch[1]));

  const voyageMatch = path.match(/^\/voyages\/([^/]+)$/);
  if (voyageMatch) return buildVoyagePage(lang, decodeURIComponent(voyageMatch[1]));

  return notFoundPage(lang);
};

interface NodeRequest {
  url?: string;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  // req.url is path-relative on the Node runtime; the base is ignored if absolute.
  const url = new URL(req.url || "/", SITE_URL);
  const rawPath = url.searchParams.get("path") || "/";
  const pathname = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  const lang = getLang(pathname);
  const path = stripLang(pathname);

  const page = await buildPage(lang, path);
  const html = renderHtml(lang, page);

  res.statusCode = page.status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("X-Bite-Prerender", "1");
  res.end(html);
}
