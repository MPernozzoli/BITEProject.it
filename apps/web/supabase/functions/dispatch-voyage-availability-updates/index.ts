import { createClient } from 'npm:@supabase/supabase-js@2'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type NotificationRow = {
  id: string
  watch_id: string
  recipient_profile_id: string
  voyage_id: string
  event_type: 'new_bookable_voyage' | 'availability_opened'
  leg_ids: string[]
  metadata: Record<string, unknown>
}

type ProfileRow = {
  id: string
  name: string | null
  email: string | null
  preferred_language: string | null
}

type VoyageRow = {
  id: string
  name: string | null
  name_it: string | null
  name_en: string | null
}

type LegRow = {
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
      templateName: 'voyage-availability-update',
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

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { limit = 25 } = await req.json().catch(() => ({}))

  const { data: notifications, error: notificationsError } = await supabase
    .from('voyage_availability_notifications')
    .select('id, watch_id, recipient_profile_id, voyage_id, event_type, leg_ids, metadata')
    .is('processed_at', null)
    .is('failed_at', null)
    .order('queued_at', { ascending: true })
    .limit(Math.max(1, Math.min(Number(limit) || 25, 100)))

  if (notificationsError) {
    console.error('Failed to load voyage availability notifications', notificationsError)
    return jsonResponse({ error: 'Failed to load notifications' }, 500)
  }

  const rows = (notifications ?? []) as NotificationRow[]
  if (rows.length === 0) {
    return jsonResponse({ processed: 0, sent: 0, failed: 0 })
  }

  const profileIds = [...new Set(rows.map((row) => row.recipient_profile_id))]
  const voyageIds = [...new Set(rows.map((row) => row.voyage_id))]
  const legIds = [...new Set(rows.flatMap((row) => row.leg_ids ?? []))]

  const [profilesRes, voyagesRes, legsRes] = await Promise.all([
    supabase.from('profiles').select('id, name, email, preferred_language').in('id', profileIds),
    supabase.from('voyages').select('id, name, name_it, name_en').in('id', voyageIds),
    legIds.length
      ? supabase
          .from('voyage_bookable_legs')
          .select('id, from_waypoint_id, to_waypoint_id, sort_order')
          .in('id', legIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (profilesRes.error || voyagesRes.error || legsRes.error) {
    console.error('Failed to load voyage availability context', {
      profilesError: profilesRes.error,
      voyagesError: voyagesRes.error,
      legsError: legsRes.error,
    })
    return jsonResponse({ error: 'Failed to load context' }, 500)
  }

  const legs = (legsRes.data ?? []) as LegRow[]
  const waypointIds = [...new Set(legs.flatMap((leg) => [leg.from_waypoint_id, leg.to_waypoint_id]))]
  const waypointsRes = waypointIds.length
    ? await supabase.from('voyage_waypoints').select('id, name, name_it, name_en').in('id', waypointIds)
    : { data: [], error: null }
  if (waypointsRes.error) {
    console.error('Failed to load voyage availability waypoints', waypointsRes.error)
    return jsonResponse({ error: 'Failed to load waypoints' }, 500)
  }

  const profilesById = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]))
  const voyagesById = new Map(((voyagesRes.data ?? []) as VoyageRow[]).map((voyage) => [voyage.id, voyage]))
  const legsById = new Map(legs.map((leg) => [leg.id, leg]))
  const waypointsById = new Map(((waypointsRes.data ?? []) as WaypointRow[]).map((waypoint) => [waypoint.id, waypoint]))

  let sent = 0
  let failed = 0

  for (const notification of rows) {
    const profile = profilesById.get(notification.recipient_profile_id)
    const voyage = voyagesById.get(notification.voyage_id)
    const language = profile?.preferred_language === 'en' ? 'en' : 'it'
    const recipientEmail = profile?.email?.trim()

    if (!recipientEmail || !voyage) {
      failed += 1
      await supabase
        .from('voyage_availability_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: !recipientEmail ? 'Recipient email missing' : 'Voyage missing',
        })
        .eq('id', notification.id)
      continue
    }

    const legLabels = [...notification.leg_ids]
      .map((id) => legsById.get(id))
      .filter((leg): leg is LegRow => Boolean(leg))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((leg) => {
        const from = localizedName(waypointsById.get(leg.from_waypoint_id), language)
        const to = localizedName(waypointsById.get(leg.to_waypoint_id), language)
        return [from, to].filter(Boolean).join(' -> ')
      })
      .filter(Boolean)

    try {
      await queueEmail({
        supabaseUrl,
        serviceRoleKey,
        recipientEmail,
        idempotencyKey: `voyage-availability:${notification.id}`,
        templateData: {
          language,
          recipientName: profile.name,
          eventType: notification.event_type,
          voyageName: localizedName(voyage, language),
          voyageUrl: `${PUBLIC_SITE_URL}/bookings?voyage=${notification.voyage_id}`,
          legs: legLabels,
        },
      })

      const now = new Date().toISOString()
      await supabase
        .from('voyage_availability_notifications')
        .update({ processed_at: now, emailed_at: now })
        .eq('id', notification.id)
      await supabase
        .from('voyage_availability_watches')
        .update({ last_notified_at: now })
        .eq('id', notification.watch_id)
      sent += 1
    } catch (error) {
      failed += 1
      console.error('Failed to queue voyage availability update', {
        notificationId: notification.id,
        error,
      })
      await supabase
        .from('voyage_availability_notifications')
        .update({
          failed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq('id', notification.id)
    }
  }

  return jsonResponse({ processed: rows.length, sent, failed })
})
