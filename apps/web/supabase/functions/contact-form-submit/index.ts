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
  const FS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
  const FH = "'Playfair Display', Georgia, 'Times New Roman', serif"

  const shell = (inner: string) => `
<div style="background-color:#f4efe7;background-image:linear-gradient(180deg,rgba(255,255,255,.82) 0%,rgba(244,239,231,.94) 45%,rgba(237,244,244,.92) 100%);margin:0;padding:32px 0;">
<div style="margin:0 auto;max-width:580px;padding:0 12px;">
<div style="background:#fffdf9;border:1px solid #e6ddd1;border-radius:28px;box-shadow:0 24px 64px rgba(21,35,56,.08);padding:36px 32px;font-family:${FS};">
<p style="color:#152338;font-family:${FH};font-size:16px;font-weight:700;letter-spacing:.32em;margin:0 0 24px;text-transform:uppercase;">BITE</p>
${inner}
</div></div></div>`.trim()

  const ownerSubject = `[Contact] ${subject}`
  const ownerHtml = shell(`
<p style="color:#3f7c7a;font-size:11px;font-weight:700;letter-spacing:.24em;margin:0 0 10px;text-transform:uppercase;">Form Contatti</p>
<h1 style="color:#152338;font-family:${FH};font-size:30px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin:0 0 20px;">Nuovo messaggio</h1>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 20px;">Nuovo messaggio dal form contatti di ${escapeHtml(SITE_NAME)}.</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;color:#3d4654;">
<tr><td style="padding:10px 0;font-weight:600;width:110px;vertical-align:top;color:#152338;">Nome</td><td style="padding:10px 0;">${escapeHtml(name)}</td></tr>
<tr><td style="padding:10px 0;font-weight:600;vertical-align:top;color:#152338;">Email</td><td style="padding:10px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#3f7c7a;text-decoration:underline;">${escapeHtml(email)}</a></td></tr>
<tr><td style="padding:10px 0;font-weight:600;vertical-align:top;color:#152338;">Lingua</td><td style="padding:10px 0;">${escapeHtml(language)}</td></tr>
<tr><td style="padding:10px 0;font-weight:600;vertical-align:top;color:#152338;">Oggetto</td><td style="padding:10px 0;">${escapeHtml(subject)}</td></tr>
</table>
<div style="padding:18px 20px;border:1px solid #e6ddd1;border-radius:20px;background:#fff;margin:0 0 20px;font-size:15px;color:#3d4654;line-height:1.75;">${escapedMessage}</div>
<hr style="border:none;border-top:1px solid #e6ddd1;margin:0 0 20px;" />
<p style="font-size:12px;color:#6e7987;line-height:1.6;margin:0;">Rispondi a <a href="mailto:${escapeHtml(email)}" style="color:#152338;text-decoration:underline;">${escapeHtml(email)}</a>. Inviato da <a href="${PUBLIC_SITE_URL}/contact" style="color:#152338;text-decoration:underline;">${PUBLIC_SITE_URL}/contact</a>.</p>`)

  const confirmationSubject =
    language === 'it'
      ? 'Abbiamo ricevuto il tuo messaggio'
      : 'We received your message'
  const confirmationHtml = language === 'it'
    ? shell(`
<p style="color:#3f7c7a;font-size:11px;font-weight:700;letter-spacing:.24em;margin:0 0 10px;text-transform:uppercase;">Contatto</p>
<h1 style="color:#152338;font-family:${FH};font-size:30px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin:0 0 20px;">Messaggio ricevuto</h1>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 16px;">Ciao ${escapeHtml(name)},</p>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 20px;">abbiamo ricevuto il tuo messaggio e ti risponderemo appena possibile.</p>
<div style="padding:18px 20px;border:1px solid #e6ddd1;border-radius:20px;background:#fff;margin:0 0 20px;font-size:15px;color:#3d4654;line-height:1.75;">
<p style="margin:0 0 8px;"><strong style="color:#152338;">Oggetto:</strong> ${escapeHtml(subject)}</p>
<p style="margin:0;">${escapedMessage}</p>
</div>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 20px;">Se devi aggiungere qualcosa, puoi rispondere a questa email oppure scriverci a <a href="mailto:${CONTACT_RECIPIENT_EMAIL}" style="color:#3f7c7a;text-decoration:underline;">${CONTACT_RECIPIENT_EMAIL}</a>.</p>
<hr style="border:none;border-top:1px solid #e6ddd1;margin:0 0 20px;" />
<p style="font-size:12px;color:#6e7987;line-height:1.6;margin:0;">Messaggio inviato dal form contatti di <a href="${PUBLIC_SITE_URL}" style="color:#152338;text-decoration:underline;">${PUBLIC_SITE_URL}</a>.</p>`)
    : shell(`
<p style="color:#3f7c7a;font-size:11px;font-weight:700;letter-spacing:.24em;margin:0 0 10px;text-transform:uppercase;">Contact</p>
<h1 style="color:#152338;font-family:${FH};font-size:30px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin:0 0 20px;">Message received</h1>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 20px;">We received your message and will reply as soon as we can.</p>
<div style="padding:18px 20px;border:1px solid #e6ddd1;border-radius:20px;background:#fff;margin:0 0 20px;font-size:15px;color:#3d4654;line-height:1.75;">
<p style="margin:0 0 8px;"><strong style="color:#152338;">Subject:</strong> ${escapeHtml(subject)}</p>
<p style="margin:0;">${escapedMessage}</p>
</div>
<p style="font-size:15px;color:#3d4654;line-height:1.75;margin:0 0 20px;">If you need to add anything, reply to this email or write to <a href="mailto:${CONTACT_RECIPIENT_EMAIL}" style="color:#3f7c7a;text-decoration:underline;">${CONTACT_RECIPIENT_EMAIL}</a>.</p>
<hr style="border:none;border-top:1px solid #e6ddd1;margin:0 0 20px;" />
<p style="font-size:12px;color:#6e7987;line-height:1.6;margin:0;">Message sent from the contact form on <a href="${PUBLIC_SITE_URL}" style="color:#152338;text-decoration:underline;">${PUBLIC_SITE_URL}</a>.</p>`)
  const ownerText = [
    'Nuovo messaggio dal form contatti di BITE.',
    '',
    `Nome: ${name}`,
    `Email: ${email}`,
    `Lingua: ${language}`,
    `Oggetto: ${subject}`,
    '',
    message,
    '',
    `Rispondi a: ${email}`,
    `Origine: ${PUBLIC_SITE_URL}/contatti`,
  ].join('\n')

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
