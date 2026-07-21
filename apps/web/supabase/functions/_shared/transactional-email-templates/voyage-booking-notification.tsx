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

type BookingEvent =
  | 'requested'
  | 'waitlisted'
  | 'admin_approved'
  | 'user_confirmed'
  | 'cancelled'
  | 'rejected'
  | 'promoted_from_waitlist'
  | 'manual_added'
  | 'payment_pending'
  | 'payment_received'
  | 'payment_failed'
  | 'payment_expired'
  | 'payment_reminder'
  | 'plan_change_pending'
  | 'plan_change_auto_accepted'

/**
 * A delay arrives as plan_change_pending, but reads nothing like one: the legs are
 * unchanged, only the clock moved. It gets its own copy so we never tell someone
 * we are "proposing new legs" when we are just running late.
 */
type TemplateVariant = BookingEvent | 'schedule_delayed'

interface VoyageBookingNotificationProps {
  language?: string | null
  recipientName?: string | null
  eventType?: BookingEvent | string | null
  voyageName?: string | null
  legs?: string[] | null
  partySize?: number | null
  bookingUrl?: string | null
  message?: string | null
  amountEur?: number | null
  paymentMethod?: string | null
  paymentReference?: string | null
  paymentExpiresAt?: string | null
  changeKind?: string | null
  /** New effective departure of the first delayed leg; only set for schedule_delayed. */
  newDepartureAt?: string | null
  /** Latest departure the baseline plan allowed, i.e. what the new one slipped past. */
  baselineDepartureBy?: string | null
  oldLegs?: string[] | null
  proposedLegs?: string[] | null
  /** The refund could not be paid automatically: ask the traveller for an IBAN by email. */
  refundPending?: boolean | null
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
      payment_pending: 'Pagamento in sospeso.',
      payment_received: 'Pagamento ricevuto.',
      payment_failed: 'Pagamento non riuscito.',
      payment_expired: 'Pagamento scaduto.',
      payment_reminder: 'Bonifico ancora da ricevere.',
      plan_change_pending: 'La pianificazione del viaggio e cambiata.',
      plan_change_auto_accepted: 'Pianificazione aggiornata.',
      schedule_delayed: 'Il viaggio sta procedendo in ritardo.',
    },
    intro: (name: string, eventType: TemplateVariant, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} sta procedendo in ritardo rispetto alla finestra prevista. Le tue tratte non cambiano, ma le date si spostano: qui sotto trovi la nuova partenza. Se le nuove date non ti sono comode puoi annullare con rimborso completo.`
      if (eventType === 'admin_approved') return `${prefix}la richiesta per ${voyageName} e stata approvata. Apri la tua area booking per confermare.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}si e liberata disponibilita su ${voyageName}: la tua richiesta e tornata in revisione.`
      if (eventType === 'waitlisted') return `${prefix}al momento i posti selezionati per ${voyageName} sono pieni. Ti avviseremo se si libera disponibilita.`
      if (eventType === 'user_confirmed') return `${prefix}il tuo imbarco su ${voyageName} e confermato.`
      if (eventType === 'cancelled') return `${prefix}il booking per ${voyageName} e stato annullato.`
      if (eventType === 'rejected') return `${prefix}la richiesta per ${voyageName} non e stata confermata.`
      if (eventType === 'manual_added') return `${prefix}sei stato aggiunto manualmente al booking per ${voyageName}.`
      if (eventType === 'payment_pending') return `${prefix}abbiamo registrato un pagamento in sospeso per ${voyageName}. Completa il versamento entro la scadenza indicata per mantenere la prenotazione.`
      if (eventType === 'payment_received') return `${prefix}abbiamo ricevuto il pagamento per ${voyageName}.`
      if (eventType === 'payment_failed') return `${prefix}il pagamento per ${voyageName} non e andato a buon fine. Apri la tua area booking per riprovare o scegliere un altro metodo.`
      if (eventType === 'payment_expired') return `${prefix}la finestra di pagamento per ${voyageName} e scaduta. Apri la tua area booking per verificare lo stato della prenotazione.`
      if (eventType === 'payment_reminder') return `${prefix}non abbiamo ancora ricevuto il bonifico per ${voyageName}. Ricorda di indicare la causale esatta: senza di quella non riusciamo ad abbinare il pagamento. Se non arriva entro la scadenza, la richiesta viene annullata in automatico.`
      if (eventType === 'plan_change_pending') return `${prefix}la pianificazione di ${voyageName} e cambiata. Ti proponiamo le nuove tratte: puoi accettare, annullare con rimborso completo o chiedere una variazione.`
      if (eventType === 'plan_change_auto_accepted') return `${prefix}la pianificazione di ${voyageName} e stata aggiornata e la tua prenotazione e stata adeguata automaticamente.`
      return `${prefix}abbiamo ricevuto la tua richiesta di imbarco per ${voyageName}.`
    },
    cta: 'Apri booking',
    voyageFallback: 'questo viaggio',
    summaryTitle: 'Dettagli booking',
    paymentTitle: 'Pagamento',
    planTitle: 'Cambio planning',
    delayTitle: 'Nuove date',
    newDeparture: 'Nuova partenza',
    plannedDeparture: 'Era prevista entro',
    messageTitle: 'Messaggio',
    refundPendingTitle: 'Rimborso della quota',
    refundPendingBody:
      'Ti spetta il rimborso della quota di partecipazione, ma non siamo riusciti ad accreditarlo automaticamente. Premi il pulsante qui sotto, accedi al tuo account e inserisci le coordinate bancarie: l’importo e gia impostato e il bonifico parte subito dopo la conferma.',
    refundCta: 'Comunica IBAN per il rimborso',
    legsTitle: 'Tratte',
    oldLegsTitle: 'Prima',
    proposedLegsTitle: 'Proposta',
    partySize: 'Persone',
    amount: 'Importo',
    paymentMethod: 'Metodo',
    paymentReference: 'Riferimento',
    paymentExpiresAt: 'Scadenza',
    bankTransferPendingIntro: (name: string, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      return `${prefix}abbiamo registrato il bonifico in attesa per ${voyageName}. La candidatura non verra esaminata finche non riceviamo l'importo corretto con la causale indicata.`
    },
    paymentMethodLabels: {
      bank_transfer: 'Bonifico',
      bunq_link: 'Carta / Apple Pay / Google Pay',
    },
    status: {
      requested: 'Richiesta ricevuta',
      waitlisted: 'Waiting list',
      admin_approved: 'Da confermare',
      user_confirmed: 'Confermato',
      cancelled: 'Annullato',
      rejected: 'Non confermato',
      promoted_from_waitlist: 'Posto disponibile',
      manual_added: 'Aggiunto da admin',
      payment_pending: 'Pagamento in sospeso',
      payment_reminder: 'Bonifico da completare',
      payment_received: 'Pagamento ricevuto',
      payment_failed: 'Pagamento non riuscito',
      payment_expired: 'Pagamento scaduto',
      plan_change_pending: 'Richiede risposta',
      plan_change_auto_accepted: 'Aggiornato',
      schedule_delayed: 'In ritardo',
    },
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
      payment_pending: 'Payment pending.',
      payment_reminder: 'Bank transfer still outstanding.',
      payment_received: 'Payment received.',
      payment_failed: 'Payment failed.',
      payment_expired: 'Payment expired.',
      plan_change_pending: 'The voyage plan changed.',
      plan_change_auto_accepted: 'Plan updated.',
      schedule_delayed: 'The voyage is running late.',
    },
    intro: (name: string, eventType: TemplateVariant, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} is running behind its planned window. Your legs do not change, but the dates shift: the new departure is below. If the new dates no longer suit you, you can cancel with a full refund.`
      if (eventType === 'admin_approved') return `${prefix}your request for ${voyageName} was approved. Open your booking area to confirm.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}availability opened on ${voyageName}: your request is back in review.`
      if (eventType === 'waitlisted') return `${prefix}the selected legs for ${voyageName} are currently full. We will notify you if availability opens.`
      if (eventType === 'user_confirmed') return `${prefix}your berth on ${voyageName} is confirmed.`
      if (eventType === 'cancelled') return `${prefix}your booking for ${voyageName} was cancelled.`
      if (eventType === 'rejected') return `${prefix}your request for ${voyageName} was not confirmed.`
      if (eventType === 'manual_added') return `${prefix}you were manually added to the booking for ${voyageName}.`
      if (eventType === 'payment_pending') return `${prefix}we recorded a pending payment for ${voyageName}. Complete it before the deadline to keep your booking.`
      if (eventType === 'payment_received') return `${prefix}we received your payment for ${voyageName}.`
      if (eventType === 'payment_failed') return `${prefix}the payment for ${voyageName} did not go through. Open your booking area to retry or choose another method.`
      if (eventType === 'payment_expired') return `${prefix}the payment window for ${voyageName} expired. Open your booking area to check the booking status.`
      if (eventType === 'payment_reminder') return `${prefix}we still have not received your bank transfer for ${voyageName}. Remember to use the exact reference: without it we cannot match the payment. If it does not arrive before the deadline, the request is cancelled automatically.`
      if (eventType === 'plan_change_pending') return `${prefix}the plan for ${voyageName} changed. We propose updated legs: you can accept, cancel with a full refund, or request a different route.`
      if (eventType === 'plan_change_auto_accepted') return `${prefix}the plan for ${voyageName} was updated and your booking was adjusted automatically.`
      return `${prefix}we received your berth request for ${voyageName}.`
    },
    cta: 'Open bookings',
    voyageFallback: 'this voyage',
    summaryTitle: 'Booking details',
    paymentTitle: 'Payment',
    planTitle: 'Plan change',
    delayTitle: 'New dates',
    newDeparture: 'New departure',
    plannedDeparture: 'Was planned by',
    messageTitle: 'Message',
    refundPendingTitle: 'Refund of your deposit',
    refundPendingBody:
      'You are entitled to a refund of your participation fee, but we could not send it automatically. Tap the button below, sign in to your account and enter your bank details: the amount is already set and the transfer starts as soon as you confirm.',
    refundCta: 'Send your IBAN for the refund',
    legsTitle: 'Legs',
    oldLegsTitle: 'Before',
    proposedLegsTitle: 'Proposed',
    partySize: 'People',
    amount: 'Amount',
    paymentMethod: 'Method',
    paymentReference: 'Reference',
    paymentExpiresAt: 'Deadline',
    bankTransferPendingIntro: (name: string, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      return `${prefix}we recorded your pending bank transfer for ${voyageName}. Your application will not be reviewed until we receive the exact amount with the required reference.`
    },
    paymentMethodLabels: {
      bank_transfer: 'Bank transfer',
      bunq_link: 'Card / Apple Pay / Google Pay',
    },
    status: {
      requested: 'Request received',
      waitlisted: 'Waiting list',
      admin_approved: 'Ready to confirm',
      user_confirmed: 'Confirmed',
      cancelled: 'Cancelled',
      rejected: 'Not confirmed',
      promoted_from_waitlist: 'Berth available',
      manual_added: 'Added by admin',
      payment_pending: 'Payment pending',
      payment_reminder: 'Bank transfer to complete',
      payment_received: 'Payment received',
      payment_failed: 'Payment failed',
      payment_expired: 'Payment expired',
      plan_change_pending: 'Needs reply',
      plan_change_auto_accepted: 'Updated',
      schedule_delayed: 'Running late',
    },
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
    'payment_pending',
    'payment_received',
    'payment_failed',
    'payment_expired',
    'payment_reminder',
    'plan_change_pending',
    'plan_change_auto_accepted',
  ]
  return allowed.includes(value as BookingEvent) ? (value as BookingEvent) : 'requested'
}

/** A delayed schedule rides in on plan_change_pending, but reads as its own thing. */
function resolveVariant(eventType: BookingEvent, changeKind?: string | null): TemplateVariant {
  return eventType === 'plan_change_pending' && changeKind === 'schedule_delayed'
    ? 'schedule_delayed'
    : eventType
}

function formatDateTime(value: string | null | undefined, language: 'it' | 'en') {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-IE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
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
  amountEur,
  paymentMethod,
  paymentReference,
  paymentExpiresAt,
  changeKind,
  newDepartureAt,
  baselineDepartureBy,
  oldLegs,
  proposedLegs,
  refundPending,
  unsubscribeUrl,
}: VoyageBookingNotificationProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const variant = resolveVariant(normalizedEventType, changeKind)
  const isDelay = variant === 'schedule_delayed'
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const safeOldLegs = oldLegs?.filter((item) => item?.trim()) ?? []
  const safeProposedLegs = proposedLegs?.filter((item) => item?.trim()) ?? []
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/bookings`
  const amountLabel =
    typeof amountEur === 'number' && amountEur > 0
      ? new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-IE', {
          style: 'currency',
          currency: 'EUR',
        }).format(amountEur)
      : null
  const paymentExpiresAtLabel = formatDateTime(paymentExpiresAt, lang)
  const newDepartureLabel = formatDateTime(newDepartureAt, lang)
  const baselineDepartureLabel = formatDateTime(baselineDepartureBy, lang)
  const paymentMethodKey = paymentMethod?.trim() as keyof typeof copy.paymentMethodLabels | undefined
  const paymentMethodLabel = paymentMethodKey && copy.paymentMethodLabels[paymentMethodKey]
    ? copy.paymentMethodLabels[paymentMethodKey]
    : paymentMethod
  const introText =
    variant === 'payment_pending' && paymentMethod === 'bank_transfer'
      ? copy.bankTransferPendingIntro(buildGreetingName(recipientName), resolvedVoyageName)
      : copy.intro(buildGreetingName(recipientName), variant, resolvedVoyageName)
  // When a refund is owed, the whole point of the email is to collect an IBAN, so the
  // primary button leads straight to the self-service refund form.
  const primaryCta = refundPending
    ? { label: copy.refundCta, url: `${PUBLIC_SITE_URL}/bookings/rimborso` }
    : { label: copy.cta, url: resolvedBookingUrl }

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
      primaryCta={primaryCta}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailSignalPills
        items={[
          copy.status[variant],
          partySize ? `${copy.partySize}: ${partySize}` : null,
          safeLegs.length ? `${safeLegs.length} ${copy.legsTitle.toLowerCase()}` : null,
        ]}
      />

      <EmailCard>
        <EmailSectionLabel>{copy.summaryTitle}</EmailSectionLabel>
        <EmailBodyText>
          <strong>{resolvedVoyageName}</strong>
        </EmailBodyText>
        <EmailDetailRow label={copy.partySize} value={partySize ? String(partySize) : null} />
        <EmailRouteBox label={copy.legsTitle} routes={safeLegs} />
        {message?.trim() ? <EmailCallout>{message.trim()}</EmailCallout> : null}
      </EmailCard>
      {refundPending ? (
        <EmailCard>
          <EmailSectionLabel>{copy.refundPendingTitle}</EmailSectionLabel>
          <EmailCallout>{copy.refundPendingBody}</EmailCallout>
        </EmailCard>
      ) : null}
      {amountLabel || paymentMethod || paymentReference || paymentExpiresAtLabel ? (
        <EmailCard>
          <EmailSectionLabel>{copy.paymentTitle}</EmailSectionLabel>
          {amountLabel ? <EmailHighlightBox label={copy.amount} value={amountLabel} /> : null}
          <EmailDetailRow label={copy.paymentMethod} value={paymentMethodLabel} />
          <EmailDetailRow label={copy.paymentReference} value={paymentReference} />
          <EmailDetailRow label={copy.paymentExpiresAt} value={paymentExpiresAtLabel} />
        </EmailCard>
      ) : null}
      {isDelay ? (
        newDepartureLabel ? (
          <EmailCard>
            <EmailSectionLabel>{copy.delayTitle}</EmailSectionLabel>
            <EmailHighlightBox label={copy.newDeparture} value={newDepartureLabel} />
            <EmailDetailRow label={copy.plannedDeparture} value={baselineDepartureLabel} />
          </EmailCard>
        ) : null
      ) : safeOldLegs.length || safeProposedLegs.length ? (
        // A delay leaves the legs untouched, so a before/after list would print the
        // same routes twice.
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
  component: VoyageBookingNotificationEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const eventType = normalizeEventType(typeof data.eventType === 'string' ? data.eventType : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const variant = resolveVariant(eventType, typeof data.changeKind === 'string' ? data.changeKind : null)
    const title = COPY[language].title[variant]
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
