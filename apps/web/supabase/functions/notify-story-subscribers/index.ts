import { createClient } from 'npm:@supabase/supabase-js@2'
import { normalizeLanguage } from '../_shared/newsletter-helpers.ts'
import { PUBLIC_SITE_URL, localizedUrl, trackedUrl } from '../_shared/email-config.ts'
import { EMAIL_TRACKING } from '../_shared/tracking.ts'
import { normalizeSystemEmailAutomation } from '../_shared/system-email-automation.ts'

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

async function authorizeRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, 401),
    }
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (serviceRoleKey && token === serviceRoleKey) {
    return { ok: true }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const userId = userData?.user?.id
  if (userError || !userId) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Unauthorized' }, 401),
    }
  }

  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  } as any)

  if (error || !isAdmin) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Forbidden' }, 403),
    }
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
  const authorization = await authorizeRequest(req, supabase as any)
  if (!authorization.ok) {
    return authorization.response
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const storyId =
    typeof body.storyId === 'string' ? body.storyId : typeof body.story_id === 'string' ? body.story_id : ''
  const articleId =
    typeof body.articleId === 'string' ? body.articleId : typeof body.article_id === 'string' ? body.article_id : ''
  const fallbackStoryTitle =
    typeof body.storyTitle === 'string' ? body.storyTitle : typeof body.story_title === 'string' ? body.story_title : ''
  const fallbackArticleTitle =
    typeof body.chapterTitle === 'string' ? body.chapterTitle : typeof body.chapter_title === 'string' ? body.chapter_title : ''
  const fallbackArticleUrl =
    typeof body.chapterUrl === 'string' ? body.chapterUrl : typeof body.chapter_url === 'string' ? body.chapter_url : ''
  const fallbackStoryUrl =
    typeof body.storyUrl === 'string' ? body.storyUrl : typeof body.story_url === 'string' ? body.story_url : ''

  if (!storyId || !articleId) {
    return jsonResponse(
      {
        error: 'storyId and articleId are required',
      },
      400
    )
  }

  const [{ data: story, error: storyError }, { data: article, error: articleError }] =
    await Promise.all([
      supabase
        .from('stories')
        .select('id, slug, title_en, title_it, cover_image')
        .eq('id', storyId)
        .maybeSingle(),
      supabase
        .from('logbook_articles')
        .select(
          'id, slug, title_en, title_it, excerpt_en, excerpt_it, cover_image, published_at, location_name, story_id'
        )
        .eq('id', articleId)
        .maybeSingle(),
    ])

  const { data: storyAutomationRow, error: storyAutomationError } = await supabase
    .from('system_email_automations')
    .select('*')
    .eq('key', 'story-new-article-notification')
    .maybeSingle()

  if (storyAutomationError) {
    console.error('Failed to load story notification automation settings', storyAutomationError)
    return jsonResponse({ error: 'Failed to load notification automation settings' }, 500)
  }

  const storyAutomation = normalizeSystemEmailAutomation(
    storyAutomationRow,
    'story-new-article-notification'
  )

  if (!storyAutomation.enabled) {
    return jsonResponse({ success: true, queued: 0, failed: 0, skipped: 'automation_disabled' })
  }

  if (storyError || !story) {
    console.error('Failed to load story for subscriber notification', storyError)
    return jsonResponse({ error: 'Failed to load story metadata' }, 500)
  }

  if (articleError || !article) {
    console.error('Failed to load article for subscriber notification', articleError)
    return jsonResponse({ error: 'Failed to load article metadata' }, 500)
  }

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('story_subscriptions')
    .select('profile_id')
    .eq('story_id', storyId)

  if (subscriptionError) {
    console.error('Failed to load story subscriptions', subscriptionError)
    return jsonResponse({ error: 'Failed to load story subscriptions' }, 500)
  }

  const { data: authorRows, error: authorError } = await supabase
    .from('article_authors')
    .select('profile_id')
    .eq('article_id', articleId)

  if (authorError) {
    console.error('Failed to load article authors for story notification', authorError)
    return jsonResponse({ error: 'Failed to load article authors' }, 500)
  }

  const subscribedProfileIds = [...new Set((subscriptions ?? []).map((row) => row.profile_id))]
  if (!subscribedProfileIds.length) {
    return jsonResponse({ success: true, queued: 0, skipped: 0 })
  }

  const authorIds = new Set((authorRows ?? []).map((row) => row.profile_id))
  const candidateProfileIds = subscribedProfileIds.filter((profileId) => !authorIds.has(profileId))

  if (!candidateProfileIds.length) {
    return jsonResponse({ success: true, queued: 0, failed: 0, skipped: 'authors_only' })
  }

  const { data: readRows, error: readError } = await supabase
    .from('article_reads')
    .select('profile_id')
    .eq('article_id', articleId)
    .in('profile_id', candidateProfileIds)

  if (readError) {
    console.error('Failed to load article reads for story notification', readError)
    return jsonResponse({ error: 'Failed to load article reads' }, 500)
  }

  const readProfileIds = new Set((readRows ?? []).map((row) => row.profile_id))
  const profileIds = candidateProfileIds.filter((profileId) => !readProfileIds.has(profileId))

  if (!profileIds.length) {
    return jsonResponse({ success: true, queued: 0, failed: 0, skipped: 'already_read' })
  }

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, name, preferred_language, secondary_language')
    .in('id', profileIds)
    .not('email', 'eq', '')

  if (profileError) {
    console.error('Failed to load profile emails', profileError)
    return jsonResponse({ error: 'Failed to load subscriber emails' }, 500)
  }

  const uniqueRecipients = new Map<
    string,
    {
      id: string
      email: string
      name: string | null
      preferred_language: string | null
      secondary_language: string | null
    }
  >()
  for (const profile of profiles ?? []) {
    const normalizedEmail = profile.email.trim().toLowerCase()
    if (!normalizedEmail || uniqueRecipients.has(normalizedEmail)) {
      continue
    }
    uniqueRecipients.set(normalizedEmail, {
      id: profile.id,
      email: normalizedEmail,
      name: profile.name ?? null,
      preferred_language: profile.preferred_language ?? null,
      secondary_language: profile.secondary_language ?? null,
    })
  }

  const { data: preferenceRows } = await supabase
    .from('email_notification_preferences')
    .select('email, story_notifications_enabled')
    .in(
      'email',
      Array.from(uniqueRecipients.values()).map((recipient) => recipient.email)
    )

  const storyPreferenceMap = new Map(
    (preferenceRows ?? []).map((row) => [
      row.email.toLowerCase(),
      row.story_notifications_enabled,
    ])
  )

  const resolveLocalizedValue = (
    preferredLanguage: string | null,
    itValue: string | null | undefined,
    enValue: string | null | undefined,
    fallback: string
  ) => {
    const normalizedLanguage = normalizeLanguage(preferredLanguage)
    if (normalizedLanguage === 'en') {
      return enValue?.trim() || itValue?.trim() || fallback
    }

    return itValue?.trim() || enValue?.trim() || fallback
  }

  const responses = await Promise.allSettled(
    Array.from(uniqueRecipients.values())
      .filter((profile) => storyPreferenceMap.get(profile.email) ?? true)
      .map(async (profile) => {
      const storyTitle = resolveLocalizedValue(
        profile.preferred_language,
        story.title_it,
        story.title_en,
        fallbackStoryTitle || 'Story'
      )
      const articleTitle = resolveLocalizedValue(
        profile.preferred_language,
        article.title_it,
        article.title_en,
        fallbackArticleTitle || 'New article'
      )
      const articleExcerpt = resolveLocalizedValue(
        profile.preferred_language,
        article.excerpt_it,
        article.excerpt_en,
        ''
      )
      // Una notifica esce dal sito: il click torna da fuori e va attribuito
      // alla storia che lo ha generato, non al mucchio del traffico diretto.
      const storyTracking = { ...EMAIL_TRACKING.notification, campaign: story.slug }
      const articleUrl =
        fallbackArticleUrl ||
        trackedUrl(profile.preferred_language, `/logbook/${article.slug}`, {
          ...storyTracking,
          content: 'nuovo-capitolo',
        })
      const storyUrl =
        fallbackStoryUrl ||
        trackedUrl(profile.preferred_language, `/logbook/story/${story.slug}`, storyTracking)
      const publishedLabel = article.published_at
        ? new Intl.DateTimeFormat(
            normalizeLanguage(profile.preferred_language) === 'en'
              ? 'en-GB'
              : 'it-IT',
            {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }
          ).format(new Date(article.published_at))
        : null

      const response = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          templateName: 'new-chapter-notification',
          recipientEmail: profile.email,
          idempotencyKey: `new-chapter-${articleId}-${profile.id}`,
          templateData: {
            language: profile.preferred_language,
            recipientName: profile.name,
            storyTitle,
            articleTitle,
            articleExcerpt,
            articleUrl,
            storyUrl,
            heroImageUrl: article.cover_image ?? story.cover_image ?? null,
            storyImageUrl: story.cover_image ?? article.cover_image ?? null,
            publishedLabel,
            locationName: article.location_name ?? null,
          },
        }),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(`Failed to queue email for ${profile.id}: ${message}`)
      }
    })
  )

  const queued = responses.filter((result) => result.status === 'fulfilled').length
  const failed = responses.length - queued

  if (failed > 0) {
    console.error(
      'Some story notifications failed',
      responses
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
    )
  }

  const now = new Date().toISOString()
  const { error: automationUpdateError } = await supabase
    .from('system_email_automations')
    .upsert({
      key: storyAutomation.key,
      enabled: storyAutomation.enabled,
      config: storyAutomation.config,
      last_run_at: now,
      last_sent_at: queued > 0 ? now : storyAutomation.last_sent_at ?? null,
      updated_at: now,
    })

  if (automationUpdateError) {
    console.error('Failed to update story notification automation timestamps', automationUpdateError)
  }

  return jsonResponse({ success: true, queued, failed })
})
