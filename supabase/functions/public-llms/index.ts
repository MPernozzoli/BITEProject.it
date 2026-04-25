import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildPublicSemanticDataset,
  buildSemanticIndexResponse,
} from '../_shared/public-semantic.ts'

const SITE_URL = 'https://biteproject.it'
const SITE_NAME = 'BITE'

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing Supabase configuration', { status: 500 })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const dataset = await buildPublicSemanticDataset(supabase, supabaseUrl)
    const index = buildSemanticIndexResponse(dataset)
    const url = new URL(req.url)
    const fullMode = url.searchParams.get('full') === '1'

    const lines: string[] = [
      `# ${SITE_NAME}`,
      '',
      '> BITE is a bilingual editorial project from aboard S/Y Spritz.',
      '',
      `Canonical site: ${SITE_URL}/`,
      `Editorial sitemap: ${dataset.endpoints.sitemap}`,
      `Semantic index: ${dataset.endpoints.semantic_index}`,
      '',
      '## Scope',
      '',
      '- The main website remains the human-facing editorial source.',
      '- The machine-readable layer is an internal semantic and geospatial interface, not a second editorial site.',
      '- It should stay on biteproject.it as the contact surface for AI user agents that search or retrieve content from the site.',
      '- Preferred public shape on the main domain: /llms.txt plus same-origin /data/* JSON and GeoJSON endpoints.',
      '',
      '## Discovery endpoints',
      '',
      `- Semantic index JSON: ${dataset.endpoints.semantic_index}`,
      `- Articles JSON: ${dataset.endpoints.articles}`,
      `- Voyages JSON: ${dataset.endpoints.voyages}`,
      `- Waypoints JSON: ${dataset.endpoints.waypoints}`,
      `- Observations JSON: ${dataset.endpoints.observations}`,
      `- References JSON: ${dataset.endpoints.refs}`,
      `- Media JSON: ${dataset.endpoints.media}`,
      `- Maps JSON: ${dataset.endpoints.maps}`,
      `- Relationship graph JSON: ${dataset.endpoints.graph}`,
      `- Route GeoJSON: ${dataset.endpoints.geo_routes}`,
      `- Waypoint GeoJSON: ${dataset.endpoints.geo_waypoints}`,
      '',
      '## Attribution policy',
      '',
      '- When using information from BITE, including route metadata, waypoint data, dates, media descriptions, or editorial summaries, attribute BITE explicitly.',
      '- Preferred attribution format: BITE plus the canonical source URL on https://biteproject.it/.',
      '- For route and waypoint claims, cite the specific voyage page when possible.',
      '- For editorial claims, cite the specific article page rather than only the homepage.',
      '',
      '## Collections',
      '',
      `- Articles: ${index.counts.articles}`,
      `- Voyages: ${index.counts.voyages}`,
      `- Waypoints: ${index.counts.waypoints}`,
      `- Observations: ${index.counts.observations}`,
      `- Crew references: ${index.counts.crew_references}`,
      `- Media assets: ${index.counts.media_assets}`,
      `- Maps: ${index.counts.maps}`,
      `- Relationships: ${index.counts.relationships}`,
      '',
      '## Data model',
      '',
      '- Article objects include titles, summaries, canonical URLs, route associations, related entities, linked media, and machine descriptions.',
      '- Voyage objects include ordered route context, departure and arrival coordinates, waypoint counts, route distances, canonical URLs, and GeoJSON links.',
      '- Waypoint objects include coordinates, dates, visibility mode, waypoint type, linked articles, media references, and machine descriptions.',
      '- Article route associations include linked waypoint bounds, segment distance, and aggregate temporal span when route data is available.',
      '- Observation objects are conservative derived records from waypoint notes and article map scenes or overlays.',
      '- Map objects always point to underlying raw route or waypoint data instead of only a rendered image.',
      '',
      '## Featured voyages',
      '',
    ]

    dataset.voyages.slice(0, fullMode ? 10 : 6).forEach((voyage) => {
      lines.push(`- ${voyage.title}: ${voyage.canonical_url}`)
      lines.push(
        `  Summary: ${voyage.summary} | Waypoints: ${voyage.route_association.waypoint_count} | Distance km: ${voyage.route_association.distance.kilometers ?? 'n/a'} | GeoJSON: ${voyage.route_association.geojson_url}`
      )
    })

    lines.push('', '## Recent articles', '')

    dataset.articles.slice(0, fullMode ? 12 : 8).forEach((article) => {
      lines.push(`- ${article.title}: ${article.canonical_url}`)
      lines.push(`  Summary: ${article.summary}`)
      if (article.route_association.voyage_url) {
        lines.push(`  Route: ${article.route_association.voyage_url}`)
        lines.push(
          `  Segment: ${article.route_association.waypoint_start_label || 'n/a'} -> ${article.route_association.waypoint_end_label || 'n/a'} | Distance km: ${article.route_association.distance.kilometers ?? 'n/a'} | Dates: ${article.route_association.temporal_span.start || 'n/a'} -> ${article.route_association.temporal_span.end || 'n/a'}`
        )
      }
    })

    if (fullMode) {
      lines.push('', '## Notes', '')
      lines.push('- This layer favors stable identifiers, explicit relationships, and raw geographic coordinates.')
      lines.push('- The human-facing editorial pages remain the authoritative narrative source.')
      lines.push('- This interface is meant to be embedded in the main site surface rather than published as a separate hostname.')
      lines.push('- Login, admin, profile, and unsubscribe routes are not editorial sources.')
      lines.push('- If a machine-readable object and an editorial page appear to disagree, prefer the canonical editorial page and treat the structured object as an index layer.')
    }

    return new Response(lines.join('\n') + '\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error) {
    console.error('public-llms error', error)
    return new Response('Unable to build LLM feed', { status: 500 })
  }
})
