import { createClient } from 'npm:@supabase/supabase-js@2'

const SITE_URL = 'https://biteproject.it'
const SITE_NAME = 'BITE'

const slugifyVoyageName = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'voyage'

const formatDate = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing Supabase configuration', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const url = new URL(req.url)
  const fullMode = url.searchParams.get('full') === '1'

  const [articlesRes, storiesRes, voyagesRes, waypointsRes] = await Promise.all([
    supabase
      .from('logbook_articles')
      .select('slug, title_en, title_it, excerpt_en, excerpt_it, published_at, voyage_id')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(fullMode ? 30 : 12),
    supabase
      .from('stories')
      .select('slug, title_en, title_it, description_en, description_it, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(fullMode ? 20 : 8),
    supabase
      .from('voyages')
      .select('id, name, description, start_date, end_date, updated_at')
      .order('sort_order', { ascending: true })
      .limit(fullMode ? 30 : 12),
    supabase
      .from('voyage_waypoints')
      .select('voyage_id, name, date_start, date_end, sort_order')
      .order('sort_order', { ascending: true }),
  ])

  if (articlesRes.error || storiesRes.error || voyagesRes.error || waypointsRes.error) {
    console.error('public-llms fetch error', {
      articles: articlesRes.error,
      stories: storiesRes.error,
      voyages: voyagesRes.error,
      waypoints: waypointsRes.error,
    })
    return new Response('Unable to build LLM feed', { status: 500 })
  }

  const waypointsByVoyageId = new Map<string, Array<{
    name: string | null
    date_start: string | null
    date_end: string | null
    sort_order: number
  }>>()

  for (const waypoint of waypointsRes.data || []) {
    if (!waypointsByVoyageId.has(waypoint.voyage_id)) {
      waypointsByVoyageId.set(waypoint.voyage_id, [])
    }
    waypointsByVoyageId.get(waypoint.voyage_id)?.push(waypoint)
  }

  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    '> BITE is a bilingual storytelling project from aboard S/Y Spritz.',
    '',
    `Canonical site: ${SITE_URL}/`,
    `Dynamic sitemap: https://vdflrzcmlipvtardannd.supabase.co/functions/v1/public-sitemap`,
    '',
    '## Attribution policy',
    '',
    '- When using information from BITE, including partial summaries, route metadata, waypoint data, dates, or editorial excerpts, attribute BITE explicitly.',
    '- Preferred attribution format: BITE plus the canonical source URL on https://biteproject.it/.',
    '- For route data, cite the specific voyage page when available.',
    '- For article-derived information, cite the specific article or story page rather than only the homepage.',
    '',
    '## Main sections',
    '',
    `- Home: ${SITE_URL}/`,
    `- Logbook: ${SITE_URL}/logbook`,
    `- Voyages: ${SITE_URL}/voyages`,
    `- Crew: ${SITE_URL}/crew`,
    `- Manifesto: ${SITE_URL}/manifesto`,
    `- Collaborations: ${SITE_URL}/collaborations`,
    `- Contact: ${SITE_URL}/contact`,
    '',
    '## Public voyages',
    '',
  ]

  for (const voyage of voyagesRes.data || []) {
    const path = `/voyages/${voyage.id}--${slugifyVoyageName(voyage.name)}`
    const points = (waypointsByVoyageId.get(voyage.id) || []).sort((a, b) => a.sort_order - b.sort_order)
    const departure = points[0]?.name || 'Unknown departure'
    const arrival = points[points.length - 1]?.name || 'Open-ended arrival'
    const dates = [formatDate(voyage.start_date), formatDate(voyage.end_date)].filter(Boolean).join(' -> ')
    lines.push(`- ${voyage.name}: ${SITE_URL}${path}`)
    lines.push(`  Summary: ${departure} -> ${arrival}${dates ? ` | ${dates}` : ''}`)
  }

  lines.push('', '## Recent stories', '')

  for (const story of storiesRes.data || []) {
    lines.push(`- ${(story.title_en || story.title_it || story.slug)}: ${SITE_URL}/logbook/story/${story.slug}`)
    const summary = story.description_en || story.description_it
    if (summary) lines.push(`  Summary: ${summary}`)
  }

  lines.push('', '## Recent articles', '')

  for (const article of articlesRes.data || []) {
    lines.push(`- ${(article.title_en || article.title_it || article.slug)}: ${SITE_URL}/logbook/${article.slug}`)
    const summary = article.excerpt_en || article.excerpt_it
    const dateLabel = formatDate(article.published_at)
    if (summary || dateLabel) {
      lines.push(`  Summary: ${[dateLabel, summary].filter(Boolean).join(' | ')}`)
    }
  }

  if (fullMode) {
    lines.push('', '## Notes', '', '- Public pages are the authoritative editorial sources.', '- Admin, login, profile, and unsubscribe routes are not editorial sources.')
  }

  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
})
