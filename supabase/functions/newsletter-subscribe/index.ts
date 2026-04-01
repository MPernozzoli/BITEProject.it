import { createClient } from 'npm:@supabase/supabase-js@2'
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

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)
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
    .select('id, preferred_language')
    .eq('email', normalizedEmail)
    .maybeSingle()

  const { data: existingSubscriber, error: lookupError } = await supabase
    .from('newsletter_subscribers')
    .select('id, subscribed, profile_id')
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
    .select('email')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (suppressionLookupError) {
    console.error('Failed to load suppression status', suppressionLookupError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  const hasVerifiedOwnership =
    requesterEmail === normalizedEmail ||
    (requesterUserId !== null &&
      (matchingProfile?.id === requesterUserId ||
        existingSubscriber?.profile_id === requesterUserId))

  const shouldNoopForSafety =
    !hasVerifiedOwnership &&
    (Boolean(suppressedEmail) || Boolean(existingSubscriber))

  if (shouldNoopForSafety) {
    return successResponse()
  }

  const payload = {
    email: normalizedEmail,
    profile_id: matchingProfile?.id ?? existingSubscriber?.profile_id ?? null,
    preferred_language: matchingProfile?.preferred_language ?? preferredLanguage,
    subscribed: true,
    source,
    unsubscribed_at: null,
  }

  const mutation = existingSubscriber
    ? supabase
        .from('newsletter_subscribers')
        .update(payload)
        .eq('id', existingSubscriber.id)
    : supabase.from('newsletter_subscribers').insert(payload)

  const { error: mutationError } = await mutation

  if (mutationError) {
    console.error('Failed to save newsletter subscriber', mutationError)
    return jsonResponse({ error: 'Failed to subscribe' }, 500)
  }

  if (hasVerifiedOwnership) {
    await supabase.from('suppressed_emails').delete().eq('email', normalizedEmail)
    await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: null })
      .eq('email', normalizedEmail)
  }

  return successResponse()
})
