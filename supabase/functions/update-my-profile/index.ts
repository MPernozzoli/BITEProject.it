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

function readString(value: unknown, maxLength: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

function readNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, maxLength)
  return normalized || null
}

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = (error.message ?? '').toLowerCase()
  return (
    error.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('relation') && message.includes('not exist')
  )
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const normalizedEmail = user.email.trim().toLowerCase()
  const preferredLanguage = normalizeLanguage(body.preferred_language)
  const secondaryLanguage = readNullableString(body.secondary_language, 8)
  const subscribed = body.newsletter_subscribed === true
  const now = new Date().toISOString()

  const profilePayload = {
    id: user.id,
    email: normalizedEmail,
    name: readString(
      body.name,
      120,
      typeof user.user_metadata?.name === 'string'
        ? user.user_metadata.name
        : typeof user.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : normalizedEmail.split('@')[0]
    ),
    bio: readNullableString(body.bio, 5000),
    avatar_url: readNullableString(body.avatar_url, 2048),
    preferred_language: preferredLanguage,
    secondary_language: secondaryLanguage,
    social_instagram: readNullableString(body.social_instagram, 255),
    social_youtube: readNullableString(body.social_youtube, 255),
    social_tiktok: readNullableString(body.social_tiktok, 255),
    social_facebook: readNullableString(body.social_facebook, 255),
    social_x: readNullableString(body.social_x, 255),
    social_linkedin: readNullableString(body.social_linkedin, 255),
    social_website: readNullableString(body.social_website, 2048),
    social_seapeople: readNullableString(body.social_seapeople, 255),
    updated_at: now,
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' })

  if (profileError) {
    console.error('Failed to save own profile', profileError)
    return jsonResponse({ error: 'Failed to save profile' }, 500)
  }

  const [{ data: preferenceRow, error: preferenceLookupError }, { data: existingSubscriber }] = await Promise.all([
    supabase
      .from('email_notification_preferences')
      .select('newsletter_enabled, digest_enabled, story_notifications_enabled')
      .eq('email', normalizedEmail)
      .maybeSingle(),
    supabase
      .from('newsletter_subscribers')
      .select('id, profile_id')
      .eq('email', normalizedEmail)
      .maybeSingle(),
  ])

  if (subscribed) {
    try {
      await activateNewsletterSubscription({
        supabase,
        supabaseUrl,
        serviceRoleKey,
        email: normalizedEmail,
        profileId: user.id,
        preferredLanguage: preferredLanguage,
        recipientName: profilePayload.name,
        source: 'profile',
        markAllConfirmationTokensUsed: true,
      })
    } catch (error) {
      console.error('Failed to activate newsletter during profile save', error)
      return jsonResponse({ error: 'Failed to save newsletter settings' }, 500)
    }
  } else {
    const preferencesTableAvailable = !isMissingRelationError(preferenceLookupError)
    const currentPreferences = normalizeEmailNotificationPreferences(
      preferencesTableAvailable ? preferenceRow : null
    )
    const nextPreferences = normalizeEmailNotificationPreferences({
      ...currentPreferences,
      newsletter_enabled: false,
      digest_enabled: false,
    })
    const previousNewsletterEnabled =
      hasAnyNewsletterNotificationsEnabled(currentPreferences)
    const shouldGloballySuppress = !hasAnyEmailNotificationsEnabled(nextPreferences)

    if (preferencesTableAvailable) {
      const { error: preferenceError } = await supabase
        .from('email_notification_preferences')
        .upsert({
          email: normalizedEmail,
          ...nextPreferences,
          updated_at: now,
        })

      if (preferenceError && !isMissingRelationError(preferenceError)) {
        console.error('Failed to update newsletter preferences during profile save', preferenceError)
        return jsonResponse({ error: 'Failed to save newsletter settings' }, 500)
      }
    }

    if (shouldGloballySuppress) {
      const { error: suppressError } = await supabase
        .from('suppressed_emails')
        .upsert(
          {
            email: normalizedEmail,
            reason: 'unsubscribe',
            metadata: {
              source: 'profile',
              preferences: nextPreferences,
            },
          },
          { onConflict: 'email' }
        )

      if (suppressError) {
        console.error('Failed to suppress email during profile save', suppressError)
        return jsonResponse({ error: 'Failed to save newsletter settings' }, 500)
      }
    } else {
      const { error: unsuppressError } = await supabase
        .from('suppressed_emails')
        .delete()
        .eq('email', normalizedEmail)
        .eq('reason', 'unsubscribe')

      if (unsuppressError) {
        console.error('Failed to clear suppression during profile save', unsuppressError)
        return jsonResponse({ error: 'Failed to save newsletter settings' }, 500)
      }
    }

    if (existingSubscriber?.id) {
      const { error: subscriberError } = await supabase
        .from('newsletter_subscribers')
        .update({
          email: normalizedEmail,
          profile_id: user.id,
          subscribed: false,
        })
        .eq('id', existingSubscriber.id)

      if (subscriberError) {
        console.error('Failed to update subscriber during profile save', subscriberError)
        return jsonResponse({ error: 'Failed to save newsletter settings' }, 500)
      }
    }

    if (previousNewsletterEnabled) {
      const { error: eventError } = await supabase.from('newsletter_events').insert({
        subscriber_id: existingSubscriber?.id ?? null,
        email: normalizedEmail,
        event_type: 'unsubscribed',
        preferred_language: preferredLanguage,
        occurred_at: now,
      })

      if (eventError) {
        console.error('Failed to record unsubscribe during profile save', eventError)
      }
    }
  }

  return jsonResponse({
    success: true,
    profile: {
      ...profilePayload,
      created_at: now,
    },
  })
})
