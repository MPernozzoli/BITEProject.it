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
import { resolveSiteLanguage } from '../site-language.ts'

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

/**
 * Last line of defence for every template: whatever language string reaches a template gets
 * mapped here, using the same rule as the rest of the site. Previously anything that was not
 * exactly 'en' rendered in Italian, so a caller passing 'pl' or 'de' silently produced an
 * Italian email — see _shared/site-language.ts.
 */
export function resolveEmailLanguage(language?: string | null): EmailLanguage {
  return resolveSiteLanguage(language)
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
      <Head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={frame}>
            {/* Brand mark */}
            <Text style={brand}>{SITE_NAME}</Text>
            <Section style={brandRule} />

            {/* Hero image */}
            <Section style={heroFrame}>
              <Img
                src={resolvedHeroImage}
                alt={heroAlt || SITE_NAME}
                width="620"
                style={heroImage}
              />
            </Section>
            {heroCaption ? <Text style={heroCaptionStyle}>{heroCaption}</Text> : null}

            {/* Eyebrow + Title */}
            {eyebrow ? <Text style={eyebrowStyle}>{eyebrow}</Text> : null}
            <Heading as="h1" style={titleStyle}>
              {title}
            </Heading>

            {/* Intro */}
            {intro ? <Section style={introBlock}>{intro}</Section> : null}

            {/* CTA buttons */}
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

            {/* Body */}
            {children}

            {/* Footer */}
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
                    <span style={footerDivider}> · </span>
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

export function EmailSectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={sectionLabel}>{children}</Text>
}

export function EmailSignalPills({ items }: { items: React.ReactNode[] }) {
  const safeItems = items.filter(Boolean)
  if (!safeItems.length) return null

  return (
    <Section style={signalRow}>
      {safeItems.map((item, index) => (
        <Text key={index} style={signalPill}>
          {item}
        </Text>
      ))}
    </Section>
  )
}

export function EmailDetailRow({
  label,
  value,
  strong = false,
}: {
  label: React.ReactNode
  value: React.ReactNode
  strong?: boolean
}) {
  if (!value) return null

  return (
    <Section style={detailRow}>
      <Text style={detailLabel}>{label}</Text>
      <Text style={strong ? detailValueStrong : detailValue}>{value}</Text>
    </Section>
  )
}

export function EmailHighlightBox({
  label,
  value,
}: {
  label: React.ReactNode
  value: React.ReactNode
}) {
  if (!value) return null

  return (
    <Section style={highlightBox}>
      <Text style={highlightLabel}>{label}</Text>
      <Text style={highlightValue}>{value}</Text>
    </Section>
  )
}

export function EmailRouteBox({
  label,
  routes,
}: {
  label: React.ReactNode
  routes: string[]
}) {
  const safeRoutes = routes.filter((route) => route?.trim())
  if (!safeRoutes.length) return null

  return (
    <Section style={routeBox}>
      <Text style={routeLabel}>{label}</Text>
      <Text style={routeText}>{safeRoutes.join(' · ')}</Text>
    </Section>
  )
}

