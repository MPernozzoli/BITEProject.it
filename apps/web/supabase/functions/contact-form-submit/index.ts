import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import {
  buildFromAddress,
  FROM_DOMAIN,
  PUBLIC_SITE_URL,
  SENDER_DOMAIN,
} from '../_shared/email-config.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const CONTACT_RECIPIENT_EMAIL =
  Deno.env.get('CONTACT_RECIPIENT_EMAIL')?.trim() || 'hello@biteproject.it'

/**
 * The submission is written straight into the mailbox as a message *from* the
 * visitor, so /admin/contatti and /admin/mail both show it and replying answers
 * the person who wrote — not our own sender address, which is what happened
 * while the form emailed hello@ and the inbound webhook fed it back in.
 */
function buildMailboxMessageId(): string {
  return `${Date.now()}.${crypto.randomUUID()}@${FROM_DOMAIN}`
}

/**
 * Admin push for a new contact message.
 *
 * Mirrors the mail push in @pynkstudio/mailapp (mailbox/push.ts + mailbox/inbound.ts),
 * which we cannot import here because it is a Node package and this runs on Deno.
 * What has to match is the wire contract, so the rest of the mailbox keeps working:
 *  - `tag: mail:<id>` — revokeMailPushNotification closes it with the same value in
 *    `closeTag` when the message is read or archived from either console;
 *  - `push_notified_at` on the row — that revocation is a no-op without it;
 *  - `assignment_reason` — anything other than 'alias_match' makes the revocation
 *    target every admin, which is who we notify here.
 * Contact mail is always addressed to the shared inbox, so there is no alias to match:
 * it is unassigned and every admin is notified, the mailbox's fallback_all_admins case.
 */
type PushSubscriptionRow = {
  profile_id: string
  endpoint: string
  p256dh: string
  auth: string
  profiles?: { email?: string | null } | null
}

function vapidConfig(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey =
    Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? Deno.env.get('VITE_WEB_PUSH_PUBLIC_KEY')
  const privateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hello@biteproject.it'
  if (!publicKey || !privateKey) return null
  return { subject, publicKey, privateKey }
}

function rejectionStatus(reason: unknown): number | null {
  const candidate = reason as { statusCode?: unknown; status?: unknown } | null
  if (typeof candidate?.statusCode === 'number') return candidate.statusCode
  if (typeof candidate?.status === 'number') return candidate.status
  return null
}

async function notifyAdminsOfContactMessage(
  supabase: ReturnType<typeof createClient>,
  messageId: string,
  senderName: string,
  subject: string
): Promise<void> {
  const vapid = vapidConfig()
  if (!vapid) {
    console.warn('Web push not configured, skipping contact notification')
    return
  }

  const { data: adminRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
  if (rolesError) throw rolesError

  const adminIds = Array.from(
    new Set(((adminRoles ?? []) as { user_id: string }[]).map((row) => row.user_id).filter(Boolean))
  )
  if (adminIds.length === 0) return

  const { data: subscriptionRows, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('profile_id, endpoint, p256dh, auth, profiles!inner(email)')
    .in('profile_id', adminIds)
    .eq('enabled', true)
  if (subscriptionsError) throw subscriptionsError

  const rows = (subscriptionRows ?? []) as unknown as PushSubscriptionRow[]
  if (rows.length === 0) return

  const emailOf = (row: PushSubscriptionRow) => row.profiles?.email?.trim().toLowerCase()
  const recipientEmails = Array.from(
    new Set(rows.map(emailOf).filter((value): value is string => Boolean(value)))
  )

  const { data: preferenceRows, error: preferencesError } = recipientEmails.length
    ? await supabase
        .from('email_notification_preferences')
        .select('email, push_mail_enabled')
        .in('email', recipientEmails)
    : { data: [], error: null }
  if (preferencesError) throw preferencesError

  const preferencesByEmail = new Map(
    ((preferenceRows ?? []) as { email: string; push_mail_enabled: boolean | null }[]).map((row) => [
      String(row.email).trim().toLowerCase(),
      row.push_mail_enabled,
    ])
  )

  // No preference row means opted in: mail push is on by default.
  const targets = rows.filter((row) => {
    const email = emailOf(row)
    if (!email) return false
    return preferencesByEmail.get(email) ?? true
  })
  if (targets.length === 0) return

  const payload = JSON.stringify({
    type: 'mail',
    title: 'Nuovo messaggio dai contatti',
    body: `${senderName}: ${subject}`,
    url: `/admin/contatti?message=${encodeURIComponent(messageId)}`,
    tag: `mail:${messageId}`,
  })

  const results = await Promise.allSettled(
    targets.map((target) =>
      webpush.sendNotification(
        {
          endpoint: target.endpoint,
          expirationTime: null,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        { TTL: 60 * 5, vapidDetails: vapid }
      )
    )
  )

  // 404/410 mean the push service retired the endpoint: stop sending to it.
  const retiredEndpoints = results
    .map((result, index) => ({ result, endpoint: targets[index].endpoint }))
    .filter(({ result }) => result.status === 'rejected')
    .filter(({ result }) =>
      [404, 410].includes(rejectionStatus((result as PromiseRejectedResult).reason) ?? 0)
    )
    .map(({ endpoint }) => endpoint)

  if (retiredEndpoints.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in('endpoint', retiredEndpoints)
  }

  if (!results.some((result) => result.status === 'fulfilled')) return

  await supabase
    .from('inbound_emails')
    .update({ push_notified_at: new Date().toISOString() })
    .eq('id', messageId)
}

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
    const confirmationUnsubscribeToken = await ensureUnsubscribeToken(
      supabase,
      email
    )

    const { data: storedMessage, error: mailboxError } = await supabase
      .from('inbound_emails')
      .insert({
        message_id: buildMailboxMessageId(),
        thread_key: `contact:${crypto.randomUUID()}`,
        from_address: email,
        from_name: name,
        to_addresses: [CONTACT_RECIPIENT_EMAIL],
        subject,
        text_body: message,
        html_body: `<div>${escapedMessage}</div>`,
        headers: [
          { name: 'X-BITE-Source', value: 'contact-form' },
          { name: 'X-BITE-Language', value: language },
          { name: 'X-BITE-Origin', value: `${PUBLIC_SITE_URL}/contact` },
        ],
        brand: 'bite_ordinary',
        intake_source: 'contact_form',
        assigned_to_profile_id: null,
        assignment_reason: 'fallback_all_admins',
        created_at: submittedAt,
      })
      .select('id')
      .maybeSingle()

    if (mailboxError || !storedMessage?.id) {
      console.error('Failed to store contact message in the mailbox', mailboxError)
      throw new Error('Failed to store contact message')
    }

    // Best effort: the visitor's message is already safely stored, so a failing
    // push must not turn their submission into an error.
    try {
      await notifyAdminsOfContactMessage(
        supabase,
        storedMessage.id as string,
        name,
        subject
      )
    } catch (pushError) {
      console.error('Contact push notification failed', pushError)
    }

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
    console.error('Contact form pipeline failed', error)
    return jsonResponse({ error: 'Failed to record contact message' }, 500)
  }

  return jsonResponse({ success: true })
})
