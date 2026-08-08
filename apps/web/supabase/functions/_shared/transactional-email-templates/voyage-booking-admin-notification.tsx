import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailBodyText,
  EmailCallout,
  EmailCard,
  EmailDetailRow,
  EmailHighlightBox,
  EmailRouteBox,
  EmailSectionLabel,
  EmailSignalPills,
  resolveEmailLanguage,
} from './theme.tsx'

type AdminBookingEvent =
  | 'admin_new_booking'
  | 'admin_cancelled'
  | 'admin_modified'
  | 'admin_payment_pending'
  | 'admin_payment_received'
  | 'admin_plan_change'
  | 'admin_balance_deadline_missed'

/**
 * A delay reaches admins as admin_plan_change, but there is nothing to approve:
 * the admin recorded the actual themselves and this is the receipt that the
 * travellers were told.
 */
type AdminTemplateVariant = AdminBookingEvent | 'schedule_delayed'

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
  paymentMethod?: string | null
  paymentReference?: string | null
  changeKind?: string | null
  oldLegs?: string[] | null
  proposedLegs?: string[] | null
  unsubscribeUrl?: string | null
  /** For admin_balance_deadline_missed: 'booking' (whole booking lapsed) or 'participant' (one guest's seat lapsed). */
  scope?: string | null
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
      schedule_delayed: 'Viaggio in ritardo: avvisati.',
      admin_balance_deadline_missed: 'Saldo non versato entro la scadenza.',
    },
    intro: (name: string, eventType: AdminTemplateVariant, voyageName: string, travelerName: string, scope?: string | null) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'Un utente'
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} ha sforato la finestra di partenza prevista e le date si sono spostate. ${traveler} e stato avvisato: non serve approvare nulla, ma puo chiedere di annullare con rimborso completo.`
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} ha annullato la propria prenotazione per ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} ha aggiornato la propria prenotazione per ${voyageName}.`
      if (eventType === 'admin_payment_pending') return `${prefix}${traveler} ha avviato un pagamento per ${voyageName}.`
      if (eventType === 'admin_payment_received') return `${prefix}pagamento ricevuto per la prenotazione di ${traveler} su ${voyageName}.`
      if (eventType === 'admin_plan_change') return `${prefix}la prenotazione di ${traveler} su ${voyageName} richiede approvazione del cambio planning.`
      if (eventType === 'admin_balance_deadline_missed' && scope === 'participant')
        return `${prefix}un ospite non ha versato il proprio saldo entro la scadenza su ${voyageName}: la sua partecipazione e stata annullata automaticamente e il posto liberato. Il resto della prenotazione di ${traveler} resta confermato. L'acconto e trattenuto di default; puoi comunque rimborsarlo dalla pagina Rimborsi.`
      if (eventType === 'admin_balance_deadline_missed')
        return `${prefix}${traveler} non ha versato il saldo entro la scadenza su ${voyageName}: la prenotazione e stata annullata automaticamente. L'acconto e trattenuto di default; puoi comunque rimborsarlo dalla pagina Rimborsi.`
      return `${prefix}${traveler} ha inviato una nuova richiesta di imbarco per ${voyageName}.`
    },
    cta: 'Apri gestione booking',
    voyageFallback: 'un viaggio',
    summaryTitle: 'Riepilogo operativo',
    planTitle: 'Cambio planning',
    legsTitle: 'Tratte',
    oldLegsTitle: 'Prima',
    proposedLegsTitle: 'Proposta',
    partySize: 'Persone',
    amount: 'Importo',
    paymentMethod: 'Metodo',
    paymentReference: 'Riferimento',
    travelerTitle: 'Richiedente',
    bankTransferPendingIntro: (name: string, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'Un utente'
      return `${prefix}${traveler} ha scelto il bonifico per ${voyageName}. Non esaminare la candidatura finche Bunq non conferma importo corretto e causale.`
    },
    paymentMethodLabels: {
      bank_transfer: 'Bonifico',
      bunq_link: 'Carta / Apple Pay / Google Pay',
    },
    status: {
      admin_new_booking: 'Nuova richiesta',
      admin_cancelled: 'Annullato',
      admin_modified: 'Aggiornato',
      admin_payment_pending: 'Pagamento in sospeso',
      admin_payment_received: 'Pagamento ricevuto',
      admin_plan_change: 'Da approvare',
      schedule_delayed: 'In ritardo',
      admin_balance_deadline_missed: 'Decaduto per mancato saldo',
    },
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
      schedule_delayed: 'Voyage running late: travellers told.',
      admin_balance_deadline_missed: 'Balance deadline missed.',
    },
    intro: (name: string, eventType: AdminTemplateVariant, voyageName: string, travelerName: string, scope?: string | null) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'A user'
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} slipped past its planned departure window and the dates moved. ${traveler} was notified: nothing needs approving, but they can ask to cancel with a full refund.`
      if (eventType === 'admin_cancelled') return `${prefix}${traveler} cancelled their booking for ${voyageName}.`
      if (eventType === 'admin_modified') return `${prefix}${traveler} updated their booking for ${voyageName}.`
      if (eventType === 'admin_payment_pending') return `${prefix}${traveler} started a payment for ${voyageName}.`
      if (eventType === 'admin_payment_received') return `${prefix}payment received for ${traveler}'s booking on ${voyageName}.`
      if (eventType === 'admin_plan_change') return `${prefix}${traveler}'s booking on ${voyageName} needs plan-change approval.`
      if (eventType === 'admin_balance_deadline_missed' && scope === 'participant')
        return `${prefix}a guest did not pay their balance by the deadline on ${voyageName}: their participation was cancelled automatically and the seat released. The rest of ${traveler}'s booking stays confirmed. The deposit is withheld by default; you can still refund it from the Refunds page.`
      if (eventType === 'admin_balance_deadline_missed')
        return `${prefix}${traveler} did not pay the balance by the deadline on ${voyageName}: the booking was cancelled automatically. The deposit is withheld by default; you can still refund it from the Refunds page.`
      return `${prefix}${traveler} submitted a new berth request for ${voyageName}.`
    },
    cta: 'Open booking management',
    voyageFallback: 'a voyage',
    summaryTitle: 'Operational summary',
    planTitle: 'Plan change',
    legsTitle: 'Legs',
    oldLegsTitle: 'Before',
    proposedLegsTitle: 'Proposed',
    partySize: 'People',
    amount: 'Amount',
    paymentMethod: 'Method',
    paymentReference: 'Reference',
    travelerTitle: 'Requester',
    bankTransferPendingIntro: (name: string, voyageName: string, travelerName: string) => {
      const prefix = name ? `${name}, ` : ''
      const traveler = travelerName || 'A user'
      return `${prefix}${traveler} chose bank transfer for ${voyageName}. Do not review the application until Bunq confirms the exact amount and reference.`
    },
    paymentMethodLabels: {
      bank_transfer: 'Bank transfer',
      bunq_link: 'Card / Apple Pay / Google Pay',
    },
    status: {
      admin_new_booking: 'New request',
      admin_cancelled: 'Cancelled',
      admin_modified: 'Updated',
      admin_payment_pending: 'Payment pending',
      admin_payment_received: 'Payment received',
      admin_plan_change: 'Needs approval',
      schedule_delayed: 'Running late',
      admin_balance_deadline_missed: 'Lapsed — balance missed',
    },
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
    'admin_balance_deadline_missed',
  ]
  return allowed.includes(value as AdminBookingEvent) ? (value as AdminBookingEvent) : 'admin_new_booking'
}

