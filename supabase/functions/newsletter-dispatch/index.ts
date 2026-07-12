// deno-lint-ignore-file
import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildFromAddress,
  PUBLIC_SITE_URL,
  localizedUrl,
  SENDER_DOMAIN,
} from '../_shared/email-config.ts'
import {
  DEFAULT_SYSTEM_EMAIL_AUTOMATIONS,
  normalizeSystemEmailAutomation,
  type SystemEmailAutomationRow,
} from '../_shared/system-email-automation.ts'
import { NewsletterEmail } from '../_shared/newsletter-email.tsx'
import {
  buildMergeVariables,
  renderMergeTags,
  resolveTranslatedEntry,
  rewriteTrackedLinks,
  stripHtml,
} from '../_shared/newsletter-helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

type Claims = Record<string, unknown> | null

type NewsletterMessage = {
  id: string
  name: string
  kind: 'campaign' | 'automation'
  status: string
  automation_trigger: 'subscribed' | 'unsubscribed' | null
  automation_delay_minutes: number
  scheduled_at: string | null
  from_name: string | null
  subject_translations: Record<string, string> | null
  preheader_translations: Record<string, string> | null
  body_html_translations: Record<string, string> | null
  body_json_translations: Record<string, unknown> | null
}

type RecipientProfile = {
  name: string | null
  preferred_language: string | null
  secondary_language: string | null
}

type Recipient = {
  id: string
  email: string
  profile_id: string | null
  preferred_language: string | null
  source: string | null
  subscribed: boolean
  profiles?: RecipientProfile | RecipientProfile[] | null
  preferences?: {
    newsletter_enabled: boolean
    digest_enabled: boolean
    story_notifications_enabled: boolean
  } | null
}

type NewsletterEvent = {
  id: string
  subscriber_id: string | null
  email: string
  event_type: 'subscribed' | 'unsubscribed'
  preferred_language: string | null
  occurred_at: string
}

type ZonedDateParts = {
  weekday: number
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getRecipientProfile(
  value: Recipient['profiles']
): RecipientProfile | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }

  return {
    weekday: weekdayMap[getPart('weekday')] ?? 0,
    year: Number(getPart('year')),
    month: Number(getPart('month')),
    day: Number(getPart('day')),
    hour: Number(getPart('hour')),
    minute: Number(getPart('minute')),
  }
}

