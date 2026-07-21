import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { isInjectedServiceKey } from '../_shared/service-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type Claims = Record<string, unknown> | null

type DueReminder = {
  reminder_id: string
  live_event_id: string
  profile_id: string
  title: string
  starts_at: string
  remind_before_minutes: number
  advance_push_due: boolean
  start_push_due: boolean
}

type PushSubscriptionRow = {
  id: string
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
  enabled: boolean
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseJwtClaims(token: string): Claims {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
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
  const cronSecret = Deno.env.get('EMAIL_QUEUE_CRON_SECRET')
  const headerCronSecret = req.headers.get('x-cron-secret')
  if (cronSecret && headerCronSecret && headerCronSecret === cronSecret) return true

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice('Bearer '.length).trim()
  if (isInjectedServiceKey(token)) return true
  const claims = parseJwtClaims(token)
  return claims?.role === 'service_role'
}

function formatStartsAt(value: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Rome',
  }).format(new Date(value))
}

async function sendPushNotification(params: {
  subscription: PushSubscriptionRow
  vapidSubject: string
  publicKey: string
  privateKey: string
  notification: Record<string, unknown>
}) {
  return webpush.sendNotification(
    {
      endpoint: params.subscription.endpoint,
      expirationTime: null,
      keys: {
        p256dh: params.subscription.p256dh,
        auth: params.subscription.auth,
      },
    },
    JSON.stringify(params.notification),
    {
      TTL: 60 * 5,
      vapidDetails: {
        subject: params.vapidSubject,
        publicKey: params.publicKey,
        privateKey: params.privateKey,
      },
    },
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? Deno.env.get('VITE_WEB_PUSH_PUBLIC_KEY')
  const privateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hello@biteproject.it'

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  if (!publicKey || !privateKey) {
    return jsonResponse({ processed: 0, skipped: 'web_push_not_configured' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('list_due_community_live_event_push_reminders', {
    _limit: 100,
  })

  if (error) {
    console.error('Failed to load due community live reminders', error)
    return jsonResponse({ error: 'Failed to load reminders' }, 500)
  }

  const reminders = (data ?? []) as DueReminder[]
  let processed = 0

  for (const reminder of reminders) {
    const kind = reminder.start_push_due ? 'start' : reminder.advance_push_due ? 'advance' : null
    if (!kind) continue

    const { data: subscriptionsData, error: subscriptionsError } = await supabase
      .from('push_subscriptions')
      .select('id, profile_id, endpoint, p256dh, auth, enabled')
      .eq('profile_id', reminder.profile_id)
      .eq('enabled', true)

    if (subscriptionsError) {
      console.error('Failed to load push subscriptions', {
        reminderId: reminder.reminder_id,
        profileId: reminder.profile_id,
        error: subscriptionsError,
      })
      continue
    }

    const subscriptions = (subscriptionsData ?? []) as PushSubscriptionRow[]
    if (!subscriptions.length) continue

    const title = kind === 'start' ? 'La live BITE Crew è iniziata' : 'La live BITE Crew sta per iniziare'
    const startsAt = formatStartsAt(reminder.starts_at)
    const body =
      kind === 'start'
        ? `${reminder.title} è live adesso.`
        : `${reminder.title} inizia alle ${startsAt}.`

    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        sendPushNotification({
          subscription,
          vapidSubject,
          publicKey,
          privateKey,
          notification: {
            type: 'community-live',
            title,
            body,
            url: 'https://crew.biteproject.it/live',
            tag: `community-live:${reminder.live_event_id}:${kind}`,
            icon: '/favicon.ico',
          },
        }),
      ),
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
      const timestamp = new Date().toISOString()
      const update =
        kind === 'start'
          ? { start_push_sent_at: timestamp, updated_at: timestamp }
          : { advance_push_sent_at: timestamp, updated_at: timestamp }

      const { error: updateError } = await supabase
        .from('community_live_event_reminders')
        .update(update)
        .eq('id', reminder.reminder_id)

      if (updateError) {
        console.error('Failed to mark community live push reminder sent', {
          reminderId: reminder.reminder_id,
          error: updateError,
        })
      } else {
        processed += 1
      }
    }
  }

  return jsonResponse({ processed, scanned: reminders.length })
})
