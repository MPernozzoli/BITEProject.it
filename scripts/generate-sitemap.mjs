import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const outputPath = path.join(publicDir, "sitemap.xml");

const SITE_URL = "https://biteproject.it";

/** Routes that exist under both /it and /en prefixes (bilingual). */
const LOCALIZED_ROUTES = [
  "/",
  "/crew",
  "/manifesto",
  "/logbook",
  "/voyages",
  "/links",
  "/collaborations",
  "/contact",
];

/** Single-language routes (legal). No hreflang alternates. */
const SINGLE_ROUTES = ["/privacy-policy", "/cookie-policy"];

const LANGS = ["it", "en"];
const DEFAULT_LANG = "en";
const withLang = (lang, path) => (path === "/" ? `/${lang}` : `/${lang}${path}`);

const xmlEscape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const toIsoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const extractImagesFromRichContent = (content) => {
  const images = [];
  const seen = new Set();

  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!node || typeof node !== "object") return;

    if (node.type === "image" && node.attrs && typeof node.attrs === "object") {
      const src = typeof node.attrs.src === "string" ? node.attrs.src.trim() : "";
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push({
          loc: src,
          title:
            typeof node.attrs.title === "string" && node.attrs.title.trim()
              ? node.attrs.title.trim()
              : undefined,
          caption:
            typeof node.attrs.alt === "string" && node.attrs.alt.trim()
              ? node.attrs.alt.trim()
              : undefined,
        });
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(content);
  return images;
};

const loadEnvFile = async () => {
  const envPath = path.join(projectRoot, ".env");
  let envContents = "";
  try {
    envContents = await readFile(envPath, "utf8");
  } catch {
    // No .env file (e.g. Vercel CI) — fall back to process env below.
  }
  const env = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  for (const rawLine of envContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");
    env[key] = value;
  }

  return env;
};

const fetchSupabaseRows = async (table, select, filters = "") => {
  const env = await loadEnvFile();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const apikey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !apikey) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env");
  }

  const url = `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}`;
  const response = await fetch(url, {
    headers: {
      apikey,
      Authorization: `Bearer ${apikey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} fetch failed: ${response.status} ${body}`);
  }

  return response.json();
};

const imageTag = (image) => {
  if (!image?.loc) return "";

  const captionTag = image.caption ? `\n      <image:caption>${xmlEscape(image.caption)}</image:caption>` : "";
  const titleTag = image.title ? `\n      <image:title>${xmlEscape(image.title)}</image:title>` : "";

  return `\n    <image:image>\n      <image:loc>${xmlEscape(image.loc)}</image:loc>${captionTag}${titleTag}\n    </image:image>`;
};

