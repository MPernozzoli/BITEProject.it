import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type NotificationRow = {
  id: string
  booking_request_id: string
  recipient_profile_id: string
  event_type: string
  emailed_at: string | null
  push_sent_at: string | null
  metadata: Record<string, unknown>
}

type ProfileRow = {
  id: string
  name: string | null
  email: string | null
  preferred_language?: string | null
}

type BookingRow = {
  id: string
  voyage_id: string
  profile_id: string
  party_size: number
  message: string | null
}

type VoyageRow = {
  id: string
  name: string | null
  name_it: string | null
  name_en: string | null
}

type LegRow = {
  booking_request_id: string
  bookable_leg_id: string
}

type BookableLegRow = {
  id: string
  from_waypoint_id: string
  to_waypoint_id: string
  sort_order: number
}

type WaypointRow = {
  id: string
  name: string | null
  name_it: string | null
  name_en: string | null
}

type PushSubscriptionRow = {
  id: string
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
  enabled: boolean
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
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

function isAuthorizedRequest(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const claims = parseJwtClaims(authHeader.slice('Bearer '.length).trim())
  return claims?.role === 'service_role'
}

function localizedName(
  value: { name?: string | null; name_it?: string | null; name_en?: string | null } | undefined,
  language: string
) {
  if (!value) return ''
  return language === 'en'
    ? value.name_en || value.name_it || value.name || ''
    : value.name_it || value.name_en || value.name || ''
}

async function queueEmail(params: {
  supabaseUrl: string
  serviceRoleKey: string
  recipientEmail: string
  templateName: string
  idempotencyKey: string
  templateData: Record<string, unknown>
}) {
  const response = await fetch(`${params.supabaseUrl}/functions/v1/send-transactional-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.serviceRoleKey}`,
    },
    body: JSON.stringify({
      templateName: params.templateName,
      recipientEmail: params.recipientEmail,
      idempotencyKey: params.idempotencyKey,
      templateData: params.templateData,
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
}

function buildAdminPushMessage(params: {
  eventType: string
  language: string
  voyageName: string
  travelerName?: string | null
  travelerEmail?: string | null
  legLabels: string[]
}) {
  const traveler =
    params.travelerName?.trim() ||
    params.travelerEmail?.trim() ||
    (params.language === 'en' ? 'A traveller' : 'Un utente')
  const voyageName = params.voyageName || (params.language === 'en' ? 'a voyage' : 'un viaggio')
  const legs = params.legLabels.length ? ` (${params.legLabels.join(', ')})` : ''

  if (params.language === 'en') {
    if (params.eventType === 'admin_cancelled') {
      return {
        title: 'Booking cancelled',
        body: `${traveler} cancelled their booking for ${voyageName}${legs}.`,
      }
    }
    if (params.eventType === 'admin_modified') {
      return {
        title: 'Booking updated',
        body: `${traveler} updated their booking for ${voyageName}${legs}.`,
      }
    }
    if (params.eventType === 'admin_payment_pending') {
      return {
        title: 'Payment pending',
        body: `${traveler} started a payment for ${voyageName}${legs}.`,
      }
    }
    if (params.eventType === 'admin_payment_received') {
      return {
        title: 'Payment received',
        body: `${traveler} completed a payment for ${voyageName}${legs}.`,
      }
    }
    if (params.eventType === 'admin_plan_change') {
      return {
        title: 'Voyage plan changed',
        body: `A booking for ${voyageName} needs attention${legs}.`,
      }
    }
    return {
      title: 'New berth request',
      body: `${traveler} requested to join ${voyageName}${legs}.`,
    }
  }

  if (params.eventType === 'admin_cancelled') {
    return {
      title: 'Booking annullato',
      body: `${traveler} ha annullato la prenotazione per ${voyageName}${legs}.`,
    }
  }
  if (params.eventType === 'admin_modified') {
    return {
      title: 'Booking aggiornato',
      body: `${traveler} ha aggiornato la prenotazione per ${voyageName}${legs}.`,
    }
  }
  if (params.eventType === 'admin_payment_pending') {
    return {
      title: 'Pagamento in attesa',
      body: `${traveler} ha avviato un pagamento per ${voyageName}${legs}.`,
    }
  }
  if (params.eventType === 'admin_payment_received') {
    return {
      title: 'Pagamento ricevuto',
      body: `${traveler} ha completato un pagamento per ${voyageName}${legs}.`,
    }
  }
  if (params.eventType === 'admin_plan_change') {
    return {
      title: 'Planning viaggio cambiato',
      body: `Un booking per ${voyageName} richiede attenzione${legs}.`,
    }
  }
  return {
    title: 'Nuova richiesta di imbarco',
    body: `${traveler} ha chiesto di partecipare a ${voyageName}${legs}.`,
  }
}

async function sendPushNotification(params: {
  subscription: PushSubscriptionRow
  vapidSubject: string
  vapidPublicKey: string
  vapidPrivateKey: string
  notification: { title: string; body: string; url: string }
}) {
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
      icon: `${PUBLIC_SITE_URL}/icons/icon-192.png`,
    }),
    {
      TTL: 60 * 5,
      vapidDetails: {
        subject: params.vapidSubject,
        publicKey: params.vapidPublicKey,
        privateKey: params.vapidPrivateKey,
      },
    }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  if (!isAuthorizedRequest(req)) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? Deno.env.get('VITE_WEB_PUSH_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hello@biteproject.it'
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const limit = typeof body.limit === 'number' ? Math.max(1, Math.min(100, Math.trunc(body.limit))) : 50
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: notifications, error: notificationError } = await supabase
    .from('voyage_booking_notifications')
    .select('id, booking_request_id, recipient_profile_id, event_type, emailed_at, push_sent_at, metadata')
    .is('processed_at', null)
    .is('failed_at', null)
    .order('queued_at', { ascending: true })
    .limit(limit)

  if (notificationError) {
    console.error('Failed to load booking notifications', notificationError)
    return jsonResponse({ error: 'Failed to load notifications' }, 500)
  }

  const pending = (notifications ?? []) as NotificationRow[]
  if (!pending.length) return jsonResponse({ success: true, queued: 0, failed: 0 })

  const requestIds = [...new Set(pending.map((row) => row.booking_request_id))]

  const { data: bookings } = await supabase
    .from('voyage_booking_requests')
    .select('id, voyage_id, profile_id, party_size, message')
    .in('id', requestIds)

  const bookingRows = (bookings ?? []) as BookingRow[]
  const bookingById = new Map(bookingRows.map((row) => [row.id, row]))

  const profileIds = [
    ...new Set([
      ...pending.map((row) => row.recipient_profile_id),
      ...bookingRows.map((row) => row.profile_id),
    ]),
  ]

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email, preferred_language')
    .in('id', profileIds)

  const profileRows = (profiles ?? []) as ProfileRow[]
  const voyageIds = [...new Set(bookingRows.map((row) => row.voyage_id))]
  const profileById = new Map(profileRows.map((row) => [row.id, row]))
  const adminRecipientIds = [
    ...new Set(pending.filter((row) => row.event_type.startsWith('admin_')).map((row) => row.recipient_profile_id)),
  ]

  const [{ data: voyages }, { data: requestLegs }, { data: pushSubscriptionRows }] = await Promise.all([
    voyageIds.length
      ? supabase.from('voyages').select('id, name, name_it, name_en').in('id', voyageIds)
      : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from('voyage_booking_request_legs').select('booking_request_id, bookable_leg_id').in('booking_request_id', requestIds)
      : Promise.resolve({ data: [] }),
    adminRecipientIds.length
      ? supabase
          .from('push_subscriptions')
          .select('id, profile_id, endpoint, p256dh, auth, enabled')
          .in('profile_id', adminRecipientIds)
          .eq('enabled', true)
      : Promise.resolve({ data: [] }),
  ])

  const voyageById = new Map(((voyages ?? []) as VoyageRow[]).map((row) => [row.id, row]))
  const requestLegRows = (requestLegs ?? []) as LegRow[]
  const legIds = [...new Set(requestLegRows.map((row) => row.bookable_leg_id))]

  const { data: bookableLegs } = legIds.length
    ? await supabase.from('voyage_bookable_legs').select('id, from_waypoint_id, to_waypoint_id, sort_order').in('id', legIds)
    : { data: [] }

  const bookableLegRows = (bookableLegs ?? []) as BookableLegRow[]
  const metadataWaypointIds = pending.flatMap((row) => [
    metadataString(row.metadata ?? {}, 'old_from_waypoint_id'),
    metadataString(row.metadata ?? {}, 'old_to_waypoint_id'),
    metadataString(row.metadata ?? {}, 'proposed_from_waypoint_id'),
    metadataString(row.metadata ?? {}, 'proposed_to_waypoint_id'),
  ]).filter((value): value is string => Boolean(value))

  const waypointIds = [
    ...new Set(bookableLegRows.flatMap((row) => [row.from_waypoint_id, row.to_waypoint_id])),
    ...new Set(metadataWaypointIds),
  ]
  const { data: waypoints } = waypointIds.length
    ? await supabase.from('voyage_waypoints').select('id, name, name_it, name_en').in('id', waypointIds)
    : { data: [] }

  const legById = new Map(bookableLegRows.map((row) => [row.id, row]))
  const waypointById = new Map(((waypoints ?? []) as WaypointRow[]).map((row) => [row.id, row]))
  const pushSubscriptionsByProfileId = new Map<string, PushSubscriptionRow[]>()
  for (const row of (pushSubscriptionRows ?? []) as PushSubscriptionRow[]) {
    const list = pushSubscriptionsByProfileId.get(row.profile_id) ?? []
    list.push(row)
    pushSubscriptionsByProfileId.set(row.profile_id, list)
  }
  const legsByRequestId = new Map<string, LegRow[]>()
  for (const link of requestLegRows) {
    const list = legsByRequestId.get(link.booking_request_id) ?? []
    list.push(link)
    legsByRequestId.set(link.booking_request_id, list)
  }

  let queued = 0
  let failed = 0

  for (const notification of pending) {
    const booking = bookingById.get(notification.booking_request_id)
    const profile = profileById.get(notification.recipient_profile_id)
    const isAdminEvent = notification.event_type.startsWith('admin_')
    if (!booking || !profile || (!profile.email && !isAdminEvent)) {
      failed += 1
      await supabase
        .from('voyage_booking_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: !booking ? 'booking_not_found' : 'recipient_profile_or_email_missing',
        })
        .eq('id', notification.id)
      continue
    }

    const language = profile.preferred_language === 'en' ? 'en' : 'it'
    const voyage = voyageById.get(booking.voyage_id)
    const legLabels = (legsByRequestId.get(booking.id) ?? [])
      .map((link) => legById.get(link.bookable_leg_id))
      .filter((leg): leg is BookableLegRow => Boolean(leg))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((leg) => {
        const from = localizedName(waypointById.get(leg.from_waypoint_id), language) || 'Waypoint'
        const to = localizedName(waypointById.get(leg.to_waypoint_id), language) || 'Waypoint'
        return `${from} -> ${to}`
      })

    const traveler = isAdminEvent ? profileById.get(booking.profile_id) : null
    const metadata = notification.metadata ?? {}
    const oldFrom = localizedName(waypointById.get(metadataString(metadata, 'old_from_waypoint_id') ?? ''), language)
    const oldTo = localizedName(waypointById.get(metadataString(metadata, 'old_to_waypoint_id') ?? ''), language)
    const proposedFrom = localizedName(waypointById.get(metadataString(metadata, 'proposed_from_waypoint_id') ?? ''), language)
    const proposedTo = localizedName(waypointById.get(metadataString(metadata, 'proposed_to_waypoint_id') ?? ''), language)
    const oldLegs = oldFrom && oldTo ? [`${oldFrom} -> ${oldTo}`] : null
    const proposedLegs = proposedFrom && proposedTo ? [`${proposedFrom} -> ${proposedTo}`] : null
    const amountEur = metadataNumber(metadata, 'amount_eur') ?? metadataNumber(metadata, 'amountEur')
    const paymentReference = metadataString(metadata, 'payment_reference') ?? metadataString(metadata, 'reference')

    let emailedAt = notification.emailed_at
    let pushSentAt = notification.push_sent_at

    try {
      if (!emailedAt && profile.email) {
        await queueEmail({
          supabaseUrl,
          serviceRoleKey,
          recipientEmail: profile.email,
          templateName: isAdminEvent ? 'voyage-booking-admin-notification' : 'voyage-booking-notification',
          idempotencyKey: `voyage-booking:${notification.id}`,
          templateData: isAdminEvent
            ? {
                language,
                recipientName: profile.name,
                eventType: notification.event_type,
                voyageName: localizedName(voyage, language),
                legs: legLabels,
                partySize: booking.party_size,
                travelerName: traveler?.name ?? null,
                travelerEmail: traveler?.email ?? null,
                bookingUrl: `${PUBLIC_SITE_URL}/admin/bookings?voyage=${booking.voyage_id}`,
                message: booking.message,
                amountEur,
                paymentReference,
                oldLegs,
                proposedLegs,
              }
            : {
                language,
                recipientName: profile.name,
                eventType: notification.event_type,
                voyageName: localizedName(voyage, language),
                legs: legLabels,
                partySize: booking.party_size,
                bookingUrl: `${PUBLIC_SITE_URL}/bookings?voyage=${booking.voyage_id}`,
                message: booking.message,
                amountEur,
                paymentMethod: metadataString(metadata, 'payment_method'),
                paymentReference,
                paymentExpiresAt: metadataString(metadata, 'payment_expires_at'),
                changeKind: metadataString(metadata, 'change_kind'),
                oldLegs,
                proposedLegs,
              },
        })
        emailedAt = new Date().toISOString()
      }

      const planChangeId = metadataString(metadata, 'plan_change_id')
      if (planChangeId && notification.event_type === 'plan_change_pending') {
        await supabase
          .from('voyage_booking_plan_changes')
          .update({
            email_status: 'sent',
            emailed_at: new Date().toISOString(),
          })
          .eq('id', planChangeId)
      }
    } catch (error) {
      failed += 1
      const metadata = notification.metadata ?? {}
      const planChangeId = metadataString(metadata, 'plan_change_id')
      if (planChangeId && notification.event_type === 'plan_change_pending') {
        await supabase
          .from('voyage_booking_plan_changes')
          .update({ email_status: 'failed' })
          .eq('id', planChangeId)
      }
      await supabase
        .from('voyage_booking_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message.slice(0, 500) : 'unknown_error',
        })
        .eq('id', notification.id)
      continue
    }

    const subscriptions = isAdminEvent
      ? pushSubscriptionsByProfileId.get(notification.recipient_profile_id) ?? []
      : []

    if (isAdminEvent && !pushSentAt && vapidPublicKey && vapidPrivateKey) {
      if (subscriptions.length > 0) {
        try {
          const pushMessage = buildAdminPushMessage({
            eventType: notification.event_type,
            language,
            voyageName: localizedName(voyage, language),
            travelerName: traveler?.name ?? null,
            travelerEmail: traveler?.email ?? null,
            legLabels,
          })
          const results = await Promise.allSettled(
            subscriptions.map((subscription) =>
              sendPushNotification({
                subscription,
                vapidSubject,
                vapidPublicKey,
                vapidPrivateKey,
                notification: {
                  title: pushMessage.title,
                  body: pushMessage.body,
                  url: `${PUBLIC_SITE_URL}/admin/bookings?voyage=${booking.voyage_id}`,
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
            pushSentAt = new Date().toISOString()
          } else if (invalidEndpoints.length === subscriptions.length) {
            pushSentAt = notification.push_sent_at ?? new Date().toISOString()
          }
        } catch (error) {
          console.error('Failed to send admin booking push notification', {
            notificationId: notification.id,
            recipientProfileId: notification.recipient_profile_id,
            error,
          })
        }
      }
    }

    const pushComplete =
      !isAdminEvent || Boolean(pushSentAt) || !vapidPublicKey || !vapidPrivateKey || subscriptions.length === 0
    const emailComplete = Boolean(emailedAt) || (isAdminEvent && !profile.email)
    if (emailComplete && pushComplete) {
      queued += 1
      await supabase
        .from('voyage_booking_notifications')
        .update({
          processed_at: new Date().toISOString(),
          emailed_at: emailedAt,
          push_sent_at: pushSentAt,
          error_message: null,
        })
        .eq('id', notification.id)
    } else if (emailedAt !== notification.emailed_at || pushSentAt !== notification.push_sent_at) {
      await supabase
        .from('voyage_booking_notifications')
        .update({
          emailed_at: emailedAt,
          push_sent_at: pushSentAt,
          error_message: null,
        })
        .eq('id', notification.id)
    }
  }

  return jsonResponse({ success: true, queued, failed })
})
