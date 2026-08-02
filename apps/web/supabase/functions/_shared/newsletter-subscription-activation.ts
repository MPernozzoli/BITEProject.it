/**
 * Adattatore verso `@pynkstudio/newsletterapp` per l'attivazione di
 * un'iscrizione.
 *
 * Sopravvive alla sola `update-my-profile`, che costruisce da sé i propri
 * client Supabase: la firma vecchia (`{ supabase, supabaseUrl, serviceRoleKey }`)
 * viene tradotta in un contesto del package.
 *
 * Non aggiungere logica qui: qualsiasi comportamento nuovo va nel package.
 */
import {
  activateNewsletterSubscription as packageActivate,
  type ActivateSubscriptionResult,
} from './newsletterapp.ts'
import { createNewsletterContext } from './newsletter.ts'

type ActivationOptions = {
  supabase: unknown
  supabaseUrl: string
  serviceRoleKey: string
  email: string
  profileId?: string | null
  preferredLanguage?: string | null
  recipientName?: string | null
  source?: string | null
  confirmationTokenId?: string | null
  markAllConfirmationTokensUsed?: boolean
}

export async function activateNewsletterSubscription({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  ...input
}: ActivationOptions): Promise<ActivateSubscriptionResult> {
  return packageActivate(
    createNewsletterContext({ supabase, supabaseUrl, serviceRoleKey }),
    input,
  )
}
