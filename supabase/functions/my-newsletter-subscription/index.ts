import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  hasAnyEmailNotificationsEnabled,
  hasAnyNewsletterNotificationsEnabled,
  normalizeEmailNotificationPreferences,
} from '../_shared/email-preferences.ts'
import { normalizeLanguage } from '../_shared/newsletter-helpers.ts'
import { activateNewsletterSubscription } from '../_shared/newsletter-subscription-activation.ts'

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

  const authHeader = req.headers.get('Authorization')
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null

  if (!accessToken) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken)

  if (authError || !user?.id || !user.email) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const normalizedEmail = user.email.trim().toLowerCase()
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().slice(0, 64)
      : 'profile'

  const [{ data: profile }, { data: preferenceRow }, { data: existingSubscriber }, { data: suppressionRow }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, preferred_language')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('email_notification_preferences')
        .select('newsletter_enabled, digest_enabled, story_notifications_enabled')
        .eq('email', normalizedEmail)
        .maybeSingle(),
      supabase
        .from('newsletter_subscribers')
        .select('id, subscribed, preferred_language, profile_id')
        .eq('email', normalizedEmail)
        .maybeSingle(),
      supabase
        .from('suppressed_emails')
        .select('reason')
        .eq('email', normalizedEmail)
        .eq('reason', 'unsubscribe')
        .maybeSingle(),
    ])

  const currentPreferences = normalizeEmailNotificationPreferences(preferenceRow)
  const currentSubscribed = preferenceRow
    ? hasAnyNewsletterNotificationsEnabled(currentPreferences)
    : Boolean(existingSubscriber?.subscribed)

  if (typeof body.subscribed !== 'boolean') {
    return jsonResponse({
      success: true,
      email: normalizedEmail,
      subscribed: currentSubscribed,
      preferences: currentPreferences,
      globallySuppressed: Boolean(suppressionRow),
    })
  }

  const nextSubscribed = body.subscribed

  if (nextSubscribed) {
    try {
      const result = await activateNewsletterSubscription({
        supabase,
        supabaseUrl,
        serviceRoleKey,
        email: normalizedEmail,
        profileId: profile?.id ?? user.id,
        preferredLanguage: profile?.preferred_language ?? null,
        recipientName: profile?.name ?? null,
        source,
        markAllConfirmationTokensUsed: true,
      })

      return jsonResponse({
        success: true,
        email: result.email,
        subscribed: true,
        preferences: {
          ...currentPreferences,
          newsletter_enabled: true,
          digest_enabled: true,
        },
        globallySuppressed: false,
      })
    } catch (error) {
      console.error('Failed to activate own newsletter subscription', error)
      return jsonResponse({ error: 'Failed to update newsletter subscription' }, 500)
    }
  }

  const nextPreferences = normalizeEmailNotificationPreferences({
    ...currentPreferences,
    newsletter_enabled: false,
    digest_enabled: false,
  })
  const previousNewsletterEnabled = hasAnyNewsletterNotificationsEnabled(currentPreferences)
  const shouldGloballySuppress = !hasAnyEmailNotificationsEnabled(nextPreferences)
  const now = new Date().toISOString()

  const { error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .upsert({
      email: normalizedEmail,
      ...nextPreferences,
      updated_at: now,
    })

  if (preferenceError) {
    console.error('Failed to update own email preferences', preferenceError)
    return jsonResponse({ error: 'Failed to update newsletter subscription' }, 500)
  }

  if (shouldGloballySuppress) {
    const { error: suppressError } = await supabase
      .from('suppressed_emails')
      .upsert(
        {
          email: normalizedEmail,
          reason: 'unsubscribe',
          metadata: {
            source,
            preferences: nextPreferences,
          },
        },
        { onConflict: 'email' }
      )

    if (suppressError) {
      console.error('Failed to suppress unsubscribed email', suppressError)
      return jsonResponse({ error: 'Failed to update newsletter subscription' }, 500)
    }
  } else {
    const { error: unsuppressError } = await supabase
      .from('suppressed_emails')
      .delete()
      .eq('email', normalizedEmail)
      .eq('reason', 'unsubscribe')

    if (unsuppressError) {
      console.error('Failed to clear unsubscribe suppression', unsuppressError)
      return jsonResponse({ error: 'Failed to update newsletter subscription' }, 500)
    }
  }

  if (existingSubscriber?.id) {
    const { error: subscriberError } = await supabase
      .from('newsletter_subscribers')
      .update({
        profile_id: profile?.id ?? existingSubscriber.profile_id ?? user.id,
        email: normalizedEmail,
        preferred_language:
          profile?.preferred_language ??
          existingSubscriber.preferred_language ??
          normalizeLanguage(profile?.preferred_language ?? null),
        subscribed: false,
        source,
        unsubscribed_at: now,
      })
      .eq('id', existingSubscriber.id)

    if (subscriberError) {
      console.error('Failed to update subscriber on own unsubscribe', subscriberError)
      return jsonResponse({ error: 'Failed to update newsletter subscription' }, 500)
    }
  }

  if (previousNewsletterEnabled) {
    const { error: eventError } = await supabase.from('newsletter_events').insert({
      subscriber_id: existingSubscriber?.id ?? null,
      email: normalizedEmail,
      event_type: 'unsubscribed',
      preferred_language: normalizeLanguage(profile?.preferred_language ?? null),
      occurred_at: now,
    })

    if (eventError) {
      console.error('Failed to record own unsubscribe event', eventError)
    }
  }

  return jsonResponse({
    success: true,
    email: normalizedEmail,
    subscribed: false,
    preferences: nextPreferences,
    globallySuppressed: shouldGloballySuppress,
  })
})
