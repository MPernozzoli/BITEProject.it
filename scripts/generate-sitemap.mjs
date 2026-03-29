import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const outputPath = path.join(publicDir, "sitemap.xml");

const SITE_URL = "https://biteproject.it";
const STATIC_ROUTES = [
  "/",
  "/crew",
  "/manifesto",
  "/logbook",
  "/collaborations",
  "/contact",
  "/privacy-policy",
  "/cookie-policy",
];

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

const loadEnvFile = async () => {
  const envPath = path.join(projectRoot, ".env");
  const envContents = await readFile(envPath, "utf8");
  const env = {};

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

const buildSitemapXml = (urls) => {
  const rows = urls
    .map(({ loc, lastmod }) => {
      const lastmodTag = lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
};

const generateSitemap = async () => {
  const staticUrls = STATIC_ROUTES.map((route) => ({
    loc: new URL(route, SITE_URL).toString(),
    lastmod: null,
  }));

  let articleUrls = [];
  let storyUrls = [];

  try {
    const [articles, stories] = await Promise.all([
      fetchSupabaseRows(
        "logbook_articles",
        "slug,published_at,updated_at",
        "&status=eq.published&order=published_at.desc.nullslast"
      ),
      fetchSupabaseRows("stories", "slug,updated_at", "&order=updated_at.desc.nullslast"),
    ]);

    articleUrls = Array.from(
      new Map(
        articles
          .filter((article) => typeof article.slug === "string" && article.slug)
          .map((article) => [
            article.slug,
            {
              loc: `${SITE_URL}/logbook/${article.slug}`,
              lastmod: toIsoDate(article.updated_at || article.published_at),
            },
          ])
      ).values()
    );

    storyUrls = Array.from(
      new Map(
        stories
          .filter((story) => typeof story.slug === "string" && story.slug)
          .map((story) => [
            story.slug,
            {
              loc: `${SITE_URL}/logbook/story/${story.slug}`,
              lastmod: toIsoDate(story.updated_at),
            },
          ])
      ).values()
    );
  } catch (error) {
    console.warn("[sitemap] Dynamic URL fetch failed, falling back to static routes only.");
    console.warn(error instanceof Error ? error.message : error);
  }

  const sitemapXml = buildSitemapXml([...staticUrls, ...storyUrls, ...articleUrls]);
  await mkdir(publicDir, { recursive: true });
  await writeFile(outputPath, sitemapXml, "utf8");

  console.log(
    `[sitemap] Wrote ${staticUrls.length + storyUrls.length + articleUrls.length} URLs to ${path.relative(projectRoot, outputPath)}`
  );
};

await generateSitemap();
