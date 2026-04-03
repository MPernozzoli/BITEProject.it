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

type ItemKind =
  | 'article_liked'
  | 'comment_liked'
  | 'article_commented'
  | 'comment_replied'

interface EngagementItem {
  actorName?: string | null
  articleTitle?: string | null
  articleUrl?: string | null
  articleImageUrl?: string | null
  createdAtLabel?: string | null
  kind?: ItemKind
  commentPreview?: string | null
}

interface EngagementNotificationProps {
  language?: string | null
  recipientName?: string | null
  category?: 'like' | 'comment'
  frequency?: 'instant' | 'daily' | 'weekly' | 'monthly' | 'none'
  items?: EngagementItem[] | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    preview: {
      like: 'Nuovi like sul tuo contenuto',
      comment: 'Nuovi commenti sul tuo contenuto',
    },
    eyebrow: {
      like: 'Like',
      comment: 'Commenti',
    },
    title: {
      like: {
        instant: 'Hai ricevuto un nuovo like.',
        daily: 'Riepilogo like delle ultime 24 ore.',
        weekly: 'Riepilogo like della settimana.',
        monthly: 'Riepilogo like del mese.',
        none: 'Aggiornamento like',
      },
      comment: {
        instant: 'Hai ricevuto un nuovo commento.',
        daily: 'Riepilogo commenti delle ultime 24 ore.',
        weekly: 'Riepilogo commenti della settimana.',
        monthly: 'Riepilogo commenti del mese.',
        none: 'Aggiornamento commenti',
      },
    },
    intro: (name: string, count: number, category: 'like' | 'comment', frequency: string) => {
      if (frequency === 'instant' && count === 1) {
        return `${name ? `${name}, ` : ''}c’è una nuova interazione sui tuoi contenuti pubblicati su BITE. Qui sotto trovi il dettaglio e il link diretto all’articolo.`
      }

      return `${name ? `${name}, ` : ''}ecco il riepilogo delle ${count} nuove interazioni di tipo ${category === 'like' ? 'like' : 'commento'} raccolte su BITE.`
    },
    primaryCta: 'Apri l’articolo',
    secondaryCta: 'Gestisci preferenze',
    articleFallback: 'Articolo',
    actorFallback: 'Qualcuno',
    kindLabel: {
      article_liked: 'ha messo like al tuo articolo',
      comment_liked: 'ha messo like a un tuo commento',
      article_commented: 'ha commentato il tuo articolo',
      comment_replied: 'ha risposto a un tuo commento',
    },
    footerReason:
      'Ricevi questa email perché hai attivato le notifiche per like o commenti sul tuo profilo BITE.',
    manageLabel: 'Puoi cambiare frequenza o disattivare queste notifiche nelle impostazioni profilo.',
  },
  en: {
    preview: {
      like: 'New likes on your content',
      comment: 'New comments on your content',
    },
    eyebrow: {
      like: 'Likes',
      comment: 'Comments',
    },
    title: {
      like: {
        instant: 'You received a new like.',
        daily: 'Your likes summary for the last 24 hours.',
        weekly: 'Your likes summary for the week.',
        monthly: 'Your likes summary for the month.',
        none: 'Likes update',
      },
      comment: {
        instant: 'You received a new comment.',
        daily: 'Your comment summary for the last 24 hours.',
        weekly: 'Your comment summary for the week.',
        monthly: 'Your comment summary for the month.',
        none: 'Comments update',
      },
    },
    intro: (name: string, count: number, category: 'like' | 'comment', frequency: string) => {
      if (frequency === 'instant' && count === 1) {
        return `${name ? `${name}, ` : ''}there is a new interaction on content you published on BITE. Below you will find the detail and the direct article link.`
      }

      return `${name ? `${name}, ` : ''}here is your summary of ${count} new ${category === 'like' ? 'likes' : 'comments'} collected on BITE.`
    },
    primaryCta: 'Open article',
    secondaryCta: 'Manage preferences',
    articleFallback: 'Article',
    actorFallback: 'Someone',
    kindLabel: {
      article_liked: 'liked your article',
      comment_liked: 'liked one of your comments',
      article_commented: 'commented on your article',
      comment_replied: 'replied to your comment',
    },
    footerReason:
      'You are receiving this email because like or comment notifications are enabled in your BITE profile.',
    manageLabel: 'You can change frequency or turn these notifications off in your profile settings.',
  },
} as const

