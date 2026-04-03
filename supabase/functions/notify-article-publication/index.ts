import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizeEmailNotificationPreferences } from '../_shared/email-preferences.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Claims = Record<string, unknown> | null

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseJwtClaims(token: string): Claims {
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function authorizeRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)

  if (claims?.role === 'service_role') {
    return { ok: true }
  }

  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) }
  }

  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  })

  if (error || !isAdmin) {
    return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) }
  }

  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const authorization = await authorizeRequest(req, supabase)
  if (!authorization.ok) {
    return authorization.response
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const articleId =
    typeof body.articleId === 'string'
      ? body.articleId
      : typeof body.article_id === 'string'
        ? body.article_id
        : ''

  if (!articleId) {
    return jsonResponse({ error: 'articleId is required' }, 400)
  }

  const { data: article, error: articleError } = await supabase
    .from('logbook_articles')
    .select('id, story_id, status')
    .eq('id', articleId)
    .maybeSingle()

  if (articleError || !article) {
    return jsonResponse({ error: 'Article not found' }, 404)
  }

  if (article.status !== 'published') {
    return jsonResponse({ success: true, inserted: 0, skipped: 'not_published' })
  }

  const { data: authorRows } = await supabase
    .from('article_authors')
    .select('profile_id')
    .eq('article_id', articleId)

  const authorIds = new Set((authorRows ?? []).map((row) => row.profile_id))

  if (article.story_id) {
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from('story_subscriptions')
      .select('profile_id')
      .eq('story_id', article.story_id)

    if (subscriptionsError) {
      console.error('Failed to load story subscriptions', subscriptionsError)
      return jsonResponse({ error: 'Failed to load story subscriptions' }, 500)
    }

    const recipientIds = Array.from(
      new Set(
        (subscriptions ?? [])
          .map((row) => row.profile_id)
          .filter((profileId) => profileId && !authorIds.has(profileId))
      )
    )

    if (!recipientIds.length) {
      return jsonResponse({ success: true, inserted: 0, skipped: 'no_story_subscribers' })
    }

    const { data: recipientProfiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', recipientIds)

    const preferenceEmails = (recipientProfiles ?? [])
      .map((row) => row.email?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value))

    const { data: preferenceRows } = preferenceEmails.length
      ? await supabase
          .from('email_notification_preferences')
          .select('email, story_notifications_enabled')
          .in('email', preferenceEmails)
      : { data: [] }

    const preferenceMap = new Map(
      (preferenceRows ?? []).map((row) => [
        row.email.toLowerCase(),
        normalizeEmailNotificationPreferences(row).story_notifications_enabled,
      ])
    )

    const enabledRecipientIds = (recipientProfiles ?? [])
      .filter((profile) => preferenceMap.get(profile.email.trim().toLowerCase()) ?? true)
      .map((profile) => profile.id)

    if (!enabledRecipientIds.length) {
      return jsonResponse({ success: true, inserted: 0, skipped: 'preferences_disabled' })
    }

    const { error: insertError } = await supabase
      .from('engagement_notifications')
      .upsert(
        enabledRecipientIds.map((recipientProfileId) => ({
          recipient_profile_id: recipientProfileId,
          actor_profile_id: null,
          article_id: articleId,
          comment_id: null,
          source_record_id: articleId,
          event_type: 'story_article_published',
          notification_category: 'publication',
        })),
        { onConflict: 'recipient_profile_id,source_record_id,event_type' }
      )

    if (insertError) {
      console.error('Failed to insert story publication notifications', insertError)
      return jsonResponse({ error: 'Failed to create notifications' }, 500)
    }

    return jsonResponse({ success: true, inserted: enabledRecipientIds.length })
  }

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, email')
    .not('email', 'eq', '')

  if (profileError) {
    console.error('Failed to load profiles for publication notifications', profileError)
    return jsonResponse({ error: 'Failed to load recipients' }, 500)
  }

  const eligibleProfiles = (profiles ?? []).filter((profile) => !authorIds.has(profile.id))
  const preferenceEmails = eligibleProfiles
    .map((profile) => profile.email.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))

  const { data: preferenceRows } = preferenceEmails.length
    ? await supabase
        .from('email_notification_preferences')
        .select('email, article_notifications_enabled')
        .in('email', preferenceEmails)
    : { data: [] }

  const preferenceMap = new Map(
    (preferenceRows ?? []).map((row) => [
      row.email.toLowerCase(),
      normalizeEmailNotificationPreferences(row).article_notifications_enabled,
    ])
  )

  const enabledRecipientIds = eligibleProfiles
    .filter((profile) => preferenceMap.get(profile.email.trim().toLowerCase()) ?? true)
    .map((profile) => profile.id)

  if (!enabledRecipientIds.length) {
    return jsonResponse({ success: true, inserted: 0, skipped: 'preferences_disabled' })
  }

  const { error: insertError } = await supabase
    .from('engagement_notifications')
    .upsert(
      enabledRecipientIds.map((recipientProfileId) => ({
        recipient_profile_id: recipientProfileId,
        actor_profile_id: null,
        article_id: articleId,
        comment_id: null,
        source_record_id: articleId,
        event_type: 'article_published',
        notification_category: 'publication',
      })),
      { onConflict: 'recipient_profile_id,source_record_id,event_type' }
    )

  if (insertError) {
    console.error('Failed to insert article publication notifications', insertError)
    return jsonResponse({ error: 'Failed to create notifications' }, 500)
  }

  return jsonResponse({ success: true, inserted: enabledRecipientIds.length })
})
