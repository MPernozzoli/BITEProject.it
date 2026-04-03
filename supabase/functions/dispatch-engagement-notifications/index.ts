import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  normalizeEmailNotificationPreferences,
  type EngagementNotificationFrequency,
} from '../_shared/email-preferences.ts'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'
import { normalizeLanguage } from '../_shared/newsletter-helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Claims = Record<string, unknown> | null

type PendingNotification = {
  id: string
  recipient_profile_id: string
  actor_profile_id: string | null
  article_id: string
  comment_id: string | null
  event_type:
    | 'article_liked'
    | 'comment_liked'
    | 'article_commented'
    | 'comment_replied'
  notification_category: 'like' | 'comment'
  created_at: string
}

type RecipientProfile = {
  id: string
  email: string
  name: string | null
  preferred_language: string | null
}

type ActorProfile = {
  id: string
  name: string | null
}

type ArticleRow = {
  id: string
  slug: string
  title_it: string | null
  title_en: string | null
  cover_image: string | null
}

type CommentRow = {
  id: string
  content: string
}

type TemplateItem = {
  actorName: string
  articleTitle: string
  articleUrl: string
  articleImageUrl: string | null
  createdAtLabel: string
  kind: PendingNotification['event_type']
  commentPreview: string | null
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseJwtClaims(token: string): Claims {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

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

function isAuthorizedRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)
  return claims?.role === 'service_role' || typeof claims?.sub === 'string'
}

