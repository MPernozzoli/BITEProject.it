import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildPublicSemanticDataset,
  buildSemanticIndexResponse,
  filterSemanticItems,
} from '../_shared/public-semantic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing Supabase configuration' }, 500)
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const dataset = await buildPublicSemanticDataset(supabase, supabaseUrl)
    const url = new URL(req.url)
    const type = url.searchParams.get('type') || 'index'

    if (type === 'index') {
      return jsonResponse(buildSemanticIndexResponse(dataset))
    }

    if (type === 'articles') {
      const items = filterSemanticItems(dataset.articles, url.searchParams, { slugKey: 'slug' })
        .filter((item) => {
          const voyageId = url.searchParams.get('voyage_id')
          if (!voyageId) return true
          return item.route_association.voyage_id === `voyage:${voyageId}`
        })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'voyages') {
      const items = dataset.voyages.filter((item) => {
        const voyageId = url.searchParams.get('voyage_id')
        const slug = url.searchParams.get('slug')
        if (voyageId && item.id !== `voyage:${voyageId}`) return false
        if (slug && item.slug !== slug) return false
        return true
      })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'waypoints') {
      const items = dataset.waypoints
        .filter((item) => {
          const voyageId = url.searchParams.get('voyage_id')
          const slug = url.searchParams.get('slug')
          if (voyageId && item.route_association.voyage_id !== `voyage:${voyageId}`) return false
          if (slug && item.slug !== slug) return false
          return true
        })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'observations') {
      const items = dataset.observations
        .filter((item) => {
          const voyageId = url.searchParams.get('voyage_id')
          const articleSlug = url.searchParams.get('article_slug')
          if (voyageId && item.route_association.voyage_id !== `voyage:${voyageId}`) return false
          if (articleSlug && item.route_association.article_slug !== articleSlug) return false
          return true
        })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'refs') {
      return jsonResponse({
        generated_at: dataset.generated_at,
        count: dataset.refs.crew.length + dataset.refs.vessels.length,
        items: dataset.refs,
      })
    }

    if (type === 'media') {
      const items = filterSemanticItems(dataset.media, url.searchParams, { slugKey: 'slug' })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'maps') {
      const items = filterSemanticItems(dataset.maps, url.searchParams, { slugKey: 'slug' })
      return jsonResponse({ generated_at: dataset.generated_at, count: items.length, items })
    }

    if (type === 'graph') {
      return jsonResponse({
        generated_at: dataset.generated_at,
        count: dataset.relationships.length,
        items: dataset.relationships,
      })
    }

    return jsonResponse({
      error: 'Unsupported type',
      supported_types: ['index', 'articles', 'voyages', 'waypoints', 'observations', 'refs', 'media', 'maps', 'graph'],
    }, 400)
  } catch (error) {
    console.error('public-semantic error', error)
    return jsonResponse({ error: 'Unable to build semantic dataset' }, 500)
  }
})