/** A delayed schedule rides in on admin_plan_change, but nothing needs approving. */
function resolveVariant(eventType: AdminBookingEvent, changeKind?: string | null): AdminTemplateVariant {
  return eventType === 'admin_plan_change' && changeKind === 'schedule_delayed'
    ? 'schedule_delayed'
    : eventType
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
  paymentMethod,
  paymentReference,
  changeKind,
  oldLegs,
  proposedLegs,
  unsubscribeUrl,
  scope,
}: VoyageBookingAdminNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const variant = resolveVariant(normalizedEventType, changeKind)
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/admin/bookings`
  const resolvedTravelerName = travelerName?.trim() || ''
  const safeOldLegs = oldLegs?.filter((item) => item?.trim()) ?? []
  const safeProposedLegs = proposedLegs?.filter((item) => item?.trim()) ?? []
  const paymentMethodKey = paymentMethod?.trim() as keyof typeof copy.paymentMethodLabels | undefined
  const paymentMethodLabel = paymentMethodKey && copy.paymentMethodLabels[paymentMethodKey]
    ? copy.paymentMethodLabels[paymentMethodKey]
    : paymentMethod
  const introText =
    variant === 'admin_payment_pending' && paymentMethod === 'bank_transfer'
      ? copy.bankTransferPendingIntro(buildGreetingName(recipientName), resolvedVoyageName, resolvedTravelerName)
      : copy.intro(buildGreetingName(recipientName), variant, resolvedVoyageName, resolvedTravelerName, scope)
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
      title={copy.title[variant]}
      intro={
        <EmailBodyText>
          {introText}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.cta, url: resolvedBookingUrl }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailSignalPills
        items={[
          copy.status[variant],
          partySize ? `${copy.partySize}: ${partySize}` : null,
          travelerEmail || resolvedTravelerName || null,
        ]}
      />

      <EmailCard>
        <EmailSectionLabel>{copy.summaryTitle}</EmailSectionLabel>
        <EmailBodyText>
          <strong>{resolvedVoyageName}</strong>
        </EmailBodyText>
        <EmailDetailRow
          label={copy.travelerTitle}
          value={[resolvedTravelerName, travelerEmail].filter(Boolean).join(' · ') || null}
        />
        <EmailDetailRow label={copy.partySize} value={partySize ? String(partySize) : null} />
        <EmailRouteBox label={copy.legsTitle} routes={safeLegs} />
        {amountLabel ? <EmailHighlightBox label={copy.amount} value={amountLabel} /> : null}
        <EmailDetailRow label={copy.paymentMethod} value={paymentMethodLabel} />
        <EmailDetailRow label={copy.paymentReference} value={paymentReference} />
        {message?.trim() ? <EmailCallout>{message.trim()}</EmailCallout> : null}
      </EmailCard>
      {/* A delay leaves the legs untouched, so before/after would print them twice. */}
      {variant !== 'schedule_delayed' && (safeOldLegs.length || safeProposedLegs.length) ? (
        <EmailCard>
          <EmailSectionLabel>{copy.planTitle}</EmailSectionLabel>
          <EmailRouteBox label={copy.oldLegsTitle} routes={safeOldLegs} />
          <EmailRouteBox label={copy.proposedLegsTitle} routes={safeProposedLegs} />
        </EmailCard>
      ) : null}
    </EditorialEmailShell>
  )
}

export const template = {
  component: VoyageBookingAdminNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const eventType = normalizeEventType(typeof data.eventType === 'string' ? data.eventType : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const variant = resolveVariant(eventType, typeof data.changeKind === 'string' ? data.changeKind : null)
    const title = COPY[language].title[variant]
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
