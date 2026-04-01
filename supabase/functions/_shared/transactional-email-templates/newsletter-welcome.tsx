import * as React from 'npm:react@18.3.1'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import type { TemplateEntry } from './registry.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailBodyText,
  EmailCard,
  resolveEmailLanguage,
} from './theme.tsx'

type NewsletterWelcomeProps = {
  language?: string | null
  recipientName?: string | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    preview: 'Benvenuto a bordo della newsletter di BITE',
    eyebrow: 'Benvenuto A Bordo',
    title: 'La newsletter di BITE parte da qui.',
    intro: (name: string) =>
      `${name ? `${name}, ` : ''}benvenuto a bordo. Useremo questa casella per mandarti nuove storie, aggiornamenti da Spritz e raccolte periodiche dei pezzi più importanti.`,
    primaryCta: 'Leggi il diario',
    secondaryCta: 'Scopri il progetto',
    cards: [
      'Nuovi articoli appena pubblicati, con link diretti.',
      'Storie a cui sei iscritto, recap periodici e selezioni editoriali.',
      'Un tono visivo coerente con il sito: niente template anonimi, solo BITE.',
    ],
    footerReason:
      'Hai ricevuto questa email perché la tua iscrizione alla newsletter è attiva.',
  },
  en: {
    preview: 'Welcome aboard the BITE newsletter',
    eyebrow: 'Welcome Aboard',
    title: 'The BITE newsletter starts here.',
    intro: (name: string) =>
      `${name ? `${name}, ` : ''}welcome aboard. We will use this inbox to send new stories, updates from Spritz, and periodic roundups of the most relevant pieces we publish.`,
    primaryCta: 'Read the journal',
    secondaryCta: 'Explore the project',
    cards: [
      'Freshly published articles with direct links.',
      'Story notifications, periodic digests, and editorial selections.',
      'A visual language that matches the site instead of a generic email template.',
    ],
    footerReason:
      'You are receiving this because your newsletter subscription is active.',
  },
} as const

const NewsletterWelcomeEmail = ({
  language,
  recipientName,
  unsubscribeUrl,
}: NewsletterWelcomeProps) => {
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
      primaryCta={{ label: copy.primaryCta, url: `${PUBLIC_SITE_URL}/journal` }}
      secondaryCta={{ label: copy.secondaryCta, url: `${PUBLIC_SITE_URL}/about` }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      {copy.cards.map((item) => (
        <EmailCard key={item}>
          <EmailBodyText>{item}</EmailBodyText>
        </EmailCard>
      ))}
    </EditorialEmailShell>
  )
}

export const template = {
  component: NewsletterWelcomeEmail,
  subject: (data: Record<string, unknown>) =>
    resolveEmailLanguage(
      typeof data.language === 'string' ? data.language : null
    ) === 'en'
      ? 'Welcome to the BITE newsletter'
      : 'Benvenuto nella newsletter di BITE',
  displayName: 'Newsletter welcome',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-welcome`,
  },
} satisfies TemplateEntry
