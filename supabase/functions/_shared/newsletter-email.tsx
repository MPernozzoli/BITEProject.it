import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

const FOOTER_COPY: Record<string, { why: string; unsubscribe: string }> = {
  it: {
    why: 'Ricevi questa email perché ti sei iscritto alla newsletter di BITE.',
    unsubscribe: 'Disiscriviti',
  },
  en: {
    why: 'You are receiving this email because you subscribed to the BITE newsletter.',
    unsubscribe: 'Unsubscribe',
  },
  fr: {
    why: "Vous recevez cet email parce que vous êtes inscrit à la newsletter BITE.",
    unsubscribe: 'Se désinscrire',
  },
  de: {
    why: 'Du erhältst diese E-Mail, weil du den BITE-Newsletter abonniert hast.',
    unsubscribe: 'Abmelden',
  },
  es: {
    why: 'Recibes este correo porque te suscribiste a la newsletter de BITE.',
    unsubscribe: 'Cancelar suscripción',
  },
  pt: {
    why: 'Você recebeu este e-mail porque se inscreveu na newsletter da BITE.',
    unsubscribe: 'Cancelar inscrição',
  },
}

interface NewsletterEmailProps {
  lang: string
  preheader?: string
  bodyHtml: string
  unsubscribeUrl: string
  trackingPixelUrl?: string
}

export const NewsletterEmail = ({
  lang,
  preheader,
  bodyHtml,
  unsubscribeUrl,
  trackingPixelUrl,
}: NewsletterEmailProps) => {
  const footerCopy = FOOTER_COPY[lang] ?? FOOTER_COPY.en

  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{preheader || 'Latest notes from BITE'}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>BITE</Text>
          <Hr style={hr} />
          <Section
            style={content}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
          <Hr style={hr} />
          <Text style={footer}>{footerCopy.why}</Text>
          <Text style={footer}>
            <a href={unsubscribeUrl} style={link}>
              {footerCopy.unsubscribe}
            </a>
          </Text>
          {trackingPixelUrl ? (
            <img
              src={trackingPixelUrl}
              width="1"
              height="1"
              alt=""
              style={{ display: 'block', opacity: 0 }}
            />
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f5f2ed',
  fontFamily: "'DM Sans', Arial, sans-serif",
  margin: '0',
  padding: '24px 0',
}

const container = {
  backgroundColor: '#ffffff',
  maxWidth: '620px',
  margin: '0 auto',
  padding: '40px 32px',
}

const brand = {
  fontSize: '18px',
  fontWeight: '700' as const,
  letterSpacing: '0.4em',
  color: '#1a2236',
  margin: '0 0 12px',
}

const hr = {
  borderColor: '#e5ddd2',
  margin: '20px 0',
}

const content = {
  color: '#2b2f36',
  fontSize: '15px',
  lineHeight: '1.75',
}

const footer = {
  color: '#6b7280',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '0 0 8px',
}

const link = {
  color: '#1a2236',
  textDecoration: 'underline',
}
