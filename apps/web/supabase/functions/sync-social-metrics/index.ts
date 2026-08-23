/**
 * Dedicated metrics sync worker for editorial channels.
 *
 * Two sync modes:
 * 1. Profile sync — fetches follower/subscriber counts from platform APIs,
 *    saves snapshots to editorial_channel_metrics.
 * 2. Post metrics re-sync — re-fetches engagement data for published targets
 *    whose metrics_synced_at is older than 20 minutes.
 *
 * Triggered by:
 * - pg_cron daily (force=false, all channels)
 * - on-demand from frontend (force=true, specific channel)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type ChannelCode = 'youtube' | 'tiktok' | 'instagram_bite' | 'instagram_dogs'

type ChannelRow = {
  id: string
  code: ChannelCode
  label: string
}

type OAuthConnection = {
  channel_id: string
  provider: string
  account_label: string | null
  refresh_token_encrypted: string | null
  scopes: string | null
  access_token_expires_at: string | null
}

type SyncResult = {
  channel_id: string
  channel_code: string
  profile_synced: boolean
  posts_synced: number
  error?: string
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function authorizeCron(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('SOCIAL_METRICS_CRON_SECRET')

  const authHeader = req.headers.get('Authorization')
  const bearer =
    authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

  if (serviceRoleKey && bearer === serviceRoleKey) return true
  if (cronSecret) {
    const headerSecret = req.headers.get('x-cron-secret')
    return Boolean(headerSecret && headerSecret === cronSecret)
  }
  return false
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  let data: unknown = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  if (!res.ok) {
    const maybe = data as { error?: { message?: string }; error_message?: string; message?: string }
    throw new Error(maybe.error?.message ?? maybe.error_message ?? maybe.message ?? `http_${res.status}`)
  }
  return data as T
}

function extractInstagramUserId(scopes: string | null, accountLabel: string | null): string | null {
  const fromScopes = scopes?.match(/instagram_user_id=([^;\s]+)/)?.[1]
  if (fromScopes) return fromScopes
  const fromLabel = accountLabel?.match(/\b(\d{5,})\b/)?.[1]
  return fromLabel ?? null
}

async function googleAccessToken(refreshOrAccessToken: string): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) return refreshOrAccessToken

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshOrAccessToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !payload.access_token) {
    if (payload.error === 'invalid_grant') return refreshOrAccessToken
    throw new Error(payload.error_description ?? payload.error ?? 'google_access_token_failed')
  }
  return payload.access_token
}

// ---------------------------------------------------------------------------
// Profile sync
// ---------------------------------------------------------------------------

async function syncInstagramProfile(params: {
  supabase: ReturnType<typeof createClient>
  channelId: string
  token: string
  scopes: string | null
  accountLabel: string | null
}): Promise<{ followers: number; following: number; media_count: number }> {
  const igUserId = extractInstagramUserId(params.scopes, params.accountLabel)
  if (!igUserId) throw new Error('instagram_user_id_not_found')

  const url = new URL(`https://graph.instagram.com/v24.0/${igUserId}`)
  url.searchParams.set('fields', 'follower_count,follows_count,media_count')
  url.searchParams.set('access_token', params.token)

  const data = await fetchJson<{
    follower_count?: number
    follows_count?: number
    media_count?: number
  }>(url.toString())

  const followers = data.follower_count ?? 0
  const following = data.follows_count ?? 0
  const media_count = data.media_count ?? 0

  // Compute engagement rate from recent posts
  let avgEngagementRate = 0
  let samplePostCount = 0
  try {
    const mediaUrl = new URL(`https://graph.instagram.com/v24.0/${igUserId}/media`)
    mediaUrl.searchParams.set('fields', 'like_count,comments_count')
    mediaUrl.searchParams.set('limit', '25')
    mediaUrl.searchParams.set('access_token', params.token)
    const mediaData = await fetchJson<{
      data?: Array<{ like_count?: number; comments_count?: number }>
    }>(mediaUrl.toString())
    const posts = mediaData.data ?? []
    samplePostCount = posts.length
    if (samplePostCount > 0 && followers > 0) {
      const totalEngagement = posts.reduce(
        (sum, p) => sum + (p.like_count ?? 0) + (p.comments_count ?? 0),
        0,
      )
      avgEngagementRate = (totalEngagement / samplePostCount / followers) * 100
    }
  } catch {
    // Non-fatal: profile metrics are still useful without engagement rate
  }

  const now = new Date().toISOString()
  await params.supabase.from('editorial_channel_metrics').insert({
    channel_id: params.channelId,
    followers,
    following,
    media_count,
    avg_engagement_rate: Math.round(avgEngagementRate * 10000) / 10000,
    sample_post_count: samplePostCount,
    captured_at: now,
  })

  return { followers, following, media_count }
}

async function syncYouTubeProfile(params: {
  supabase: ReturnType<typeof createClient>
  channelId: string
  refreshOrAccessToken: string
}): Promise<{ subscribers: number; video_count: number }> {
  const accessToken = await googleAccessToken(params.refreshOrAccessToken)

  // Get channel ID from OAuth connection scopes or use the YouTube Data API
  const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels')
  channelsUrl.searchParams.set('part', 'statistics,contentDetails')
  channelsUrl.searchParams.set('mine', 'true')

  const channelData = await fetchJson<{
    items?: Array<{
      id?: string
      statistics?: {
        subscriberCount?: string
        videoCount?: string
      }
    }>
  }>(channelsUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const stats = channelData.items?.[0]?.statistics ?? {}
  const subscribers = Number(stats.subscriberCount ?? 0)
  const video_count = Number(stats.videoCount ?? 0)

  // Compute engagement rate from recent videos
  let avgEngagementRate = 0
  let samplePostCount = 0
  try {
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/search')
    videosUrl.searchParams.set('part', 'id')
    videosUrl.searchParams.set('forMine', 'true')
    videosUrl.searchParams.set('type', 'video')
    videosUrl.searchParams.set('order', 'date')
    videosUrl.searchParams.set('maxResults', '25')

    const videosData = await fetchJson<{
      items?: Array<{ id?: { videoId?: string } }>
    }>(videosUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const videoIds = (videosData.items ?? [])
      .map((item) => item.id?.videoId)
      .filter(Boolean)
      .join(',')

    if (videoIds) {
      const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
      statsUrl.searchParams.set('part', 'statistics')
      statsUrl.searchParams.set('id', videoIds)

      const statsData = await fetchJson<{
        items?: Array<{
          statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
        }>
      }>(statsUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const videos = statsData.items ?? []
      samplePostCount = videos.length
      if (samplePostCount > 0 && subscribers > 0) {
        const totalEngagement = videos.reduce((sum, v) => {
          const stats = v.statistics ?? {}
          return sum + Number(stats.likeCount ?? 0) + Number(stats.commentCount ?? 0)
        }, 0)
        avgEngagementRate = (totalEngagement / samplePostCount / subscribers) * 100
      }
    }
  } catch {
    // Non-fatal
  }

  const now = new Date().toISOString()
  await params.supabase.from('editorial_channel_metrics').insert({
    channel_id: params.channelId,
    followers: subscribers,
    media_count: video_count,
    avg_engagement_rate: Math.round(avgEngagementRate * 10000) / 10000,
    sample_post_count: samplePostCount,
    captured_at: now,
  })

  return { subscribers, video_count }
}

// ---------------------------------------------------------------------------
// Post metrics re-sync
// ---------------------------------------------------------------------------

async function syncInstagramPostMetrics(params: {
  supabase: ReturnType<typeof createClient>
  targetId: string
  platformPostId: string
  token: string
}): Promise<void> {
  let likes = 0
  let comments = 0
  let permalink: string | null = null
  try {
    const mediaUrl = new URL(`https://graph.instagram.com/v24.0/${params.platformPostId}`)
    mediaUrl.searchParams.set('fields', 'like_count,comments_count,permalink')
    mediaUrl.searchParams.set('access_token', params.token)
    const media = await fetchJson<{ like_count?: number; comments_count?: number; permalink?: string }>(
      mediaUrl.toString(),
    )
    likes = media.like_count ?? 0
    comments = media.comments_count ?? 0
    permalink = media.permalink ?? null
  } catch (error) {
    console.warn('sync-social-queue instagram media metrics failed', error instanceof Error ? error.message : error)
  }

  let impressions = 0
  let reach = 0
  let views = 0
  let saves = 0
  try {
    const insightUrl = new URL(`https://graph.instagram.com/v24.0/${params.platformPostId}/insights`)
    insightUrl.searchParams.set('metric', 'impressions,reach,saved,video_views,plays')
    insightUrl.searchParams.set('access_token', params.token)
    const payload = await fetchJson<{
      data?: Array<{ name?: string; values?: Array<{ value?: number }> }>
    }>(insightUrl.toString())
    for (const item of payload.data ?? []) {
      const value = item.values?.[0]?.value ?? 0
      if (item.name === 'impressions') impressions = value
      if (item.name === 'reach') reach = value
      if (item.name === 'saved') saves = value
      if (item.name === 'video_views' || item.name === 'plays') views = Math.max(views, value)
    }
  } catch {
    // Non-fatal
  }

  const now = new Date().toISOString()
  await params.supabase.from('editorial_post_insights').insert({
    target_id: params.targetId,
    source: 'instagram',
    impressions,
    reach,
    views,
    likes,
    comments,
    saves,
    notes: 'Snapshot automatico da sync-social-metrics.',
    captured_at: now,
  })
  await params.supabase
    .from('editorial_publish_targets')
    .update({
      metrics_synced_at: now,
      ...(permalink ? { platform_permalink: permalink } : {}),
      updated_at: now,
    })
    .eq('id', params.targetId)
}

async function syncYouTubePostMetrics(params: {
  supabase: ReturnType<typeof createClient>
  targetId: string
  platformPostId: string
  refreshOrAccessToken: string
}): Promise<void> {
  const accessToken = await googleAccessToken(params.refreshOrAccessToken)
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'statistics')
  url.searchParams.set('id', params.platformPostId)
  const payload = await fetchJson<{
    items?: Array<{
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
    }>
  }>(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const stats = payload.items?.[0]?.statistics ?? {}
  const now = new Date().toISOString()
  await params.supabase.from('editorial_post_insights').insert({
    target_id: params.targetId,
    source: 'youtube',
    views: Number(stats.viewCount ?? 0),
    likes: Number(stats.likeCount ?? 0),
    comments: Number(stats.commentCount ?? 0),
    notes: 'Snapshot automatico da sync-social-metrics.',
    captured_at: now,
  })
  await params.supabase
    .from('editorial_publish_targets')
    .update({
      metrics_synced_at: now,
      platform_permalink: `https://www.youtube.com/watch?v=${params.platformPostId}`,
      updated_at: now,
    })
    .eq('id', params.targetId)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  if (!authorizeCron(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Parse body
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // defaults below
  }

  const force = body.force === true
  const targetChannelId = typeof body.channel_id === 'string' ? body.channel_id : null

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const COOLDOWN_MS = 20 * 60 * 1000 // 20 minutes

  // 1. Fetch channels
  let channelQuery = supabase.from('editorial_plan_channels').select('id, code, label')
  if (targetChannelId) {
    channelQuery = channelQuery.eq('id', targetChannelId)
  }
  const { data: channels, error: chErr } = await channelQuery
  if (chErr || !channels) {
    return jsonResponse({ error: 'Channel query failed', detail: chErr?.message }, 500)
  }

  // 2. Fetch OAuth connections for relevant channels
  const channelIds = channels.map((c) => c.id)
  const { data: connections } = await supabase
    .from('social_oauth_connections')
    .select('channel_id, provider, account_label, refresh_token_encrypted, scopes, access_token_expires_at')
    .in('channel_id', channelIds)

  const connByChannel = new Map<string, OAuthConnection>()
  for (const row of connections ?? []) {
    connByChannel.set(row.channel_id, row as unknown as OAuthConnection)
  }

  // 3. Check last profile snapshot per channel for cooldown
  const lastSnapshotMap = new Map<string, string>()
  if (channelIds.length > 0) {
    const { data: recentMetrics } = await supabase
      .from('editorial_channel_metrics')
      .select('channel_id, captured_at')
      .in('channel_id', channelIds)
      .order('captured_at', { ascending: false })
      .limit(channelIds.length * 2) // get enough to find latest per channel
    for (const row of recentMetrics ?? []) {
      if (!lastSnapshotMap.has(row.channel_id)) {
        lastSnapshotMap.set(row.channel_id, row.captured_at)
      }
    }
  }

  const results: SyncResult[] = []

  // 4. Profile sync
  for (const ch of channels) {
    const conn = connByChannel.get(ch.id)
    if (!conn?.refresh_token_encrypted) {
      results.push({
        channel_id: ch.id,
        channel_code: ch.code,
        profile_synced: false,
        posts_synced: 0,
        error: 'no_oauth_connection',
      })
      continue
    }

    // Cooldown check
    if (!force) {
      const lastSync = lastSnapshotMap.get(ch.id)
      if (lastSync) {
        const ageMs = Date.now() - new Date(lastSync).getTime()
        if (Number.isFinite(ageMs) && ageMs < COOLDOWN_MS) {
          results.push({
            channel_id: ch.id,
            channel_code: ch.code,
            profile_synced: false,
            posts_synced: 0,
            error: 'cooldown',
          })
          continue
        }
      }
    }

    try {
      if (ch.code === 'instagram_bite' || ch.code === 'instagram_dogs') {
        await syncInstagramProfile({
          supabase,
          channelId: ch.id,
          token: conn.refresh_token_encrypted,
          scopes: conn.scopes,
          accountLabel: conn.account_label,
        })
      } else if (ch.code === 'youtube') {
        await syncYouTubeProfile({
          supabase,
          channelId: ch.id,
          refreshOrAccessToken: conn.refresh_token_encrypted,
        })
      } else {
        results.push({
          channel_id: ch.id,
          channel_code: ch.code,
          profile_synced: false,
          posts_synced: 0,
          error: 'unsupported_channel',
        })
        continue
      }
      results.push({
        channel_id: ch.id,
        channel_code: ch.code,
        profile_synced: true,
        posts_synced: 0,
      })
    } catch (error) {
      results.push({
        channel_id: ch.id,
        channel_code: ch.code,
        profile_synced: false,
        posts_synced: 0,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  // 5. Post metrics re-sync (all channels, cooldown 20min per target)
  const { data: syncTargets } = await supabase
    .from('editorial_publish_targets')
    .select('id, channel_id, platform_post_id, metrics_synced_at')
    .eq('status', 'published')
    .not('platform_post_id', 'is', null)
    .in('channel_id', channelIds)
    .or('metrics_synced_at.is.null,metrics_synced_at.lt.' + new Date(Date.now() - COOLDOWN_MS).toISOString())
    .limit(50)

  let postsSynced = 0
  for (const target of syncTargets ?? []) {
    const conn = connByChannel.get(target.channel_id)
    if (!conn?.refresh_token_encrypted || !target.platform_post_id) continue

    const ch = channels.find((c) => c.id === target.channel_id)
    if (!ch) continue

    try {
      if (ch.code === 'instagram_bite' || ch.code === 'instagram_dogs') {
        await syncInstagramPostMetrics({
          supabase,
          targetId: target.id,
          platformPostId: target.platform_post_id,
          token: conn.refresh_token_encrypted,
        })
      } else if (ch.code === 'youtube') {
        await syncYouTubePostMetrics({
          supabase,
          targetId: target.id,
          platformPostId: target.platform_post_id,
          refreshOrAccessToken: conn.refresh_token_encrypted,
        })
      }
      postsSynced++
    } catch (error) {
      console.warn('sync-social-metrics post sync failed', target.id, error instanceof Error ? error.message : error)
    }
  }

  // Update the results array with post counts
  for (const r of results) {
    if (r.profile_synced) {
      r.posts_synced = syncTargets?.filter((t) => t.channel_id === r.channel_id).length ?? 0
    }
  }

  return jsonResponse({
    ok: true,
    force,
    channel_count: channels.length,
    profile_syncs: results.filter((r) => r.profile_synced).length,
    posts_synced: postsSynced,
    results,
  })
})
