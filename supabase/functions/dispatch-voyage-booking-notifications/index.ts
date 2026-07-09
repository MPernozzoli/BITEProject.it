import { createClient } from 'npm:@supabase/supabase-js@2'
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
      templateName: 'voyage-booking-notification',
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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  if (!isAuthorizedRequest(req)) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
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
    .select('id, booking_request_id, recipient_profile_id, event_type')
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
  const profileIds = [...new Set(pending.map((row) => row.recipient_profile_id))]

  const [{ data: bookings }, { data: profiles }] = await Promise.all([
    supabase.from('voyage_booking_requests').select('id, voyage_id, profile_id, party_size, message').in('id', requestIds),
    supabase.from('profiles').select('id, name, email, preferred_language').in('id', profileIds),
  ])

  const bookingRows = (bookings ?? []) as BookingRow[]
  const profileRows = (profiles ?? []) as ProfileRow[]
  const voyageIds = [...new Set(bookingRows.map((row) => row.voyage_id))]
  const bookingById = new Map(bookingRows.map((row) => [row.id, row]))
  const profileById = new Map(profileRows.map((row) => [row.id, row]))

  const [{ data: voyages }, { data: requestLegs }] = await Promise.all([
    voyageIds.length
      ? supabase.from('voyages').select('id, name, name_it, name_en').in('id', voyageIds)
      : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from('voyage_booking_request_legs').select('booking_request_id, bookable_leg_id').in('booking_request_id', requestIds)
      : Promise.resolve({ data: [] }),
  ])

  const voyageById = new Map(((voyages ?? []) as VoyageRow[]).map((row) => [row.id, row]))
  const requestLegRows = (requestLegs ?? []) as LegRow[]
  const legIds = [...new Set(requestLegRows.map((row) => row.bookable_leg_id))]

  const { data: bookableLegs } = legIds.length
    ? await supabase.from('voyage_bookable_legs').select('id, from_waypoint_id, to_waypoint_id, sort_order').in('id', legIds)
    : { data: [] }

  const bookableLegRows = (bookableLegs ?? []) as BookableLegRow[]
  const waypointIds = [
    ...new Set(bookableLegRows.flatMap((row) => [row.from_waypoint_id, row.to_waypoint_id])),
  ]
  const { data: waypoints } = waypointIds.length
    ? await supabase.from('voyage_waypoints').select('id, name, name_it, name_en').in('id', waypointIds)
    : { data: [] }

  const legById = new Map(bookableLegRows.map((row) => [row.id, row]))
  const waypointById = new Map(((waypoints ?? []) as WaypointRow[]).map((row) => [row.id, row]))
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
    if (!booking || !profile?.email) {
      failed += 1
      await supabase
        .from('voyage_booking_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: !booking ? 'booking_not_found' : 'recipient_email_missing',
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

    try {
      await queueEmail({
        supabaseUrl,
        serviceRoleKey,
        recipientEmail: profile.email,
        idempotencyKey: `voyage-booking:${notification.id}`,
        templateData: {
          language,
          recipientName: profile.name,
          eventType: notification.event_type,
          voyageName: localizedName(voyage, language),
          legs: legLabels,
          partySize: booking.party_size,
          bookingUrl: `${PUBLIC_SITE_URL}/bookings?voyage=${booking.voyage_id}`,
          message: booking.message,
        },
      })

      queued += 1
      await supabase
        .from('voyage_booking_notifications')
        .update({
          processed_at: new Date().toISOString(),
          emailed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', notification.id)
    } catch (error) {
      failed += 1
      await supabase
        .from('voyage_booking_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message.slice(0, 500) : 'unknown_error',
        })
        .eq('id', notification.id)
    }
  }

  return jsonResponse({ success: true, queued, failed })
})
