/**
 * Worker for scheduled social publishing.
 *
 * Supported now:
 * - Instagram image/reel/story via Instagram Content Publishing API.
 * - YouTube video/short via resumable upload.
 *
 * TikTok intentionally returns a structured `provider_not_implemented` failure
 * instead of silently succeeding: Direct Post requires an app-review flow.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type ChannelCode = 'youtube' | 'tiktok' | 'instagram_bite' | 'instagram_dogs'

type QueueTarget = {
  id: string
  channel_id: string
  asset_id: string | null
  editorial_plan_slot_id: string | null
  publish_at: string | null
  content_format: string
  caption: string | null
  title_override: string | null
  status: string
  platform_post_id?: string | null
  metrics_synced_at?: string | null
  editorial_media_assets: {
    title: string
    storage_main_path: string | null
    synopsis: string | null
  } | null
  editorial_plan_slots: {
    slot_date: string
    slot_time: string
  } | null
  editorial_plan_channels: {
    code: ChannelCode
    label: string
    timezone: string
  } | null
}

type OAuthConnection = {
  provider: string
  account_label: string | null
  refresh_token_encrypted: string | null
  access_token_expires_at: string | null
  scopes: string | null
}

type PublishResult = {
  ok: true
  platformPostId: string
  permalink?: string | null
  source: 'instagram' | 'youtube' | 'tiktok'
} | {
  ok: false
  error: string
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function authorizeCron(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('SOCIAL_PUBLISH_CRON_SECRET')

  const authHeader = req.headers.get('Authorization')
  const bearer =
    authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

  if (serviceRoleKey && bearer === serviceRoleKey) {
    return true
  }

  if (cronSecret) {
    const headerSecret = req.headers.get('x-cron-secret')
    return Boolean(headerSecret && headerSecret === cronSecret)
  }

  return false
}

function isDryRun(req: Request): boolean {
  const url = new URL(req.url)
  return url.searchParams.get('dry_run') === '1' || url.searchParams.get('dryRun') === 'true'
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second] = String(time).slice(0, 8).split(':').map(Number)
  if (!year || !month || !day || hour === undefined || minute === undefined) return null
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utcGuess)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asZoneUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const offsetMs = asZoneUtc - utcGuess.getTime()
  return new Date(utcGuess.getTime() - offsetMs)
}

function dueAt(target: QueueTarget): Date | null {
  if (target.publish_at) return new Date(target.publish_at)
  const slot = target.editorial_plan_slots
  if (!slot?.slot_date || !slot.slot_time) return null
  return zonedDateTimeToUtc(
    slot.slot_date,
    slot.slot_time,
    target.editorial_plan_channels?.timezone || 'Europe/Rome',
  )
}

function extractInstagramUserId(scopes: string | null, accountLabel: string | null): string | null {
  const fromScopes = scopes?.match(/instagram_user_id=([^;\s]+)/)?.[1]
  if (fromScopes) return fromScopes
  const fromLabel = accountLabel?.match(/\b(\d{5,})\b/)?.[1]
  return fromLabel ?? null
}

function instagramMediaType(contentFormat: string, storagePath: string): 'IMAGE' | 'REELS' | 'STORIES' {
  if (contentFormat === 'ig_story') return 'STORIES'
  if (contentFormat === 'ig_reel') return 'REELS'
  if (/\.(mp4|mov|m4v)$/i.test(storagePath)) return 'REELS'
  return 'IMAGE'
}

function mediaMimeType(storagePath: string): string {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.m4v')) return 'video/x-m4v'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'video/mp4'
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

async function publicAssetUrl(params: {
  supabase: ReturnType<typeof createClient>
  storagePath: string
  dryRun: boolean
}): Promise<string> {
  if (/^https?:\/\//i.test(params.storagePath)) return params.storagePath
  if (params.dryRun) return `https://example.invalid/${encodeURIComponent(params.storagePath)}`

  const { data, error } = await params.supabase.storage
    .from('editorial-media')
    .createSignedUrl(params.storagePath, 60 * 60 * 24)
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'signed_url_failed')
  }
  return data.signedUrl
}

async function publishInstagram(params: {
  supabase: ReturnType<typeof createClient>
  target: QueueTarget
  connection: OAuthConnection
  dryRun: boolean
}): Promise<PublishResult> {
  const token = params.connection.refresh_token_encrypted
  if (!token) return { ok: false, error: 'instagram_not_connected' }

  const igUserId = extractInstagramUserId(params.connection.scopes, params.connection.account_label)
  if (!igUserId) return { ok: false, error: 'instagram_user_id_missing' }

  const storagePath = params.target.editorial_media_assets?.storage_main_path
  if (!storagePath) return { ok: false, error: 'media_asset_missing_storage_path' }

  const mediaUrl = await publicAssetUrl({
    supabase: params.supabase,
    storagePath,
    dryRun: params.dryRun,
  })

  if (params.dryRun) {
    return {
      ok: true,
      platformPostId: `dryrun_${params.target.id}`,
      permalink: mediaUrl,
      source: 'instagram',
    }
  }

  const mediaType = instagramMediaType(params.target.content_format, storagePath)
  const createUrl = new URL(`https://graph.instagram.com/v24.0/${igUserId}/media`)
  createUrl.searchParams.set('access_token', token)
  if (mediaType === 'IMAGE') {
    createUrl.searchParams.set('image_url', mediaUrl)
  } else {
    createUrl.searchParams.set('media_type', mediaType)
    createUrl.searchParams.set('video_url', mediaUrl)
  }
  if (params.target.caption && mediaType !== 'STORIES') {
    createUrl.searchParams.set('caption', params.target.caption)
  }

  const created = await fetchJson<{ id?: string }>(createUrl.toString(), { method: 'POST' })
  if (!created.id) return { ok: false, error: 'instagram_container_missing_id' }

  if (mediaType !== 'IMAGE') {
    for (let attempt = 0; attempt < 8; attempt++) {
      const statusUrl = new URL(`https://graph.instagram.com/v24.0/${created.id}`)
      statusUrl.searchParams.set('fields', 'status_code')
      statusUrl.searchParams.set('access_token', token)
      const status = await fetchJson<{ status_code?: string }>(statusUrl.toString())
      if (status.status_code === 'FINISHED') break
      if (status.status_code === 'ERROR' || attempt === 7) {
        return { ok: false, error: `instagram_container_${status.status_code ?? 'not_ready'}` }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  const publishUrl = new URL(`https://graph.instagram.com/v24.0/${igUserId}/media_publish`)
  publishUrl.searchParams.set('creation_id', created.id)
  publishUrl.searchParams.set('access_token', token)
  const published = await fetchJson<{ id?: string }>(publishUrl.toString(), { method: 'POST' })
  if (!published.id) return { ok: false, error: 'instagram_publish_missing_id' }

  let permalink: string | null = null
  try {
    const mediaUrl = new URL(`https://graph.instagram.com/v24.0/${published.id}`)
    mediaUrl.searchParams.set('fields', 'permalink')
    mediaUrl.searchParams.set('access_token', token)
    const media = await fetchJson<{ permalink?: string }>(mediaUrl.toString())
    permalink = media.permalink ?? null
  } catch (error) {
    console.warn('publish-social-queue instagram permalink lookup failed', error instanceof Error ? error.message : error)
  }

  return {
    ok: true,
    platformPostId: published.id,
    permalink,
    source: 'instagram',
  }
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

async function publishYouTube(params: {
  supabase: ReturnType<typeof createClient>
  target: QueueTarget
  connection: OAuthConnection
  dryRun: boolean
}): Promise<PublishResult> {
  const token = params.connection.refresh_token_encrypted
  if (!token) return { ok: false, error: 'youtube_not_connected' }

  const storagePath = params.target.editorial_media_assets?.storage_main_path
  if (!storagePath) return { ok: false, error: 'media_asset_missing_storage_path' }

  const title = (params.target.title_override || params.target.editorial_media_assets?.title || 'BITE editorial video').slice(0, 100)
  const description = (params.target.caption || params.target.editorial_media_assets?.synopsis || '').slice(0, 5000)
  const mediaUrl = await publicAssetUrl({
    supabase: params.supabase,
    storagePath,
    dryRun: params.dryRun,
  })

  if (params.dryRun) {
    return {
      ok: true,
      platformPostId: `dryrun_${params.target.id}`,
      permalink: mediaUrl,
      source: 'youtube',
    }
  }

  const accessToken = await googleAccessToken(token)
  const mimeType = mediaMimeType(storagePath)
  const initUrl = new URL('https://www.googleapis.com/upload/youtube/v3/videos')
  initUrl.searchParams.set('uploadType', 'resumable')
  initUrl.searchParams.set('part', 'snippet,status')

  const initRes = await fetch(initUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify({
      snippet: {
        title,
        description,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    }),
  })
  if (!initRes.ok) {
    const text = await initRes.text()
    throw new Error(`youtube_upload_init_failed:${text.slice(0, 500)}`)
  }

  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) return { ok: false, error: 'youtube_upload_url_missing' }

  const mediaRes = await fetch(mediaUrl)
  if (!mediaRes.ok) return { ok: false, error: `youtube_media_fetch_${mediaRes.status}` }
  const mediaBlob = await mediaRes.blob()

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mediaBlob.type || mimeType,
      'Content-Length': String(mediaBlob.size),
    },
    body: mediaBlob,
  })
  const payload = (await uploadRes.json()) as { id?: string; error?: { message?: string } }
  if (!uploadRes.ok || !payload.id) {
    throw new Error(payload.error?.message ?? `youtube_upload_failed_${uploadRes.status}`)
  }

  return {
    ok: true,
    platformPostId: payload.id,
    permalink: `https://www.youtube.com/watch?v=${payload.id}`,
    source: 'youtube',
  }
}

async function syncInstagramMetrics(params: {
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
    const media = await fetchJson<{ like_count?: number; comments_count?: number; permalink?: string }>(mediaUrl.toString())
    likes = media.like_count ?? 0
    comments = media.comments_count ?? 0
    permalink = media.permalink ?? null
  } catch (error) {
    console.warn('publish-social-queue instagram media metrics failed', error instanceof Error ? error.message : error)
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
  } catch (error) {
    console.warn('publish-social-queue instagram insights failed', error instanceof Error ? error.message : error)
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
    notes: 'Snapshot automatico da publish-social-queue.',
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

async function syncYouTubeMetrics(params: {
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
      statistics?: {
        viewCount?: string
        likeCount?: string
        commentCount?: string
      }
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
    notes: 'Snapshot automatico da publish-social-queue.',
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

async function publishTarget(params: {
  supabase: ReturnType<typeof createClient>
  target: QueueTarget
  connection: OAuthConnection | null
  dryRun: boolean
}): Promise<PublishResult> {
  const code = params.target.editorial_plan_channels?.code
  if (!code) return { ok: false, error: 'channel_missing' }
  if (!params.connection?.refresh_token_encrypted) return { ok: false, error: 'oauth_connection_missing_token' }

  if (code === 'instagram_bite' || code === 'instagram_dogs') {
    return publishInstagram({
      supabase: params.supabase,
      target: params.target,
      connection: params.connection,
      dryRun: params.dryRun,
    })
  }

  if (code === 'youtube') {
    return publishYouTube({
      supabase: params.supabase,
      target: params.target,
      connection: params.connection,
      dryRun: params.dryRun,
    })
  }
  if (code === 'tiktok') return { ok: false, error: 'provider_not_implemented_tiktok_direct_post_required' }
  return { ok: false, error: 'unsupported_channel' }
}

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

  const dryRun = isDryRun(req)
  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const now = new Date()
  const nowIso = now.toISOString()

  const { data, error } = await supabase
    .from('editorial_publish_targets')
    .select(`
      id,
      channel_id,
      asset_id,
      editorial_plan_slot_id,
      publish_at,
      content_format,
      caption,
      title_override,
      status,
      platform_post_id,
      metrics_synced_at,
      editorial_media_assets(title, storage_main_path, synopsis),
      editorial_plan_slots(slot_date, slot_time),
      editorial_plan_channels(code, label, timezone)
    `)
    .in('status', ['pending', 'failed', 'published'])
    .limit(50)

  if (error) {
    console.error('publish-social-queue select', error)
    return jsonResponse({ error: 'Query failed' }, 500)
  }

  const dueTargets = ((data ?? []) as unknown as QueueTarget[])
    .filter((target) => {
      if (target.status !== 'pending' && target.status !== 'failed') return false
      const at = dueAt(target)
      return Boolean(at && at <= now)
    })
    .sort((a, b) => (dueAt(a)?.getTime() ?? 0) - (dueAt(b)?.getTime() ?? 0))

  const syncCandidates = ((data ?? []) as unknown as QueueTarget[])
    .filter((target) => {
      if (target.status !== 'published') return false
      if (!target.platform_post_id) return false
      const code = target.editorial_plan_channels?.code
      if (code !== 'instagram_bite' && code !== 'instagram_dogs' && code !== 'youtube') return false
      if (!target.metrics_synced_at) return true
      const ageMs = Date.now() - new Date(target.metrics_synced_at).getTime()
      return Number.isFinite(ageMs) && ageMs > 6 * 60 * 60 * 1000
    })
    .slice(0, 20)

  const channelIds = Array.from(new Set([
    ...dueTargets.map((target) => target.channel_id),
    ...syncCandidates.map((target) => target.channel_id),
  ]))
  const connectionByChannel = new Map<string, OAuthConnection>()
  if (channelIds.length > 0) {
    const { data: connections, error: connectionError } = await supabase
      .from('social_oauth_connections')
      .select('channel_id, provider, account_label, refresh_token_encrypted, access_token_expires_at, scopes')
      .in('channel_id', channelIds)
    if (connectionError) {
      console.error('publish-social-queue connections', connectionError)
      return jsonResponse({ error: 'Connection lookup failed' }, 500)
    }
    for (const row of connections ?? []) {
      connectionByChannel.set(row.channel_id as string, row as OAuthConnection)
    }
  }

  const processed: Array<{ id: string; status: string; platformPostId?: string; error?: string }> = []

  for (const target of dueTargets) {
    if (!dryRun) {
      const { data: locked, error: lockError } = await supabase
        .from('editorial_publish_targets')
        .update({ status: 'publishing', last_error: null, updated_at: nowIso })
        .eq('id', target.id)
        .in('status', ['pending', 'failed'])
        .select('id')
        .maybeSingle()
      if (lockError) {
        processed.push({ id: target.id, status: 'failed', error: lockError.message })
        continue
      }
      if (!locked) continue
    }

    const result = await publishTarget({
      supabase,
      target,
      connection: connectionByChannel.get(target.channel_id) ?? null,
      dryRun,
    })

    if (result.ok) {
      processed.push({ id: target.id, status: dryRun ? 'dry_run' : 'published', platformPostId: result.platformPostId })
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('editorial_publish_targets')
          .update({
            status: 'published',
            platform_post_id: result.platformPostId,
            platform_permalink: result.permalink ?? null,
            published_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', target.id)
        if (updateError) {
          console.error('publish-social-queue published update', updateError)
        }
        const connection = connectionByChannel.get(target.channel_id)
        if (connection?.refresh_token_encrypted) {
          if (result.source === 'instagram') {
            await syncInstagramMetrics({
              supabase,
              targetId: target.id,
              platformPostId: result.platformPostId,
              token: connection.refresh_token_encrypted,
            })
          }
          if (result.source === 'youtube') {
            await syncYouTubeMetrics({
              supabase,
              targetId: target.id,
              platformPostId: result.platformPostId,
              refreshOrAccessToken: connection.refresh_token_encrypted,
            })
          }
        }
      }
    } else {
      processed.push({ id: target.id, status: 'failed', error: result.error })
      if (!dryRun) {
        await supabase
          .from('editorial_publish_targets')
          .update({
            status: 'failed',
            last_error: result.error,
            updated_at: new Date().toISOString(),
          })
          .eq('id', target.id)
      }
    }
  }

  const syncedMetrics: string[] = []
  if (!dryRun) {
    for (const target of syncCandidates) {
      const connection = connectionByChannel.get(target.channel_id)
      if (!connection?.refresh_token_encrypted || !target.platform_post_id) continue
      try {
        const code = target.editorial_plan_channels?.code
        if (code === 'youtube') {
          await syncYouTubeMetrics({
            supabase,
            targetId: target.id,
            platformPostId: target.platform_post_id,
            refreshOrAccessToken: connection.refresh_token_encrypted,
          })
        } else {
          await syncInstagramMetrics({
            supabase,
            targetId: target.id,
            platformPostId: target.platform_post_id,
            token: connection.refresh_token_encrypted,
          })
        }
        syncedMetrics.push(target.id)
      } catch (error) {
        console.warn('publish-social-queue metric sync failed', target.id, error instanceof Error ? error.message : error)
      }
    }
  }

  return jsonResponse({
    ok: true,
    dryRun,
    dueCount: dueTargets.length,
    processedCount: processed.length,
    metricsSyncedCount: dryRun ? syncCandidates.length : syncedMetrics.length,
    metricsSyncedIds: dryRun ? syncCandidates.map((target) => target.id) : syncedMetrics,
    processed,
  })
})
