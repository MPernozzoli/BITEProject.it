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

const FONT_SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const FONT_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"

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
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <Preview>{preheader || 'Latest notes from BITE'}</Preview>
      <Body style={main}>
        <Container style={outerContainer}>
          <Section style={frame}>
            <Text style={brand}>BITE</Text>
            <Hr style={hr} />
            <Section
              style={content}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
            <Hr style={hr} />
            <Section style={footerCard}>
              <Text style={footer}>{footerCopy.why}</Text>
              <Text style={footer}>
                <a href={unsubscribeUrl} style={link}>
                  {footerCopy.unsubscribe}
                </a>
              </Text>
            </Section>
          </Section>
        </Container>
        {trackingPixelUrl ? (
          <img
            src={trackingPixelUrl}
            width="1"
            height="1"
            alt=""
            style={{ display: 'block', opacity: 0 }}
          />
        ) : null}
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f4efe7',
  backgroundImage:
    'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(244,239,231,0.94) 45%, rgba(237,244,244,0.92) 100%)',
  fontFamily: FONT_SANS,
  margin: '0',
  padding: '32px 0',
}

const outerContainer = {
  margin: '0 auto',
  maxWidth: '680px',
  padding: '0 12px',
}

const frame = {
  backgroundColor: '#fffdf9',
  border: '1px solid #e6ddd1',
  borderRadius: '28px',
  boxShadow: '0 24px 64px rgba(21, 35, 56, 0.08)',
  overflow: 'hidden' as const,
  padding: '36px 32px',
}

const brand = {
  color: '#152338',
  fontFamily: FONT_SERIF,
  fontSize: '16px',
  fontWeight: '700' as const,
  letterSpacing: '0.32em',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
}

const hr = {
  borderColor: '#e6ddd1',
  margin: '20px 0',
}

const content = {
  color: '#3d4654',
  fontFamily: FONT_SANS,
  fontSize: '15px',
  lineHeight: '1.75',
}

const footerCard = {
  backgroundColor: '#f6f3ed',
  border: '1px solid #e3dbd0',
  borderRadius: '18px',
  padding: '18px 20px 14px',
}

const footer = {
  color: '#6e7987',
  fontFamily: FONT_SANS,
  fontSize: '12px',
  lineHeight: '1.7',
  margin: '0 0 8px',
}

const link = {
  color: '#152338',
  textDecoration: 'underline',
}
