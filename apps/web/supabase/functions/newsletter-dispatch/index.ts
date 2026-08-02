/**
 * Dispatcher newsletter: campagne schedulate, automazioni su
 * iscrizione/disiscrizione e digest settimanale.
 *
 * Selezione dei destinatari, rendering, merge tag, deduplica delle consegne,
 * gestione delle soppressioni e schedulazione del digest vivono in
 * `@pynkstudio/newsletterapp`. Qui restano tre agganci che sono di BITE:
 *
 * - il digest, che legge il content model di BITE (`send-newsletter-digest`);
 * - il worker della coda email, svegliato subito dopo l'accodamento così una
 *   campagna parte senza aspettare il cron;
 * - il dispatch delle notifiche di engagement, che non è newsletter ma è
 *   sempre stato agganciato a questo stesso tick.
 */
import { createDispatchHandler } from '../_shared/newsletterapp.ts'
import { serveNewsletter } from '../_shared/newsletter.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function invokeFunction(name: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

serveNewsletter((source) => {
  const dispatch = createDispatchHandler(source, {
    runDigest: async ({ startDate, endDate }) => {
      const response = await invokeFunction('send-newsletter-digest', { startDate, endDate })
      if (!response.ok) {
        throw new Error(`Weekly digest failed: ${await response.text()}`)
      }
      const result = await response.json()
      return { queued: typeof result.queued === 'number' ? result.queued : 0 }
    },

    afterQueue: async () => {
      const response = await invokeFunction('process-email-queue')
      if (!response.ok) {
        console.warn(
          'Inline email dispatch failed (emails will be sent by cron)',
          await response.text(),
        )
      }
    },
  })

  return async (request: Request) => {
    const response = await dispatch(request)

    // Fuori dal dispatch newsletter di proposito: le notifiche di engagement
    // vanno smaltite a ogni tick, anche quando non c'è nulla da accodare.
    try {
      const engagement = await invokeFunction('dispatch-engagement-notifications', { limit: 250 })
      if (!engagement.ok) {
        console.error('Failed to process engagement notification dispatch', await engagement.text())
      }
    } catch (error) {
      console.error('Failed to invoke engagement notification dispatch', error)
    }

    return response
  }
})
