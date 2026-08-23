import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'

/**
 * Proactive editorial readiness checker.
 *
 * Runs every hour via pg_cron / external scheduler.
 * Finds site-channel slots publishing within the next 24 hours,
 * checks article readiness, and sends push alerts to admins.
 *
 * Schedule: POST every hour to /functions/v1/editorial-readiness-alert
 * Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type ReadinessResult = {
  ready: boolean
  missing: string[]
  article_id: string
}

type SlotRow = {
  id: string
  slot_date: string
  slot_time: string
  assigned_article_id: string | null
  status: string
  channel_id: string
}

type ArticleRow = {
  id: string
  title_it: string | null
  title_en: string | null
  slug: string
  cover_image: string | null
}

type AdminProfile = {
  id: string
  email: string
  name: string | null
  preferred_language: string | null
}

type PushSubscriptionRow = {
  id: string
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
  enabled: boolean
}

type AlertLogRow = {
  slot_id: string
  alert_type: string
  sent_at: string
}

const MISSING_FIELD_LABELS: Record<string, { it: string; en: string }> = {
  title_it: { it: 'Titolo IT', en: 'IT title' },
  title_en: { it: 'Titolo EN', en: 'EN title' },
  excerpt_it: { it: 'Estratto IT', en: 'IT excerpt' },
  excerpt_en: { it: 'Estratto EN', en: 'EN excerpt' },
  content_it: { it: 'Contenuto IT', en: 'IT content' },
  content_en: { it: 'Contenuto EN', en: 'EN content' },
  cover_image: { it: 'Copertina', en: 'Cover image' },
  editorial_type: { it: 'Tipo editoriale', en: 'Editorial type' },
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function authorizeCron(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('EDITORIAL_ALERT_CRON_SECRET')

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

function hoursUntil(slotDate: string, slotTime: string): number {
  const slotDateTime = new Date(`${slotDate}T${slotTime}`)
  const now = new Date()
  return (slotDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
}

function resolveArticleTitle(article: ArticleRow | null, lang: string): string {
  if (!article) return lang === 'en' ? 'Article' : 'Articolo'
  if (lang === 'en') return article.title_en?.trim() || article.title_it?.trim() || 'Article'
  return article.title_it?.trim() || article.title_en?.trim() || 'Articolo'
}

function buildMissingFieldsText(missing: string[], lang: string): string {
  if (!missing.length) return ''
  const labels = missing.map((f) => MISSING_FIELD_LABELS[f]?.[lang] ?? f)
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`
  const last = labels.pop()!
  return `${labels.join(', ')} e ${last}`
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
  const vapidPublicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
  const vapidSubject =
    Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hello@biteproject.it'

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const dryRun = isDryRun(req)

  // Site channel ID (from editorial_plan_channels)
  const SITE_CHANNEL_ID = '11111111-1111-4111-8111-111111110001'

  // Find assigned site slots publishing within the next 24 hours
  const now = new Date()
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const nowDate = now.toISOString().slice(0, 10)
  const horizonDate = horizon.toISOString().slice(0, 10)

  const { data: slots, error: slotError } = await supabase
    .from('editorial_plan_slots')
    .select('id, slot_date, slot_time, assigned_article_id, status, channel_id')
    .eq('channel_id', SITE_CHANNEL_ID)
    .eq('status', 'assigned')
    .not('assigned_article_id', 'is', null)
    .gte('slot_date', nowDate)
    .lte('slot_date', horizonDate)
    .order('slot_date', { ascending: true })
    .order('slot_time', { ascending: true })

  if (slotError) {
    console.error('editorial-readiness-alert: failed to load slots', slotError)
    return jsonResponse({ error: 'Failed to load slots' }, 500)
  }

  const candidateSlots = (slots ?? []) as SlotRow[]

  // Filter to slots actually within 24h (slot_date might be same day but time passed)
  const upcomingSlots = candidateSlots.filter((s) => {
    const hours = hoursUntil(s.slot_date, s.slot_time)
    return hours > 0 && hours <= 24
  })

  if (!upcomingSlots.length) {
    return jsonResponse({ success: true, checked: 0, alertsSent: 0, dryRun })
  }

  const articleIds = Array.from(
    new Set(upcomingSlots.map((s) => s.assigned_article_id!).filter(Boolean))
  )

  // Load articles and check readiness
  const readinessResults = new Map<string, ReadinessResult>()
  for (const articleId of articleIds) {
    const { data, error } = await supabase.rpc('check_article_readiness', {
      _article_id: articleId,
    })
    if (error) {
      console.error(`editorial-readiness-alert: readiness check failed for ${articleId}`, error)
      readinessResults.set(articleId, { ready: false, missing: ['check_failed'], article_id: articleId })
    } else {
      readinessResults.set(articleId, data as ReadinessResult)
    }
  }

  // Load articles for title resolution
  const { data: articleRows } = await supabase
    .from('logbook_articles')
    .select('id, title_it, title_en, slug, cover_image')
    .in('id', articleIds)

  const articlesById = new Map(
    ((articleRows ?? []) as ArticleRow[]).map((a) => [a.id, a])
  )

  // Find admin profiles
  const { data: adminRoles } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')

  const adminIds = ((adminRoles ?? []) as { user_id: string }[]).map((r) => r.user_id)

  if (!adminIds.length) {
    return jsonResponse({ success: true, checked: upcomingSlots.length, alertsSent: 0, dryRun, note: 'no admins' })
  }

  // Load admin profiles and their push subscriptions + recent alerts
  const [
    { data: adminProfiles },
    { data: pushSubs },
    { data: recentAlerts },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, name, preferred_language')
      .in('id', adminIds),
    supabase
      .from('push_subscriptions')
      .select('id, profile_id, endpoint, p256dh, auth, enabled')
      .in('profile_id', adminIds)
      .eq('enabled', true),
    // Recent alerts in the last 6 hours (avoid spam)
    supabase
      .from('editorial_alert_log')
      .select('slot_id, alert_type, sent_at')
      .gte('sent_at', new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()),
  ])

  // Load preferences after we have admin emails
  const adminEmails = ((adminProfiles ?? []) as AdminProfile[])
    .map((p) => p.email?.toLowerCase())
    .filter(Boolean)

  const { data: prefRows } = adminEmails.length
    ? await supabase
        .from('email_notification_preferences')
        .select('email, push_editorial_alerts_enabled')
        .in('email', adminEmails)
    : { data: [] }

  const profilesById = new Map(
    ((adminProfiles ?? []) as AdminProfile[]).map((p) => [p.id, p])
  )
  const subsByProfileId = new Map<string, PushSubscriptionRow[]>()
  for (const row of (pushSubs ?? []) as PushSubscriptionRow[]) {
    const arr = subsByProfileId.get(row.profile_id) ?? []
    arr.push(row)
    subsByProfileId.set(row.profile_id, arr)
  }
  const prefsByEmail = new Map(
    ((prefRows ?? []) as { email: string; push_editorial_alerts_enabled: boolean }[]).map(
      (r) => [r.email.toLowerCase(), r.push_editorial_alerts_enabled]
    )
  )
  const recentAlertSet = new Set(
    ((recentAlerts ?? []) as AlertLogRow[]).map((a) => `${a.slot_id}:${a.alert_type}`)
  )

  let alertsSent = 0
  const alertLogEntries: Array<{
    slot_id: string
    article_id: string
    alert_type: string
    missing_fields: string[]
    hours_until_publish: number
  }> = []

  for (const slot of upcomingSlots) {
    if (!slot.assigned_article_id) continue
    const readiness = readinessResults.get(slot.assigned_article_id)
    if (!readiness) continue

    const hours = hoursUntil(slot.slot_date, slot.slot_time)
    const article = articlesById.get(slot.assigned_article_id)

    let alertType: string
    if (readiness.ready) {
      alertType = 'readiness_ok'
    } else if (hours <= 6) {
      alertType = 'readiness_critical'
    } else {
      alertType = 'readiness_warning'
    }

    // Skip if we already sent this alert type for this slot recently
    if (recentAlertSet.has(`${slot.id}:${alertType}`)) continue
    // For ready articles, only notify once (when they become ready)
    if (alertType === 'readiness_ok' && recentAlertSet.has(`${slot.id}:readiness_ok`)) continue

    // Don't send push for ready articles – only for warnings/criticals
    if (alertType === 'readiness_ok') {
      // Still log it for tracking
      alertLogEntries.push({
        slot_id: slot.id,
        article_id: slot.assigned_article_id,
        alert_type: alertType,
        missing_fields: readiness.missing,
        hours_until_publish: hours,
      })
      continue
    }

    // Send push to admins who have editorial alerts enabled
    for (const adminId of adminIds) {
      const profile = profilesById.get(adminId)
      if (!profile?.email) continue

      const normalizedEmail = profile.email.toLowerCase()
      const enabled = prefsByEmail.get(normalizedEmail)
      if (enabled === false) continue

      const lang = profile.preferred_language === 'en' ? 'en' : 'it'
      const subscriptions = subsByProfileId.get(adminId) ?? []
      if (!subscriptions.length) continue

      const articleTitle = resolveArticleTitle(article, lang)
      const missingText = buildMissingFieldsText(readiness.missing, lang)
      const urgency = alertType === 'readiness_critical'
        ? (lang === 'en' ? 'URGENT' : 'URGENTE')
        : (lang === 'en' ? 'Reminder' : 'Promemoria')

      const title = `${urgency}: ${articleTitle}`
      const body = lang === 'en'
        ? `Missing: ${missingText}. Publishes in ${Math.round(hours)}h.`
        : `Mancano: ${missingText}. Pubblica tra ${Math.round(hours)}h.`
      const url = `${PUBLIC_SITE_URL}/${lang}/admin/article/${slot.assigned_article_id}`

      const results = await Promise.allSettled(
        subscriptions.map((sub) =>
          sendPushNotification({
            subscription: sub,
            vapidSubject,
            notification: { title, body, url, icon: article?.cover_image },
          })
        )
      )

      // Disable invalid subscriptions
      const invalidEndpoints = results
        .map((result, i) => ({ result, subscription: subscriptions[i] }))
        .filter(({ result }) => result.status === 'rejected')
        .filter(({ result }) => {
          const reason = (result as PromiseRejectedResult).reason
          const code = reason?.statusCode ?? reason?.status
          return code === 404 || code === 410
        })
        .map(({ subscription }) => subscription.endpoint)

      if (invalidEndpoints.length > 0) {
        await supabase
          .from('push_subscriptions')
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .in('endpoint', invalidEndpoints)
      }

      if (results.some((r) => r.status === 'fulfilled')) {
        alertsSent++
      }
    }

    alertLogEntries.push({
      slot_id: slot.id,
      article_id: slot.assigned_article_id,
      alert_type: alertType,
      missing_fields: readiness.missing,
      hours_until_publish: hours,
    })
  }

  // Write alert log entries
  if (alertLogEntries.length > 0 && !dryRun) {
    const { error: logError } = await supabase
      .from('editorial_alert_log')
      .insert(
        alertLogEntries.map((e) => ({
          slot_id: e.slot_id,
          article_id: e.article_id,
          alert_type: e.alert_type,
          missing_fields: e.missing_fields,
          hours_until_publish: e.hours_until_publish,
        }))
      )

    if (logError) {
      console.error('editorial-readiness-alert: failed to write alert log', logError)
    }
  }

  return jsonResponse({
    success: true,
    dryRun,
    checked: upcomingSlots.length,
    alertsSent,
    alertDetails: alertLogEntries.map((e) => ({
      slot_id: e.slot_id,
      article_id: e.article_id,
      alert_type: e.alert_type,
      missing: e.missing_fields,
      hours: Math.round(e.hours_until_publish),
    })),
  })
})
