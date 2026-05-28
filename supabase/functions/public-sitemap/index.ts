import { createClient } from 'npm:@supabase/supabase-js@2'

const SITE_URL = 'https://biteproject.it'

/** Routes that exist under both /it and /en prefixes (bilingual). */
const LOCALIZED_ROUTES = [
  '/',
  '/crew',
  '/manifesto',
  '/logbook',
  '/voyages',
  '/collaborations',
  '/contact',
  '/links',
]

/** Single-language routes (legal, profile). No hreflang alternates. */
const SINGLE_ROUTES = [
  '/privacy-policy',
  '/cookie-policy',
]

const LANGS = ['it', 'en'] as const
const DEFAULT_LANG = 'en'
type Lang = typeof LANGS[number]

const withLang = (lang: Lang, path: string) =>
  path === '/' ? `/${lang}` : `/${lang}${path}`

const xmlEscape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const toIsoDate = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const slugifyVoyageName = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'voyage'

type SitemapEntry = {
  /** Path WITHOUT lang prefix for bilingual routes, full path for single routes. */
  path: string
  lastmod?: string | null
  /** If true, emits one <url> per language with xhtml:link alternates. */
  bilingual: boolean
}

const buildSitemapXml = (entries: SitemapEntry[]) => {
  const rows: string[] = []

  for (const entry of entries) {
    const lastmodTag = entry.lastmod
      ? `\n    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>`
      : ''

    if (!entry.bilingual) {
      const loc = `${SITE_URL}${entry.path}`
      rows.push(`  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n  </url>`)
      continue
    }

    // Emit one <url> per language, with xhtml:link alternates pointing to every
    // language version + x-default. This is the SEO-correct hreflang pattern.
    const alternates = LANGS.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(
          `${SITE_URL}${withLang(l, entry.path)}`
        )}" />`
    ).join('\n')
    const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
      `${SITE_URL}${withLang(DEFAULT_LANG, entry.path)}`
    )}" />`

    for (const lang of LANGS) {
      const loc = `${SITE_URL}${withLang(lang, entry.path)}`
      rows.push(
        `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n${alternates}\n${xDefault}\n  </url>`
      )
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing Supabase configuration', { status: 500 })
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)

  const [articlesRes, storiesRes, voyagesRes, profilesRes] = await Promise.all([
    supabase
      .from('logbook_articles')
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('stories')
      .select('slug, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('voyages')
      .select('id, name, updated_at')
      .eq('is_published', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('public_profiles')
      .select('id, created_at'),
  ])

  if (articlesRes.error || storiesRes.error || voyagesRes.error || profilesRes.error) {
    console.error('public-sitemap fetch error', {
      articles: articlesRes.error,
      stories: storiesRes.error,
      voyages: voyagesRes.error,
      profiles: profilesRes.error,
    })
    return new Response('Unable to build sitemap', { status: 500 })
  }

  const staticEntries: SitemapEntry[] = LOCALIZED_ROUTES.map((path) => ({
    path,
    lastmod: null,
    bilingual: true,
  }))

  const singleEntries: SitemapEntry[] = SINGLE_ROUTES.map((path) => ({
    path,
    lastmod: null,
    bilingual: false,
  }))

  const articleEntries: SitemapEntry[] = (articlesRes.data || [])
    .filter((a) => a.slug)
    .map((a) => ({
      path: `/logbook/${a.slug}`,
      lastmod: toIsoDate(a.updated_at || a.published_at),
      bilingual: true,
    }))

  const storyEntries: SitemapEntry[] = (storiesRes.data || [])
    .filter((s) => s.slug)
    .map((s) => ({
      path: `/logbook/story/${s.slug}`,
      lastmod: toIsoDate(s.updated_at),
      bilingual: true,
    }))

  const voyageEntries: SitemapEntry[] = (voyagesRes.data || [])
    .filter((v) => v.id && v.name)
    .map((v) => ({
      path: `/voyages/${v.id}--${slugifyVoyageName(v.name)}`,
      lastmod: toIsoDate(v.updated_at),
      bilingual: true,
    }))

  const profileEntries: SitemapEntry[] = (profilesRes.data || [])
    .filter((p) => p.id)
    .map((p) => ({
      path: `/profile/${p.id}`,
      lastmod: toIsoDate(p.created_at),
      bilingual: false,
    }))

  return new Response(
    buildSitemapXml([
      ...staticEntries,
      ...voyageEntries,
      ...storyEntries,
      ...articleEntries,
      ...singleEntries,
      ...profileEntries,
    ]),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
})
