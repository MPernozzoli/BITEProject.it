import * as React from 'npm:react@18.3.1'
import { Link } from 'npm:@react-email/components@0.0.22'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import type { TemplateEntry } from './registry.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailBodyText,
  EmailCard,
  resolveEmailLanguage,
} from './theme.tsx'

type NewsletterSubscriptionConfirmationProps = {
  language?: string | null
  recipientName?: string | null
  confirmationUrl?: string | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    preview: 'Conferma che vuoi ricevere gli Appunti dalla barca di BITE',
    eyebrow: 'Appunti dalla barca',
    title: 'Conferma la tua iscrizione.',
    primaryCta: 'Conferma iscrizione',
    secondaryCta: 'Scopri il logbook',
    intro: (name: string) =>
      `${name ? `${name}, ` : ''}abbiamo ricevuto la tua richiesta di iscrizione agli Appunti dalla barca di BITE. Per attivarla davvero, conferma dal pulsante qui sotto.`,
    cardTitle:
      'Ti manderemo solo contenuti editoriali, recap e aggiornamenti rilevanti. Nessuna iscrizione diventa attiva finché non confermi il tuo interesse.',
    footerReason:
      'Ricevi questa email perché qualcuno ha richiesto l’iscrizione agli Appunti dalla barca di BITE con questo indirizzo.',
    linkLabel: 'logbook di BITE',
    linkBody:
      'è il punto di partenza migliore per orientarti tra i contenuti già pubblicati.',
  },
  en: {
    preview: "Confirm that you want to receive BITE's Notes from the boat",
    eyebrow: 'Notes from the boat',
    title: 'Confirm your subscription.',
    primaryCta: 'Confirm subscription',
    secondaryCta: 'Explore the logbook',
    intro: (name: string) =>
      `${name ? `${name}, ` : ''}we received a request to subscribe this address to BITE's Notes from the boat. To activate it for real, confirm from the button below.`,
    cardTitle:
      'We only send editorial content, roundups, and relevant updates. No subscription becomes active until you confirm your interest.',
    footerReason:
      "You are receiving this email because someone requested a subscription to BITE's Notes from the boat with this address.",
    linkLabel: 'BITE logbook',
    linkBody: 'is the best place to start exploring what has already been published.',
  },
} as const

const NewsletterSubscriptionConfirmationEmail = ({
  language,
  recipientName,
  confirmationUrl,
  unsubscribeUrl,
}: NewsletterSubscriptionConfirmationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const greetingName = buildGreetingName(recipientName)

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title}
      intro={<EmailBodyText>{copy.intro(greetingName)}</EmailBodyText>}
      primaryCta={{
        label: copy.primaryCta,
        url: confirmationUrl?.trim() || `${PUBLIC_SITE_URL}/`,
      }}
      secondaryCta={{ label: copy.secondaryCta, url: `${PUBLIC_SITE_URL}/journal` }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailCard>
        <EmailBodyText>{copy.cardTitle}</EmailBodyText>
        <EmailBodyText muted>
          <Link href={`${PUBLIC_SITE_URL}/journal`} style={{ color: '#2d5356' }}>
            {copy.linkLabel}
          </Link>{' '}
          {copy.linkBody}
        </EmailBodyText>
      </EmailCard>
    </EditorialEmailShell>
  )
}

export const template = {
  component: NewsletterSubscriptionConfirmationEmail,
  subject: (data: Record<string, unknown>) =>
    resolveEmailLanguage(
      typeof data.language === 'string' ? data.language : null
    ) === 'en'
      ? "Confirm your subscription to BITE's Notes from the boat"
      : 'Conferma la tua iscrizione agli Appunti dalla barca di BITE',
  displayName: 'Newsletter subscription confirmation',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    confirmationUrl: `${PUBLIC_SITE_URL}/newsletter/confirm?token=preview-confirmation`,
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-confirmation`,
  },
} satisfies TemplateEntry