const EngagementNotificationEmail = ({
  language,
  recipientName,
  category = 'comment',
  frequency = 'instant',
  items,
  unsubscribeUrl,
}: EngagementNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const greetingName = buildGreetingName(recipientName)
  const safeItems = items ?? []
  const firstItem = safeItems[0]
  const primaryUrl = firstItem?.articleUrl?.trim() || `${PUBLIC_SITE_URL}/journal`

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview[category]}
      eyebrow={copy.eyebrow[category]}
      title={copy.title[category][frequency]}
      heroImageUrl={firstItem?.articleImageUrl}
      heroCaption={firstItem?.articleTitle || copy.articleFallback}
      intro={
        <EmailBodyText>
          {copy.intro(greetingName, safeItems.length, category, frequency)}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.primaryCta, url: primaryUrl }}
      secondaryCta={{ label: copy.secondaryCta, url: `${PUBLIC_SITE_URL}/profile` }}
      footerReason={copy.footerReason}
      footerNote={<EmailBodyText muted>{copy.manageLabel}</EmailBodyText>}
      unsubscribeUrl={unsubscribeUrl}
    >
      {safeItems.map((item, index) => {
        const articleTitle = item.articleTitle?.trim() || copy.articleFallback
        const actorName = item.actorName?.trim() || copy.actorFallback
        const articleUrl = item.articleUrl?.trim() || `${PUBLIC_SITE_URL}/journal`
        const kindLabel = copy.kindLabel[item.kind ?? 'article_commented']

        return (
          <EmailCard key={`${articleUrl}-${index}`}>
            <EmailBodyText>
              <strong>{actorName}</strong> {kindLabel}
            </EmailBodyText>
            <EmailBodyText muted>
              <Link href={articleUrl} style={{ color: '#2d5356' }}>
                {articleTitle}
              </Link>
              {item.createdAtLabel ? ` · ${item.createdAtLabel}` : ''}
            </EmailBodyText>
            {item.commentPreview ? (
              <EmailBodyText muted>{item.commentPreview}</EmailBodyText>
            ) : null}
          </EmailCard>
        )
      })}
    </EditorialEmailShell>
  )
}

export const template = {
  component: EngagementNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const category = data.category === 'like' ? 'like' : 'comment'
    const frequency =
      typeof data.frequency === 'string' ? data.frequency : 'instant'
    const language = resolveEmailLanguage(
      typeof data.language === 'string' ? data.language : null
    )
    const items = Array.isArray(data.items) ? data.items : []
    const firstItem = (items[0] ?? {}) as Record<string, unknown>
    const articleTitle =
      typeof firstItem.articleTitle === 'string' ? firstItem.articleTitle.trim() : ''

    if (frequency === 'instant' && articleTitle) {
      return language === 'en'
        ? `New ${category} on "${articleTitle}" — BITE`
        : `Nuovo ${category === 'like' ? 'like' : 'commento'} su "${articleTitle}" — BITE`
    }

    if (language === 'en') {
      return `${category === 'like' ? 'Likes' : 'Comments'} summary (${items.length}) — BITE`
    }

    return `Riepilogo ${category === 'like' ? 'like' : 'commenti'} (${items.length}) — BITE`
  },
  displayName: 'Engagement notifications',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    category: 'comment',
    frequency: 'daily',
    items: [
      {
        actorName: 'Giulia',
        articleTitle: 'Capitolo 7: prove in mare',
        articleUrl: `${PUBLIC_SITE_URL}/logbook/capitolo-7-prove-in-mare`,
        articleImageUrl: `${PUBLIC_SITE_URL}/og-image.jpeg`,
        createdAtLabel: '3 apr 2026 · 08:10',
        kind: 'comment_replied',
        commentPreview: 'Grande passaggio sulla gestione del vento in uscita.',
      },
    ],
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-engagement`,
  },
} satisfies TemplateEntry
