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
  | 'balance_reminder'
  | 'balance_deadline_missed'
  | 'contribution_proposal_received'
  | 'contribution_proposal_accepted'
  | 'contribution_proposal_countered'
  | 'contribution_proposal_rejected'
  | 'guest_share_due'
  | 'guest_share_overdue'
  | 'guest_share_dropped'

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
  /** Bank coordinates, passed only for bank_transfer so the payer can pay straight from the email. */
  bankTransferIban?: string | null
  bankTransferBic?: string | null
  bankTransferHolder?: string | null
  /**
   * Booking status the settlement produced ('requested' | 'user_confirmed'). Lets the
   * payment_received email say what happened to the application, not just that money landed.
   */
  paymentOutcome?: string | null
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
  /** "deposit" (acconto) or "balance" (saldo) — set on payment_pending/payment_received/balance_reminder. */
  phase?: string | null
  /** Balance due date, for balance_reminder. */
  balanceDueAt?: string | null
  /** For balance_deadline_missed: 'booking' (own), 'participant' (own seat), or
   * 'participant_removed' (sent to the lead about a guest who lapsed). */
  scope?: string | null
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
      balance_reminder: 'Il saldo scade a breve.',
      balance_deadline_missed: 'Scadenza saldo non rispettata.',
      contribution_proposal_received: 'Proposta ricevuta.',
      contribution_proposal_accepted: 'Proposta accettata.',
      contribution_proposal_countered: 'Contro-proposta ricevuta.',
      contribution_proposal_rejected: 'Proposta non accettata.',
      guest_share_due: 'La tua quota e da versare.',
      guest_share_overdue: 'Una quota del gruppo non e stata versata.',
      guest_share_dropped: 'Partecipazione annullata.',
    },
    intro: (name: string, eventType: TemplateVariant, voyageName: string, phase?: string | null, scope?: string | null, balanceDueAtLabel?: string | null) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} sta procedendo in ritardo rispetto alla finestra prevista. Le tue tratte non cambiano, ma le date si spostano: qui sotto trovi la nuova partenza. Se le nuove date non ti sono comode puoi annullare con rimborso completo.`
      if (eventType === 'admin_approved') return `${prefix}la richiesta per ${voyageName} e stata approvata. Apri la tua area booking per confermare.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}si e liberata disponibilita su ${voyageName}: la tua richiesta e tornata in revisione.`
      if (eventType === 'waitlisted') return `${prefix}al momento i posti selezionati per ${voyageName} sono pieni. Ti avviseremo se si libera disponibilita.`
      if (eventType === 'user_confirmed') return `${prefix}il tuo imbarco su ${voyageName} e confermato.`
      if (eventType === 'cancelled') return `${prefix}il booking per ${voyageName} e stato annullato.`
      if (eventType === 'rejected') return `${prefix}la richiesta per ${voyageName} non e stata confermata.`
      if (eventType === 'manual_added') return `${prefix}sei stato aggiunto manualmente al booking per ${voyageName}.`
      if (eventType === 'payment_pending' && phase === 'balance') return `${prefix}abbiamo registrato il pagamento del saldo in sospeso per ${voyageName}. Completa il versamento entro la scadenza indicata: oltre quel termine la prenotazione decade e l'acconto gia versato non e rimborsabile.`
      if (eventType === 'payment_pending') return `${prefix}abbiamo registrato un pagamento dell'acconto in sospeso per ${voyageName}. Completa il versamento entro la scadenza indicata per mantenere la prenotazione.`
      if (eventType === 'payment_received' && phase === 'balance') return `${prefix}abbiamo ricevuto il saldo per ${voyageName}: la tua prenotazione e a posto con i pagamenti.`
      if (eventType === 'payment_received') return `${prefix}abbiamo ricevuto l'acconto per ${voyageName}. Ricorda che il saldo va versato almeno 15 giorni prima della partenza della tua tratta di imbarco.`
      if (eventType === 'payment_failed') return `${prefix}il pagamento per ${voyageName} non e andato a buon fine. Apri la tua area booking per riprovare o scegliere un altro metodo.`
      if (eventType === 'payment_expired') return `${prefix}la finestra di pagamento per ${voyageName} e scaduta. Apri la tua area booking per verificare lo stato della prenotazione.`
      if (eventType === 'payment_reminder') return `${prefix}non abbiamo ancora ricevuto il bonifico per ${voyageName}. Qui sotto trovi di nuovo tutti i dati: ricorda di indicare la causale esatta, senza di quella non riusciamo ad abbinare il pagamento. Se non arriva entro la scadenza, la richiesta viene annullata in automatico.`
      if (eventType === 'balance_reminder') return `${prefix}il saldo per ${voyageName}${balanceDueAtLabel ? ` scade il ${balanceDueAtLabel}` : ' sta per scadere'}. Se non arriva entro quella data, la prenotazione decade e l'acconto gia versato non e rimborsabile.`
      if (eventType === 'balance_deadline_missed' && scope === 'participant') return `${prefix}la scadenza per versare il saldo di ${voyageName} e passata: la tua partecipazione e stata annullata e l'acconto versato non e rimborsabile.`
      if (eventType === 'balance_deadline_missed' && scope === 'participant_removed') return `${prefix}un partecipante che avevi invitato su ${voyageName} non ha versato il proprio saldo entro la scadenza: la sua partecipazione e stata annullata. Il resto della prenotazione resta confermato.`
      if (eventType === 'balance_deadline_missed') return `${prefix}la scadenza per versare il saldo di ${voyageName} e passata: la prenotazione e stata annullata e l'acconto versato non e rimborsabile.`
      if (eventType === 'plan_change_pending') return `${prefix}la pianificazione di ${voyageName} e cambiata. Ti proponiamo le nuove tratte: puoi accettare, annullare con rimborso completo o chiedere una variazione.`
      if (eventType === 'plan_change_auto_accepted') return `${prefix}la pianificazione di ${voyageName} e stata aggiornata e la tua prenotazione e stata adeguata automaticamente.`
      if (eventType === 'contribution_proposal_received') return `${prefix}abbiamo ricevuto la tua proposta di contributo/workaway per ${voyageName}. La esamineremo e ti risponderemo a breve.`
      if (eventType === 'contribution_proposal_accepted') return `${prefix}la tua proposta per ${voyageName} e stata accettata. Se resta un saldo da versare, apri la tua area booking per completare il pagamento.`
      if (eventType === 'contribution_proposal_countered') return `${prefix}per ${voyageName} ti proponiamo una contro-proposta sul contributo. Apri la tua area booking per accettarla o rifiutarla.`
      if (eventType === 'contribution_proposal_rejected') return `${prefix}la tua proposta per ${voyageName} non e stata accettata. Se avevi gia versato il contributo fisso, il rimborso e automatico.`
      if (eventType === 'guest_share_due') return `${prefix}l'importo del contributo per ${voyageName} e stato concordato con chi ha organizzato la prenotazione: ora tocca a te versare la tua quota${balanceDueAtLabel ? `, entro il ${balanceDueAtLabel}` : ''}. Trovi l'importo qui sotto e il pulsante per pagare nella tua area booking. Se non arriva entro quel termine, chi ha prenotato dovra decidere se proseguire senza di te o annullare per tutti.`
      if (eventType === 'guest_share_overdue') return `${prefix}una persona della tua prenotazione per ${voyageName} non ha versato la propria quota entro il termine. Apri la tua area booking e scegli come procedere: puoi proseguire senza di lei, oppure annullare la prenotazione per tutto il gruppo.`
      if (eventType === 'guest_share_dropped') return `${prefix}la tua partecipazione a ${voyageName} e stata annullata perche la quota non e stata versata entro il termine. Se avevi gia versato qualcosa, te lo restituiamo.`
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
      return `${prefix}abbiamo registrato il bonifico in attesa per ${voyageName}. Qui sotto trovi tutti i dati per fare il versamento: la candidatura non verra esaminata finche non riceviamo l'importo corretto con la causale indicata.`
    },
    bankTransferTitle: 'Dati per il bonifico',
    bankHolder: 'Intestatario',
    bankIban: 'IBAN',
    bankBic: 'BIC / SWIFT',
    bankReference: 'Causale (obbligatoria)',
    bankAmount: 'Importo esatto',
    bankDeadline: 'Da completare entro',
    bankMatchWarning:
      'Per convalidare il pagamento in automatico devono combaciare sia l\'importo sia la causale. Senza la causale esatta non riusciamo ad abbinare il bonifico alla tua candidatura.',
    bankDeadlineWarning:
      'Se il bonifico non arriva entro la scadenza indicata, la candidatura decade in automatico e dovrai ripresentarla.',
    paymentOutcomeTitle: 'Cosa succede adesso',
    paymentOutcome: {
      requested:
        'La tua candidatura e ora al vaglio dell\'organizzatore: la esaminiamo al piu presto e ti scriviamo appena c\'e una decisione.',
      user_confirmed: 'Il tuo posto a bordo e confermato: non devi fare altro.',
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
      balance_reminder: 'Saldo in scadenza',
      balance_deadline_missed: 'Decaduto per mancato saldo',
      contribution_proposal_received: 'Proposta in revisione',
      contribution_proposal_accepted: 'Proposta accettata',
      contribution_proposal_countered: 'Contro-proposta ricevuta',
      contribution_proposal_rejected: 'Proposta non accettata',
      guest_share_due: 'Quota da versare',
      guest_share_overdue: 'Quota non versata',
      guest_share_dropped: 'Partecipazione annullata',
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
      balance_reminder: 'The balance is due soon.',
      balance_deadline_missed: 'Balance deadline missed.',
      contribution_proposal_received: 'Proposal received.',
      contribution_proposal_accepted: 'Proposal accepted.',
      contribution_proposal_countered: 'Counter-proposal received.',
      contribution_proposal_rejected: 'Proposal not accepted.',
      guest_share_due: 'Your share is due.',
      guest_share_overdue: 'A share in your party was not paid.',
      guest_share_dropped: 'Participation cancelled.',
    },
    intro: (name: string, eventType: TemplateVariant, voyageName: string, phase?: string | null, scope?: string | null, balanceDueAtLabel?: string | null) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'schedule_delayed') return `${prefix}${voyageName} is running behind its planned window. Your legs do not change, but the dates shift: the new departure is below. If the new dates no longer suit you, you can cancel with a full refund.`
      if (eventType === 'admin_approved') return `${prefix}your request for ${voyageName} was approved. Open your booking area to confirm.`
      if (eventType === 'promoted_from_waitlist') return `${prefix}availability opened on ${voyageName}: your request is back in review.`
      if (eventType === 'waitlisted') return `${prefix}the selected legs for ${voyageName} are currently full. We will notify you if availability opens.`
      if (eventType === 'user_confirmed') return `${prefix}your berth on ${voyageName} is confirmed.`
      if (eventType === 'cancelled') return `${prefix}your booking for ${voyageName} was cancelled.`
      if (eventType === 'rejected') return `${prefix}your request for ${voyageName} was not confirmed.`
      if (eventType === 'manual_added') return `${prefix}you were manually added to the booking for ${voyageName}.`
      if (eventType === 'payment_pending' && phase === 'balance') return `${prefix}we recorded a pending balance payment for ${voyageName}. Complete it before the deadline: after that the booking lapses and the deposit already paid is not refundable.`
      if (eventType === 'payment_pending') return `${prefix}we recorded a pending deposit payment for ${voyageName}. Complete it before the deadline to keep your booking.`
      if (eventType === 'payment_received' && phase === 'balance') return `${prefix}we received the balance for ${voyageName}: your booking is fully settled.`
      if (eventType === 'payment_received') return `${prefix}we received your deposit for ${voyageName}. Remember the balance is due at least 15 days before your own embarkation leg departs.`
      if (eventType === 'payment_failed') return `${prefix}the payment for ${voyageName} did not go through. Open your booking area to retry or choose another method.`
      if (eventType === 'payment_expired') return `${prefix}the payment window for ${voyageName} expired. Open your booking area to check the booking status.`
      if (eventType === 'payment_reminder') return `${prefix}we still have not received your bank transfer for ${voyageName}. All the details are below again: remember to use the exact reference, without it we cannot match the payment. If it does not arrive before the deadline, the request is cancelled automatically.`
      if (eventType === 'balance_reminder') return `${prefix}the balance for ${voyageName}${balanceDueAtLabel ? ` is due on ${balanceDueAtLabel}` : ' is due soon'}. If it does not arrive by then, the booking lapses and the deposit already paid is not refundable.`
      if (eventType === 'balance_deadline_missed' && scope === 'participant') return `${prefix}the deadline to pay the balance for ${voyageName} has passed: your participation was cancelled and the deposit you paid is not refundable.`
      if (eventType === 'balance_deadline_missed' && scope === 'participant_removed') return `${prefix}a participant you invited on ${voyageName} did not pay their balance by the deadline: their participation was cancelled. The rest of the booking stays confirmed.`
      if (eventType === 'balance_deadline_missed') return `${prefix}the deadline to pay the balance for ${voyageName} has passed: the booking was cancelled and the deposit you paid is not refundable.`
      if (eventType === 'plan_change_pending') return `${prefix}the plan for ${voyageName} changed. We propose updated legs: you can accept, cancel with a full refund, or request a different route.`
      if (eventType === 'plan_change_auto_accepted') return `${prefix}the plan for ${voyageName} was updated and your booking was adjusted automatically.`
      if (eventType === 'contribution_proposal_received') return `${prefix}we received your contribution/workaway proposal for ${voyageName}. We will review it and get back to you soon.`
      if (eventType === 'contribution_proposal_accepted') return `${prefix}your proposal for ${voyageName} was accepted. If a balance remains, open your booking area to complete the payment.`
      if (eventType === 'contribution_proposal_countered') return `${prefix}we have a counter-proposal on the contribution for ${voyageName}. Open your booking area to accept or reject it.`
      if (eventType === 'contribution_proposal_rejected') return `${prefix}your proposal for ${voyageName} was not accepted. If you had already paid the fixed contribution, the refund is automatic.`
      if (eventType === 'guest_share_due') return `${prefix}the contribution for ${voyageName} has been agreed with whoever organised the booking, and your own share is now due${balanceDueAtLabel ? ` by ${balanceDueAtLabel}` : ''}. The amount is below, and the payment button is in your booking area. If it does not arrive by then, the booker will have to decide whether to go on without you or cancel for everybody.`
      if (eventType === 'guest_share_overdue') return `${prefix}someone on your booking for ${voyageName} did not pay their share by the deadline. Open your booking area and choose how to go on: you can continue without them, or cancel the booking for the whole party.`
      if (eventType === 'guest_share_dropped') return `${prefix}your participation in ${voyageName} was cancelled because the share was not paid by the deadline. Anything you had already paid is refunded to you.`
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
      return `${prefix}we recorded your pending bank transfer for ${voyageName}. Everything you need to send it is below: your application will not be reviewed until we receive the exact amount with the required reference.`
    },
    bankTransferTitle: 'Bank transfer details',
    bankHolder: 'Account holder',
    bankIban: 'IBAN',
    bankBic: 'BIC / SWIFT',
    bankReference: 'Reference (required)',
    bankAmount: 'Exact amount',
    bankDeadline: 'Complete it by',
    bankMatchWarning:
      'For the payment to be validated automatically, both the amount and the reference must match. Without the exact reference we cannot link the transfer to your application.',
    bankDeadlineWarning:
      'If the transfer does not arrive by the deadline shown, the application lapses automatically and you will have to apply again.',
    paymentOutcomeTitle: 'What happens now',
    paymentOutcome: {
      requested:
        'Your application is now with the organiser for review: we will look at it as soon as possible and write to you with a decision.',
      user_confirmed: 'Your place on board is confirmed: nothing else is needed from you.',
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
      balance_reminder: 'Balance due soon',
      balance_deadline_missed: 'Lapsed — balance missed',
      contribution_proposal_received: 'Proposal under review',
      contribution_proposal_accepted: 'Proposal accepted',
      contribution_proposal_countered: 'Counter-proposal received',
      contribution_proposal_rejected: 'Proposal not accepted',
      guest_share_due: 'Share due',
      guest_share_overdue: 'Share unpaid',
      guest_share_dropped: 'Participation cancelled',
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
    'balance_reminder',
    'balance_deadline_missed',
    'contribution_proposal_received',
    'contribution_proposal_accepted',
    'contribution_proposal_countered',
    'contribution_proposal_rejected',
    'guest_share_due',
    'guest_share_overdue',
    'guest_share_dropped',
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
  bankTransferIban,
  bankTransferBic,
  bankTransferHolder,
  paymentOutcome,
  changeKind,
  newDepartureAt,
  baselineDepartureBy,
  oldLegs,
  proposedLegs,
  refundPending,
  unsubscribeUrl,
  phase,
  balanceDueAt,
  scope,
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
  const balanceDueAtLabel = formatDateTime(balanceDueAt, lang)
  const paymentMethodKey = paymentMethod?.trim() as keyof typeof copy.paymentMethodLabels | undefined
  const paymentMethodLabel = paymentMethodKey && copy.paymentMethodLabels[paymentMethodKey]
    ? copy.paymentMethodLabels[paymentMethodKey]
    : paymentMethod
  const introText =
    variant === 'payment_pending' && paymentMethod === 'bank_transfer'
      ? copy.bankTransferPendingIntro(buildGreetingName(recipientName), resolvedVoyageName)
      : copy.intro(buildGreetingName(recipientName), variant, resolvedVoyageName, phase, scope, balanceDueAtLabel)
  // A payer who closed the dialog has nothing else to pay from: when the contribution is still
  // owed by transfer, the email itself has to carry the full coordinates, not just a reference.
  const showsBankInstructions =
    (variant === 'payment_pending' || variant === 'payment_reminder') &&
    paymentMethod === 'bank_transfer' &&
    Boolean(bankTransferIban?.trim())
  const outcomeKey = paymentOutcome?.trim() as keyof typeof copy.paymentOutcome | undefined
  const outcomeText = outcomeKey ? copy.paymentOutcome[outcomeKey] : null
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
      {outcomeText ? (
        <EmailCard>
          <EmailSectionLabel>{copy.paymentOutcomeTitle}</EmailSectionLabel>
          <EmailBodyText>{outcomeText}</EmailBodyText>
        </EmailCard>
      ) : null}
      {showsBankInstructions ? (
        <EmailCard>
          <EmailSectionLabel>{copy.bankTransferTitle}</EmailSectionLabel>
          {amountLabel ? <EmailHighlightBox label={copy.bankAmount} value={amountLabel} /> : null}
          <EmailHighlightBox label={copy.bankReference} value={paymentReference} />
          <EmailDetailRow label={copy.bankHolder} value={bankTransferHolder} strong />
          <EmailDetailRow label={copy.bankIban} value={bankTransferIban} strong />
          <EmailDetailRow label={copy.bankBic} value={bankTransferBic} />
          <EmailDetailRow label={copy.bankDeadline} value={paymentExpiresAtLabel} strong />
          <EmailCallout>{copy.bankMatchWarning}</EmailCallout>
          <EmailCallout>{copy.bankDeadlineWarning}</EmailCallout>
        </EmailCard>
      ) : amountLabel || paymentMethod || paymentReference || paymentExpiresAtLabel || balanceDueAtLabel ? (
        <EmailCard>
          <EmailSectionLabel>{copy.paymentTitle}</EmailSectionLabel>
          {amountLabel ? <EmailHighlightBox label={copy.amount} value={amountLabel} /> : null}
          <EmailDetailRow label={copy.paymentMethod} value={paymentMethodLabel} />
          <EmailDetailRow label={copy.paymentReference} value={paymentReference} />
          <EmailDetailRow label={copy.paymentExpiresAt} value={paymentExpiresAtLabel} />
          {balanceDueAtLabel ? <EmailDetailRow label={copy.paymentExpiresAt} value={balanceDueAtLabel} strong /> : null}
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
  // The bank-transfer variant is the one worth eyeballing: it is the only email a payer can
  // still pay from once the in-app dialog is closed.
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    eventType: 'payment_pending',
    voyageName: 'Mediterraneo 2026',
    legs: ['Palermo → Cagliari', 'Cagliari → Mahon'],
    partySize: 2,
    amountEur: 168.4,
    paymentMethod: 'bank_transfer',
    paymentReference: 'BON-1A2B3C4D-9F0E',
    paymentExpiresAt: '2026-08-01T18:00:00.000Z',
    bankTransferIban: 'NL61BUNQ2201910510',
    bankTransferBic: 'BUNQNL2A',
    bankTransferHolder: 'Massimo Pernozzoli',
    bookingUrl: `${PUBLIC_SITE_URL}/bookings`,
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-booking`,
  },
} satisfies TemplateEntry
