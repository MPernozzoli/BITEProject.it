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
    preview: 'Conferma il cambio email per BITE',
    eyebrow: 'Account',
    heading: 'Conferma il cambio email',
    button: 'Conferma Cambio Email',
    footer: 'Se non hai richiesto questa modifica, proteggi subito il tuo account.',
    intro: (email: string, newEmail: string) => (
      <>
        Hai richiesto di cambiare il tuo indirizzo email su BITE da{' '}
        <Link href={`mailto:${email}`} style={link}>
          {email}
        </Link>{' '}
        a{' '}
        <Link href={`mailto:${newEmail}`} style={link}>
          {newEmail}
        </Link>
        . Clicca il pulsante qui sotto per confermare.
      </>
    ),
  },
  en: {
    preview: 'Confirm your email change for BITE',
    eyebrow: 'Account',
    heading: 'Confirm your email change',
    button: 'Confirm Email Change',
    footer: "If you didn't request this change, secure your account right away.",
    intro: (email: string, newEmail: string) => (
      <>
        You requested to change your BITE email address from{' '}
        <Link href={`mailto:${email}`} style={link}>
          {email}
        </Link>{' '}
        to{' '}
        <Link href={`mailto:${newEmail}`} style={link}>
          {newEmail}
        </Link>
        . Click the button below to confirm.
      </>
    ),
  },
} as const

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
  locale?: Locale
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
  locale = 'it',
}: EmailChangeEmailProps) => {
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
            <Text style={text}>{t.intro(email, newEmail)}</Text>
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

export default EmailChangeEmail

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