function getFrequencyDelayMs(
  frequency: EngagementNotificationFrequency
): number | null {
  switch (frequency) {
    case 'instant':
      return 0
    case 'daily':
      return 24 * 60 * 60 * 1000
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000
    case 'none':
      return null
  }
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  if (!value?.trim()) return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function resolveArticleTitle(
  article: ArticleRow | null | undefined,
  language: string | null
): string {
  if (!article) return normalizeLanguage(language) === 'en' ? 'Article' : 'Articolo'

  if (normalizeLanguage(language) === 'en') {
    return article.title_en?.trim() || article.title_it?.trim() || 'Article'
  }

  return article.title_it?.trim() || article.title_en?.trim() || 'Articolo'
}

function formatTimestamp(value: string, language: string | null): string {
  return new Intl.DateTimeFormat(
    normalizeLanguage(language) === 'en' ? 'en-GB' : 'it-IT',
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  ).format(new Date(value))
}

async function queueEmail(params: {
  supabaseUrl: string
  serviceRoleKey: string
  recipientEmail: string
  idempotencyKey: string
  templateData: Record<string, unknown>
}): Promise<void> {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/send-transactional-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.serviceRoleKey}`,
    },
    body: JSON.stringify({
      templateName: 'engagement-notification',
      recipientEmail: params.recipientEmail,
      idempotencyKey: params.idempotencyKey,
      templateData: params.templateData,
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(500, Math.trunc(body.limit)))
      : 250

  const { data: notifications, error: notificationError } = await supabase
    .from('engagement_notifications')
    .select(
      'id, recipient_profile_id, actor_profile_id, article_id, comment_id, event_type, notification_category, created_at'
    )
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (notificationError) {
    console.error('Failed to load pending engagement notifications', notificationError)
    return jsonResponse({ error: 'Failed to load notifications' }, 500)
  }

  const pending = (notifications ?? []) as PendingNotification[]
  if (!pending.length) {
    return jsonResponse({ success: true, queued: 0, suppressed: 0, processed: 0 })
  }

  const recipientIds = Array.from(new Set(pending.map((row) => row.recipient_profile_id)))
  const actorIds = Array.from(
    new Set(
      pending
        .map((row) => row.actor_profile_id)
        .filter((value): value is string => Boolean(value))
    )
  )
  const articleIds = Array.from(new Set(pending.map((row) => row.article_id)))
  const commentIds = Array.from(
    new Set(
      pending
        .map((row) => row.comment_id)
        .filter((value): value is string => Boolean(value))
    )
  )

  const [
    { data: recipientRows, error: recipientError },
    { data: actorRows, error: actorError },
    { data: articleRows, error: articleError },
    { data: commentRows, error: commentError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, name, preferred_language')
      .in('id', recipientIds),
    actorIds.length
      ? supabase.from('public_profiles').select('id, name').in('id', actorIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('logbook_articles')
      .select('id, slug, title_it, title_en, cover_image')
      .in('id', articleIds),
    commentIds.length
      ? supabase.from('article_comments').select('id, content').in('id', commentIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (recipientError || actorError || articleError || commentError) {
    console.error('Failed to load notification metadata', {
      recipientError,
      actorError,
      articleError,
      commentError,
    })
    return jsonResponse({ error: 'Failed to load notification metadata' }, 500)
  }

  const recipientsById = new Map(
    ((recipientRows ?? []) as RecipientProfile[]).map((row) => [row.id, row])
  )
  const actorsById = new Map(
    ((actorRows ?? []) as ActorProfile[]).map((row) => [row.id, row])
  )
  const articlesById = new Map(
    ((articleRows ?? []) as ArticleRow[]).map((row) => [row.id, row])
  )
  const commentsById = new Map(
    ((commentRows ?? []) as CommentRow[]).map((row) => [row.id, row])
  )

  const recipientEmails = Array.from(
    new Set(
      Array.from(recipientsById.values())
        .map((row) => row.email?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
  )

  const { data: preferenceRows, error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .select(
      'email, newsletter_enabled, digest_enabled, story_notifications_enabled, like_notifications_frequency, comment_notifications_frequency'
    )
    .in('email', recipientEmails)

  if (preferenceError) {
    console.error('Failed to load engagement notification preferences', preferenceError)
    return jsonResponse({ error: 'Failed to load preferences' }, 500)
  }

  const preferencesByEmail = new Map(
    (preferenceRows ?? []).map((row) => [
      row.email.toLowerCase(),
      normalizeEmailNotificationPreferences(row),
    ])
  )

  const grouped = new Map<string, PendingNotification[]>()
  for (const row of pending) {
    const recipient = recipientsById.get(row.recipient_profile_id)
    if (!recipient?.email?.trim()) continue
    const key = `${row.recipient_profile_id}:${row.notification_category}`
    const current = grouped.get(key) ?? []
    current.push(row)
    grouped.set(key, current)
  }

  const now = Date.now()
  const processedIds = new Set<string>()
  const suppressedIds = new Set<string>()
  let queued = 0

  for (const [groupKey, rows] of grouped) {
    const [recipientProfileId, category] = groupKey.split(':') as [
      string,
      'like' | 'comment',
    ]
    const recipient = recipientsById.get(recipientProfileId)
    if (!recipient?.email?.trim()) continue

    const normalizedEmail = recipient.email.trim().toLowerCase()
    const preferences =
      preferencesByEmail.get(normalizedEmail) ??
      normalizeEmailNotificationPreferences()
    const frequency =
      category === 'like'
        ? preferences.like_notifications_frequency
        : preferences.comment_notifications_frequency

    if (frequency === 'none') {
      rows.forEach((row) => suppressedIds.add(row.id))
      continue
    }

    const delayMs = getFrequencyDelayMs(frequency)
    if (delayMs === null) {
      rows.forEach((row) => suppressedIds.add(row.id))
      continue
    }

    const dueRows =
      frequency === 'instant'
        ? rows
        : rows.filter((row) => now - new Date(row.created_at).getTime() >= delayMs)

    if (!dueRows.length) continue

    const recipientLanguage = normalizeLanguage(recipient.preferred_language)
    const buildItems = (notificationsForEmail: PendingNotification[]): TemplateItem[] =>
      notificationsForEmail.map((notification) => {
        const article = articlesById.get(notification.article_id)
        const comment = notification.comment_id
          ? commentsById.get(notification.comment_id)
          : null
        const actor = notification.actor_profile_id
          ? actorsById.get(notification.actor_profile_id)
          : null

        return {
          actorName:
            actor?.name?.trim() ||
            (recipientLanguage === 'en' ? 'Someone' : 'Qualcuno'),
          articleTitle: resolveArticleTitle(article, recipientLanguage),
          articleUrl: article
            ? `${PUBLIC_SITE_URL}/logbook/${article.slug}`
            : `${PUBLIC_SITE_URL}/journal`,
          articleImageUrl: article?.cover_image ?? null,
          createdAtLabel: formatTimestamp(notification.created_at, recipientLanguage),
          kind: notification.event_type,
          commentPreview: truncateText(comment?.content, 180),
        }
      })

    try {
      if (frequency === 'instant') {
        for (const notification of dueRows) {
          const [item] = buildItems([notification])
          await queueEmail({
            supabaseUrl,
            serviceRoleKey,
            recipientEmail: normalizedEmail,
            idempotencyKey: `engagement-notification:${notification.id}`,
            templateData: {
              language: recipientLanguage,
              recipientName: recipient.name,
              category,
              frequency,
              items: [item],
            },
          })
          processedIds.add(notification.id)
          queued += 1
        }
      } else {
        const items = buildItems(dueRows)
        await queueEmail({
          supabaseUrl,
          serviceRoleKey,
          recipientEmail: normalizedEmail,
          idempotencyKey: `engagement-digest:${recipient.id}:${category}:${frequency}:${dueRows[0].id}:${dueRows.length}`,
          templateData: {
            language: recipientLanguage,
            recipientName: recipient.name,
            category,
            frequency,
            items,
          },
        })
        dueRows.forEach((notification) => processedIds.add(notification.id))
        queued += 1
      }
    } catch (error) {
      console.error('Failed to queue engagement email', {
        recipientProfileId,
        category,
        frequency,
        error,
      })
    }
  }

  const timestamp = new Date().toISOString()

  if (processedIds.size > 0) {
    const { error } = await supabase
      .from('engagement_notifications')
      .update({
        processed_at: timestamp,
        emailed_at: timestamp,
        processing_note: 'queued',
      })
      .in('id', Array.from(processedIds))

    if (error) {
      console.error('Failed to mark engagement notifications as queued', error)
    }
  }

  if (suppressedIds.size > 0) {
    const { error } = await supabase
      .from('engagement_notifications')
      .update({
        processed_at: timestamp,
        processing_note: 'recipient_disabled_notifications',
      })
      .in('id', Array.from(suppressedIds))

    if (error) {
      console.error('Failed to mark engagement notifications as suppressed', error)
    }
  }

  return jsonResponse({
    success: true,
    queued,
    suppressed: suppressedIds.size,
    processed: processedIds.size,
  })
})
