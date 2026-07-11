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

type AdminBookingEvent = 'admin_new_booking' | 'admin_cancelled' | 'admin_modified'

interface VoyageBookingAdminNotificationProps {
  language?: string | null
  recipientName?: string | null
  eventType?: AdminBookingEvent | string | null
  voyageName?: string | null
  legs?: string[] | null
  partySize?: number | null
  travelerName?: string | null
  travelerEmail?: string | null
  bookingUrl?: string | null
  message?: string | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    eyebrow: 'Booking imbarco · Admin',
    preview: 'Aggiornamento su una prenotazione di imbarco',
    title: {
      admin_new_booking: 'Nuova richiesta di imbarco.',
      admin_cancelled: 'Un booking e stato annullato.',
      admin_modified: 'Un booking e stato aggiornato.',
    },
    intro: (name: string, eventType: AdminBookingEvent, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'Un utente'
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} ha annullato la propria prenotazione per ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} ha aggiornato la propria prenotazione per ${voyageName}.`
      return `${prefix}${traveler} ha inviato una nuova richiesta di imbarco per ${voyageName}.`
    },
    cta: 'Apri gestione booking',
    voyageFallback: 'un viaggio',
    legsTitle: 'Tratte',
    partySize: 'Persone',
    travelerTitle: 'Richiedente',
    footerReason: 'Ricevi questa email perche sei amministratore su BITE.',
  },
  en: {
    eyebrow: 'Voyage booking · Admin',
    preview: 'Update about a voyage booking',
    title: {
      admin_new_booking: 'New berth request.',
      admin_cancelled: 'A booking was cancelled.',
      admin_modified: 'A booking was updated.',
    },
    intro: (name: string, eventType: AdminBookingEvent, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'A user'
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} cancelled their booking for ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} updated their booking for ${voyageName}.`
      return `${prefix}${traveler} submitted a new berth request for ${voyageName}.`
    },
    cta: 'Open booking management',
    voyageFallback: 'a voyage',
    legsTitle: 'Legs',
    partySize: 'People',
    travelerTitle: 'Requester',
    footerReason: 'You are receiving this email because you are an admin on BITE.',
  },
} as const

function normalizeEventType(value?: string | null): AdminBookingEvent {
  const allowed: AdminBookingEvent[] = ['admin_new_booking', 'admin_cancelled', 'admin_modified']
  return allowed.includes(value as AdminBookingEvent) ? (value as AdminBookingEvent) : 'admin_new_booking'
}

const VoyageBookingAdminNotificationEmail = ({
  language,
  recipientName,
  eventType,
  voyageName,
  legs,
  partySize,
  travelerName,
  travelerEmail,
  bookingUrl,
  message,
  unsubscribeUrl,
}: VoyageBookingAdminNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/admin/bookings`
  const resolvedTravelerName = travelerName?.trim() || ''

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview}
      eyebrow={copy.eyebrow}
      title={copy.title[normalizedEventType]}
      intro={
        <EmailBodyText>
          {copy.intro(buildGreetingName(recipientName), normalizedEventType, resolvedVoyageName, resolvedTravelerName)}
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
        {resolvedTravelerName || travelerEmail ? (
          <EmailBodyText muted>
            {copy.travelerTitle}: {[resolvedTravelerName, travelerEmail].filter(Boolean).join(' · ')}
          </EmailBodyText>
        ) : null}
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
  component: VoyageBookingAdminNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const eventType = normalizeEventType(typeof data.eventType === 'string' ? data.eventType : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const title = COPY[language].title[eventType]
    return voyageName ? `${title} ${voyageName} — BITE` : `${title} — BITE`
  },
  displayName: 'Voyage booking admin notifications',
  previewData: {
    language: 'it',
    recipientName: 'Admin',
    eventType: 'admin_new_booking',
    voyageName: 'Mediterraneo 2026',
    legs: ['Palermo → Cagliari', 'Cagliari → Mahon'],
    partySize: 2,
    travelerName: 'Massimo Pernozzoli',
    travelerEmail: 'massimo@example.com',
    bookingUrl: `${PUBLIC_SITE_URL}/admin/bookings`,
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-booking-admin`,
  },
} satisfies TemplateEntry
