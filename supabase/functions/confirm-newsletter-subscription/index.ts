import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  DEFAULT_SYSTEM_EMAIL_AUTOMATIONS,
  normalizeSystemEmailAutomation,
} from '../_shared/system-email-automation.ts'
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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const url = new URL(req.url)
  let token = url.searchParams.get('token')

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (typeof body.token === 'string') {
        token = body.token
      }
    } catch {
      token = url.searchParams.get('token')
    }
  }

  if (!token) {
    return jsonResponse({ error: 'Token is required' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const [{ data: confirmationToken, error: tokenError }, { data: confirmationAutomationRow }] = await Promise.all([
    supabase
      .from('newsletter_confirmation_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle(),
    supabase
      .from('system_email_automations')
      .select('*')
      .eq('key', 'newsletter-confirmation')
      .maybeSingle(),
  ])

  if (tokenError || !confirmationToken) {
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  const confirmationAutomation = normalizeSystemEmailAutomation(
    confirmationAutomationRow,
    'newsletter-confirmation'
  )
  const tokenTtlHours =
    typeof confirmationAutomation.config.token_ttl_hours === 'number'
      ? confirmationAutomation.config.token_ttl_hours
      : DEFAULT_SYSTEM_EMAIL_AUTOMATIONS['newsletter-confirmation'].config
          .token_ttl_hours as number
  const tokenAgeMs = Date.now() - new Date(confirmationToken.created_at).getTime()
  const isExpired = tokenAgeMs > tokenTtlHours * 60 * 60 * 1000

  const language = normalizeLanguage(confirmationToken.preferred_language)

  if (req.method === 'GET') {
    return jsonResponse({
      valid: !confirmationToken.used_at && !isExpired,
      alreadyConfirmed: Boolean(confirmationToken.used_at),
      expired: isExpired,
      email: confirmationToken.email,
      language,
    })
  }

  if (confirmationToken.used_at) {
    return jsonResponse({
      success: true,
      alreadyConfirmed: true,
      email: confirmationToken.email,
      language,
    })
  }

  if (isExpired) {
    return jsonResponse({ error: 'Invalid or expired token', expired: true }, 410)
  }

  try {
    await activateNewsletterSubscription({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      email: confirmationToken.email,
      profileId: confirmationToken.profile_id,
      preferredLanguage: confirmationToken.preferred_language,
      source: confirmationToken.source,
      confirmationTokenId: confirmationToken.id,
    })
  } catch (error) {
    console.error('Failed to activate newsletter subscription on confirmation', error)
    return jsonResponse({ error: 'Failed to confirm subscription' }, 500)
  }

  return jsonResponse({
    success: true,
    email: confirmationToken.email,
    language,
  })
})
