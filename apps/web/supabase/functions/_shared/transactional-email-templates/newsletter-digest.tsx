import * as React from 'npm:react@18.3.1'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import type { TemplateEntry } from './registry.ts'
import {
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
    eyebrow: 'Digest',
    preview: 'Tutti gli articoli usciti di recente su BITE',
    title: (periodLabel?: string | null) =>
      periodLabel?.trim() ? `Il recap di ${periodLabel}` : 'Il recap degli ultimi articoli',
    intro: (count: number) =>
      `Qui trovi ${count} articol${count === 1 ? 'o' : 'i'} pubblicat${count === 1 ? 'o' : 'i'} di recente, con link diretti e cover.`,
    primaryCta: 'Apri il logbook',
    readLabel: 'Leggi articolo',
    empty: 'In questa finestra non ci sono nuovi articoli da inviare.',
    footerReason: 'Ricevi questo digest perché sei iscritto agli Appunti dalla barca di BITE.',
  },
  en: {
    eyebrow: 'Digest',
    preview: 'All the latest articles published on BITE',
    title: (periodLabel?: string | null) =>
      periodLabel?.trim() ? `Your ${periodLabel} roundup` : 'Your latest article roundup',
    intro: (count: number) =>
      `Here are ${count} recently published article${count === 1 ? '' : 's'}, each with a direct link and cover image.`,
    primaryCta: 'Open the logbook',
    readLabel: 'Read article',
    empty: 'There are no new articles in this window.',
    footerReason: "You are receiving this digest because you subscribed to BITE's Notes from the boat.",
  },
} as const

const NewsletterDigestEmail = ({
  language,
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

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title(periodLabel)}
      heroImageUrl={heroImageUrl ?? resolvedArticles[0]?.coverImageUrl}
      intro={<EmailBodyText>{copy.intro(resolvedCount)}</EmailBodyText>}
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
        ? 'BITE article digest'
        : 'Digest articoli BITE',
  displayName: 'Newsletter digest',
  previewData: {
    language: 'it',
    issueLabel: 'Digest settimanale',
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
