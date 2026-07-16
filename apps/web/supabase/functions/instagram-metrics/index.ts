/**
 * Public metrics endpoint for pack.biteproject.it.
 *
 * Reads only the editorial channel `instagram_dogs` OAuth connection server-side,
 * refreshes a short-lived cache, and returns a compact public payload for Pack.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const INSTAGRAM_DOGS_CHANNEL_ID = '11111111-1111-4111-8111-111111110005'
const CACHE_SLUG = 'bitespack'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type MetricItem = {
  label: string
  value: number
  suffix: string
}

type AudienceItem = {
  label: string
  value: number
}

type MetricsPayload = {
  metrics: MetricItem[]
  topCountries?: AudienceItem[]
  audienceBreakdown?: AudienceItem[]
  updatedAt: string
  mediaKitUrl?: string
  source: string
  profile?: {
    id?: string
    username?: string
    name?: string
    biography?: string
    website?: string
    profilePictureUrl?: string
    followersCount?: number
    followsCount?: number
    mediaCount?: number
  }
}

type CachedRow = {
  payload: MetricsPayload
  fetched_at: string
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') return {}
  try {
    const parsed = await req.json()
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function requestedLanguage(body: Record<string, unknown>): 'it' | 'en' {
  return body.language === 'it' ? 'it' : 'en'
}

function label(language: 'it' | 'en', it: string, en: string): string {
  return language === 'it' ? it : en
}

function roundMetric(value: number, decimals = 0): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function extractInstagramUserId(scopes: string | null, accountLabel: string | null): string | null {
  const fromScopes = scopes?.match(/instagram_user_id=([^;\s]+)/)?.[1]
  if (fromScopes) return fromScopes
  const fromLabel = accountLabel?.match(/\b(\d{5,})\b/)?.[1]
  return fromLabel ?? null
}

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString())
  const data = (await res.json()) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Instagram API error ${res.status}`)
  }
  return data
}

async function fetchInstagramPayload(params: {
  accessToken: string
  instagramUserId: string | null
  language: 'it' | 'en'
  mediaKitUrl?: string
}): Promise<MetricsPayload> {
  const userId = params.instagramUserId ?? 'me'
  const profileUrl = new URL(`https://graph.instagram.com/v24.0/${userId}`)
  profileUrl.searchParams.set(
    'fields',
    'id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count',
  )
  profileUrl.searchParams.set('access_token', params.accessToken)

  const profile = await fetchJson<{
    id?: string
    username?: string
    name?: string
    biography?: string
    website?: string
    profile_picture_url?: string
    followers_count?: number
    follows_count?: number
    media_count?: number
  }>(profileUrl)

  let sampledPostCount = 0
  let avgLikes: number | null = null
  let avgComments: number | null = null

  const mediaOwnerId = profile.id ?? userId
  if (mediaOwnerId && mediaOwnerId !== 'me') {
    const mediaUrl = new URL(`https://graph.instagram.com/v24.0/${mediaOwnerId}/media`)
    mediaUrl.searchParams.set('fields', 'id,like_count,comments_count,timestamp')
    mediaUrl.searchParams.set('limit', '25')
    mediaUrl.searchParams.set('access_token', params.accessToken)

    try {
      const media = await fetchJson<{
        data?: Array<{ like_count?: number; comments_count?: number }>
      }>(mediaUrl)
      const rows = (media.data ?? []).filter(
        (row) => typeof row.like_count === 'number' || typeof row.comments_count === 'number',
      )
      sampledPostCount = rows.length
      if (rows.length > 0) {
        avgLikes = rows.reduce((sum, row) => sum + (row.like_count ?? 0), 0) / rows.length
        avgComments = rows.reduce((sum, row) => sum + (row.comments_count ?? 0), 0) / rows.length
      }
    } catch (error) {
      console.warn('instagram-metrics media fetch failed', error instanceof Error ? error.message : error)
    }
  }

  const followers = profile.followers_count ?? 0
  const metrics: MetricItem[] = [
    {
      label: label(params.language, 'Follower Instagram', 'Instagram followers'),
      value: followers,
      suffix: '',
    },
  ]

  if (followers > 0 && avgLikes !== null && avgComments !== null) {
    metrics.push({
      label: 'Engagement rate',
      value: roundMetric(((avgLikes + avgComments) / followers) * 100, 2),
      suffix: '%',
    })
  }
  if (avgLikes !== null) {
    metrics.push({
      label: label(params.language, 'Like medi / post', 'Avg. likes / post'),
      value: roundMetric(avgLikes),
      suffix: '',
    })
  }
  if (avgComments !== null) {
    metrics.push({
      label: label(params.language, 'Commenti medi / post', 'Avg. comments / post'),
      value: roundMetric(avgComments),
      suffix: '',
    })
  }
  if (sampledPostCount > 0) {
    metrics.push({
      label: label(params.language, 'Post analizzati', 'Posts sampled'),
      value: sampledPostCount,
      suffix: '',
    })
  }
  if (typeof profile.media_count === 'number') {
    metrics.push({
      label: label(params.language, 'Post totali', 'Total posts'),
      value: profile.media_count,
      suffix: '',
    })
  }

  return {
    metrics,
    updatedAt: new Date().toISOString(),
    mediaKitUrl: params.mediaKitUrl,
    source: 'Instagram Graph API',
    profile: {
      id: profile.id,
      username: profile.username,
      name: profile.name,
      biography: profile.biography,
      website: profile.website,
      profilePictureUrl: profile.profile_picture_url,
      followersCount: profile.followers_count,
      followsCount: profile.follows_count,
      mediaCount: profile.media_count,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server misconfigured' }, 500)
  }

  const body = await readBody(req)
  const language = requestedLanguage(body)
  const mediaKitUrl = typeof body.mediaKitUrl === 'string' ? body.mediaKitUrl : undefined
  const forceRefresh = body.refresh === true
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: cached } = await supabase
    .schema('pack')
    .from('external_metrics_cache')
    .select('payload, fetched_at')
    .eq('slug', CACHE_SLUG)
    .maybeSingle<CachedRow>()

  if (cached?.payload && !forceRefresh) {
    const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < CACHE_TTL_MS) {
      return json(cached.payload)
    }
  }

  const { data: connection, error: connectionError } = await supabase
    .from('social_oauth_connections')
    .select('account_label, refresh_token_encrypted, scopes')
    .eq('channel_id', INSTAGRAM_DOGS_CHANNEL_ID)
    .eq('provider', 'meta_instagram')
    .maybeSingle()

  if (connectionError) {
    console.error('instagram-metrics connection lookup', connectionError)
  }

  const accessToken = connection?.refresh_token_encrypted
  if (!accessToken) {
    if (cached?.payload) return json(cached.payload)
    return json({ error: 'instagram_dogs_not_connected' }, 503)
  }

  try {
    const payload = await fetchInstagramPayload({
      accessToken,
      instagramUserId: extractInstagramUserId(connection.scopes, connection.account_label),
      language,
      mediaKitUrl,
    })

    const { error: upsertError } = await supabase.schema('pack').from('external_metrics_cache').upsert(
      {
        slug: CACHE_SLUG,
        source_url: 'https://instagram.com/bitespack',
        payload,
        fetched_at: payload.updatedAt,
      },
      { onConflict: 'slug' },
    )

    if (upsertError) {
      console.error('instagram-metrics cache upsert', upsertError)
    }

    return json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'instagram_fetch_failed'
    console.error('instagram-metrics refresh failed', message)
    if (cached?.payload) return json(cached.payload)
    return json({ error: message }, 502)
  }
})