function getLocalDateKey(parts: Pick<ZonedDateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

async function processWeeklyDigestAutomation(params: {
  supabase: ReturnType<typeof createClient>
  serviceRoleKey: string
  supabaseUrl: string
}): Promise<{ queued: number; skipped: boolean }> {
  const { supabase, serviceRoleKey, supabaseUrl } = params
  const { data: automationRow, error } = await supabase
    .from('system_email_automations')
    .select('*')
    .eq('key', 'newsletter-weekly-digest')
    .maybeSingle()

  if (error) {
    throw error
  }

  const automation = normalizeSystemEmailAutomation(
    automationRow as Partial<SystemEmailAutomationRow> | null,
    'newsletter-weekly-digest'
  )

  const timeZone =
    typeof automation.config.timezone === 'string'
      ? automation.config.timezone
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-weekly-digest'].config
          .timezone as string
  const weekday =
    typeof automation.config.weekday === 'number'
      ? automation.config.weekday
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-weekly-digest'].config
          .weekday as number
  const hourLocal =
    typeof automation.config.hour_local === 'number'
      ? automation.config.hour_local
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-weekly-digest'].config
          .hour_local as number
  const minuteLocal =
    typeof automation.config.minute_local === 'number'
      ? automation.config.minute_local
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-weekly-digest'].config
          .minute_local as number

  const now = new Date()
  const nowParts = getZonedDateParts(now, timeZone)
  const currentDateKey = getLocalDateKey(nowParts)
  const lastSentParts = automation.last_sent_at
    ? getZonedDateParts(new Date(automation.last_sent_at), timeZone)
    : null
  const lastSentDateKey = lastSentParts ? getLocalDateKey(lastSentParts) : null

  await (supabase as any)
    .from('system_email_automations')
    .upsert({
      key: automation.key,
      enabled: automation.enabled,
      config: automation.config,
      last_run_at: now.toISOString(),
      last_sent_at: automation.last_sent_at ?? null,
      updated_at: new Date().toISOString(),
    })

  if (!automation.enabled) {
    return { queued: 0, skipped: true }
  }

  if (
    nowParts.weekday !== weekday ||
    nowParts.hour < hourLocal ||
    (nowParts.hour === hourLocal && nowParts.minute < minuteLocal) ||
    lastSentDateKey === currentDateKey
  ) {
    return { queued: 0, skipped: true }
  }

  const startDate = automation.last_sent_at
    ? automation.last_sent_at
    : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const response = await fetch(`${supabaseUrl}/functions/v1/send-newsletter-digest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      startDate,
      endDate: now.toISOString(),
    }),
  })

  if (!response.ok) {
    throw new Error(`Weekly digest failed: ${await response.text()}`)
  }

  const result = await response.json()
  const queued = typeof result.queued === 'number' ? result.queued : 0

  if (queued > 0) {
    await (supabase as any)
      .from('system_email_automations')
      .upsert({
        key: automation.key,
        enabled: automation.enabled,
        config: automation.config,
        last_run_at: now.toISOString(),
        last_sent_at: now.toISOString(),
        updated_at: new Date().toISOString(),
      })
  }

  return { queued, skipped: queued === 0 }
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

  const { data: isAdmin, error } = await (supabase as any).rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  })

  if (error || !isAdmin) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Forbidden' }, 403),
    }
  }

  return { ok: true }
}

async function ensureUnsubscribeToken(
  supabase: ReturnType<typeof createClient>,
  email: string
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase()
  const { data: existingToken, error: lookupError } = await (supabase as any)
    .from('email_unsubscribe_tokens')
    .select('id, token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (lookupError) {
    throw lookupError
  }

  if (existingToken && !existingToken.used_at) {
    return existingToken.token
  }

  const token = crypto.randomUUID().replaceAll('-', '')

  if (existingToken) {
    const { error: updateError } = await (supabase as any)
      .from('email_unsubscribe_tokens')
      .update({ token, used_at: null })
      .eq('id', existingToken.id)

    if (updateError) throw updateError
    return token
  }

  const { error: insertError } = await (supabase as any)
    .from('email_unsubscribe_tokens')
    .insert({ email: normalizedEmail, token, used_at: null })

  if (insertError) throw insertError

  return token
}

async function markEventProcessed(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  processingNote: string
): Promise<void> {
  await (supabase as any)
    .from('newsletter_events')
    .update({
      processed_at: new Date().toISOString(),
      processing_note: processingNote,
    })
    .eq('id', eventId)
}

async function createDeliveryRecord(
  supabase: ReturnType<typeof createClient>,
  values: Record<string, unknown>
): Promise<boolean> {
  const { error } = await (supabase as any).from('newsletter_deliveries').insert(values)

  if (!error) return true

  if (error.code === '23505') {
    return false
  }

  throw error
}

async function queueNewsletterDelivery(
  supabase: ReturnType<typeof createClient>,
  params: {
    message: NewsletterMessage
    recipientEmail: string
    recipientLanguage: string | null
    secondaryLanguage: string | null
    recipientName: string | null
    subscriberSource: string | null
    profileId: string | null
    subscriberId: string | null
    eventId: string | null
    deliveryType: 'campaign' | 'automation'
    eventType?: string | null
    suppressedEmails: Set<string>
    supabaseUrl: string
  }
): Promise<'queued' | 'suppressed' | 'skipped' | 'failed'> {
  const normalizedEmail = params.recipientEmail.trim().toLowerCase()
  const deliveryId = crypto.randomUUID()
  const messageId = crypto.randomUUID()
  const trackerToken = crypto.randomUUID().replaceAll('-', '')
  const trackingBaseUrl = `${params.supabaseUrl}/functions/v1`
  const clickTrackingBase = `${trackingBaseUrl}/newsletter-track-click?delivery=${deliveryId}&token=${trackerToken}`
  const openTrackingUrl = `${trackingBaseUrl}/newsletter-track-open?delivery=${deliveryId}&token=${trackerToken}`

  if (params.suppressedEmails.has(normalizedEmail)) {
    const inserted = await createDeliveryRecord(supabase, {
      id: deliveryId,
      newsletter_message_id: params.message.id,
      newsletter_event_id: params.eventId,
      subscriber_id: params.subscriberId,
      delivery_type: params.deliveryType,
      recipient_email: normalizedEmail,
      recipient_language: params.recipientLanguage ?? 'it',
      status: 'suppressed',
      tracker_token: trackerToken,
      message_id: messageId,
      error_message: 'Recipient is suppressed or unsubscribed.',
      metadata: {
        reason: 'suppressed_recipient',
      },
    })

    return inserted ? 'suppressed' : 'skipped'
  }

  const unsubscribeToken = await ensureUnsubscribeToken(supabase, normalizedEmail)
  const unsubscribeUrl = `${PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}&context=${encodeURIComponent(`newsletter:${params.message.id}`)}`

  const subjectEntry = resolveTranslatedEntry(
    params.message.subject_translations,
    params.recipientLanguage,
    params.secondaryLanguage
  )
  const preheaderEntry = resolveTranslatedEntry(
    params.message.preheader_translations,
    params.recipientLanguage,
    params.secondaryLanguage
  )
  const bodyEntry = resolveTranslatedEntry(
    params.message.body_html_translations,
    params.recipientLanguage,
    params.secondaryLanguage
  )

  const mergeVariables = buildMergeVariables({
    userName: params.recipientName,
    userEmail: normalizedEmail,
    preferredLanguage: params.recipientLanguage,
    profileId: params.profileId,
    siteUrl: localizedUrl(params.recipientLanguage, '/'),
    unsubscribeUrl,
    messageName: params.message.name,
    deliveryType: params.deliveryType,
    eventType: params.eventType,
    subscriberSource: params.subscriberSource,
  })

  const renderedSubject = renderMergeTags(subjectEntry.value, mergeVariables)
  const renderedPreheader = renderMergeTags(preheaderEntry.value, mergeVariables)
  const renderedBody = renderMergeTags(bodyEntry.value, mergeVariables)

  if (!renderedSubject.trim() || !renderedBody.trim()) {
    const inserted = await createDeliveryRecord(supabase, {
      id: deliveryId,
      newsletter_message_id: params.message.id,
      newsletter_event_id: params.eventId,
      subscriber_id: params.subscriberId,
      delivery_type: params.deliveryType,
      recipient_email: normalizedEmail,
      recipient_language: bodyEntry.language,
      status: 'failed',
      tracker_token: trackerToken,
      message_id: messageId,
      error_message: 'Missing translated subject or body for recipient language.',
      metadata: {
        reason: 'missing_translation',
      },
    })

    return inserted ? 'failed' : 'skipped'
  }

  const trackedBodyHtml = rewriteTrackedLinks(renderedBody, clickTrackingBase)
  const html = await renderAsync(
    React.createElement(NewsletterEmail, {
      lang: bodyEntry.language,
      preheader: renderedPreheader,
      bodyHtml: trackedBodyHtml,
      unsubscribeUrl,
      trackingPixelUrl: openTrackingUrl,
    })
  )

  const text = `${stripHtml(renderedBody)}\n\n${unsubscribeUrl}`

  const inserted = await createDeliveryRecord(supabase, {
    id: deliveryId,
    newsletter_message_id: params.message.id,
    newsletter_event_id: params.eventId,
    subscriber_id: params.subscriberId,
    delivery_type: params.deliveryType,
    recipient_email: normalizedEmail,
    recipient_language: bodyEntry.language,
    status: 'queued',
    tracker_token: trackerToken,
    message_id: messageId,
    metadata: {
      subject: renderedSubject,
      preheader: renderedPreheader,
    },
  })

  if (!inserted) {
    return 'skipped'
  }

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      run_id: crypto.randomUUID(),
      to: normalizedEmail,
      from: buildFromAddress(params.message.from_name),
      sender_domain: SENDER_DOMAIN,
      subject: renderedSubject,
      html,
      text,
      purpose: 'newsletter',
      label: `newsletter:${params.message.name}`,
      idempotency_key: deliveryId,
      unsubscribe_token: unsubscribeToken,
      message_id: messageId,
      metadata: {
        newsletter_delivery_id: deliveryId,
        newsletter_message_id: params.message.id,
      },
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue newsletter email', enqueueError)
    await supabase
      .from('newsletter_deliveries')
      .update({
        status: 'failed',
        error_message: 'Failed to enqueue email.',
      })
      .eq('id', deliveryId)

    return 'failed'
  }

  return 'queued'
}

async function loadActiveRecipients(
  supabase: ReturnType<typeof createClient>
): Promise<Recipient[]> {
  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .select(
      'id, email, profile_id, preferred_language, source, subscribed, profiles:profiles!newsletter_subscribers_profile_id_fkey(name, preferred_language, secondary_language)'
    )
    .eq('subscribed', true)

  if (error) throw error
  const recipients = (data ?? []) as Recipient[]
  if (!recipients.length) return recipients

  const emails = recipients.map((recipient) => recipient.email.toLowerCase())
  const { data: preferenceRows, error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .select('email, newsletter_enabled, digest_enabled, story_notifications_enabled')
    .in('email', emails)

  if (preferenceError) {
    throw preferenceError
  }

  const preferenceMap = new Map(
    (preferenceRows ?? []).map((row) => [
      row.email.toLowerCase(),
      {
        newsletter_enabled: row.newsletter_enabled,
        digest_enabled: row.digest_enabled,
        story_notifications_enabled: row.story_notifications_enabled,
      },
    ])
  )

  return recipients.filter((recipient) => {
    const preferences = preferenceMap.get(recipient.email.toLowerCase()) ?? null
    recipient.preferences = preferences
    return preferences ? preferences.newsletter_enabled : true
  })
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

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const targetMessageId =
    typeof body.messageId === 'string' ? body.messageId : null
  const processEvents =
    typeof body.processEvents === 'boolean'
      ? body.processEvents
      : !targetMessageId

  const now = new Date()
  const nowIso = now.toISOString()
  const summary = {
    campaignsQueued: 0,
    automationsQueued: 0,
    suppressed: 0,
    failed: 0,
    skipped: 0,
    processedEvents: 0,
  }

  const { data: suppressedRows } = await supabase
    .from('suppressed_emails')
    .select('email')

  const suppressedEmails = new Set(
    (suppressedRows ?? []).map((row) => row.email.toLowerCase())
  )

  const dueCampaignsQuery = supabase
    .from('newsletter_messages')
    .select('*')
    .eq('kind', 'campaign')
    .in('status', ['scheduled', 'sending'])
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })

  if (targetMessageId) {
    dueCampaignsQuery.eq('id', targetMessageId)
  }

  const { data: dueCampaigns, error: campaignsError } = await dueCampaignsQuery
  if (campaignsError) {
    console.error('Failed to load scheduled campaigns', campaignsError)
    return jsonResponse({ error: 'Failed to load campaigns' }, 500)
  }

  const recipients = await loadActiveRecipients(supabase)

  for (const campaign of (dueCampaigns ?? []) as NewsletterMessage[]) {
    await supabase
      .from('newsletter_messages')
      .update({ status: 'sending', last_queued_at: nowIso })
      .eq('id', campaign.id)

    const { data: existingDeliveries } = await supabase
      .from('newsletter_deliveries')
      .select('recipient_email')
      .eq('newsletter_message_id', campaign.id)
      .is('newsletter_event_id', null)

    const alreadyQueued = new Set(
      (existingDeliveries ?? []).map((row) => row.recipient_email.toLowerCase())
    )

    for (const recipient of recipients) {
      const normalizedEmail = recipient.email.toLowerCase()
      if (alreadyQueued.has(normalizedEmail)) {
        summary.skipped++
        continue
      }

      const profile = getRecipientProfile(recipient.profiles)
      const result = await queueNewsletterDelivery(supabase, {
        message: campaign,
        recipientEmail: normalizedEmail,
        recipientLanguage:
          profile?.preferred_language ?? recipient.preferred_language,
        secondaryLanguage: profile?.secondary_language ?? null,
        recipientName: profile?.name ?? null,
        subscriberSource: recipient.source ?? null,
        profileId: recipient.profile_id,
        subscriberId: recipient.id,
        eventId: null,
        deliveryType: 'campaign',
        suppressedEmails,
        supabaseUrl,
      })

      if (result === 'queued') summary.campaignsQueued++
      if (result === 'suppressed') summary.suppressed++
      if (result === 'failed') summary.failed++
      if (result === 'skipped') summary.skipped++
    }

    await supabase
      .from('newsletter_messages')
      .update({
        status: 'sent',
        sent_at: nowIso,
        last_queued_at: nowIso,
      })
      .eq('id', campaign.id)
  }

  if (processEvents) {
    const { data: activeAutomations, error: automationError } = await supabase
      .from('newsletter_messages')
      .select('*')
      .eq('kind', 'automation')
      .eq('status', 'active')

    if (automationError) {
      console.error('Failed to load newsletter automations', automationError)
      return jsonResponse({ error: 'Failed to load automations' }, 500)
    }

    const { data: pendingEvents, error: eventsError } = await supabase
      .from('newsletter_events')
      .select('id, subscriber_id, email, event_type, preferred_language, occurred_at')
      .is('processed_at', null)
      .order('occurred_at', { ascending: true })
      .limit(200)

    if (eventsError) {
      console.error('Failed to load pending newsletter events', eventsError)
      return jsonResponse({ error: 'Failed to load events' }, 500)
    }

    for (const event of (pendingEvents ?? []) as NewsletterEvent[]) {
      const matchingAutomations = ((activeAutomations ?? []) as NewsletterMessage[]).filter(
        (automation) => automation.automation_trigger === event.event_type
      )

      if (matchingAutomations.length === 0) {
        await markEventProcessed(supabase, event.id, 'No active automation.')
        summary.processedEvents++
        continue
      }

      const { data: existingEventDeliveries } = await supabase
        .from('newsletter_deliveries')
        .select('newsletter_message_id')
        .eq('newsletter_event_id', event.id)

      const existingAutomationIds = new Set(
        (existingEventDeliveries ?? []).map(
          (delivery) => delivery.newsletter_message_id
        )
      )

      const { data: subscriber } = await supabase
        .from('newsletter_subscribers')
        .select(
          'id, email, profile_id, preferred_language, source, subscribed, profiles:profiles!newsletter_subscribers_profile_id_fkey(name, preferred_language, secondary_language)'
        )
        .eq('email', event.email.toLowerCase())
        .maybeSingle()

      const { data: preferenceRow } = await supabase
        .from('email_notification_preferences')
        .select('newsletter_enabled, digest_enabled, story_notifications_enabled')
        .eq('email', event.email.toLowerCase())
        .maybeSingle()

      const canReceiveNewsletter = preferenceRow
        ? preferenceRow.newsletter_enabled
        : true

      let hasPendingAutomation = false
      let processedForEvent = 0

      for (const automation of matchingAutomations) {
        if (existingAutomationIds.has(automation.id)) {
          processedForEvent++
          continue
        }

        const scheduledFor = new Date(event.occurred_at)
        scheduledFor.setMinutes(
          scheduledFor.getMinutes() + (automation.automation_delay_minutes ?? 0)
        )

        if (scheduledFor > now) {
          hasPendingAutomation = true
          continue
        }

        if (
          event.event_type === 'unsubscribed' ||
          suppressedEmails.has(event.email.toLowerCase()) ||
          !subscriber?.subscribed ||
          !canReceiveNewsletter
        ) {
          const inserted = await createDeliveryRecord(supabase, {
            id: crypto.randomUUID(),
            newsletter_message_id: automation.id,
            newsletter_event_id: event.id,
            subscriber_id: subscriber?.id ?? null,
            delivery_type: 'automation',
            recipient_email: event.email.toLowerCase(),
            recipient_language:
              subscriber?.preferred_language ?? event.preferred_language ?? 'it',
            status: 'suppressed',
            tracker_token: crypto.randomUUID().replaceAll('-', ''),
            message_id: crypto.randomUUID(),
            error_message: 'Automation skipped for unsubscribed or suppressed recipient.',
            metadata: {
              reason: 'recipient_not_sendable',
            },
          })

          if (inserted) {
            summary.suppressed++
            processedForEvent++
          }
          continue
        }

        const profile = getRecipientProfile(subscriber.profiles)
        const result = await queueNewsletterDelivery(supabase, {
          message: automation,
          recipientEmail: event.email.toLowerCase(),
          recipientLanguage:
            profile?.preferred_language ??
            subscriber.preferred_language ??
            event.preferred_language,
          secondaryLanguage: profile?.secondary_language ?? null,
          recipientName: profile?.name ?? null,
          subscriberSource: subscriber.source ?? null,
          profileId: subscriber.profile_id,
          subscriberId: subscriber.id,
          eventId: event.id,
          deliveryType: 'automation',
          eventType: event.event_type,
          suppressedEmails,
          supabaseUrl,
        })

        if (result === 'queued') {
          summary.automationsQueued++
          processedForEvent++
        }
        if (result === 'suppressed') {
          summary.suppressed++
          processedForEvent++
        }
        if (result === 'failed') {
          summary.failed++
          processedForEvent++
        }
        if (result === 'skipped') {
          summary.skipped++
          processedForEvent++
        }
      }

      if (!hasPendingAutomation) {
        await markEventProcessed(
          supabase,
          event.id,
          `Processed ${processedForEvent} automation(s).`
        )
        summary.processedEvents++
      }
    }
  }

  try {
    const weeklyDigestResult = await processWeeklyDigestAutomation({
      supabase,
      serviceRoleKey,
      supabaseUrl,
    })

    if (weeklyDigestResult.queued > 0) {
      summary.campaignsQueued += weeklyDigestResult.queued
    }
  } catch (error) {
    console.error('Failed to process weekly digest automation', error)
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/dispatch-engagement-notifications`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ limit: 250 }),
      }
    )

    if (!response.ok) {
      console.error(
        'Failed to process engagement notification dispatch',
        await response.text()
      )
    }
  } catch (error) {
    console.error('Failed to invoke engagement notification dispatch', error)
  }

  return jsonResponse({ success: true, ...summary })
})
