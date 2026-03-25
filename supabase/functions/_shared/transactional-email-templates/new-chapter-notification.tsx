import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "BITE"

interface NewChapterProps {
  storyTitle?: string
  chapterTitle?: string
  chapterUrl?: string
  storyUrl?: string
}

const NewChapterNotificationEmail = ({ storyTitle, chapterTitle, chapterUrl, storyUrl }: NewChapterProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New chapter in {storyTitle || 'a story you follow'} — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Hr style={hr} />
        <Heading style={h1}>
          New chapter published
        </Heading>
        <Text style={text}>
          A new chapter has been added to <strong>{storyTitle || 'a story you follow'}</strong>:
        </Text>
        <Heading as="h2" style={h2}>
          {chapterTitle || 'New Chapter'}
        </Heading>
        {chapterUrl && (
          <Button href={chapterUrl} style={button}>
            Read Now
          </Button>
        )}
        <Text style={footer}>
          You're receiving this because you subscribed to this story on {SITE_NAME}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NewChapterNotificationEmail,
  subject: (data: Record<string, any>) => `New chapter in "${data.storyTitle || 'Story'}" — ${SITE_NAME}`,
  displayName: 'New chapter notification',
  previewData: {
    storyTitle: 'The Refit Chronicles',
    chapterTitle: 'Chapter 3: Engine Rebuild',
    chapterUrl: 'https://biteproject.it/logbook/engine-rebuild',
    storyUrl: 'https://biteproject.it/logbook/story/refit-chronicles',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '540px', margin: '0 auto' }
const brand = { fontSize: '18px', fontWeight: '700' as const, letterSpacing: '3px', color: '#1a2236', margin: '0 0 16px' }
const hr = { borderColor: '#e5e5e5', margin: '16px 0 24px' }
const h1 = { fontSize: '22px', fontWeight: '600' as const, color: '#1a2236', margin: '0 0 16px', fontFamily: "'Playfair Display', Georgia, serif" }
const h2 = { fontSize: '18px', fontWeight: '500' as const, color: '#3d7a7a', margin: '0 0 24px', fontFamily: "'Playfair Display', Georgia, serif" }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const button = {
  backgroundColor: '#1a2236',
  color: '#f5f2ed',
  padding: '12px 28px',
  fontSize: '13px',
  fontWeight: '500' as const,
  letterSpacing: '0.5px',
  textDecoration: 'none',
  display: 'inline-block' as const,
  margin: '0 0 32px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' }
