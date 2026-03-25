/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="it" dir="ltr">
    <Head />
    <Preview>Reimposta la tua password per BITE</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>BITE</Text>
        <Heading style={h1}>Reimposta la tua password</Heading>
        <Text style={text}>
          Abbiamo ricevuto una richiesta di reimpostazione della password per il tuo account BITE.
          Clicca il pulsante qui sotto per scegliere una nuova password.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reimposta Password
        </Button>
        <Text style={footer}>
          Se non hai richiesto la reimpostazione, puoi ignorare questa email.
          La tua password non verrà modificata.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', system-ui, sans-serif" }
const container = { padding: '40px 25px' }
const brand = {
  fontFamily: "'Playfair Display', Georgia, serif",
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#152338',
  letterSpacing: '0.1em',
  margin: '0 0 30px',
}
const h1 = {
  fontFamily: "'Playfair Display', Georgia, serif",
  fontSize: '22px',
  fontWeight: '600' as const,
  color: '#152338',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#6a6f78',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: '#152338',
  color: '#f9f7f4',
  fontSize: '14px',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontWeight: '500' as const,
  borderRadius: '4px',
  padding: '12px 24px',
  textDecoration: 'none',
  letterSpacing: '0.05em',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