export function EmailCallout({ children }: { children: React.ReactNode }) {
  return <Text style={callout}>{children}</Text>
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

/* ─── Design tokens ─── */

const FONT_SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const FONT_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"

const COLOR_NAVY = '#152338'
const COLOR_BODY = '#3d4654'
const COLOR_MUTED = '#6e7987'
const COLOR_TEAL = '#3f7c7a'
const COLOR_TEAL_DARK = '#2d5356'
const COLOR_CREAM = '#fffdf9'
const COLOR_WARM_BG = '#f4efe7'
const COLOR_BORDER = '#e6ddd1'
const COLOR_CARD_BG = '#ffffff'
const COLOR_FOOTER_BG = '#f6f3ed'
const COLOR_FOOTER_BORDER = '#e3dbd0'
const COLOR_SECONDARY_BG = '#eef4f4'
const COLOR_SECONDARY_BORDER = '#cddbdc'
const COLOR_INLINE_BG = '#f3efe8'
const COLOR_INLINE_BORDER = '#ddd2c4'
const COLOR_ARTICLE_IMAGE_BG = '#ebf2f2'

const main = {
  backgroundColor: COLOR_WARM_BG,
  backgroundImage:
    'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(244,239,231,0.94) 45%, rgba(237,244,244,0.92) 100%)',
  fontFamily: FONT_SANS,
  margin: '0',
  padding: '32px 0',
}

const container = {
  margin: '0 auto',
  maxWidth: '680px',
  padding: '0 12px',
}

const frame = {
  backgroundColor: COLOR_CREAM,
  border: `1px solid ${COLOR_BORDER}`,
  borderRadius: '28px',
  boxShadow: '0 24px 64px rgba(21, 35, 56, 0.08)',
  overflow: 'hidden' as const,
  padding: '28px 26px',
}

const brand = {
  color: COLOR_NAVY,
  fontFamily: FONT_SERIF,
  fontSize: '16px',
  fontWeight: '700' as const,
  letterSpacing: '0.32em',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
}

const brandRule = {
  backgroundColor: COLOR_TEAL,
  borderRadius: '999px',
  height: '3px',
  margin: '0 0 22px',
  maxWidth: '72px',
}

const heroFrame = {
  backgroundColor: COLOR_ARTICLE_IMAGE_BG,
  borderRadius: '20px',
  overflow: 'hidden' as const,
  marginBottom: '18px',
}

const heroImage = {
  display: 'block' as const,
  height: 'auto',
  width: '100%',
}

const heroCaptionStyle = {
  color: COLOR_MUTED,
  fontFamily: FONT_SANS,
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '0 0 14px',
}

const eyebrowStyle = {
  color: COLOR_TEAL,
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.24em',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
}

const titleStyle = {
  color: COLOR_NAVY,
  fontFamily: FONT_SERIF,
  fontSize: '36px',
  fontWeight: '600' as const,
  letterSpacing: '-0.025em',
  lineHeight: '1.12',
  margin: '0 0 18px',
}

const introBlock = {
  marginBottom: '12px',
}

const bodyText = {
  color: COLOR_BODY,
  fontFamily: FONT_SANS,
  fontSize: '15px',
  lineHeight: '1.75',
  margin: '0 0 16px',
}

const bodyMutedText = {
  ...bodyText,
  color: COLOR_MUTED,
}

const sectionLabel = {
  color: COLOR_TEAL,
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.18em',
  margin: '0 0 10px',
  textTransform: 'uppercase' as const,
}

const signalRow = {
  margin: '0 0 18px',
}

const signalPill = {
  backgroundColor: COLOR_SECONDARY_BG,
  border: `1px solid ${COLOR_SECONDARY_BORDER}`,
  borderRadius: '999px',
  color: COLOR_TEAL_DARK,
  display: 'inline-block',
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.08em',
  lineHeight: '1',
  margin: '0 8px 8px 0',
  padding: '9px 12px',
  textTransform: 'uppercase' as const,
}

const detailRow = {
  borderTop: `1px solid ${COLOR_BORDER}`,
  margin: '0',
  padding: '13px 0 0',
}

const detailLabel = {
  color: COLOR_MUTED,
  display: 'inline-block',
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.12em',
  lineHeight: '1.5',
  margin: '0 16px 12px 0',
  textTransform: 'uppercase' as const,
  verticalAlign: 'top',
  width: '128px',
}

const detailValue = {
  color: COLOR_BODY,
  display: 'inline-block',
  fontFamily: FONT_SANS,
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0 0 12px',
  verticalAlign: 'top',
  width: 'calc(100% - 154px)',
}

const detailValueStrong = {
  ...detailValue,
  color: COLOR_NAVY,
  fontFamily: FONT_SERIF,
  fontSize: '22px',
  fontWeight: '600' as const,
  lineHeight: '1.25',
}

const highlightBox = {
  backgroundColor: COLOR_NAVY,
  borderRadius: '16px',
  margin: '0 0 14px',
  padding: '16px',
}

const highlightLabel = {
  color: '#d7e5e3',
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.14em',
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
}

const highlightValue = {
  color: '#fffaf3',
  fontFamily: FONT_SERIF,
  fontSize: '30px',
  fontWeight: '600' as const,
  lineHeight: '1.1',
  margin: '0',
}

const routeBox = {
  backgroundColor: COLOR_FOOTER_BG,
  border: `1px solid ${COLOR_FOOTER_BORDER}`,
  borderRadius: '16px',
  margin: '0 0 14px',
  padding: '14px 16px',
}

const routeLabel = {
  color: COLOR_MUTED,
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.14em',
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
}

const routeText = {
  color: COLOR_BODY,
  fontFamily: FONT_SANS,
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0',
}

const callout = {
  backgroundColor: COLOR_SECONDARY_BG,
  border: `1px solid ${COLOR_SECONDARY_BORDER}`,
  borderRadius: '16px',
  color: COLOR_TEAL_DARK,
  fontFamily: FONT_SANS,
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '4px 0 16px',
  padding: '14px 16px',
}

const ctaRow = {
  margin: '6px 0 24px',
}

const primaryButton = {
  backgroundColor: COLOR_NAVY,
  borderRadius: '999px',
  color: '#fffaf3',
  fontFamily: FONT_SANS,
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.06em',
  marginRight: '10px',
  padding: '14px 24px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const secondaryButton = {
  backgroundColor: COLOR_SECONDARY_BG,
  border: `1px solid ${COLOR_SECONDARY_BORDER}`,
  borderRadius: '999px',
  color: COLOR_TEAL_DARK,
  fontFamily: FONT_SANS,
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.06em',
  padding: '14px 24px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const card = {
  backgroundColor: COLOR_CARD_BG,
  border: `1px solid ${COLOR_BORDER}`,
  borderRadius: '20px',
  margin: '0 0 18px',
  padding: '22px 20px',
}

const articleCard = {
  ...card,
  padding: '18px',
}

const articleImageWrap = {
  backgroundColor: COLOR_ARTICLE_IMAGE_BG,
  borderRadius: '14px',
  marginBottom: '14px',
  overflow: 'hidden' as const,
}

const articleImage = {
  display: 'block' as const,
  height: 'auto',
  width: '100%',
}

const storyLabel = {
  color: COLOR_TEAL,
  fontFamily: FONT_SANS,
  fontSize: '11px',
  fontWeight: '700' as const,
  letterSpacing: '0.18em',
  margin: '0 0 8px',
  textTransform: 'uppercase' as const,
}

const storyLabelLink = {
  color: COLOR_TEAL,
  textDecoration: 'none',
}

const articleTitle = {
  color: COLOR_NAVY,
  fontFamily: FONT_SERIF,
  fontSize: '26px',
  fontWeight: '600' as const,
  letterSpacing: '-0.02em',
  lineHeight: '1.2',
  margin: '0 0 10px',
}

const articleTitleLink = {
  color: COLOR_NAVY,
  textDecoration: 'none',
}

const articleMeta = {
  color: COLOR_MUTED,
  fontFamily: FONT_SANS,
  fontSize: '12px',
  letterSpacing: '0.04em',
  lineHeight: '1.5',
  margin: '0 0 16px',
  textTransform: 'uppercase' as const,
}

const inlineButton = {
  backgroundColor: COLOR_INLINE_BG,
  border: `1px solid ${COLOR_INLINE_BORDER}`,
  borderRadius: '999px',
  color: COLOR_NAVY,
  fontFamily: FONT_SANS,
  fontSize: '12px',
  fontWeight: '700' as const,
  letterSpacing: '0.06em',
  padding: '11px 18px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
}

const footerCard = {
  backgroundColor: COLOR_FOOTER_BG,
  border: `1px solid ${COLOR_FOOTER_BORDER}`,
  borderRadius: '18px',
  marginTop: '28px',
  padding: '18px 20px 14px',
}

const footerText = {
  color: COLOR_MUTED,
  fontFamily: FONT_SANS,
  fontSize: '12px',
  lineHeight: '1.7',
  margin: '0 0 8px',
}

const footerLinks = {
  color: COLOR_NAVY,
  fontFamily: FONT_SANS,
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '0',
}

const footerLink = {
  color: COLOR_NAVY,
  textDecoration: 'underline',
}

const footerDivider = {
  color: '#a3adba',
}
