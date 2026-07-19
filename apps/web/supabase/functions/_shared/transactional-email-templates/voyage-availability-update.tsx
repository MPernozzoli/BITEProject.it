import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'
import { PUBLIC_SITE_URL } from '../email-config.ts'
import {
  buildGreetingName,
  EditorialEmailShell,
  EmailBodyText,
  EmailCard,
  EmailRouteBox,
  EmailSectionLabel,
  EmailSignalPills,
  resolveEmailLanguage,
} from './theme.tsx'

type AvailabilityEvent = 'new_bookable_voyage' | 'availability_opened'

interface VoyageAvailabilityUpdateProps {
  language?: string | null
  recipientName?: string | null
  eventType?: AvailabilityEvent | string | null
  voyageName?: string | null
  voyageUrl?: string | null
  legs?: string[] | null
  unsubscribeUrl?: string | null
}

const COPY = {
  it: {
    eyebrow: 'Aggiornamenti viaggi',
    preview: 'Aggiornamento su un viaggio a cui puoi chiedere di partecipare',
    title: {
      new_bookable_voyage: 'Nuovo viaggio aperto alle adesioni.',
      availability_opened: 'Si e liberata disponibilita su un viaggio.',
    },
    intro: (name: string, eventType: AvailabilityEvent, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'availability_opened') {
        return `${prefix}hai chiesto di essere avvisato se si fosse liberato spazio su ${voyageName}. Ora risulta di nuovo disponibilita sulle tratte indicate qui sotto.`
      }
      return `${prefix}hai chiesto di ricevere aggiornamenti quando vengono pubblicati nuovi viaggi a cui e possibile chiedere di partecipare. ${voyageName} e ora visibile nell'area booking.`
    },
    cta: 'Apri il viaggio',
    voyageFallback: 'questo viaggio',
    status: {
      new_bookable_voyage: 'Nuovo viaggio',
      availability_opened: 'Disponibilita riaperta',
    },
    legsTitle: 'Tratte',
    summaryTitle: 'Dettaglio',
    footerReason: 'Ricevi questa email perche hai chiesto aggiornamenti sui viaggi BITE.',
  },
  en: {
    eyebrow: 'Voyage updates',
    preview: 'Update about a voyage you can ask to join',
    title: {
      new_bookable_voyage: 'A new voyage is open for joining requests.',
      availability_opened: 'Availability opened on a voyage.',
    },
    intro: (name: string, eventType: AvailabilityEvent, voyageName: string) => {
      const prefix = name ? `${name}, ` : ''
      if (eventType === 'availability_opened') {
        return `${prefix}you asked to be notified if space opened on ${voyageName}. There is now availability again on the legs listed below.`
      }
      return `${prefix}you asked to receive updates when new voyages become available for joining requests. ${voyageName} is now visible in the booking area.`
    },
    cta: 'Open voyage',
    voyageFallback: 'this voyage',
    status: {
      new_bookable_voyage: 'New voyage',
      availability_opened: 'Availability opened',
    },
    legsTitle: 'Legs',
    summaryTitle: 'Details',
    footerReason: 'You are receiving this email because you asked for BITE voyage updates.',
  },
} as const

function normalizeEventType(value?: string | null): AvailabilityEvent {
  return value === 'availability_opened' ? 'availability_opened' : 'new_bookable_voyage'
}

const VoyageAvailabilityUpdateEmail = ({
  language,
  recipientName,
  eventType,
  voyageName,
  voyageUrl,
  legs,
  unsubscribeUrl,
}: VoyageAvailabilityUpdateProps) => {
  const lang = resolveEmailLanguage(language)
  const copy = COPY[lang]
  const normalizedEventType = normalizeEventType(eventType)
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const resolvedVoyageUrl = voyageUrl?.trim() || `${PUBLIC_SITE_URL}/bookings`

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
      primaryCta={{ label: copy.cta, url: resolvedVoyageUrl }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailSignalPills
        items={[
          copy.status[normalizedEventType],
          safeLegs.length ? `${safeLegs.length} ${copy.legsTitle.toLowerCase()}` : null,
        ]}
      />

      <EmailCard>
        <EmailSectionLabel>{copy.summaryTitle}</EmailSectionLabel>
        <EmailBodyText>
          <strong>{resolvedVoyageName}</strong>
        </EmailBodyText>
        <EmailRouteBox label={copy.legsTitle} routes={safeLegs} />
      </EmailCard>
    </EditorialEmailShell>
  )
}

export const template = {
  component: VoyageAvailabilityUpdateEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const eventType = normalizeEventType(typeof data.eventType === 'string' ? data.eventType : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const title = COPY[language].title[eventType]
    return voyageName ? `${title} ${voyageName} - BITE` : `${title} - BITE`
  },
  displayName: 'Voyage availability updates',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    eventType: 'availability_opened',
    voyageName: 'Mediterraneo 2026',
    voyageUrl: `${PUBLIC_SITE_URL}/bookings?voyage=preview`,
    legs: ['Palermo -> Cagliari', 'Cagliari -> Mahon'],
    unsubscribeUrl: `${PUBLIC_SITE_URL}/unsubscribe?token=preview-availability`,
  },
} satisfies TemplateEntry
