/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

type Locale = 'it' | 'en'

const COPY = {
  it: {
    preview: 'Sei stato invitato su BITE',
    eyebrow: 'Invito',
    heading: 'Sei stato invitato',
    button: 'Accetta Invito',
    footer: 'Se non ti aspettavi questo invito, puoi ignorare questa email.',
    intro: (siteUrl: string) => (
      <>
        Sei stato invitato a unirti a{' '}
        <Link href={siteUrl} style={link}>
          <strong>BITE</strong>
        </Link>
        . Clicca il pulsante qui sotto per accettare l'invito e creare il tuo account.
      </>
    ),
  },
  en: {
    preview: "You've been invited to BITE",
    eyebrow: 'Invitation',
    heading: "You've been invited",
    button: 'Accept Invite',
    footer: "If you weren't expecting this invitation, you can safely ignore this email.",
    intro: (siteUrl: string) => (
      <>
        You've been invited to join{' '}
        <Link href={siteUrl} style={link}>
          <strong>BITE</strong>
        </Link>
        . Click the button below to accept the invitation and create your account.
      </>
    ),
  },
} as const

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  locale?: Locale
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  locale = 'it',
}: InviteEmailProps) => {
  const t = COPY[locale] ?? COPY.it
  return (
    <Html lang={locale} dir="ltr">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={frame}>
            <Text style={brand}>BITE</Text>
            <Text style={eyebrow}>{t.eyebrow}</Text>
            <Heading style={h1}>{t.heading}</Heading>
            <Text style={text}>{t.intro(siteUrl)}</Text>
            <Section style={ctaRow}>
              <Button style={button} href={confirmationUrl}>
                {t.button}
              </Button>
            </Section>
            <Hr style={divider} />
            <Text style={footer}>{t.footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteEmail

const FONT_SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const FONT_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"

const main = {
  backgroundColor: '#f4efe7',
  backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(244,239,231,0.94) 45%, rgba(237,244,244,0.92) 100%)',
  fontFamily: FONT_SANS,
  margin: '0',
  padding: '32px 0',
}
const container = { margin: '0 auto', maxWidth: '580px', padding: '0 12px' }
const frame = {
  backgroundColor: '#fffdf9',
  border: '1px solid #e6ddd1',
  borderRadius: '28px',
  boxShadow: '0 24px 64px rgba(21, 35, 56, 0.08)',
  padding: '36px 32px',
}
const brand = {
  color: '#152338',
  fontFamily: FONT_SERIF,
  fontSize: '16px',
  fontWeight: '700' as const,
  letterSpacing: '0.32em',
  margin: '0 0 24px',
  textTransform: 'uppercase' as const,
}
const eyebrow = {
  color: '#3f7c7a',
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.24em',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
}
const h1 = {
  fontFamily: FONT_SERIF,
  fontSize: '30px',
  fontWeight: '600' as const,
  color: '#152338',
  letterSpacing: '-0.025em',
  lineHeight: '1.15',
  margin: '0 0 20px',
}
const text = {
  fontFamily: FONT_SANS,
  fontSize: '15px',
  color: '#3d4654',
  lineHeight: '1.75',
  margin: '0 0 24px',
}
const link = { color: '#3f7c7a', textDecoration: 'underline' }
const ctaRow = { margin: '0 0 28px' }
const button = {
  backgroundColor: '#152338',
  borderRadius: '999px',
  color: '#fffaf3',
  fontFamily: FONT_SANS,
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.06em',
  padding: '14px 28px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}
const divider = { borderColor: '#e6ddd1', margin: '0 0 20px' }
const footer = {
  fontFamily: FONT_SANS,
  fontSize: '12px',
  color: '#6e7987',
  lineHeight: '1.6',
  margin: '0',
}
