import { createClient } from 'npm:@supabase/supabase-js@2'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'
import { activateNewsletterSubscription } from '../_shared/newsletter-subscription-activation.ts'
import {
  DEFAULT_SYSTEM_EMAIL_AUTOMATIONS,
  normalizeSystemEmailAutomation,
} from '../_shared/system-email-automation.ts'
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

function successResponse(): Response {
  return jsonResponse({ success: true })
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const normalizedEmail =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isValidEmail(normalizedEmail)) {
    return jsonResponse({ error: 'Valid email is required' }, 400)
  }

  const consentAccepted = body.consent === true
  if (!consentAccepted) {
    return jsonResponse({ error: 'Consent is required' }, 400)
  }

  const honeypot =
    typeof body.website === 'string'
      ? body.website.trim()
      : typeof body.company === 'string'
        ? body.company.trim()
        : ''
  if (honeypot) {
    return successResponse()
  }

  const preferredLanguage = normalizeLanguage(
    typeof body.preferredLanguage === 'string'
      ? body.preferredLanguage
      : typeof body.preferred_language === 'string'
        ? body.preferred_language
        : null
  )
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().slice(0, 64)
      : 'homepage'

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const sendTransactionalTemplate = async (
    templateName: string,
    templateData: Record<string, unknown>
  ) => {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-transactional-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          templateName,
          recipientEmail: normalizedEmail,
          idempotencyKey: `${templateName}:${normalizedEmail}:${crypto.randomUUID()}`,
          templateData,
        }),
      }
    )

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`${templateName} failed: ${message}`)
    }
  }
  const authHeader = req.headers.get('Authorization')
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null

  let requesterUserId: string | null = null
  let requesterEmail: string | null = null
  if (accessToken) {
    const {
      data: { user },
    } = await supabase.auth.getUser(accessToken)
    requesterUserId = user?.id ?? null
    requesterEmail = user?.email?.trim().toLowerCase() ?? null
  }

  const { data: matchingProfile } = await supabase
    .from('profiles')
    .select('id, name, preferred_language')
    .eq('email', normalizedEmail)
    .maybeSingle()

  const { data: existingSubscriber, error: lookupError } = await supabase
    .from('newsletter_subscribers')
    .select('id, subscribed, profile_id, preferred_language')
    .or(
      matchingProfile?.id
        ? `email.eq.${normalizedEmail},profile_id.eq.${matchingProfile.id}`
        : `email.eq.${normalizedEmail}`
    )
    .limit(1)
    .maybeSingle()

  if (lookupError) {
    console.error('Failed to load newsletter subscriber', lookupError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  const { data: suppressedEmail, error: suppressionLookupError } = await supabase
    .from('suppressed_emails')
    .select('email, reason')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (suppressionLookupError) {
    console.error('Failed to load suppression status', suppressionLookupError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  const isAuthenticatedOwnEmail =
    requesterUserId !== null && requesterEmail === normalizedEmail

  const isAlreadyNewsletterActive = Boolean(existingSubscriber?.subscribed)
  if (!isAuthenticatedOwnEmail && isAlreadyNewsletterActive) {
    return successResponse()
  }

  const activateDirectly = async () => {
    await activateNewsletterSubscription({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      email: normalizedEmail,
      profileId:
        matchingProfile?.id ?? existingSubscriber?.profile_id ?? requesterUserId,
      preferredLanguage:
        matchingProfile?.preferred_language ??
        existingSubscriber?.preferred_language ??
        preferredLanguage,
      recipientName: matchingProfile?.name ?? null,
      source,
      markAllConfirmationTokensUsed: true,
    })
  }

  if (isAuthenticatedOwnEmail) {
    try {
      await activateDirectly()
      return successResponse()
    } catch (error) {
      console.error('Failed to activate verified newsletter subscription', error)
      return jsonResponse({ error: 'Failed to subscribe' }, 500)
    }
  }

  const { data: confirmationAutomationRow, error: automationLookupError } = await supabase
    .from('system_email_automations')
    .select('*')
    .eq('key', 'newsletter-confirmation')
    .maybeSingle()

  if (automationLookupError) {
    if (isMissingRelationError(automationLookupError)) {
      try {
        await activateDirectly()
        return successResponse()
      } catch (error) {
        console.error('Failed to subscribe with legacy fallback', error)
        return jsonResponse({ error: 'Failed to subscribe' }, 500)
      }
    }
    console.error('Failed to load system automation settings', automationLookupError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  const confirmationAutomation = normalizeSystemEmailAutomation(
    confirmationAutomationRow,
    'newsletter-confirmation'
  )

  if (!confirmationAutomation.enabled) {
    try {
      await activateDirectly()
      return successResponse()
    } catch (error) {
      console.error('Failed to activate direct subscription when confirmation is disabled', error)
      return jsonResponse({ error: 'Failed to subscribe' }, 500)
    }
  }

  const resendCooldownMinutes =
    typeof confirmationAutomation.config.resend_cooldown_minutes === 'number'
      ? confirmationAutomation.config.resend_cooldown_minutes
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-confirmation'].config
          .resend_cooldown_minutes as number

  const { data: existingConfirmationToken, error: tokenLookupError } = await supabase
    .from('newsletter_confirmation_tokens')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    if (isMissingRelationError(tokenLookupError)) {
      try {
        await activateDirectly()
        return successResponse()
      } catch (error) {
        console.error('Failed to subscribe with legacy token fallback', error)
        return jsonResponse({ error: 'Failed to subscribe' }, 500)
      }
    }
    console.error('Failed to load newsletter confirmation token', tokenLookupError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  const now = new Date()
  const lastSentAt = existingConfirmationToken?.last_sent_at
    ? new Date(existingConfirmationToken.last_sent_at)
    : null
  const withinCooldown =
    lastSentAt !== null &&
    now.getTime() - lastSentAt.getTime() < resendCooldownMinutes * 60 * 1000

  const preferredLanguageForToken =
    matchingProfile?.preferred_language ??
    existingSubscriber?.preferred_language ??
    preferredLanguage

  let confirmationToken = existingConfirmationToken?.token ?? crypto.randomUUID().replaceAll('-', '')
  let confirmationTokenCreatedAt =
    existingConfirmationToken?.created_at ?? now.toISOString()
  let confirmationTokenLastSentAt =
    existingConfirmationToken?.last_sent_at ?? now.toISOString()

  if (existingConfirmationToken?.used_at || (suppressedEmail && suppressedEmail.reason === 'unsubscribe')) {
    confirmationToken = crypto.randomUUID().replaceAll('-', '')
    confirmationTokenCreatedAt = now.toISOString()
    confirmationTokenLastSentAt = now.toISOString()
  }

  const tokenPayload = {
    email: normalizedEmail,
    token: confirmationToken,
    profile_id: matchingProfile?.id ?? existingSubscriber?.profile_id ?? null,
    preferred_language: preferredLanguageForToken,
    source,
    created_at: confirmationTokenCreatedAt,
    last_sent_at: withinCooldown ? confirmationTokenLastSentAt : now.toISOString(),
    used_at: null,
  }

  const tokenMutation = existingConfirmationToken
    ? supabase
        .from('newsletter_confirmation_tokens')
        .update(tokenPayload)
        .eq('id', existingConfirmationToken.id)
    : supabase.from('newsletter_confirmation_tokens').insert(tokenPayload)

  const { error: tokenMutationError } = await tokenMutation

  if (tokenMutationError) {
    if (isMissingRelationError(tokenMutationError)) {
      try {
        await activateDirectly()
        return successResponse()
      } catch (error) {
        console.error('Failed to subscribe with legacy token save fallback', error)
        return jsonResponse({ error: 'Failed to subscribe' }, 500)
      }
    }
    console.error('Failed to save newsletter confirmation token', tokenMutationError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  if (!withinCooldown) {
    const confirmationUrl = `${PUBLIC_SITE_URL}/newsletter/confirm?token=${confirmationToken}`
    const templateData = {
      language: preferredLanguageForToken,
      recipientName: matchingProfile?.name ?? null,
      confirmationUrl,
    }

    try {
      await sendTransactionalTemplate(
        'newsletter-subscription-confirmation',
        templateData
      )

      await supabase
        .from('system_email_automations')
        .upsert({
          key: confirmationAutomation.key,
          enabled: confirmationAutomation.enabled,
          config: confirmationAutomation.config,
          last_run_at: now.toISOString(),
          last_sent_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
    } catch (error) {
      console.error('Failed to send newsletter confirmation email', error)
    }
  }

  return successResponse()
})
