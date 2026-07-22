import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Conferma la tua email',
  invite: 'Sei stato invitato su BITE',
  magiclink: 'Il tuo codice di accesso',
  recovery: 'Reimposta la tua password',
  email_change: 'Conferma il cambio email',
  reauthentication: 'Il tuo codice di verifica',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

const SITE_NAME = "BITE Project"
const SENDER_DOMAIN = "mail.biteproject.it"
const ROOT_DOMAIN = "biteproject.it"
const FROM_DOMAIN = "mail.biteproject.it" // Domain shown in From address (may be root or sender subdomain)

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://biteproject.it"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const previewSecret = Deno.env.get('AUTH_EMAIL_HOOK_SECRET')
  const authHeader = req.headers.get('Authorization')

  if (!previewSecret || authHeader !== `Bearer ${previewSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
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

function authorizeHookCaller(req: Request): Response | null {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)
  if (claims?.role === 'service_role') return null

  const hookSecret = Deno.env.get('AUTH_EMAIL_HOOK_SECRET')
  if (hookSecret && token === hookSecret) return null

  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeAuthEmailPayload(raw: unknown): { run_id: string; data: Record<string, unknown>; version: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : record
  const run_id =
    typeof record.run_id === 'string'
      ? record.run_id
      : typeof record.id === 'string'
        ? record.id
        : crypto.randomUUID()
  const version = typeof record.version === 'string' ? record.version : '1'
  return { run_id, data, version }
}

type EmailJob = {
  runId: string
  emailType: string
  recipientEmail: string
  templateProps: Record<string, unknown>
}

// Native payload shape sent by Supabase Auth's built-in "Send Email" hook,
// signed per the Standard Webhooks spec (webhook-id/webhook-timestamp/webhook-signature).
// See https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
type NativeHookPayload = {
  user: { email: string }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    email_new?: string
  }
}

function parseNativeHook(rawBody: string, headers: Headers): EmailJob {
  const hookSecret = Deno.env.get('AUTH_EMAIL_HOOK_SECRET')
  if (!hookSecret) {
    throw new Error('AUTH_EMAIL_HOOK_SECRET is not configured')
  }
  const wh = new Webhook(hookSecret.replace('v1,whsec_', ''))
  const { user, email_data } = wh.verify(rawBody, Object.fromEntries(headers)) as NativeHookPayload

  const confirmationUrl = `${email_data.site_url}/auth/v1/verify?token=${email_data.token_hash}&type=${email_data.email_action_type}&redirect_to=${encodeURIComponent(email_data.redirect_to)}`

  return {
    runId: crypto.randomUUID(),
    emailType: email_data.email_action_type,
    recipientEmail: user.email,
    templateProps: {
      siteName: SITE_NAME,
      siteUrl: `https://${ROOT_DOMAIN}`,
      recipient: user.email,
      confirmationUrl,
      token: email_data.token,
      email: user.email,
      newEmail: email_data.email_new,
    },
  }
}

function parseLegacyEnvelope(rawBody: string): EmailJob {
  const payload = normalizeAuthEmailPayload(JSON.parse(rawBody))
  if (!payload) throw new Error('Invalid webhook payload')
  if (payload.version !== '1') throw new Error(`Unsupported payload version: ${payload.version}`)

  const emailType = String(payload.data.action_type ?? payload.data.type ?? '')
  const recipientEmail = String(payload.data.email ?? payload.data.recipient ?? '')

  return {
    runId: payload.run_id,
    emailType,
    recipientEmail,
    templateProps: {
      siteName: SITE_NAME,
      siteUrl: `https://${ROOT_DOMAIN}`,
      recipient: recipientEmail,
      confirmationUrl: payload.data.url,
      token: payload.data.token,
      email: recipientEmail,
      newEmail: payload.data.new_email,
    },
  }
}

// Renders the templated email and enqueues it for delivery via the Resend dispatcher.
async function sendTemplatedEmail(job: EmailJob): Promise<Response> {
  const { runId, emailType, recipientEmail, templateProps } = job
  console.log('Received auth event', { emailType, email: recipientEmail, run_id: runId })

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType, run_id: runId })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Render React Email to HTML and plain text
  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  // Enqueue email for async processing by the dispatcher (process-email-queue).
  const supabase = createClient<any>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const messageId = crypto.randomUUID()

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: recipientEmail,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      run_id: runId,
      message_id: messageId,
      to: recipientEmail,
      from: `${SITE_NAME} <support@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, run_id: runId, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: recipientEmail, run_id: runId })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Webhook handler - receives Supabase Auth email events and queues the rendered email.
// Supports two callers:
//  1. Supabase Auth's native "Send Email" hook (HTTPS type) - Standard Webhooks signed,
//     carries the real {user, email_data} shape.
//  2. Internal callers (e.g. the app backend) authenticated with the service role key or
//     the static AUTH_EMAIL_HOOK_SECRET, carrying the {run_id, data, version} envelope.
async function handleWebhook(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const isNativeHookCall = req.headers.has('webhook-signature')

  let job: EmailJob
  try {
    if (isNativeHookCall) {
      job = parseNativeHook(rawBody, req.headers)
    } else {
      const authorizationError = authorizeHookCaller(req)
      if (authorizationError) return authorizationError
      job = parseLegacyEnvelope(rawBody)
    }
  } catch (error) {
    console.error('Failed to authenticate/parse webhook payload', error)
    const status = isNativeHookCall ? 401 : 400
    const message = error instanceof Error ? error.message : 'Invalid webhook payload'
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return sendTemplatedEmail(job)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
