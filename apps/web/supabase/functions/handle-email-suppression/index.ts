import { createClient } from 'npm:@supabase/supabase-js@2'

// Suppression event payload sent by the Go API when Mailgun reports
// a bounce, complaint, or unsubscribe.
interface SuppressionPayload {
  email: string
  reason: 'bounce' | 'complaint' | 'unsubscribe'
  message_id?: string
  metadata?: Record<string, unknown>
  is_retry: boolean
  retry_count: number
}

function parseSuppressionPayload(body: string): SuppressionPayload {
  const parsed = JSON.parse(body)
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as SuppressionPayload
  if (!data.email || !data.reason) {
    throw new Error('Missing required fields: email, reason')
  }
  return data
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

function authorizeSuppressionCaller(req: Request): Response | null {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)
  if (claims?.role === 'service_role') return null

  const secret = Deno.env.get('EMAIL_SUPPRESSION_WEBHOOK_SECRET')
  if (secret && token === secret) return null

  return jsonResponse({ error: 'Forbidden' }, 403)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const authorizationError = authorizeSuppressionCaller(req)
  if (authorizationError) {
    return authorizationError
  }

  let payload: SuppressionPayload
  try {
    payload = parseSuppressionPayload(await req.text())
  } catch (error) {
    console.error('Invalid suppression payload', { error })
    return jsonResponse({ error: 'Invalid payload' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const normalizedEmail = payload.email.toLowerCase()

  // 1. Upsert to suppressed_emails (idempotent — safe for retries)
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      {
        email: normalizedEmail,
        reason: payload.reason,
        metadata: payload.metadata ?? null,
      },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  const disabledEmailPreferences = {
    newsletter_enabled: false,
    digest_enabled: false,
    story_notifications_enabled: false,
    like_notifications_frequency: 'none',
    comment_notifications_frequency: 'none',
  }

  const { error: preferenceError } = await supabase
    .from('email_notification_preferences')
    .upsert({
      email: normalizedEmail,
      ...disabledEmailPreferences,
      updated_at: new Date().toISOString(),
    })

  if (preferenceError) {
    console.warn('Failed to update email notification preferences after suppression', {
      error: preferenceError,
      email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    })
  }

  const { data: subscriber } = await supabase
    .from('newsletter_subscribers')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  const { error: subscriberUpdateError } = await supabase
    .from('newsletter_subscribers')
    .update({
      subscribed: false,
      source: `suppression:${payload.reason}`,
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('email', normalizedEmail)

  if (subscriberUpdateError) {
    console.warn('Failed to update newsletter subscriber after suppression', {
      error: subscriberUpdateError,
    })
  }

  if (payload.reason === 'unsubscribe') {
    const { error: eventError } = await supabase.from('newsletter_events').insert({
      subscriber_id: subscriber?.id ?? null,
      email: normalizedEmail,
      event_type: 'unsubscribed',
      preferred_language: null,
      occurred_at: new Date().toISOString(),
    })

    if (eventError) {
      console.warn('Failed to record unsubscribe event from suppression webhook', {
        error: eventError,
      })
    }

    const { error: feedbackError } = await supabase
      .from('newsletter_unsubscribe_feedback')
      .insert({
        email: normalizedEmail,
        profile_id: null,
        source: 'suppression_webhook',
        reason_code: 'mailbox_provider_unsubscribe',
        reason_text: null,
        unsubscribe_scope: disabledEmailPreferences,
        message_context: payload.metadata ?? null,
      })

    if (feedbackError) {
      console.warn('Failed to record suppression unsubscribe feedback', {
        error: feedbackError,
      })
    }
  }

  // 2. Append a new log entry for the suppression event (never update existing rows)
  const sendLogStatus = mapReasonToStatus(payload.reason)
  const sendLogMessage = mapReasonToMessage(payload.reason)

  const { error: insertError } = await supabase
    .from('email_send_log')
    .insert({
      message_id: payload.message_id ?? null,
      template_name: 'system',
      recipient_email: normalizedEmail,
      status: sendLogStatus,
      error_message: sendLogMessage,
      metadata: payload.metadata ?? null,
    })

  if (insertError) {
    // Non-fatal — log and continue. The suppression was already recorded.
    console.warn('Failed to insert email_send_log', {
      error: insertError,
    })
  }

  console.log('Suppression processed', {
    email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    reason: payload.reason,
    is_retry: payload.is_retry,
    retry_count: payload.retry_count,
    has_message_id: !!payload.message_id,
  })

  return jsonResponse({ success: true })
})

function mapReasonToStatus(
  reason: string,
): 'bounced' | 'complained' | 'suppressed' {
  switch (reason) {
    case 'bounce':
      return 'bounced'
    case 'complaint':
      return 'complained'
    default:
      return 'suppressed'
  }
}

function mapReasonToMessage(reason: string): string {
  switch (reason) {
    case 'bounce':
      return 'Permanent bounce — email address is invalid or rejected'
    case 'complaint':
      return 'Spam complaint — recipient marked email as spam'
    case 'unsubscribe':
      return 'Recipient unsubscribed'
    default:
      return 'Email suppressed'
  }
}
