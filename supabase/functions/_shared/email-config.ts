export const SITE_NAME = 'BITE'
export const FROM_DOMAIN = 'biteproject.it'
export const SENDER_DOMAIN = 'notify.biteproject.it'
export const PUBLIC_SITE_URL = 'https://biteproject.it'

export function buildFromAddress(fromName?: string | null): string {
  const senderName = fromName?.trim() || SITE_NAME
  return `${senderName} <noreply@${FROM_DOMAIN}>`
}
