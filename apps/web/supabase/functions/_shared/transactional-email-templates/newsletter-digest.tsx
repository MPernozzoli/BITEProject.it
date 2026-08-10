import * as React from 'npm:react@18.3.1'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import type { TemplateEntry } from './registry.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailArticleCard,
  EmailBodyText,
  EmailCard,
  type EmailArticleItem,
  resolveEmailLanguage,
} from './theme.tsx'

type NewsletterDigestProps = {
  language?: string | null
  recipientName?: string | null
  issueLabel?: string | null
  periodLabel?: string | null
  articleCount?: number | null
  heroImageUrl?: string | null
  articles?: EmailArticleItem[]
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    eyebrow: 'Notizie Di Bordo',
    preview: 'Le ultime notizie di bordo di BITE',
    title: 'Le notizie di bordo',
    intro: (count: number, name: string) => {
      const verb = count === 1 ? 'aspetta' : 'aspettano'
      const noun = count === 1 ? 'nuovo articolo' : 'nuovi articoli'
      return `${name ? `${name}, ti` : 'Ti'} ${verb} ${count} ${noun} da leggere questa settimana.`
    },
    primaryCta: 'Apri il diario di bordo',
    readLabel: 'Leggi articolo',
    empty: 'Questa settimana non ci sono nuove notizie di bordo da condividere.',
    footerReason: 'Ricevi le notizie di bordo perché sei iscritto agli Appunti dalla barca di BITE.',
  },
  en: {
    eyebrow: 'Onboard News',
    preview: 'The latest onboard news from BITE',
    title: 'The latest onboard news',
    intro: (count: number, name: string) => {
      const verb = count === 1 ? 'is' : 'are'
      const noun = count === 1 ? 'new article' : 'new articles'
      return `${name ? `${name}, ` : ''}${count} ${noun} ${verb} waiting for you to read this week.`
    },
    primaryCta: 'Open the logbook',
    readLabel: 'Read article',
    empty: 'No onboard news to share this week.',
    footerReason: "You're receiving onboard news because you're subscribed to BITE's Notes from the boat.",
  },
} as const

const NewsletterDigestEmail = ({
  language,
  recipientName,
  periodLabel,
  articleCount,
  heroImageUrl,
  articles,
  unsubscribeUrl,
}: NewsletterDigestProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const resolvedArticles = articles ?? []
  const resolvedCount = articleCount ?? resolvedArticles.length
  const greetingName = buildGreetingName(recipientName)

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title}
      heroImageUrl={heroImageUrl ?? resolvedArticles[0]?.coverImageUrl}
      heroCaption={periodLabel}
      intro={<EmailBodyText>{copy.intro(resolvedCount, greetingName)}</EmailBodyText>}
      primaryCta={{ label: copy.primaryCta, url: `${PUBLIC_SITE_URL}/journal` }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      {resolvedArticles.length > 0 ? (
        resolvedArticles.map((article) => (
          <EmailArticleCard
            key={`${article.url}:${article.title}`}
            article={article}
            readLabel={copy.readLabel}
          />
        ))
      ) : (
        <EmailCard>
          <EmailBodyText>{copy.empty}</EmailBodyText>
        </EmailCard>
      )}
    </EditorialEmailShell>
  )
}

export const template = {
  component: NewsletterDigestEmail,
  subject: (data: Record<string, unknown>) =>
    typeof data.issueLabel === 'string' && data.issueLabel.trim()
      ? `${data.issueLabel.trim()} — BITE`
      : resolveEmailLanguage(
            typeof data.language === 'string' ? data.language : null
          ) === 'en'
        ? 'Onboard news — BITE'
        : 'Notizie di bordo — BITE',
  displayName: 'Newsletter digest',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    issueLabel: 'Notizie di bordo',
    periodLabel: '1 aprile 2026',
    articleCount: 2,
    heroImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-digest`,
    articles: [
      {
        title: 'Vivere a bordo davvero',
        excerpt:
          'Cosa cambia quando la barca non è una vacanza ma casa, studio, officina e mezzo di trasporto insieme.',
        url: `${PUBLIC_SITE_URL}/logbook/vivere-a-bordo-davvero`,
        coverImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
        storyTitle: 'Vita a bordo',
        storyUrl: `${PUBLIC_SITE_URL}/journal`,
        publishedLabel: '1 apr 2026',
      },
      {
        title: 'Refit di primavera',
        excerpt:
          'Una settimana di piccoli lavori, riparazioni e decisioni tecniche che fanno la differenza in navigazione.',
        url: `${PUBLIC_SITE_URL}/logbook/refit-di-primavera`,
        coverImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
        publishedLabel: '30 mar 2026',
        locationName: 'Puglia',
      },
    ],
  },
} satisfies TemplateEntry
