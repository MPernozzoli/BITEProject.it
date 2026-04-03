import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildFromAddress,
  PUBLIC_SITE_URL,
  SENDER_DOMAIN,
  SITE_NAME,
} from '../_shared/email-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const CONTACT_RECIPIENT_EMAIL =
  Deno.env.get('CONTACT_RECIPIENT_EMAIL')?.trim() || 'hello@biteproject.com'

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function readString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
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

  const honeypot = readString(body.company ?? body.website, 255)
  if (honeypot) {
    return jsonResponse({ success: true })
  }

  const name = readString(body.name, 120)
  const email = readString(body.email, 320).toLowerCase()
  const subject = readString(body.subject, 160)
  const message = normalizeMultiline(readString(body.message, 5000))
  const language = readString(body.language, 8) || 'en'

  if (!name) {
    return jsonResponse({ error: 'Name is required' }, 400)
  }

  if (!isValidEmail(email)) {
    return jsonResponse({ error: 'Valid email is required' }, 400)
  }

  if (!subject) {
    return jsonResponse({ error: 'Subject is required' }, 400)
  }

  if (message.length < 10) {
    return jsonResponse({ error: 'Message is too short' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const messageId = crypto.randomUUID()
  const submittedAt = new Date().toISOString()
  const normalizedSubject = `[Contact] ${subject}`
  const escapedMessage = escapeHtml(message).replaceAll('\n', '<br />')
  const html = `
    <div style="font-family: Georgia, serif; color: #1f2937; line-height: 1.6;">
      <p style="margin: 0 0 16px;">Nuovo messaggio dal form contatti di ${escapeHtml(SITE_NAME)}.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
        <tr><td style="padding: 8px 0; font-weight: 600; width: 120px;">Nome</td><td style="padding: 8px 0;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 600;">Email</td><td style="padding: 8px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td style="padding: 8px 0; font-weight: 600;">Lingua</td><td style="padding: 8px 0;">${escapeHtml(language)}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: 600;">Oggetto</td><td style="padding: 8px 0;">${escapeHtml(subject)}</td></tr>
      </table>
      <div style="padding: 16px 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb;">
        ${escapedMessage}
      </div>
      <p style="margin: 20px 0 0; font-size: 13px; color: #6b7280;">
        Rispondi manualmente a <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>.
        Inviato da <a href="${PUBLIC_SITE_URL}/contact">${PUBLIC_SITE_URL}/contact</a>.
      </p>
    </div>
  `.trim()
  const text = [
    `Nuovo messaggio dal form contatti di ${SITE_NAME}.`,
    '',
    `Nome: ${name}`,
    `Email: ${email}`,
    `Lingua: ${language}`,
    `Oggetto: ${subject}`,
    '',
    message,
    '',
    `Pagina: ${PUBLIC_SITE_URL}/contact`,
  ].join('\n')

  const { error: logError } = await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: 'contact-form',
    recipient_email: CONTACT_RECIPIENT_EMAIL,
    status: 'pending',
    metadata: {
      sender_name: name,
      sender_email: email,
      subject,
      language,
      source: 'contact-form',
    },
  })

  if (logError) {
    console.error('Failed to create contact email log entry', logError)
    return jsonResponse({ error: 'Failed to queue message' }, 500)
  }

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: CONTACT_RECIPIENT_EMAIL,
      from: buildFromAddress('BITE Contact'),
      sender_domain: SENDER_DOMAIN,
      subject: normalizedSubject,
      html,
      text,
      purpose: 'transactional',
      label: 'contact-form',
      idempotency_key: `${email}:${subject}:${message.slice(0, 64)}`,
      metadata: {
        sender_name: name,
        sender_email: email,
        subject,
        language,
      },
      queued_at: submittedAt,
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue contact email', enqueueError)
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'contact-form',
      recipient_email: CONTACT_RECIPIENT_EMAIL,
      status: 'failed',
      error_message: 'Failed to enqueue contact email',
      metadata: {
        sender_name: name,
        sender_email: email,
        subject,
        language,
        source: 'contact-form',
      },
    })
    return jsonResponse({ error: 'Failed to queue message' }, 500)
  }

  return jsonResponse({ success: true })
})
