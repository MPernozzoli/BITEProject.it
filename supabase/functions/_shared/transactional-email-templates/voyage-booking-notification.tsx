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

type BookingEvent =
  | 'requested'
  | 'waitlisted'
  | 'admin_approved'
  | 'user_confirmed'
  | 'cancelled'
  | 'rejected'
  | 'promoted_from_waitlist'
  | 'manual_added'

interface VoyageBookingNotificationProps {
  language?: string | null
  recipientName?: string | null
  eventType?: BookingEvent | string | null
  voyageName?: string | null
  legs?: string[] | null
  partySize?: number | null
  bookingUrl?: string | null
  message?: string | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    eyebrow: 'Booking imbarco',
    preview: 'Aggiornamento sulla tua richiesta di imbarco',
    title: {
      requested: 'Richiesta di imbarco ricevuta.',
      waitlisted: 'Sei in waiting list.',
      admin_approved: 'La tua richiesta e pronta per la conferma.',
      user_confirmed: 'Imbarco confermato.',
      cancelled: 'Booking annullato.',
      rejected: 'Richiesta non confermata.',
      promoted_from_waitlist: 'Si e liberato un posto.',
      manual_added: 'Sei stato aggiunto a un booking.',
    },
    intro: (name: string, eventType: BookingEvent, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'admin_approved') return `${prefix}la richiesta per ${voyageName} e stata approvata. Apri la tua area booking per confermare.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}si e liberata disponibilita su ${voyageName}: la tua richiesta e tornata in revisione.`
      if (eventType === 'waitlisted') return `${prefix}al momento i posti selezionati per ${voyageName} sono pieni. Ti avviseremo se si libera disponibilita.`
      if (eventType === 'user_confirmed') return `${prefix}il tuo imbarco su ${voyageName} e confermato.`
      if (eventType === 'cancelled') return `${prefix}il booking per ${voyageName} e stato annullato.`
      if (eventType === 'rejected') return `${prefix}la richiesta per ${voyageName} non e stata confermata.`
      if (eventType === 'manual_added') return `${prefix}sei stato aggiunto manualmente al booking per ${voyageName}.`
      return `${prefix}abbiamo ricevuto la tua richiesta di imbarco per ${voyageName}.`
    },
    cta: 'Apri booking',
    voyageFallback: 'questo viaggio',
    legsTitle: 'Tratte',
    partySize: 'Persone',
    footerReason: 'Ricevi questa email perche hai una richiesta di imbarco su BITE.',
  },
  en: {
    eyebrow: 'Voyage booking',
    preview: 'Update about your voyage booking request',
    title: {
      requested: 'Your berth request was received.',
      waitlisted: 'You are on the waiting list.',
      admin_approved: 'Your request is ready to confirm.',
      user_confirmed: 'Berth confirmed.',
      cancelled: 'Booking cancelled.',
      rejected: 'Request not confirmed.',
      promoted_from_waitlist: 'A berth became available.',
      manual_added: 'You were added to a booking.',
    },
    intro: (name: string, eventType: BookingEvent, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'admin_approved') return `${prefix}your request for ${voyageName} was approved. Open your booking area to confirm.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}availability opened on ${voyageName}: your request is back in review.`
      if (eventType === 'waitlisted') return `${prefix}the selected legs for ${voyageName} are currently full. We will notify you if availability opens.`
      if (eventType === 'user_confirmed') return `${prefix}your berth on ${voyageName} is confirmed.`
      if (eventType === 'cancelled') return `${prefix}your booking for ${voyageName} was cancelled.`
      if (eventType === 'rejected') return `${prefix}your request for ${voyageName} was not confirmed.`
      if (eventType === 'manual_added') return `${prefix}you were manually added to the booking for ${voyageName}.`
      return `${prefix}we received your berth request for ${voyageName}.`
    },
    cta: 'Open bookings',
    voyageFallback: 'this voyage',
    legsTitle: 'Legs',
    partySize: 'People',
    footerReason: 'You are receiving this email because you have a voyage booking request on BITE.',
  },
} as const

function normalizeEventType(value?: string | null): BookingEvent {
  const allowed: BookingEvent[] = [
    'requested',
    'waitlisted',
    'admin_approved',
    'user_confirmed',
    'cancelled',
    'rejected',
    'promoted_from_waitlist',
    'manual_added',
  ]
  return allowed.includes(value as BookingEvent) ? (value as BookingEvent) : 'requested'
}

const VoyageBookingNotificationEmail = ({
  language,
  recipientName,
  eventType,
  voyageName,
  legs,
  partySize,
  bookingUrl,
  message,
  unsubscribeUrl,
}: VoyageBookingNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/bookings`

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title[normalizedEventType]}
      intro={
        <EmailBodyText>
          {copy.intro(buildGreetingName(recipientName), normalizedEventType, resolvedVoyageName)}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.cta, url: resolvedBookingUrl }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailCard>
        <EmailBodyText>
          <strong>{resolvedVoyageName}</strong>
        </EmailBodyText>
        {partySize ? (
          <EmailBodyText muted>
            {copy.partySize}: {partySize}
          </EmailBodyText>
        ) : null}
        {safeLegs.length ? (
          <EmailBodyText muted>
            {copy.legsTitle}: {safeLegs.join(' · ')}
          </EmailBodyText>
        ) : null}
        {message?.trim() ? <EmailBodyText muted>{message.trim()}</EmailBodyText> : null}
      </EmailCard>
    </EditorialEmailShell>
  )
}

export const template = {
  component: VoyageBookingNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const eventType = normalizeEventType(typeof data.eventType === 'string' ? data.eventType : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const title = COPY[language].title[eventType]
    return voyageName ? `${title} ${voyageName} — BITE` : `${title} — BITE`
  },
  displayName: 'Voyage booking notifications',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    eventType: 'admin_approved',
    voyageName: 'Mediterraneo 2026',
    legs: ['Palermo → Cagliari', 'Cagliari → Mahon'],
    partySize: 2,
    bookingUrl: `${PUBLIC_SITE_URL}/bookings`,
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-booking`,
  },
} satisfies TemplateEntry
