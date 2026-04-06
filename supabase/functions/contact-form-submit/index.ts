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
  Deno.env.get('CONTACT_RECIPIENT_EMAIL')?.trim() || 'hello@biteproject.it'

type EmailJob = {
  messageId: string
  recipientEmail: string
  subject: string
  html: string
  text: string
  label: string
  metadata: Record<string, unknown>
  errorLabel: string
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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

async function queueEmail(
  supabase: ReturnType<typeof createClient>,
  submittedAt: string,
  idempotencyKey: string,
  unsubscribeToken: string,
  job: EmailJob
) {
  const { error: logError } = await supabase.from('email_send_log').insert({
    message_id: job.messageId,
    template_name: job.label,
    recipient_email: job.recipientEmail,
    status: 'pending',
    metadata: job.metadata,
  })

  if (logError) {
    console.error(`Failed to create ${job.errorLabel} log entry`, logError)
    throw new Error(`Failed to create ${job.errorLabel} log entry`)
  }

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: job.messageId,
      to: job.recipientEmail,
      from: buildFromAddress('BITE Contact'),
      sender_domain: SENDER_DOMAIN,
      subject: job.subject,
      html: job.html,
      text: job.text,
      purpose: 'transactional',
      label: job.label,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      metadata: job.metadata,
      queued_at: submittedAt,
    },
  })

  if (enqueueError) {
    console.error(`Failed to enqueue ${job.errorLabel}`, enqueueError)
    await supabase.from('email_send_log').insert({
      message_id: job.messageId,
      template_name: job.label,
      recipient_email: job.recipientEmail,
      status: 'failed',
      error_message: `Failed to enqueue ${job.errorLabel}`,
      metadata: job.metadata,
    })
    throw new Error(`Failed to enqueue ${job.errorLabel}`)
  }
}

