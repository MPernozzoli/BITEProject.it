import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  hasAnyNewsletterNotificationsEnabled,
  normalizeEmailNotificationPreferences,
} from './email-preferences.ts'
import { normalizeLanguage } from './newsletter-helpers.ts'
import { normalizeSystemEmailAutomation } from './system-email-automation.ts'

type ActivationOptions = {
  supabase: ReturnType<typeof createClient>
  supabaseUrl: string
  serviceRoleKey: string
  email: string
  profileId?: string | null
  preferredLanguage?: string | null
  recipientName?: string | null
  source?: string | null
  confirmationTokenId?: string | null
  markAllConfirmationTokensUsed?: boolean
}

type ActivationResult = {
  email: string
  language: string
  alreadySubscribed: boolean
}

export async function activateNewsletterSubscription({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  email,
  profileId = null,
  preferredLanguage = null,
  recipientName = null,
  source = null,
  confirmationTokenId = null,
  markAllConfirmationTokensUsed = false,
}: ActivationOptions): Promise<ActivationResult> {
  const normalizedEmail = email.trim().toLowerCase()
  const [
    { data: profile },
    { data: existingSubscriber },
    { data: preferenceRow, error: preferenceLookupError },
    { data: welcomeAutomationRow, error: welcomeAutomationError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, preferred_language')
      .eq('email', normalizedEmail)
      .maybeSingle(),
    supabase
      .from('newsletter_subscribers')
      .select('id, preferred_language, subscribed, profile_id')
      .eq('email', normalizedEmail)
      .maybeSingle(),
    supabase
      .from('email_notification_preferences')
      .select('newsletter_enabled, digest_enabled, story_notifications_enabled')
      .eq('email', normalizedEmail)
      .maybeSingle(),
    supabase
      .from('system_email_automations')
      .select('*')
      .eq('key', 'newsletter-welcome')
      .maybeSingle(),
  ])

  if (preferenceLookupError) {
    throw new Error(
      `Failed to load email preferences for activation: ${preferenceLookupError.message}`
    )
  }

  if (welcomeAutomationError) {
    throw new Error(
      `Failed to load welcome automation for activation: ${welcomeAutomationError.message}`
    )
  }

  const language = normalizeLanguage(
    preferredLanguage ?? profile?.preferred_language ?? existingSubscriber?.preferred_language
  )
  const nextPreferences = normalizeEmailNotificationPreferences({
    ...(preferenceRow ?? {}),
    newsletter_enabled: true,
    digest_enabled: true,
  })
  const now = new Date().toISOString()
  const wasSubscribed = Boolean(existingSubscriber?.subscribed)

  const { error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .upsert({
      email: normalizedEmail,
      ...nextPreferences,
      updated_at: now,
    })

  if (preferenceError) {
    throw new Error(
      `Failed to activate email preferences for ${normalizedEmail}: ${preferenceError.message}`
    )
  }

  const subscriberPayload = {
    email: normalizedEmail,
    profile_id: profileId ?? profile?.id ?? existingSubscriber?.profile_id ?? null,
    preferred_language:
      preferredLanguage ??
      profile?.preferred_language ??
      existingSubscriber?.preferred_language ??
      language,
    subscribed: hasAnyNewsletterNotificationsEnabled(nextPreferences),
    source: source || 'homepage',
    unsubscribed_at: null,
  }

  const subscriberMutation = existingSubscriber
    ? supabase
        .from('newsletter_subscribers')
        .update(subscriberPayload)
        .eq('id', existingSubscriber.id)
    : supabase.from('newsletter_subscribers').insert(subscriberPayload)

  const { error: subscriberError } = await subscriberMutation

  if (subscriberError) {
    throw new Error(
      `Failed to activate newsletter subscriber for ${normalizedEmail}: ${subscriberError.message}`
    )
  }

  const { error: suppressionError } = await supabase
    .from('suppressed_emails')
    .delete()
    .eq('email', normalizedEmail)
    .eq('reason', 'unsubscribe')

  if (suppressionError) {
    console.error('Failed to clear unsubscribe suppression on activation', suppressionError)
  }

  const subscriberId = existingSubscriber?.id
    ? existingSubscriber.id
    : (
        await supabase
          .from('newsletter_subscribers')
          .select('id')
          .eq('email', normalizedEmail)
          .maybeSingle()
      ).data?.id ?? null

  if (!wasSubscribed) {
    const { error: eventError } = await supabase.from('newsletter_events').insert({
      subscriber_id: subscriberId,
      email: normalizedEmail,
      event_type: 'subscribed',
      preferred_language: subscriberPayload.preferred_language,
      occurred_at: now,
    })

    if (eventError) {
      console.error('Failed to record subscribe event on activation', eventError)
    }
  }

  if (confirmationTokenId) {
    const { error: tokenUpdateError } = await supabase
      .from('newsletter_confirmation_tokens')
      .update({ used_at: now })
      .eq('id', confirmationTokenId)

    if (tokenUpdateError) {
      console.error('Failed to mark confirmation token as used', tokenUpdateError)
    }
  } else if (markAllConfirmationTokensUsed) {
    const { error: tokenUpdateError } = await supabase
      .from('newsletter_confirmation_tokens')
      .update({ used_at: now })
      .eq('email', normalizedEmail)
      .is('used_at', null)

    if (tokenUpdateError) {
      console.error('Failed to mark pending confirmation tokens as used', tokenUpdateError)
    }
  }

  const welcomeAutomation = normalizeSystemEmailAutomation(
    welcomeAutomationRow,
    'newsletter-welcome'
  )

  if (welcomeAutomation.enabled && !wasSubscribed) {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-transactional-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          templateName: 'newsletter-welcome',
          recipientEmail: normalizedEmail,
          idempotencyKey: `newsletter-welcome:${normalizedEmail}:${crypto.randomUUID()}`,
          templateData: {
            language: subscriberPayload.preferred_language,
            recipientName: recipientName ?? profile?.name ?? null,
          },
        }),
      }
    )

    if (!response.ok) {
      console.error('Failed to queue welcome email after activation', await response.text())
    } else {
      const { error: automationUpdateError } = await supabase
        .from('system_email_automations')
        .upsert({
          key: welcomeAutomation.key,
          enabled: welcomeAutomation.enabled,
          config: welcomeAutomation.config,
          last_run_at: now,
          last_sent_at: now,
          updated_at: now,
        })

      if (automationUpdateError) {
        console.error(
          'Failed to update welcome automation timestamps after activation',
          automationUpdateError
        )
      }
    }
  }

  return {
    email: normalizedEmail,
    language,
    alreadySubscribed: wasSubscribed,
  }
}
