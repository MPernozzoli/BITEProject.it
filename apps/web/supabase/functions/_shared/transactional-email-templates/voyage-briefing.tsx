import * as React from 'npm:react@18.3.1'
import { Section, Text } from 'npm:@react-email/components@0.0.22'
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

type BriefingKind = 'first' | 'second'

interface VoyageBriefingProps {
  language?: string | null
  recipientName?: string | null
  briefingKind?: BriefingKind | string | null
  voyageName?: string | null
  legs?: string[] | null
  partySize?: number | null
  bookingUrl?: string | null
  briefingContent?: string | null
  unsubscribeUrl?: string | null
}

const DEFAULT_CONTENT = {
  first: {
    it: `Benvenuto a bordo. Questo primo briefing arriva appena la tua partecipazione è confermata: contiene le informazioni pratiche da considerare prima di organizzare gli spostamenti e preparare il bagaglio.

Spostamenti da/per l'imbarco: pianifica con mezzi modificabili quando possibile. Se acquisti biglietti non flessibili, valuta un'assicurazione viaggio che consenta rimborso o cambio data in caso di variazioni operative.

Bagaglio: in barca non si portano valigie rigide, trolley o simili. Scegli una sacca morbida o uno zaino di medie dimensioni: si stiva meglio e in cabina occupa meno spazio.

Cosa portare: anche se si va per mare, alcune navigazioni sono notturne o al largo e può fare fresco. Porta almeno una camicia pesante, un pile o una giacca antivento. A bordo non si usano scarpe con suola scura: consigliamo scarpe adatte all'acqua e dedicate solo alla barca.

Saponi, detersivi e crema solare: non serve portare saponi o detersivi da casa, che comunque non si possono usare a bordo per ragioni ambientali. La crema solare è già in barca.`,
    en: `Welcome aboard. This first briefing is sent as soon as your participation is confirmed: it covers the practical information to consider before booking transfers and packing.

Travel to/from the embarkation point: plan with flexible transport where possible. If you buy non-flexible tickets, consider travel insurance that allows refund or date changes in case the operational plan changes.

Luggage: hard suitcases, trolleys and similar rigid luggage cannot be brought aboard. Choose a soft duffel or a medium backpack: it is easier to stow and takes less cabin space.

What to bring: even though this is a sea voyage, some passages happen at night or offshore and it can get cool. Bring at least a warm shirt, fleece or windbreaker. Dark-soled shoes cannot be used aboard: we recommend water-friendly shoes dedicated only to boat use.

Soap, detergents and sunscreen: there is no need to bring household soap or detergents, which cannot be used aboard for environmental reasons. Sunscreen is already on board.`,
  },
  second: {
    it: `Secondo briefing operativo: qui raccogliamo le informazioni utili per vivere bene la barca durante il viaggio.

Lavaggio e abbigliamento: a bordo non c'è una lavatrice. I vestiti si lavano a mano in un secchio, quindi porta capi semplici da lavare e asciugare. Le cose in barca si consumano facilmente e non sono previste sfilate: la maglietta della salute batte il vestito di marca.

Intrattenimento: la barca ha Starlink per una connessione veloce e illimitata, radio con casse interne ed esterne e un proiettore per i film serali. Non serve portare casse Bluetooth o altra attrezzatura.

Tecnologia: a bordo trovi prese elettriche tipo L e tipo F, più prese USB-A e USB-C per ricaricare i dispositivi.

Cibo e frigo: ci sono due frigoriferi con un piccolo congelatore, quindi niente ghiaccio in quantità. Puoi portare pietanze che vorresti mangiare o condividere, ma considera spazio, tempi e conservazione.

Posti ed esperienze: sentiti libero di proporre luoghi da vedere, soste o esperienze lungo la rotta. Le migliori idee entrano nel piano quando meteo, tempi e sicurezza lo permettono.`,
    en: `Second operational briefing: this collects useful information for living aboard during the voyage.

Laundry and clothing: there is no washing machine aboard. Clothes are washed by hand in a bucket, so bring items that are easy to wash and dry. Things wear out quickly on a boat and there are no fashion shows underway: practical beats branded.

Entertainment: the boat has Starlink for fast unlimited internet, radio with indoor and outdoor speakers, and a projector for evening movies. You do not need to bring Bluetooth speakers or extra gear.

Technology: aboard you will find Type L and Type F power sockets, plus USB-A and USB-C charging ports.

Food and fridge space: there are two fridges with a small freezer, so no large amounts of ice. You can bring food you would like to eat or share, but consider space, timing and storage.

Places and experiences: feel free to suggest places to see, stops or experiences along the route. The best ideas enter the plan when weather, timing and safety allow it.`,
  },
} as const

