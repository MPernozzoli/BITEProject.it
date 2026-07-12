import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailBodyText,
  EmailCard,
  resolveEmailLanguage,
} from './theme.tsx'

interface VoyageParticipantInviteProps {
  language?: string | null
  recipientName?: string | null
  inviterName?: string | null
  voyageName?: string | null
  legs?: string[] | null
  requiresPayment?: boolean | null
  depositEur?: number | null
  bookingUrl?: string | null
}

const COPY = {
  it: {
    eyebrow: 'Invito a bordo',
    preview: 'Sei stato invitato a partecipare a un viaggio su BITE',
    title: 'Sei stato invitato a bordo.',
    intro: (name: string, inviter: string, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      const by = inviter ? `${inviter} ti ha` : 'Ti hanno'
      return `${prefix}${by} invitato a partecipare a ${voyageName}. BITE non è un charter o un'attività commerciale: è un viaggio privato con condivisione equa delle spese vive. Per prendere parte al viaggio devi avere un tuo account sul portale BITE.`
    },
    steps: 'Cosa fare',
    stepRegister: 'Accedi o iscriviti al portale con questa email.',
    stepAccept: 'Apri le tue prenotazioni, accetta l\'invito e le condizioni di partecipazione.',
    stepPay: 'Versa la tua quota equa di contributo alle spese vive del viaggio per confermare la partecipazione.',
    noPay: 'Per questo viaggio il contributo è già coperto da chi ti ha invitato: dovrai solo accettare le condizioni.',
    deposit: 'Quota contributo viaggio',
    cta: 'Vai alle prenotazioni',
    voyageFallback: 'un viaggio',
    legsTitle: 'Tratte',
    footerReason: 'Ricevi questa email perché sei stato invitato a un viaggio su BITE.',
  },
  en: {
    eyebrow: 'Invitation aboard',
    preview: 'You have been invited to join a voyage on BITE',
    title: 'You have been invited aboard.',
    intro: (name: string, inviter: string, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      const by = inviter ? `${inviter} has` : 'You have been'
      return `${prefix}${by} invited you to join ${voyageName}. BITE is not a charter or a commercial activity: it is a private voyage with fair sharing of out-of-pocket costs. To take part you need your own account on the BITE portal.`
    },
    steps: 'What to do',
    stepRegister: 'Sign in or register on the portal with this email.',
    stepAccept: 'Open your bookings, accept the invitation and the participation terms.',
    stepPay: 'Pay your fair-share contribution to the voyage out-of-pocket costs to confirm participation.',
    noPay: 'For this voyage your contribution is already covered by whoever invited you: you only need to accept the terms.',
    deposit: 'Voyage contribution share',
    cta: 'Go to bookings',
    voyageFallback: 'a voyage',
    legsTitle: 'Legs',
    footerReason: 'You are receiving this email because you were invited to a voyage on BITE.',
  },
} as const

const VoyageParticipantInviteEmail = ({
  language,
  recipientName,
  inviterName,
  voyageName,
  legs,
  requiresPayment,
  depositEur,
  bookingUrl,
}: VoyageParticipantInviteProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/bookings`
  const depositLabel =
    typeof depositEur === 'number' && depositEur > 0
      ? new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-IE', {
          style: 'currency',
          currency: 'EUR',
        }).format(depositEur)
      : null

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title}
      intro={
        <EmailBodyText>
          {copy.intro(buildGreetingName(recipientName), inviterName?.trim() || '', resolvedVoyageName)}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.cta, url: resolvedBookingUrl }}
      footerReason={copy.footerReason}
    >
      <EmailCard>
        <EmailBodyText>
          <strong>{resolvedVoyageName}</strong>
        </EmailBodyText>
        {safeLegs.length ? (
          <EmailBodyText muted>
            {copy.legsTitle}: {safeLegs.join(' · ')}
          </EmailBodyText>
        ) : null}
        {requiresPayment && depositLabel ? (
          <EmailBodyText muted>
            {copy.deposit}: {depositLabel}
          </EmailBodyText>
        ) : null}
      </EmailCard>

      <EmailCard>
        <EmailBodyText>
          <strong>{copy.steps}</strong>
        </EmailBodyText>
        <EmailBodyText muted>1. {copy.stepRegister}</EmailBodyText>
        <EmailBodyText muted>2. {copy.stepAccept}</EmailBodyText>
        {requiresPayment ? (
          <EmailBodyText muted>3. {copy.stepPay}</EmailBodyText>
        ) : (
          <EmailBodyText muted>{copy.noPay}</EmailBodyText>
        )}
      </EmailCard>
    </EditorialEmailShell>
  )
}

export const template = {
  component: VoyageParticipantInviteEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const title = language === 'it' ? 'Sei invitato a bordo' : 'You are invited aboard'
    return voyageName ? `${title}: ${voyageName} — BITE` : `${title} — BITE`
  },
  displayName: 'Voyage participant invite',
  previewData: {
    language: 'it',
    recipientName: 'Giulia',
    inviterName: 'Massimo',
    voyageName: 'Mediterraneo 2026',
    legs: ['Palermo → Cagliari'],
    requiresPayment: true,
    depositEur: 50,
    bookingUrl: `${PUBLIC_SITE_URL}/bookings`,
  },
} satisfies TemplateEntry
