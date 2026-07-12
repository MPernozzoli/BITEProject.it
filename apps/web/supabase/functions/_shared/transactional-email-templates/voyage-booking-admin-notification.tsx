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

type AdminBookingEvent =
  | 'admin_new_booking'
  | 'admin_cancelled'
  | 'admin_modified'
  | 'admin_payment_pending'
  | 'admin_payment_received'
  | 'admin_plan_change'

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
  amountEur?: number | null
  paymentReference?: string | null
  oldLegs?: string[] | null
  proposedLegs?: string[] | null
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
      admin_payment_pending: 'Pagamento booking in sospeso.',
      admin_payment_received: 'Pagamento booking ricevuto.',
      admin_plan_change: 'Cambio planning da approvare.',
    },
    intro: (name: string, eventType: AdminBookingEvent, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'Un utente'
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} ha annullato la propria prenotazione per ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} ha aggiornato la propria prenotazione per ${voyageName}.`
      if (eventType === 'admin_payment_pending') return `${prefix}${traveler} ha avviato un pagamento per ${voyageName}.`
      if (eventType === 'admin_payment_received') return `${prefix}pagamento ricevuto per la prenotazione di ${traveler} su ${voyageName}.`
      if (eventType === 'admin_plan_change') return `${prefix}la prenotazione di ${traveler} su ${voyageName} richiede approvazione del cambio planning.`
      return `${prefix}${traveler} ha inviato una nuova richiesta di imbarco per ${voyageName}.`
    },
    cta: 'Apri gestione booking',
    voyageFallback: 'un viaggio',
    legsTitle: 'Tratte',
    oldLegsTitle: 'Prima',
    proposedLegsTitle: 'Proposta',
    partySize: 'Persone',
    amount: 'Importo',
    paymentReference: 'Riferimento',
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
      admin_payment_pending: 'Booking payment pending.',
      admin_payment_received: 'Booking payment received.',
      admin_plan_change: 'Plan change approval needed.',
    },
    intro: (name: string, eventType: AdminBookingEvent, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'A user'
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} cancelled their booking for ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} updated their booking for ${voyageName}.`
      if (eventType === 'admin_payment_pending') return `${prefix}${traveler} started a payment for ${voyageName}.`
      if (eventType === 'admin_payment_received') return `${prefix}payment received for ${traveler}'s booking on ${voyageName}.`
      if (eventType === 'admin_plan_change') return `${prefix}${traveler}'s booking on ${voyageName} needs plan-change approval.`
      return `${prefix}${traveler} submitted a new berth request for ${voyageName}.`
    },
    cta: 'Open booking management',
    voyageFallback: 'a voyage',
    legsTitle: 'Legs',
    oldLegsTitle: 'Before',
    proposedLegsTitle: 'Proposed',
    partySize: 'People',
    amount: 'Amount',
    paymentReference: 'Reference',
    travelerTitle: 'Requester',
    footerReason: 'You are receiving this email because you are an admin on BITE.',
  },
} as const

function normalizeEventType(value?: string | null): AdminBookingEvent {
  const allowed: AdminBookingEvent[] = [
    'admin_new_booking',
    'admin_cancelled',
    'admin_modified',
    'admin_payment_pending',
    'admin_payment_received',
    'admin_plan_change',
  ]
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
  amountEur,
  paymentReference,
  oldLegs,
  proposedLegs,
  unsubscribeUrl,
}: VoyageBookingAdminNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/admin/bookings`
  const resolvedTravelerName = travelerName?.trim() || ''
  const safeOldLegs = oldLegs?.filter((item) => item?.trim()) ?? []
  const safeProposedLegs = proposedLegs?.filter((item) => item?.trim()) ?? []
  const amountLabel =
    typeof amountEur === 'number' && amountEur > 0
      ? new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-IE', {
          style: 'currency',
          currency: 'EUR',
        }).format(amountEur)
      : null

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
        {amountLabel ? <EmailBodyText muted>{copy.amount}: {amountLabel}</EmailBodyText> : null}
        {paymentReference ? <EmailBodyText muted>{copy.paymentReference}: {paymentReference}</EmailBodyText> : null}
        {safeOldLegs.length ? (
          <EmailBodyText muted>
            {copy.oldLegsTitle}: {safeOldLegs.join(' · ')}
          </EmailBodyText>
        ) : null}
        {safeProposedLegs.length ? (
          <EmailBodyText muted>
            {copy.proposedLegsTitle}: {safeProposedLegs.join(' · ')}
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