const COPY = {
  it: {
    eyebrow: 'Briefing viaggio',
    preview: {
      first: 'Prime informazioni pratiche per il tuo imbarco BITE',
      second: 'Informazioni operative per vivere bene la barca',
    },
    title: {
      first: 'Il tuo primo briefing di viaggio.',
      second: 'Secondo briefing operativo.',
    },
    intro: (name: string, voyageName: string, kind: BriefingKind) => {
      const prefix = name ? `${name}, ` : ''
      return kind === 'first'
        ? `${prefix}la tua partecipazione a ${voyageName} è confermata. Qui trovi le prime informazioni per organizzarti senza irrigidire troppo il piano.`
        : `${prefix}mancano altri dettagli pratici per ${voyageName}: vita a bordo, tecnologia, frigo e idee lungo la rotta.`
    },
    cta: 'Apri booking',
    voyageFallback: 'questo viaggio',
    summaryTitle: 'Riepilogo viaggio',
    contentTitle: 'Briefing',
    rememberTitle: 'Da ricordare',
    socketsTitle: 'Prese a bordo',
    partySize: 'Persone',
    legsTitle: 'Tratte',
    fallbackItemTitle: 'Nota pratica',
    highlights: {
      first: ['Biglietti flessibili', 'Sacca morbida', 'Strati caldi', 'Scarpe da barca'],
      second: ['Lavaggio a mano', 'Starlink', 'Prese L/F', 'Frigo limitato'],
    },
    footerReason: 'Ricevi questa email perché hai una partecipazione confermata a un viaggio BITE.',
  },
  en: {
    eyebrow: 'Voyage briefing',
    preview: {
      first: 'First practical information for your BITE berth',
      second: 'Operational information for living aboard',
    },
    title: {
      first: 'Your first voyage briefing.',
      second: 'Second operational briefing.',
    },
    intro: (name: string, voyageName: string, kind: BriefingKind) => {
      const prefix = name ? `${name}, ` : ''
      return kind === 'first'
        ? `${prefix}your participation in ${voyageName} is confirmed. Here is the first practical information so you can plan without making the plan too rigid.`
        : `${prefix}here are more practical details for ${voyageName}: life aboard, technology, fridge space and route ideas.`
    },
    cta: 'Open bookings',
    voyageFallback: 'this voyage',
    summaryTitle: 'Voyage summary',
    contentTitle: 'Briefing',
    rememberTitle: 'Remember',
    socketsTitle: 'Sockets aboard',
    partySize: 'People',
    legsTitle: 'Legs',
    fallbackItemTitle: 'Practical note',
    highlights: {
      first: ['Flexible tickets', 'Soft bag', 'Warm layers', 'Boat shoes'],
      second: ['Hand washing', 'Starlink', 'Type L/F sockets', 'Limited fridge space'],
    },
    footerReason: 'You are receiving this email because you have a confirmed participation in a BITE voyage.',
  },
} as const

function normalizeBriefingKind(value?: string | null): BriefingKind {
  return value === 'second' ? 'second' : 'first'
}

function paragraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitBriefingItem(value: string, fallbackTitle: string) {
  const colonIndex = value.indexOf(':')
  if (colonIndex > 0 && colonIndex <= 48) {
    return {
      title: value.slice(0, colonIndex).trim(),
      body: value.slice(colonIndex + 1).trim(),
    }
  }
  return { title: fallbackTitle, body: value }
}

