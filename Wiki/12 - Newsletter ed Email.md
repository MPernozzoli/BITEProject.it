---
tags: [newsletter, email, notifiche, funzionalita]
---
# 12 - Newsletter ed Email

⬅️ [[Home]] · sorgente: `supabase/functions/`, `src/lib/newsletter.ts`

Sistema completo di newsletter + email transazionali, interamente su [[09 - Edge Functions]].

## Iscrizione & gestione
- `newsletter-subscribe` → invia email di conferma (double opt-in)
- `confirm-newsletter-subscription` → attiva iscrizione (pagina `/newsletter/confirm` → [[05 - Frontend - Pagine\|NewsletterConfirm]])
- `my-newsletter-subscription` → stato/preferenze utente
- `handle-email-unsubscribe` → pagina `/unsubscribe`
- `handle-email-suppression` → gestione bounce/soppressioni
- Lib client: `src/lib/newsletter.ts`, `src/lib/email-notification-preferences.ts`

## Invio & digest
- `newsletter-dispatch` — dispatch campagne
- `send-newsletter-digest` — digest periodico
- `process-email-queue` — worker della coda email (verify_jwt)
- `send-transactional-email` / `preview-transactional-email` — email transazionali + anteprima

## Tracking
- `newsletter-track-open` — pixel apertura
- `newsletter-track-click` — redirect tracciato click

## Notifiche di pubblicazione
- `notify-article-publication` — nuovo articolo
- `notify-story-subscribers` — nuove story
- `publish-scheduled-articles` — pubblicazione programmata
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — eventi booking → [[13 - Booking Voyage]]

## Auth email
- `auth-email-hook` (no JWT) — intercetta email di autenticazione Supabase
- Template React-email in `supabase/functions/_shared/email-templates/`: `signup`, `recovery`, `magic-link`, `invite`, `email-change`, `reauthentication`

## Template & helper condivisi
`_shared/`: `email-config.ts`, `email-preferences.ts`, `newsletter-email.tsx`, `newsletter-helpers.ts`, `newsletter-subscription-activation.ts`, `system-email-automation.ts`, `transactional-email-templates/`.

## Push (Web Push)
- `vapid-public-key` — espone la chiave pubblica VAPID; gestione preferenze notifiche in `ProfileNotificationsMenu.tsx`.

## Collegamenti
- [[09 - Edge Functions]] · [[16 - Admin]] (AdminNewsletterManager)
