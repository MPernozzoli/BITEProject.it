import { createClient } from 'npm:@supabase/supabase-js@2'

const SITE_URL = 'https://biteproject.it'

const STATIC_ROUTES = [
  '/',
  '/crew',
  '/manifesto',
  '/logbook',
  '/voyages',
  '/collaborations',
  '/contact',
  '/privacy-policy',
  '/cookie-policy',
]

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

const buildSitemapXml = (
  urls: Array<{ loc: string; lastmod?: string | null }>
) => {
  const rows = urls
    .map(({ loc, lastmod }) => {
      const lastmodTag = lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : ''
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing Supabase configuration', { status: 500 })
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)

  const [articlesRes, storiesRes, voyagesRes] = await Promise.all([
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
  ])

  if (articlesRes.error || storiesRes.error || voyagesRes.error) {
    console.error('public-sitemap fetch error', {
      articles: articlesRes.error,
      stories: storiesRes.error,
      voyages: voyagesRes.error,
    })
    return new Response('Unable to build sitemap', { status: 500 })
  }

  const staticUrls = STATIC_ROUTES.map((route) => ({
    loc: new URL(route, SITE_URL).toString(),
    lastmod: null,
  }))

  const articleUrls = (articlesRes.data || [])
    .filter((article) => article.slug)
    .map((article) => ({
      loc: `${SITE_URL}/logbook/${article.slug}`,
      lastmod: toIsoDate(article.updated_at || article.published_at),
    }))

  const storyUrls = (storiesRes.data || [])
    .filter((story) => story.slug)
    .map((story) => ({
      loc: `${SITE_URL}/logbook/story/${story.slug}`,
      lastmod: toIsoDate(story.updated_at),
    }))

  const voyageUrls = (voyagesRes.data || [])
    .filter((voyage) => voyage.id && voyage.name)
    .map((voyage) => ({
      loc: `${SITE_URL}/voyages/${voyage.id}--${slugifyVoyageName(voyage.name)}`,
      lastmod: toIsoDate(voyage.updated_at),
    }))

  return new Response(
    buildSitemapXml([...staticUrls, ...voyageUrls, ...storyUrls, ...articleUrls]),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
})
