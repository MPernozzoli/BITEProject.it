/**
 * Social comments management for Instagram and YouTube.
 *
 * Operations:
 * - list:   Fetch comments from platform API, cache in social_comments_cache
 * - reply:  Post a reply to a comment
 * - hide:   Hide/unhide a comment (Instagram only)
 * - delete: Delete a comment
 *
 * Used by the /admin/comments page.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type ChannelCode = 'instagram_bite' | 'instagram_dogs' | 'youtube'

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonErr(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
// Instagram comments
// ---------------------------------------------------------------------------

type IgComment = {
  id: string
  text: string
  username: string
  timestamp: string
  like_count?: number
  replies?: { data?: IgComment[] }
}

async function listInstagramComments(params: {
  token: string
  mediaId: string
  after?: string
}): Promise<{ comments: IgComment[]; nextCursor?: string }> {
  const url = new URL(`https://graph.instagram.com/v24.0/${params.mediaId}/comments`)
  url.searchParams.set('fields', 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}')
  url.searchParams.set('limit', '50')
  url.searchParams.set('access_token', params.token)
  if (params.after) url.searchParams.set('after', params.after)

  const data = await fetchJson<{ data?: IgComment[]; paging?: { cursors?: { after?: string } } }>(
    url.toString(),
  )
  return {
    comments: data.data ?? [],
    nextCursor: data.paging?.cursors?.after,
  }
}

async function replyInstagramComment(params: {
  token: string
  commentId: string
  message: string
}): Promise<{ id: string }> {
  const url = new URL(`https://graph.instagram.com/v24.0/${params.commentId}/replies`)
  const data = await fetchJson<{ id: string }>(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: params.message,
      access_token: params.token,
    }),
  })
  return data
}

async function hideInstagramComment(params: {
  token: string
  commentId: string
  hide: boolean
}): Promise<void> {
  const url = new URL(`https://graph.instagram.com/v24.0/${params.commentId}`)
  url.searchParams.set('access_token', params.token)
  await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide: params.hide }),
  })
}

async function deleteInstagramComment(params: {
  token: string
  commentId: string
}): Promise<void> {
  const url = new URL(`https://graph.instagram.com/v24.0/${params.commentId}`)
  url.searchParams.set('access_token', params.token)
  await fetch(url.toString(), { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// YouTube comments
// ---------------------------------------------------------------------------

type YtComment = {
  id: string
  snippet: {
    topLevelComment?: {
      snippet?: {
        textDisplay?: string
        authorDisplayName?: string
        authorProfileImageUrl?: string
        publishedAt?: string
        likeCount?: number
      }
    }
    totalReplyCount?: number
  }
}

async function listYouTubeComments(params: {
  accessToken: string
  videoId: string
  pageToken?: string
}): Promise<{ comments: YtComment[]; nextCursor?: string }> {
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('videoId', params.videoId)
  url.searchParams.set('order', 'time')
  url.searchParams.set('maxResults', '50')
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)

  const data = await fetchJson<{ items?: YtComment[]; nextPageToken?: string }>(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })
  return {
    comments: data.items ?? [],
    nextCursor: data.nextPageToken,
  }
}

async function replyYouTubeComment(params: {
  accessToken: string
  parentId: string
  text: string
}): Promise<{ id: string }> {
  const url = new URL('https://www.googleapis.com/youtube/v3/comments')
  const data = await fetchJson<{ id?: string }>(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        parentId: params.parentId,
        textOriginal: params.text,
      },
    }),
  })
  return { id: data.id ?? '' }
}

async function deleteYouTubeComment(params: {
  accessToken: string
  commentId: string
}): Promise<void> {
  const url = new URL('https://www.googleapis.com/youtube/v3/comments')
  url.searchParams.set('id', params.commentId)
  await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })
}

async function moderateYouTubeComment(params: {
  accessToken: string
  commentId: string
  status: 'published' | 'heldForReview' | 'rejected'
}): Promise<void> {
  const url = new URL('https://www.googleapis.com/youtube/v3/comments/setModerationStatus')
  await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: params.commentId,
      moderationStatus: params.status,
    }),
  })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Auth: require admin JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonErr('Unauthorized', 401)
  }
  const token = authHeader.slice('Bearer '.length).trim()

  // Verify admin via service role client
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Parse JWT to get user ID
  const parts = token.split('.')
  let userId: string | null = null
  if (parts.length >= 2) {
    try {
      const payload = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=')))
      userId = payload?.sub ?? null
      // service_role bypass
      if (payload?.role === 'service_role') userId = 'service_role'
    } catch { /* ignore */ }
  }
  if (!userId) return jsonErr('Unauthorized', 401)

  if (userId !== 'service_role') {
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' })
    if (!isAdmin) return jsonErr('Forbidden', 403)
  }

  // Parse request
  let body: Record<string, unknown> = {}
  try {
    if (req.method === 'POST') body = await req.json()
  } catch { /* ignore */ }

  const url = new URL(req.url)
  const action = (body.action as string) ?? url.searchParams.get('action') ?? 'list'
  const channelId = (body.channel_id as string) ?? url.searchParams.get('channel_id')
  const statusFilter = (body.status as string) ?? url.searchParams.get('status') ?? 'all'

  if (!channelId) return jsonErr('channel_id is required', 400)

  // Fetch channel info
  const { data: channel } = await supabase
    .from('editorial_plan_channels')
    .select('id, code')
    .eq('id', channelId)
    .single()
  if (!channel) return jsonErr('Channel not found', 404)

  const channelCode = channel.code as ChannelCode

  // Fetch OAuth connection
  const { data: conn } = await supabase
    .from('social_oauth_connections')
    .select('refresh_token_encrypted, account_label, scopes')
    .eq('channel_id', channelId)
    .single()

  if (!conn?.refresh_token_encrypted) {
    return jsonErr('OAuth connection not configured for this channel', 400)
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  if (action === 'list') {
    const page = Number(body.page ?? url.searchParams.get('page') ?? 1)
    const perPage = 50

    // Fetch published targets with platform_post_id for this channel
    const { data: targets } = await supabase
      .from('editorial_publish_targets')
      .select('id, platform_post_id, platform_permalink')
      .eq('channel_id', channelId)
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .order('published_at', { ascending: false })
      .limit(20)

    if (!targets?.length) {
      return jsonResponse({ comments: [], total: 0, page, has_more: false })
    }

    const allComments: Array<{
      id: string
      channel_id: string
      platform_comment_id: string
      platform_media_id: string | null
      platform_media_permalink: string | null
      author_name: string | null
      author_avatar_url: string | null
      text: string | null
      timestamp: string | null
      reply_count: number
      hidden: boolean
      local_status: string
      local_reply: string | null
    }> = []

    // Fetch comments from platform for each target
    for (const target of targets) {
      if (!target.platform_post_id) continue
      try {
        if (channelCode === 'instagram_bite' || channelCode === 'instagram_dogs') {
          const igUserId = extractInstagramUserId(conn.scopes, conn.account_label)
          if (!igUserId) continue
          const { comments } = await listInstagramComments({
            token: conn.refresh_token_encrypted,
            mediaId: target.platform_post_id,
          })
          for (const c of comments) {
            allComments.push({
              id: `${channelId}-${c.id}`,
              channel_id: channelId,
              platform_comment_id: c.id,
              platform_media_id: target.platform_post_id,
              platform_media_permalink: target.platform_permalink,
              author_name: c.username,
              author_avatar_url: null,
              text: c.text,
              timestamp: c.timestamp,
              reply_count: c.replies?.data?.length ?? 0,
              hidden: false,
              local_status: 'new',
              local_reply: null,
            })
          }
        } else if (channelCode === 'youtube') {
          const accessToken = await googleAccessToken(conn.refresh_token_encrypted)
          const { comments } = await listYouTubeComments({
            accessToken,
            videoId: target.platform_post_id,
          })
          for (const c of comments) {
            const topSnippet = c.snippet?.topLevelComment?.snippet
            allComments.push({
              id: `${channelId}-${c.id}`,
              channel_id: channelId,
              platform_comment_id: c.id,
              platform_media_id: target.platform_post_id,
              platform_media_permalink: target.platform_permalink,
              author_name: topSnippet?.authorDisplayName ?? null,
              author_avatar_url: topSnippet?.authorProfileImageUrl ?? null,
              text: topSnippet?.textDisplay ?? null,
              timestamp: topSnippet?.publishedAt ?? null,
              reply_count: c.snippet?.totalReplyCount ?? 0,
              hidden: false,
              local_status: 'new',
              local_reply: null,
            })
          }
        }
      } catch (error) {
        console.warn('social-comments list error for target', target.id, error instanceof Error ? error.message : error)
      }
    }

    // Update cache
    for (const c of allComments) {
      await supabase.from('social_comments_cache').upsert(
        {
          channel_id: c.channel_id,
          platform_comment_id: c.platform_comment_id,
          platform_media_id: c.platform_media_id,
          platform_media_permalink: c.platform_media_permalink,
          author_name: c.author_name,
          author_avatar_url: c.author_avatar_url,
          text: c.text,
          timestamp: c.timestamp,
          reply_count: c.reply_count,
          hidden: c.hidden,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'channel_id,platform_comment_id' },
      )
    }

    // Return from cache with local_status
    let query = supabase
      .from('social_comments_cache')
      .select('*', { count: 'exact' })
      .eq('channel_id', channelId)
      .order('timestamp', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('local_status', statusFilter)
    }

    const offset = (page - 1) * perPage
    const { data: cached, count } = await query.range(offset, offset + perPage - 1)

    return jsonResponse({
      comments: cached ?? [],
      total: count ?? 0,
      page,
      has_more: (count ?? 0) > offset + perPage,
    })
  }

  // ---------------------------------------------------------------------------
  // REPLY
  // ---------------------------------------------------------------------------
  if (action === 'reply') {
    const commentId = body.comment_id as string
    const message = body.message as string
    if (!commentId || !message) return jsonErr('comment_id and message are required', 400)

    // Fetch from cache to get platform IDs
    const { data: cached } = await supabase
      .from('social_comments_cache')
      .select('platform_comment_id')
      .eq('id', commentId)
      .single()
    if (!cached) return jsonErr('Comment not found in cache', 404)

    try {
      if (channelCode === 'instagram_bite' || channelCode === 'instagram_dogs') {
        await replyInstagramComment({
          token: conn.refresh_token_encrypted,
          commentId: cached.platform_comment_id,
          message,
        })
      } else if (channelCode === 'youtube') {
        const accessToken = await googleAccessToken(conn.refresh_token_encrypted)
        await replyYouTubeComment({
          accessToken,
          parentId: cached.platform_comment_id,
          text: message,
        })
      }
    } catch (error) {
      return jsonErr(`Reply failed: ${error instanceof Error ? error.message : 'unknown'}`, 500)
    }

    // Update local status
    await supabase
      .from('social_comments_cache')
      .update({ local_status: 'replied', local_reply: message })
      .eq('id', commentId)

    return jsonResponse({ ok: true })
  }

  // ---------------------------------------------------------------------------
  // HIDE (Instagram only)
  // ---------------------------------------------------------------------------
  if (action === 'hide') {
    const commentId = body.comment_id as string
    const hide = body.hide !== false
    if (!commentId) return jsonErr('comment_id is required', 400)

    if (channelCode !== 'instagram_bite' && channelCode !== 'instagram_dogs') {
      return jsonErr('Hide is only supported for Instagram', 400)
    }

    const { data: cached } = await supabase
      .from('social_comments_cache')
      .select('platform_comment_id')
      .eq('id', commentId)
      .single()
    if (!cached) return jsonErr('Comment not found', 404)

    try {
      await hideInstagramComment({
        token: conn.refresh_token_encrypted,
        commentId: cached.platform_comment_id,
        hide,
      })
    } catch (error) {
      return jsonErr(`Hide failed: ${error instanceof Error ? error.message : 'unknown'}`, 500)
    }

    await supabase
      .from('social_comments_cache')
      .update({ local_status: hide ? 'hidden' : 'new', hidden: hide })
      .eq('id', commentId)

    return jsonResponse({ ok: true })
  }

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------
  if (action === 'delete') {
    const commentId = body.comment_id as string
    if (!commentId) return jsonErr('comment_id is required', 400)

    const { data: cached } = await supabase
      .from('social_comments_cache')
      .select('platform_comment_id')
      .eq('id', commentId)
      .single()
    if (!cached) return jsonErr('Comment not found', 404)

    try {
      if (channelCode === 'instagram_bite' || channelCode === 'instagram_dogs') {
        await deleteInstagramComment({
          token: conn.refresh_token_encrypted,
          commentId: cached.platform_comment_id,
        })
      } else if (channelCode === 'youtube') {
        const accessToken = await googleAccessToken(conn.refresh_token_encrypted)
        await deleteYouTubeComment({
          accessToken,
          commentId: cached.platform_comment_id,
        })
      }
    } catch (error) {
      return jsonErr(`Delete failed: ${error instanceof Error ? error.message : 'unknown'}`, 500)
    }

    await supabase.from('social_comments_cache').delete().eq('id', commentId)

    return jsonResponse({ ok: true })
  }

  return jsonErr(`Unknown action: ${action}`, 400)
})
