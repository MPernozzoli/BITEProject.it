import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPublicSemanticDataset } from '../_shared/public-semantic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function geoJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return geoJsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return geoJsonResponse({ error: 'Missing Supabase configuration' }, 500)
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const dataset = await buildPublicSemanticDataset(supabase, supabaseUrl)
    const url = new URL(req.url)
    const kind = url.searchParams.get('kind') || 'routes'
    const voyageId = url.searchParams.get('voyage_id')
    const voyageRef = voyageId ? `voyage:${voyageId}` : null

    const features = (kind === 'waypoints' ? dataset.geo.waypoints : dataset.geo.routes)
      .filter((feature) => {
        if (!voyageRef) return true
        if (kind === 'waypoints') {
          return feature.properties.voyage_id === voyageRef
        }
        return feature.properties.id === voyageRef
      })

    return geoJsonResponse({
      type: 'FeatureCollection',
      generated_at: dataset.generated_at,
      kind,
      features,
    })
  } catch (error) {
    console.error('public-geo error', error)
    return geoJsonResponse({ error: 'Unable to build geo dataset' }, 500)
  }
})
