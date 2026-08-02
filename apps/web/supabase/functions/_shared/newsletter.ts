/**
 * BITE wiring per `@pynkstudio/newsletterapp`, lato edge function.
 *
 * Tutta la logica newsletter — iscrizione, double opt-in, preferenze,
 * disiscrizione, soppressioni, dispatch di campagne e automazioni, digest,
 * tracking — vive nel package. Qui c'è solo ciò che è di BITE:
 *
 * - dominio, mittente e lingue;
 * - la shell grafica delle email (`NewsletterEmail`), che il package non
 *   conosce e non deve conoscere;
 * - i canali push che BITE tiene sulla stessa riga di
 *   `email_notification_preferences`;
 * - l'automazione `story-new-article-notification`, che è del content model di
 *   BITE e non del package.
 *
 * Qualsiasi modifica futura al *comportamento* della newsletter va nel package,
 * non qui. → Wiki/12 - Newsletter ed Email.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

import {
  resolveNewsletterConfig,
  type NewsletterConfig,
  type NewsletterContext,
  type SystemAutomationDefaults,
} from './newsletterapp.ts'
import { PUBLIC_SITE_URL, SENDER_DOMAIN, SITE_NAME } from './email-config.ts'
import { isInjectedServiceKey } from './service-auth.ts'

/** Automazione di BITE: notifica di nuovo articolo dentro una story. */
export const AUTOMATION_STORY_NEW_ARTICLE = 'story-new-article-notification'

export const newsletterConfig: NewsletterConfig = resolveNewsletterConfig({
  siteUrl: PUBLIC_SITE_URL,
  siteName: SITE_NAME,
  senderDomain: SENDER_DOMAIN,
  // Le newsletter si scrivono in sei lingue, ma il sito pubblico è bilingue:
  // i link nel corpo devono comunque risolvere su /it o /en.
  supportedLanguages: ['it', 'en', 'fr', 'de', 'es', 'pt'],
  defaultLanguage: 'it',
  siteLanguages: ['it', 'en'],
  defaultSiteLanguage: 'en',
  // Embed qualificato col nome del vincolo: senza, PostgREST non risolve la
  // relazione in modo deterministico.
  subscriberProfileEmbed:
    'profiles:profiles!newsletter_subscribers_profile_id_fkey(name, preferred_language, secondary_language)',
})

/**
 * Canali push di BITE. Stanno sulla stessa riga delle preferenze email, quindi
 * vanno dichiarati al package: altrimenti una `upsert` fatta dal runtime
 * newsletter li riscriverebbe come mancanti.
 */
export const BITE_PREFERENCE_DEFAULTS = {
  push_engagement_enabled: true,
  push_publication_enabled: true,
  push_mail_enabled: true,
  push_voyage_admin_enabled: true,
  push_voyage_user_enabled: true,
} as const

export const BITE_PREFERENCE_COLUMNS = Object.keys(BITE_PREFERENCE_DEFAULTS)

/**
 * Si sovrappongono ai default del package senza sostituirli: qui c'è solo
 * l'automazione in più di BITE e il fuso del digest, che il package lascia a
 * UTC.
 */
export const BITE_AUTOMATION_DEFAULTS: SystemAutomationDefaults = {
  [AUTOMATION_STORY_NEW_ARTICLE]: {
    key: AUTOMATION_STORY_NEW_ARTICLE,
    enabled: true,
    config: {},
    last_run_at: null,
    last_sent_at: null,
  },
  'newsletter-weekly-digest': {
    key: 'newsletter-weekly-digest',
    enabled: true,
    // Martedì 07:00 ora di Roma.
    config: { timezone: 'Europe/Rome', weekday: 2, hour_local: 7, minute_local: 0 },
    last_run_at: null,
    last_sent_at: null,
  },
}

type ContextOptions = {
  supabase: unknown
  supabaseUrl: string
  serviceRoleKey: string
}

export function createNewsletterContext({
  supabase,
  supabaseUrl,
  serviceRoleKey,
}: ContextOptions): NewsletterContext {
  return {
    config: newsletterConfig,
    db: supabase as NewsletterContext['db'],

    /**
     * Shell editoriale BITE. È l'unico punto in cui il package cede il
     * controllo del markup: font, colori, header e footer restano qui.
     *
     * React e react-email sono caricati su richiesta: questo modulo è importato
     * anche dalle function di tracking, che non renderizzano nulla e non devono
     * pagarne il cold start.
     */
    renderNewsletter: async ({ language, preheader, bodyHtml, unsubscribeUrl, trackingPixelUrl }) => {
      const [React, { renderAsync }, { NewsletterEmail }] = await Promise.all([
        import('npm:react@18.3.1'),
        import('npm:@react-email/components@0.0.22'),
        import('./newsletter-email.tsx'),
      ])

      return {
        html: await renderAsync(
          React.createElement(NewsletterEmail, {
            lang: language,
            preheader,
            bodyHtml,
            unsubscribeUrl,
            trackingPixelUrl,
          }),
        ),
      }
    },

    /** I template transazionali restano registrati in `send-transactional-email`. */
    sendTemplate: async ({ templateName, recipientEmail, idempotencyKey, templateData }) => {
      const response = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ templateName, recipientEmail, idempotencyKey, templateData }),
      })

      if (!response.ok) {
        throw new Error(`${templateName} failed: ${await response.text()}`)
      }
    },

    getUserFromToken: async (token) => {
      const { data } = await (supabase as any).auth.getUser(token)
      const user = data?.user
      return user ? { id: user.id, email: user.email } : null
    },

    isServiceToken: (token) => isInjectedServiceKey(token) || token === serviceRoleKey,
    // pg_cron chiama col secret dedicato invece della service-role key, così lo
    // scheduler ha un segreto revocabile in autonomia. È lo stesso di
    // `process-email-queue`: non serve configurarne un secondo.
    cronSecret: () => Deno.env.get('EMAIL_QUEUE_CRON_SECRET'),

    preferenceDefaults: BITE_PREFERENCE_DEFAULTS,
    preferenceColumns: BITE_PREFERENCE_COLUMNS,
    automationDefaults: BITE_AUTOMATION_DEFAULTS,
  }
}

/**
 * Monta un handler del package come edge function.
 *
 * Centralizza le due cose che altrimenti si ripeterebbero in ogni function: il
 * controllo delle env di servizio e la creazione (memoizzata) del client
 * service-role. Il contesto è costruito su richiesta, non all'import, così una
 * env mancante resta un 500 gestito invece di un crash a cold start.
 */
export function serveNewsletter(
  createHandler: (source: () => NewsletterContext) => (request: Request) => Promise<Response>,
): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Newsletter function is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    Deno.serve(
      () =>
        new Response(JSON.stringify({ error: 'Server configuration error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    return
  }

  let cached: NewsletterContext | null = null
  const source = () => {
    if (!cached) {
      cached = createNewsletterContext({
        supabase: createClient(supabaseUrl, serviceRoleKey),
        supabaseUrl,
        serviceRoleKey,
      })
    }
    return cached
  }

  Deno.serve(createHandler(source))
}
