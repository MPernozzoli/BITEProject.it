/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="it" dir="ltr">
    <Head />
    <Preview>Il tuo codice di verifica BITE</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>BITE</Text>
        <Heading style={h1}>Codice di verifica</Heading>
        <Text style={text}>Usa il codice qui sotto per confermare la tua identità:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          Il codice scadrà a breve. Se non hai richiesto questo codice, puoi ignorare questa email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#152338',
  letterSpacing: '0.15em',
  margin: '0 0 30px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
