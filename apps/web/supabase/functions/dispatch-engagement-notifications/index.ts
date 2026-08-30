import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import {
  normalizeEmailNotificationPreferences,
  type EngagementNotificationFrequency,
} from '../_shared/email-preferences.ts'
import { PUBLIC_SITE_URL, localizedUrl } from '../_shared/email-config.ts'
import { EMAIL_TRACKING, buildTrackedUrl } from '../_shared/tracking.ts'
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
    | 'article_published'
    | 'story_article_published'
  notification_category: 'like' | 'comment' | 'publication'
  created_at: string
  push_sent_at: string | null
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
  avatar_url?: string | null
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

type PushSubscriptionRow = {
  id: string
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
  enabled: boolean
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

function isAuthorizedRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice('Bearer '.length).trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  // Service-role only endpoint: compare bearer token literally to the service role key.
  // No JWT signature forging is possible because we never trust decoded claims.
  return Boolean(serviceRoleKey && token === serviceRoleKey)
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

function buildNotificationUrl(
  article: ArticleRow | null | undefined,
  notification: PendingNotification,
  lang: string | null = null,
  channel: 'email' | 'push' = 'email'
): string {
  const articlePath = article ? `/logbook/${article.slug}` : '/logbook'
  const params = new URLSearchParams({
    notification: notification.id,
    focus: notification.comment_id ? 'comment' : 'likes',
  })

  if (notification.comment_id) {
    params.set('comment', notification.comment_id)
  }

  // Email e push sono due consegne diverse della stessa notifica: si
  // distinguono nel mezzo, così si vede quale delle due riporta davvero
  // qualcuno sul sito.
  return buildTrackedUrl(`${localizedUrl(lang, articlePath)}?${params.toString()}`, {
    ...(channel === 'push' ? EMAIL_TRACKING.push : EMAIL_TRACKING.notification),
    campaign: notification.notification_category ?? 'engagement',
  })
}

function buildPushMessage(params: {
  language: string | null
  item: TemplateItem
  category: 'like' | 'comment' | 'publication'
}): { title: string; body: string } {
  const language = normalizeLanguage(params.language)
  const actorName =
    params.item.actorName.trim() || (language === 'en' ? 'Someone' : 'Qualcuno')

  if (params.category === 'like') {
    return {
      title:
        language === 'en'
          ? `${actorName} liked your content`
          : `${actorName} ha messo like`,
      body:
        language === 'en'
          ? params.item.articleTitle
          : params.item.articleTitle,
    }
  }

  if (params.category === 'publication') {
    return {
      title:
        params.item.kind === 'story_article_published'
          ? language === 'en'
            ? 'New chapter in a story you follow'
            : 'Nuovo capitolo in una storia che segui'
          : language === 'en'
            ? 'New article published'
            : 'Nuovo articolo pubblicato',
      body: params.item.articleTitle,
    }
  }

  return {
    title:
      language === 'en'
        ? `${actorName} interacted with your comments`
        : `${actorName} ha interagito con i tuoi commenti`,
    body: params.item.commentPreview || params.item.articleTitle,
  }
}

async function sendPushNotification(params: {
  subscription: PushSubscriptionRow
  vapidSubject: string
  notification: { title: string; body: string; url: string; icon?: string | null }
}): Promise<void> {
  await webpush.sendNotification(
    {
      endpoint: params.subscription.endpoint,
      expirationTime: null,
      keys: {
        p256dh: params.subscription.p256dh,
        auth: params.subscription.auth,
      },
    },
    JSON.stringify({
      title: params.notification.title,
      body: params.notification.body,
      url: params.notification.url,
      icon: params.notification.icon || `${PUBLIC_SITE_URL}/icons/icon-192.png`,
    }),
    {
      TTL: 60 * 5,
      vapidDetails: {
        subject: params.vapidSubject,
        publicKey: Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '',
        privateKey: Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '',
      },
    }
  )
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
  const vapidPublicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
  const vapidSubject =
    Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hello@biteproject.it'

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
      'id, recipient_profile_id, actor_profile_id, article_id, comment_id, event_type, notification_category, created_at, push_sent_at'
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
    { data: pushSubscriptionRows, error: pushSubscriptionError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, name, preferred_language')
      .in('id', recipientIds),
    actorIds.length
      ? supabase.from('public_profiles').select('id, name, avatar_url').in('id', actorIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('logbook_articles')
      .select('id, slug, title_it, title_en, cover_image')
      .in('id', articleIds),
    commentIds.length
      ? supabase.from('article_comments').select('id, content').in('id', commentIds)
      : Promise.resolve({ data: [], error: null }),
    recipientIds.length
      ? supabase
          .from('push_subscriptions')
          .select('id, profile_id, endpoint, p256dh, auth, enabled')
          .in('profile_id', recipientIds)
          .eq('enabled', true)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (recipientError || actorError || articleError || commentError || pushSubscriptionError) {
    console.error('Failed to load notification metadata', {
      recipientError,
      actorError,
      articleError,
      commentError,
      pushSubscriptionError,
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
  const pushSubscriptionsByProfileId = new Map<string, PushSubscriptionRow[]>()
  for (const row of (pushSubscriptionRows ?? []) as PushSubscriptionRow[]) {
    const current = pushSubscriptionsByProfileId.get(row.profile_id) ?? []
    current.push(row)
    pushSubscriptionsByProfileId.set(row.profile_id, current)
  }

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
      'email, article_notifications_enabled, newsletter_enabled, digest_enabled, story_notifications_enabled, like_notifications_frequency, comment_notifications_frequency, push_engagement_enabled, push_publication_enabled'
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
  const pushSentIds = new Set<string>()
  let queued = 0

  const buildItems = (
    notificationsForOutput: PendingNotification[],
    recipientLanguage: string | null
  ): TemplateItem[] =>
    notificationsForOutput.map((notification) => {
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
        articleUrl: buildNotificationUrl(article, notification, recipientLanguage),
        articleImageUrl: article?.cover_image ?? null,
        createdAtLabel: formatTimestamp(notification.created_at, recipientLanguage),
        kind: notification.event_type,
        commentPreview: truncateText(comment?.content, 180),
      }
    })

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
    const recipientLanguage = normalizeLanguage(recipient.preferred_language)

    if (
      ((category === 'publication' && preferences.push_publication_enabled) ||
        (category !== 'publication' && preferences.push_engagement_enabled)) &&
      vapidPublicKey &&
      vapidPrivateKey
    ) {
      const subscriptions = pushSubscriptionsByProfileId.get(recipientProfileId) ?? []
      const pushRows = rows.filter((row) => !row.push_sent_at)
      for (const notification of pushRows) {
        if (!subscriptions.length) break

        try {
          const [item] = buildItems([notification], recipientLanguage)
          const pushMessage = buildPushMessage({
            language: recipientLanguage,
            item,
            category: notification.notification_category,
          })

          const results = await Promise.allSettled(
            subscriptions.map((subscription) =>
              sendPushNotification({
                subscription,
                vapidSubject,
                notification: {
                  title: pushMessage.title,
                  body: pushMessage.body,
                  // Stessa destinazione dell'email, mezzo diverso: la push va
                  // taggata come push, altrimenti le due consegne si sommano
                  // in un unico numero che non dice quale delle due funziona.
                  url: buildNotificationUrl(
                    articlesById.get(notification.article_id),
                    notification,
                    recipientLanguage,
                    'push'
                  ),
                  icon: item.articleImageUrl,
                },
              })
            )
          )

          const invalidEndpoints = results
            .map((result, index) => ({ result, subscription: subscriptions[index] }))
            .filter(({ result }) => result.status === 'rejected')
            .filter(({ result }) => {
              const reason = (result as PromiseRejectedResult).reason
              const statusCode =
                typeof reason?.statusCode === 'number'
                  ? reason.statusCode
                  : typeof reason?.status === 'number'
                    ? reason.status
                    : null
              return statusCode === 404 || statusCode === 410
            })
            .map(({ subscription }) => subscription.endpoint)

          if (invalidEndpoints.length > 0) {
            await supabase
              .from('push_subscriptions')
              .update({ enabled: false, updated_at: new Date().toISOString() })
              .in('endpoint', invalidEndpoints)
          }

          if (results.some((result) => result.status === 'fulfilled')) {
            pushSentIds.add(notification.id)
          }
        } catch (error) {
          console.error('Failed to send engagement push notification', {
            notificationId: notification.id,
            recipientProfileId,
            error,
          })
        }
      }
    }

    if (category === 'publication') {
      rows.forEach((row) => processedIds.add(row.id))
      continue
    }

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

    try {
      if (frequency === 'instant') {
        for (const notification of dueRows) {
          const [item] = buildItems([notification], recipientLanguage)
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
        const items = buildItems(dueRows, recipientLanguage)
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

  if (pushSentIds.size > 0) {
    const { error } = await supabase
      .from('engagement_notifications')
      .update({
        push_sent_at: timestamp,
      })
      .in('id', Array.from(pushSentIds))

    if (error) {
      console.error('Failed to mark engagement notifications as push-sent', error)
    }
  }

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