const buildSitemapXml = (urls) => {
  const rows = urls
    .map(({ loc, lastmod, images, alternates }) => {
      const lastmodTag = lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
      const imageTags = (images || []).map(imageTag).join("");
      const alternateTags = (alternates || [])
        .map(
          (alt) =>
            `\n    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${xmlEscape(alt.href)}" />`
        )
        .join("");
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}${alternateTags}${imageTags}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows}\n</urlset>\n`;
};

/** Expand one logical bilingual entry into one <url> per language with hreflang alternates. */
const expandBilingual = (path, lastmod, images = [], localizedPaths) => {
  const pathFor = (l) => (localizedPaths && localizedPaths[l]) || path;
  const alternates = [
    ...LANGS.map((l) => ({ hreflang: l, href: `${SITE_URL}${withLang(l, pathFor(l))}` })),
    { hreflang: "x-default", href: `${SITE_URL}${withLang(DEFAULT_LANG, pathFor(DEFAULT_LANG))}` },
  ];
  return LANGS.map((lang) => ({
    loc: `${SITE_URL}${withLang(lang, pathFor(lang))}`,
    lastmod,
    images,
    alternates,
  }));
};

const generateSitemap = async () => {
  const staticUrls = LOCALIZED_ROUTES.flatMap((route) => expandBilingual(route, null));
  const singleUrls = SINGLE_ROUTES.map((route) => ({
    loc: `${SITE_URL}${route}`,
    lastmod: null,
  }));

  let articleUrls = [];
  let storyUrls = [];
  let voyageUrls = [];

  try {
    const [articles, stories, voyages] = await Promise.all([
      fetchSupabaseRows(
        "logbook_articles",
        "slug,slug_it,slug_en,title_en,title_it,published_at,updated_at,cover_image,content_en,content_it",
        "&status=eq.published&order=published_at.desc.nullslast"
      ),
      fetchSupabaseRows("stories", "slug,slug_it,slug_en,title_en,title_it,updated_at,cover_image", "&order=updated_at.desc.nullslast"),
      fetchSupabaseRows("voyages", "id,name,updated_at", "&order=sort_order.asc"),
    ]);

    const slugFor = (row, l) => {
      const own = l === "it" ? row.slug_it : row.slug_en;
      const other = l === "it" ? row.slug_en : row.slug_it;
      const candidate = (own && String(own).trim()) || (other && String(other).trim()) || row.slug;
      return candidate;
    };

    articleUrls = Array.from(
      new Map(
        articles
          .filter((article) => typeof article.slug === "string" && article.slug)
          .map((article) => {
            const inlineImages = [
              ...extractImagesFromRichContent(article.content_en),
              ...extractImagesFromRichContent(article.content_it),
            ];
            const coverImages = article.cover_image
              ? [
                  {
                    loc: article.cover_image,
                    title: article.title_en || article.title_it || article.slug,
                    caption: article.title_en || article.title_it || "Logbook article cover image",
                  },
                ]
              : [];
            const images = Array.from(
              new Map(
                [...coverImages, ...inlineImages].map((image) => [
                  image.loc,
                  {
                    loc: image.loc,
                    title: image.title || article.title_en || article.title_it || article.slug,
                    caption: image.caption || image.title || article.title_en || article.title_it || "Article image",
                  },
                ])
              ).values()
            );

            return [
              article.slug,
              expandBilingual(
                `/logbook/${article.slug}`,
                toIsoDate(article.updated_at || article.published_at),
                images,
                { it: `/logbook/${slugFor(article, "it")}`, en: `/logbook/${slugFor(article, "en")}` }
              ),
            ];
          })
      ).values()
    ).flat();

    storyUrls = Array.from(
      new Map(
        stories
          .filter((story) => typeof story.slug === "string" && story.slug)
          .map((story) => [
            story.slug,
            expandBilingual(
              `/logbook/story/${story.slug}`,
              toIsoDate(story.updated_at),
              story.cover_image
                ? [
                    {
                      loc: story.cover_image,
                      title: story.title_en || story.title_it || story.slug,
                      caption: story.title_en || story.title_it || "Story cover image",
                    },
                  ]
                : [],
              { it: `/logbook/story/${slugFor(story, "it")}`, en: `/logbook/story/${slugFor(story, "en")}` }
            ),
          ])
      ).values()
    ).flat();

    const slugifyVoyageName = (value) =>
      value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "voyage";

    voyageUrls = Array.from(
      new Map(
        voyages
          .filter((voyage) => typeof voyage.id === "string" && voyage.id && typeof voyage.name === "string" && voyage.name)
          .map((voyage) => [
            voyage.id,
            expandBilingual(
              `/voyages/${voyage.id}--${slugifyVoyageName(voyage.name)}`,
              toIsoDate(voyage.updated_at)
            ),
          ])
      ).values()
    ).flat();
  } catch (error) {
    console.warn("[sitemap] Dynamic URL fetch failed, falling back to static routes only.");
    console.warn(error instanceof Error ? error.message : error);
  }

  const sitemapXml = buildSitemapXml([
    ...staticUrls,
    ...voyageUrls,
    ...storyUrls,
    ...articleUrls,
    ...singleUrls,
  ]);
  await mkdir(publicDir, { recursive: true });
  await writeFile(outputPath, sitemapXml, "utf8");

  console.log(
    `[sitemap] Wrote ${staticUrls.length + voyageUrls.length + storyUrls.length + articleUrls.length + singleUrls.length} URLs to ${path.relative(projectRoot, outputPath)}`
  );
};

await generateSitemap();