function BriefingCards({
  content,
  fallbackTitle,
}: {
  content: string
  fallbackTitle: string
}) {
  const blocks = paragraphs(content)
  const intro = blocks[0] ?? ''
  const items = blocks.slice(1).map((item) => splitBriefingItem(item, fallbackTitle))
  const rows = []
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2))
  }

  return (
    <Section>
      {intro ? (
        <Section style={briefingLeadCard}>
          <Text style={briefingLeadText}>{intro}</Text>
        </Section>
      ) : null}
      <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((item, index) => {
                const number = rowIndex * 2 + index + 1
                return (
                  <td key={number} style={briefingItemCell}>
                    <Section style={briefingItemCard}>
                      <Text style={briefingItemNumber}>{String(number).padStart(2, '0')}</Text>
                      <Text style={briefingItemTitle}>{item.title}</Text>
                      <Text style={briefingItemBody}>{item.body}</Text>
                    </Section>
                  </td>
                )
              })}
              {row.length === 1 ? <td style={briefingItemCell} /> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function HighlightStrip({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <Section style={highlightStrip}>
      <Text style={highlightStripTitle}>{title}</Text>
      {items.map((item) => (
        <Text key={item} style={highlightChip}>
          {item}
        </Text>
      ))}
    </Section>
  )
}

function SocketVisuals({ title }: { title: string }) {
  return (
    <EmailCard>
      <EmailSectionLabel>{title}</EmailSectionLabel>
      <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
        <tbody>
          <tr>
            <td style={socketCell}>
              <TextLike label="Type L" />
              <div style={typeLBox}>
                <span style={socketHoleOutline} />
                <span style={socketHoleOutline} />
                <span style={socketHoleOutline} />
              </div>
            </td>
            <td style={socketCell}>
              <TextLike label="Type F" />
              <div style={typeFBox}>
                <span style={socketHoleSolid} />
                <span style={socketHoleSolid} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </EmailCard>
  )
}

function TextLike({ label }: { label: string }) {
  return <p style={socketLabel}>{label}</p>
}

const VoyageBriefingEmail = ({
  language,
  recipientName,
  briefingKind,
  voyageName,
  legs,
  partySize,
  bookingUrl,
  briefingContent,
  unsubscribeUrl,
}: VoyageBriefingProps) => {
  const lang = resolveEmailLanguage(language)
  const kind = normalizeBriefingKind(briefingKind)
  const copy = COPY[lang]
  const resolvedVoyageName = voyageName?.trim() || copy.voyageFallback
  const resolvedBookingUrl = bookingUrl?.trim() || `${PUBLIC_SITE_URL}/bookings`
  const safeLegs = legs?.filter((item) => item?.trim()) ?? []
  const content = briefingContent?.trim() || DEFAULT_CONTENT[kind][lang]

  return (
    <EditorialEmailShell
      language={lang}
      preview={copy.preview[kind]}
      eyebrow={copy.eyebrow}
      title={copy.title[kind]}
      intro={
        <EmailBodyText>
          {copy.intro(buildGreetingName(recipientName), resolvedVoyageName, kind)}
        </EmailBodyText>
      }
      primaryCta={{ label: copy.cta, url: resolvedBookingUrl }}
      footerReason={copy.footerReason}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailSignalPills
        items={[
          kind === 'first' ? 'Briefing 1' : 'Briefing 2',
          partySize ? `${copy.partySize}: ${partySize}` : null,
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

      <HighlightStrip title={copy.rememberTitle} items={copy.highlights[kind]} />

      <EmailCard>
        <EmailSectionLabel>{copy.contentTitle}</EmailSectionLabel>
        <BriefingCards content={content} fallbackTitle={copy.fallbackItemTitle} />
      </EmailCard>

      {kind === 'second' ? <SocketVisuals title={copy.socketsTitle} /> : null}
    </EditorialEmailShell>
  )
}

const socketCell = {
  width: '50%',
  padding: '0 8px 0 0',
  verticalAlign: 'top' as const,
}

const highlightStrip = {
  backgroundColor: '#152338',
  borderRadius: '20px',
  margin: '0 0 18px',
  padding: '18px 18px 10px',
}

const highlightStripTitle = {
  color: '#d7e5e3',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.16em',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
}

const highlightChip = {
  backgroundColor: 'rgba(255, 250, 243, 0.1)',
  border: '1px solid rgba(255, 250, 243, 0.22)',
  borderRadius: '999px',
  color: '#fffaf3',
  display: 'inline-block',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '12px',
  fontWeight: '700' as const,
  lineHeight: '1',
  margin: '0 8px 8px 0',
  padding: '10px 12px',
}

const briefingLeadCard = {
  backgroundColor: '#eef4f4',
  border: '1px solid #cddbdc',
  borderRadius: '18px',
  margin: '0 0 14px',
  padding: '16px 18px',
}

const briefingLeadText = {
  color: '#2d5356',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '15px',
  fontWeight: '600' as const,
  lineHeight: '1.7',
  margin: '0',
}

const briefingItemCell = {
  padding: '0 8px 12px 0',
  verticalAlign: 'top' as const,
  width: '50%',
}

const briefingItemCard = {
  backgroundColor: '#fffdf9',
  border: '1px solid #e6ddd1',
  borderRadius: '18px',
  minHeight: '174px',
  padding: '16px',
}

const briefingItemNumber = {
  backgroundColor: '#3f7c7a',
  borderRadius: '999px',
  color: '#fffaf3',
  display: 'inline-block',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '10px',
  fontWeight: '800' as const,
  letterSpacing: '0.12em',
  lineHeight: '1',
  margin: '0 0 12px',
  padding: '8px 10px',
}

const briefingItemTitle = {
  color: '#152338',
  fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif",
  fontSize: '21px',
  fontWeight: '600' as const,
  lineHeight: '1.2',
  margin: '0 0 8px',
}

const briefingItemBody = {
  color: '#3d4654',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '13px',
  lineHeight: '1.65',
  margin: '0',
}

const socketLabel = {
  color: '#6e7987',
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.14em',
  margin: '0 0 8px',
  textTransform: 'uppercase' as const,
}

const socketHoleOutline = {
  border: '1px solid #152338',
  borderRadius: '999px',
  display: 'inline-block',
  height: '10px',
  margin: '0 6px',
  width: '10px',
}

const socketHoleSolid = {
  backgroundColor: '#152338',
  borderRadius: '999px',
  display: 'inline-block',
  height: '10px',
  margin: '0 8px',
  width: '10px',
}

const typeLBox = {
  backgroundColor: '#f6f3ed',
  border: '1px solid #e3dbd0',
  borderRadius: '16px',
  padding: '22px 12px',
  textAlign: 'center' as const,
}

const typeFBox = {
  ...typeLBox,
  borderRadius: '999px',
}

export const template = {
  component: VoyageBriefingEmail,
  subject: (data: Record<string, unknown>) => {
    const language = resolveEmailLanguage(typeof data.language === 'string' ? data.language : null)
    const kind = normalizeBriefingKind(typeof data.briefingKind === 'string' ? data.briefingKind : null)
    const voyageName = typeof data.voyageName === 'string' ? data.voyageName.trim() : ''
    const title = COPY[language].title[kind]
    return voyageName ? `${title} ${voyageName} - BITE` : `${title} - BITE`
  },
  displayName: 'Voyage briefing',
  previewData: {
    language: 'it',
    recipientName: 'Massimo',
    briefingKind: 'first',
    voyageName: 'Mediterraneo 2026',
    legs: ['Palermo -> Cagliari', 'Cagliari -> Mahon'],
    partySize: 1,
    bookingUrl: `${PUBLIC_SITE_URL}/bookings`,
  },
} satisfies TemplateEntry
