import * as React from 'npm:react@18.3.1'
import { Link } from 'npm:@react-email/components@0.0.22'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import type { TemplateEntry } from './registry.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailArticleCard,
  EmailBodyText,
  EmailCard,
  resolveEmailLanguage,
} from './theme.tsx'

interface NewChapterProps {
  language?: string | null
  recipientName?: string | null
  storyTitle?: string | null
  articleTitle?: string | null
  articleExcerpt?: string | null
  articleUrl?: string | null
  storyUrl?: string
  heroImageUrl?: string | null
  storyImageUrl?: string | null
  publishedLabel?: string | null
  locationName?: string | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    preview: 'Nuovo articolo in una storia che segui',
    eyebrow: 'Nuova Pubblicazione',
    title: 'C’è un nuovo articolo in una storia che segui.',
    intro: (name: string, storyTitle: string) =>
      `${name ? `${name}, ` : ''}abbiamo pubblicato un nuovo capitolo in ${storyTitle}. Qui sotto trovi cover, contesto e link diretto per leggerlo subito.`,
    primaryCta: 'Leggi ora',
    secondaryCta: 'Apri la storia',
    readLabel: 'Leggi articolo',
    footerReason:
      'Ricevi questa email perché ti sei iscritto a una storia di BITE.',
    storyFallback: 'una storia che segui',
    articleFallback: 'Nuovo articolo',
    storyHintPrefix: 'Segui la storia',
    storyNote:
      'La pagina della storia resta il punto di accesso più comodo per recuperare anche i capitoli precedenti.',
  },
  en: {
    preview: 'New article in a story you follow',
    eyebrow: 'New Release',
    title: 'A new article just landed in a story you follow.',
    intro: (name: string, storyTitle: string) =>
      `${name ? `${name}, ` : ''}we just published a new chapter inside ${storyTitle}. Below you will find the cover, some context, and a direct link to read it right away.`,
    primaryCta: 'Read now',
    secondaryCta: 'Open the story',
    readLabel: 'Read article',
    footerReason:
      'You are receiving this email because you subscribed to a story on BITE.',
    storyFallback: 'a story you follow',
    articleFallback: 'New article',
    storyHintPrefix: 'Following story',
    storyNote:
      'The story page remains the easiest place to catch up on previous chapters as well.',
  },
} as const

const NewChapterNotificationEmail = ({
  language,
  recipientName,
  storyTitle,
  articleTitle,
  articleExcerpt,
  articleUrl,
  storyUrl,
  heroImageUrl,
  storyImageUrl,
  publishedLabel,
  locationName,
  unsubscribeUrl,
}: NewChapterProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const greetingName = buildGreetingName(recipientName)
  const resolvedStoryTitle = storyTitle?.trim() || copy.storyFallback
  const resolvedArticleTitle = articleTitle?.trim() || copy.articleFallback
  const resolvedArticleUrl = articleUrl?.trim() || `${PUBLIC_SITE_URL}/journal`

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title}
      heroImageUrl={heroImageUrl ?? storyImageUrl}
      heroCaption={`${copy.storyHintPrefix}: ${resolvedStoryTitle}`}
      intro={
        <EmailBodyText>
          {copy.intro(greetingName, resolvedStoryTitle)}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.primaryCta, url: resolvedArticleUrl }}
      secondaryCta={
        storyUrl ? { label: copy.secondaryCta, url: storyUrl } : null
      }
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailArticleCard
        article={{
          title: resolvedArticleTitle,
          excerpt: articleExcerpt,
          url: resolvedArticleUrl,
          coverImageUrl: heroImageUrl ?? storyImageUrl,
          storyTitle: resolvedStoryTitle,
          storyUrl,
          publishedLabel,
          locationName,
        }}
        readLabel={copy.readLabel}
      />
      {storyUrl ? (
        <EmailCard>
          <EmailBodyText muted>
            <Link href={storyUrl} style={{ color: '#2d5356' }}>
              {resolvedStoryTitle}
            </Link>{' '}
            {copy.storyNote}
          </EmailBodyText>
        </EmailCard>
      ) : null}
    </EditorialEmailShell>
  )
}

export const template = {
  component: NewChapterNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const articleTitle =
      typeof data.articleTitle === 'string' ? data.articleTitle.trim() : ''
    if (articleTitle) {
      return `${articleTitle} — BITE`
    }

    return resolveEmailLanguage(
      typeof data.language === 'string' ? data.language : null
    ) === 'en'
      ? 'New article published — BITE'
      : 'Nuovo articolo pubblicato — BITE'
  },
  displayName: 'Story article notification',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    storyTitle: 'Cronache di refit',
    articleTitle: 'Capitolo 3: motore e cablaggi',
    articleExcerpt:
      'Una giornata intera passata tra impianti, errori evitati per un pelo e una lunga lista di decisioni tecniche.',
    articleUrl: `${PUBLIC_SITE_URL}/logbook/capitolo-3-motore-e-cablaggi`,
    storyUrl: `${PUBLIC_SITE_URL}/logbook/story/cronache-di-refit`,
    heroImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
    storyImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
    publishedLabel: '1 apr 2026',
    locationName: 'Taranto',
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-story`,
  },
} satisfies TemplateEntry