async function ensureUnsubscribeToken(
  supabase: ReturnType<typeof createClient>,
  recipientEmail: string
) {
  const normalizedEmail = recipientEmail.trim().toLowerCase()

  const { data: existingToken, error: lookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (lookupError) {
    console.error('Failed to load unsubscribe token', lookupError)
    throw new Error('Failed to load unsubscribe token')
  }

  if (existingToken && !existingToken.used_at) {
    return existingToken.token
  }

  const nextToken = generateToken()
  const { error: upsertError } = await supabase
    .from('email_unsubscribe_tokens')
    .upsert(
      { token: nextToken, email: normalizedEmail },
      { onConflict: 'email', ignoreDuplicates: true }
    )

  if (upsertError) {
    console.error('Failed to store unsubscribe token', upsertError)
    throw new Error('Failed to store unsubscribe token')
  }

  const { data: storedToken, error: reReadError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (reReadError || !storedToken?.token) {
    console.error('Failed to confirm unsubscribe token', reReadError)
    throw new Error('Failed to confirm unsubscribe token')
  }

  return storedToken.token
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
  const submittedAt = new Date().toISOString()
  const ownerMessageId = crypto.randomUUID()
  const confirmationMessageId = crypto.randomUUID()
  const escapedMessage = escapeHtml(message).replaceAll('\n', '<br />')
  const ownerSubject = `[Contact] ${subject}`
  const ownerHtml = `
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
  const ownerText = [
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

  const confirmationSubject =
    language === 'it'
      ? 'Abbiamo ricevuto il tuo messaggio'
      : 'We received your message'
  const confirmationHtml =
    language === 'it'
      ? `
        <div style="font-family: Georgia, serif; color: #1f2937; line-height: 1.6;">
          <p style="margin: 0 0 16px;">Ciao ${escapeHtml(name)},</p>
          <p style="margin: 0 0 16px;">abbiamo ricevuto il tuo messaggio e ti risponderemo appena possibile.</p>
          <div style="padding: 16px 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb; margin: 0 0 16px;">
            <p style="margin: 0 0 8px;"><strong>Oggetto:</strong> ${escapeHtml(subject)}</p>
            <p style="margin: 0;">${escapedMessage}</p>
          </div>
          <p style="margin: 0 0 16px;">Se devi aggiungere qualcosa, puoi rispondere a questa email oppure scriverci a <a href="mailto:${CONTACT_RECIPIENT_EMAIL}">${CONTACT_RECIPIENT_EMAIL}</a>.</p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">Messaggio inviato dal form contatti di <a href="${PUBLIC_SITE_URL}">${PUBLIC_SITE_URL}</a>.</p>
        </div>
      `.trim()
      : `
        <div style="font-family: Georgia, serif; color: #1f2937; line-height: 1.6;">
          <p style="margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
          <p style="margin: 0 0 16px;">We received your message and will reply as soon as we can.</p>
          <div style="padding: 16px 18px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb; margin: 0 0 16px;">
            <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
            <p style="margin: 0;">${escapedMessage}</p>
          </div>
          <p style="margin: 0 0 16px;">If you need to add anything, reply to this email or write to <a href="mailto:${CONTACT_RECIPIENT_EMAIL}">${CONTACT_RECIPIENT_EMAIL}</a>.</p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">Message sent from the contact form on <a href="${PUBLIC_SITE_URL}">${PUBLIC_SITE_URL}</a>.</p>
        </div>
      `.trim()
  const confirmationText =
    language === 'it'
      ? [
          `Ciao ${name},`,
          '',
          'abbiamo ricevuto il tuo messaggio e ti risponderemo appena possibile.',
          '',
          `Oggetto: ${subject}`,
          '',
          message,
          '',
          `Se devi aggiungere qualcosa scrivici a ${CONTACT_RECIPIENT_EMAIL}.`,
        ].join('\n')
      : [
          `Hi ${name},`,
          '',
          'We received your message and will reply as soon as we can.',
          '',
          `Subject: ${subject}`,
          '',
          message,
          '',
          `If you need to add anything, write to ${CONTACT_RECIPIENT_EMAIL}.`,
        ].join('\n')

  try {
    const ownerUnsubscribeToken = await ensureUnsubscribeToken(
      supabase,
      CONTACT_RECIPIENT_EMAIL
    )
    const confirmationUnsubscribeToken = await ensureUnsubscribeToken(
      supabase,
      email
    )

    await queueEmail(
      supabase,
      submittedAt,
      `${email}:owner:${subject}:${message.slice(0, 64)}`,
      ownerUnsubscribeToken,
      {
        messageId: ownerMessageId,
        recipientEmail: CONTACT_RECIPIENT_EMAIL,
        subject: ownerSubject,
        html: ownerHtml,
        text: ownerText,
        label: 'contact-form',
        metadata: {
          sender_name: name,
          sender_email: email,
          subject,
          language,
          source: 'contact-form',
          direction: 'owner',
        },
        errorLabel: 'contact owner email',
      }
    )

    await queueEmail(
      supabase,
      submittedAt,
      `${email}:confirmation:${subject}:${message.slice(0, 64)}`,
      confirmationUnsubscribeToken,
      {
        messageId: confirmationMessageId,
        recipientEmail: email,
        subject: confirmationSubject,
        html: confirmationHtml,
        text: confirmationText,
        label: 'contact-form-confirmation',
        metadata: {
          sender_name: name,
          sender_email: email,
          subject,
          language,
          source: 'contact-form',
          direction: 'confirmation',
        },
        errorLabel: 'contact confirmation email',
      }
    )

    try {
      const dispatcherResponse = await fetch(
        `${supabaseUrl}/functions/v1/process-email-queue`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
        }
      )
      if (!dispatcherResponse.ok) {
        console.warn('Inline dispatch failed (emails will be sent by cron)', await dispatcherResponse.text())
      }
    } catch (dispatchErr) {
      console.warn('Inline dispatch error (emails will be sent by cron)', dispatchErr)
    }
  } catch (error) {
    console.error('Contact form email pipeline failed', error)
    return jsonResponse({ error: 'Failed to send contact emails' }, 500)
  }

  return jsonResponse({ success: true })
})
