import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { PUBLIC_SITE_URL, SITE_NAME } from '../email-config.ts'

const DEFAULT_HERO_IMAGE = `${PUBLIC_SITE_URL}/og-image.jpeg`

const SHELL_COPY = {
  it: {
    browseSite: 'Vai al sito',
    unsubscribe: 'Disiscriviti',
    footerReason:
      'Ricevi questa email perché hai interagito con le email o i contenuti di BITE.',
  },
  en: {
    browseSite: 'Visit the site',
    unsubscribe: 'Unsubscribe',
    footerReason:
      'You are receiving this email because you interacted with BITE emails or content.',
  },
} as const

export type EmailLanguage = 'it' | 'en'

export type EmailArticleItem = {
  title: string
  excerpt?: string | null
  url: string
  coverImageUrl?: string | null
  storyTitle?: string | null
  storyUrl?: string | null
  publishedLabel?: string | null
  locationName?: string | null
}

type EditorialEmailShellProps = {
  language?: string | null
  preview: string
  eyebrow?: string
  title: string
  intro?: React.ReactNode
  heroImageUrl?: string | null
  heroAlt?: string
  heroCaption?: string | null
  primaryCta?: { label: string; url: string } | null
  secondaryCta?: { label: string; url: string } | null
  children?: React.ReactNode
  footerReason?: string | null
  footerNote?: React.ReactNode
  unsubscribeUrl?: string | null
}

export function resolveEmailLanguage(language?: string | null): EmailLanguage {
  return language?.trim().toLowerCase() === 'en' ? 'en' : 'it'
}

export function buildGreetingName(recipientName?: string | null): string {
  if (!recipientName?.trim()) return ''
  return recipientName.trim().split(/\s+/)[0] ?? recipientName.trim()
}

