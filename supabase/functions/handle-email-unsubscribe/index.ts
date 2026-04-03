import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  hasAnyEmailNotificationsEnabled,
  hasAnyNewsletterNotificationsEnabled,
  normalizeEmailNotificationPreferences,
  type EmailNotificationPreferences,
} from '../_shared/email-preferences.ts'
import { normalizeLanguage } from '../_shared/newsletter-helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseReasonCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized.slice(0, 64) : null
}

function parseReasonText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, 1000) : null
}

function parsePreferencesFromBody(value: unknown): Partial<EmailNotificationPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const input = value as Record<string, unknown>

  return {
    newsletter_enabled:
      typeof input.newsletter_enabled === 'boolean'
        ? input.newsletter_enabled
        : typeof input.newsletterEnabled === 'boolean'
          ? input.newsletterEnabled
          : undefined,
    digest_enabled:
      typeof input.digest_enabled === 'boolean'
        ? input.digest_enabled
        : typeof input.digestEnabled === 'boolean'
          ? input.digestEnabled
          : undefined,
    story_notifications_enabled:
      typeof input.story_notifications_enabled === 'boolean'
        ? input.story_notifications_enabled
        : typeof input.storyNotificationsEnabled === 'boolean'
          ? input.storyNotificationsEnabled
          : undefined,
    like_notifications_frequency:
      typeof input.like_notifications_frequency === 'string'
        ? input.like_notifications_frequency
        : typeof input.likeNotificationsFrequency === 'string'
          ? input.likeNotificationsFrequency
          : undefined,
    comment_notifications_frequency:
      typeof input.comment_notifications_frequency === 'string'
        ? input.comment_notifications_frequency
        : typeof input.commentNotificationsFrequency === 'string'
          ? input.commentNotificationsFrequency
          : undefined,
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')
  let context = url.searchParams.get('context')
  let mailboxOneClick = false
  let requestBody: Record<string, unknown> = {}

  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      mailboxOneClick = params.get('List-Unsubscribe') === 'One-Click'
      if (!mailboxOneClick) {
        const formToken = params.get('token')
        if (formToken) {
          token = formToken
        }
      }
    } else {
      try {
        requestBody = await req.json()
        if (typeof requestBody.token === 'string') {
          token = requestBody.token
        }
        if (typeof requestBody.context === 'string' && requestBody.context.trim()) {
          context = requestBody.context.trim().slice(0, 128)
        }
      } catch {
        requestBody = {}
      }
    }
  }

  if (!token) {
    return jsonResponse({ error: 'Token is required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: tokenRecord, error: lookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  const email = tokenRecord.email.toLowerCase()

  const [{ data: preferenceRow }, { data: profile }, { data: activeSuppression }] =
    await Promise.all([
      supabase
        .from('email_notification_preferences')
        .select(
          'newsletter_enabled, digest_enabled, story_notifications_enabled, like_notifications_frequency, comment_notifications_frequency'
        )
        .eq('email', email)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('id, preferred_language')
        .eq('email', email)
        .maybeSingle(),
      supabase
        .from('suppressed_emails')
        .select('reason')
        .eq('email', email)
        .maybeSingle(),
    ])

  const { data: existingSubscriber } = await supabase
    .from('newsletter_subscribers')
    .select('id, preferred_language')
    .eq('email', email)
    .maybeSingle()

  const currentPreferences = normalizeEmailNotificationPreferences(preferenceRow)
  const { count: storySubscriptionCount } = profile?.id
    ? await supabase
        .from('story_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id)
    : { count: 0 }

  const language = normalizeLanguage(profile?.preferred_language ?? null)

  if (req.method === 'GET') {
    return jsonResponse({
      valid: true,
      email,
      context,
      language,
      preferences: currentPreferences,
      storySubscriptionCount: storySubscriptionCount ?? 0,
      globallySuppressed: Boolean(activeSuppression),
    })
  }

  const nextPreferences = mailboxOneClick
    ? normalizeEmailNotificationPreferences({
        newsletter_enabled: false,
        digest_enabled: false,
        story_notifications_enabled: false,
      })
    : normalizeEmailNotificationPreferences({
        ...currentPreferences,
        ...parsePreferencesFromBody(requestBody.preferences),
      })

  const previousNewsletterEnabled =
    currentPreferences.newsletter_enabled || currentPreferences.digest_enabled
  const nextNewsletterEnabled =
    nextPreferences.newsletter_enabled || nextPreferences.digest_enabled
  const preferencesChanged =
    currentPreferences.newsletter_enabled !== nextPreferences.newsletter_enabled ||
    currentPreferences.digest_enabled !== nextPreferences.digest_enabled ||
    currentPreferences.story_notifications_enabled !==
      nextPreferences.story_notifications_enabled
  const shouldGloballySuppress = !hasAnyEmailNotificationsEnabled(nextPreferences)
  const reasonCode =
    mailboxOneClick
      ? 'mailbox_one_click'
      : parseReasonCode(requestBody.reasonCode ?? requestBody.reason_code)
  const reasonText = parseReasonText(requestBody.reasonText ?? requestBody.reason_text)
  const source =
    mailboxOneClick
      ? 'mailbox_one_click'
      : typeof requestBody.source === 'string' && requestBody.source.trim()
        ? requestBody.source.trim().slice(0, 64)
        : 'preferences_page'

  const { error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .upsert({
      email,
      ...nextPreferences,
      updated_at: new Date().toISOString(),
    })

  if (preferenceError) {
    console.error('Failed to save email notification preferences', preferenceError)
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }

  if (shouldGloballySuppress) {
    const { error: suppressError } = await supabase
      .from('suppressed_emails')
      .upsert(
        {
          email,
          reason: 'unsubscribe',
          metadata: {
            source,
            context,
            preferences: nextPreferences,
          },
        },
        { onConflict: 'email' },
      )

    if (suppressError) {
      console.error('Failed to suppress email', suppressError)
      return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
    }
  } else {
    const { error: unsuppressError } = await supabase
      .from('suppressed_emails')
      .delete()
      .eq('email', email)
      .eq('reason', 'unsubscribe')

    if (unsuppressError) {
      console.error('Failed to remove unsubscribe suppression', unsuppressError)
      return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
    }
  }

  const nextSubscriberPayload = {
    email,
    profile_id: profile?.id ?? null,
    preferred_language: existingSubscriber?.preferred_language ?? language,
    subscribed: hasAnyNewsletterNotificationsEnabled(nextPreferences),
    source,
    unsubscribed_at: nextNewsletterEnabled ? null : new Date().toISOString(),
  }

  const subscriberMutation =
    existingSubscriber
      ? supabase
          .from('newsletter_subscribers')
          .update(nextSubscriberPayload)
          .eq('email', email)
      : nextNewsletterEnabled
        ? supabase.from('newsletter_subscribers').insert(nextSubscriberPayload)
        : Promise.resolve({ error: null })

  const { error: subscriberError } = await subscriberMutation

  if (subscriberError) {
    console.error('Failed to update newsletter subscriber after unsubscribe', {
      error: subscriberError,
      email,
    })
  }

  if (previousNewsletterEnabled !== nextNewsletterEnabled) {
    const { data: subscriber } = await supabase
      .from('newsletter_subscribers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    const { error: eventError } = await supabase.from('newsletter_events').insert({
      subscriber_id: subscriber?.id ?? null,
      email,
      event_type: nextNewsletterEnabled ? 'subscribed' : 'unsubscribed',
      preferred_language: language,
      occurred_at: new Date().toISOString(),
    })

    if (eventError) {
      console.error('Failed to record newsletter unsubscribe event', eventError)
    }
  }

  if (reasonCode || reasonText || mailboxOneClick || preferencesChanged) {
    const { error: feedbackError } = await supabase
      .from('newsletter_unsubscribe_feedback')
      .insert({
        email,
        profile_id: profile?.id ?? null,
        source,
        reason_code: reasonCode,
        reason_text: reasonText,
        unsubscribe_scope: nextPreferences,
        message_context: {
          context,
          token_id: tokenRecord.id,
          mailbox_one_click: mailboxOneClick,
        },
      })

    if (feedbackError) {
      console.error('Failed to record unsubscribe feedback', feedbackError)
    }
  }

  await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRecord.id)

  return jsonResponse({
    success: true,
    email,
    preferences: nextPreferences,
    globallySuppressed: shouldGloballySuppress,
  })
})