export function EditorialEmailShell({
  language,
  preview,
  eyebrow,
  title,
  intro,
  heroImageUrl,
  heroAlt,
  heroCaption,
  primaryCta,
  secondaryCta,
  children,
  footerReason,
  footerNote,
  unsubscribeUrl,
}: EditorialEmailShellProps) {
  const lang = resolveEmailLanguage(language)
  const copy = SHELL_COPY[lang]
  const resolvedHeroImage = heroImageUrl?.trim() || DEFAULT_HERO_IMAGE

  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={frame}>
            <Text style={brand}>{SITE_NAME}</Text>
            <Section style={heroFrame}>
              <Img
                src={resolvedHeroImage}
                alt={heroAlt || SITE_NAME}
                width="620"
                style={heroImage}
              />
            </Section>
            {heroCaption ? <Text style={heroCaptionStyle}>{heroCaption}</Text> : null}
            {eyebrow ? <Text style={eyebrowStyle}>{eyebrow}</Text> : null}
            <Heading as="h1" style={titleStyle}>
              {title}
            </Heading>
            {intro ? <Section style={introBlock}>{intro}</Section> : null}
            {primaryCta || secondaryCta ? (
              <Section style={ctaRow}>
                {primaryCta ? (
                  <Button href={primaryCta.url} style={primaryButton}>
                    {primaryCta.label}
                  </Button>
                ) : null}
                {secondaryCta ? (
                  <Button href={secondaryCta.url} style={secondaryButton}>
                    {secondaryCta.label}
                  </Button>
                ) : null}
              </Section>
            ) : null}
            {children}
            <Section style={footerCard}>
              <Text style={footerText}>
                {footerReason?.trim() || copy.footerReason}
              </Text>
              <Text style={footerLinks}>
                <Link href={PUBLIC_SITE_URL} style={footerLink}>
                  {copy.browseSite}
                </Link>
                {unsubscribeUrl ? (
                  <>
                    <span style={footerDivider}> • </span>
                    <Link href={unsubscribeUrl} style={footerLink}>
                      {copy.unsubscribe}
                    </Link>
                  </>
                ) : null}
              </Text>
              {footerNote ? <Section>{footerNote}</Section> : null}
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export function EmailCard({
  children,
}: {
  children: React.ReactNode
}) {
  return <Section style={card}>{children}</Section>
}

export function EmailBodyText({
  children,
  muted = false,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return <Text style={muted ? bodyMutedText : bodyText}>{children}</Text>
}

export function EmailArticleCard({
  article,
  readLabel,
}: {
  article: EmailArticleItem
  readLabel: string
}) {
  return (
    <Section style={articleCard}>
      {article.coverImageUrl ? (
        <Section style={articleImageWrap}>
          <Img
            src={article.coverImageUrl}
            alt={article.title}
            width="556"
            style={articleImage}
          />
        </Section>
      ) : null}
      {article.storyTitle ? (
        article.storyUrl ? (
          <Text style={storyLabel}>
            <Link href={article.storyUrl} style={storyLabelLink}>
              {article.storyTitle}
            </Link>
          </Text>
        ) : (
          <Text style={storyLabel}>{article.storyTitle}</Text>
        )
      ) : null}
      <Heading as="h2" style={articleTitle}>
        <Link href={article.url} style={articleTitleLink}>
          {article.title}
        </Link>
      </Heading>
      {article.excerpt ? <Text style={bodyText}>{article.excerpt}</Text> : null}
      {article.publishedLabel || article.locationName ? (
        <Text style={articleMeta}>
          {[article.publishedLabel, article.locationName].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <Button href={article.url} style={inlineButton}>
        {readLabel}
      </Button>
    </Section>
  )
}

const main = {
  backgroundColor: '#f4efe7',
  backgroundImage:
    'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(244,239,231,0.94) 45%, rgba(237,244,244,0.92) 100%)',
  fontFamily: "'DM Sans', Arial, sans-serif",
  margin: '0',
  padding: '28px 0',
}

const container = {
  margin: '0 auto',
  maxWidth: '680px',
  padding: '0 12px',
}

const frame = {
  backgroundColor: '#fffdf9',
  border: '1px solid #e6ddd1',
  borderRadius: '30px',
  boxShadow: '0 26px 80px rgba(21, 35, 56, 0.10)',
  overflow: 'hidden',
  padding: '24px',
}

const brand = {
  color: '#152338',
  fontSize: '14px',
  fontWeight: '700' as const,
  letterSpacing: '0.34em',
  margin: '0 0 18px',
  textTransform: 'uppercase' as const,
}

const heroFrame = {
  backgroundColor: '#dde8ea',
  borderRadius: '22px',
  overflow: 'hidden',
  marginBottom: '16px',
}

const heroImage = {
  display: 'block',
  height: 'auto',
  width: '100%',
}

const heroCaptionStyle = {
  color: '#6e7987',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 12px',
}

const eyebrowStyle = {
  color: '#3f7c7a',
  fontSize: '12px',
  fontWeight: '700' as const,
  letterSpacing: '0.22em',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
}

const titleStyle = {
  color: '#152338',
  fontFamily: "'Playfair Display', Georgia, serif",
  fontSize: '38px',
  fontWeight: '600' as const,
  letterSpacing: '-0.03em',
  lineHeight: '1.08',
  margin: '0 0 16px',
}

const introBlock = {
  marginBottom: '10px',
}

const bodyText = {
  color: '#4c5563',
  fontSize: '15px',
  lineHeight: '1.8',
  margin: '0 0 16px',
}

const bodyMutedText = {
  ...bodyText,
  color: '#6e7987',
}

const ctaRow = {
  margin: '8px 0 20px',
}

const primaryButton = {
  backgroundColor: '#152338',
  borderRadius: '999px',
  color: '#fffaf3',
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.08em',
  marginRight: '10px',
  padding: '14px 22px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const secondaryButton = {
  backgroundColor: '#eef4f4',
  border: '1px solid #cddbdc',
  borderRadius: '999px',
  color: '#2d5356',
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.08em',
  padding: '14px 22px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const card = {
  backgroundColor: '#ffffff',
  border: '1px solid #e7e0d7',
  borderRadius: '22px',
  margin: '0 0 18px',
  padding: '22px 20px',
}

const articleCard = {
  ...card,
  padding: '18px',
}

const articleImageWrap = {
  backgroundColor: '#ebf2f2',
  borderRadius: '16px',
  marginBottom: '14px',
  overflow: 'hidden',
}

const articleImage = {
  display: 'block',
  height: 'auto',
  width: '100%',
}

const storyLabel = {
  color: '#3f7c7a',
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.16em',
  margin: '0 0 8px',
  textTransform: 'uppercase' as const,
}

const storyLabelLink = {
  color: '#3f7c7a',
  textDecoration: 'none',
}

const articleTitle = {
  color: '#152338',
  fontFamily: "'Playfair Display', Georgia, serif",
  fontSize: '27px',
  fontWeight: '600' as const,
  letterSpacing: '-0.02em',
  lineHeight: '1.18',
  margin: '0 0 10px',
}

const articleTitleLink = {
  color: '#152338',
  textDecoration: 'none',
}

const articleMeta = {
  color: '#6e7987',
  fontSize: '12px',
  letterSpacing: '0.05em',
  lineHeight: '1.5',
  margin: '0 0 16px',
  textTransform: 'uppercase' as const,
}

const inlineButton = {
  backgroundColor: '#f3efe8',
  border: '1px solid #ddd2c4',
  borderRadius: '999px',
  color: '#152338',
  fontSize: '12px',
  fontWeight: '700' as const,
  letterSpacing: '0.08em',
  padding: '11px 16px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const footerCard = {
  backgroundColor: '#f6f3ed',
  border: '1px solid #e3dbd0',
  borderRadius: '20px',
  marginTop: '24px',
  padding: '18px 18px 14px',
}

const footerText = {
  color: '#6e7987',
  fontSize: '12px',
  lineHeight: '1.7',
  margin: '0 0 8px',
}

const footerLinks = {
  color: '#152338',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '0',
}

const footerLink = {
  color: '#152338',
  textDecoration: 'underline',
}

const footerDivider = {
  color: '#a3adba',
}
