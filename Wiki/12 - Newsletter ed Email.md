---
tags: [newsletter, email, notifiche, funzionalita]
---
# 12 - Newsletter ed Email

⬅️ [[Home]] · sorgente: `supabase/functions/`, `src/lib/newsletter.ts`

Sistema completo di newsletter + email transazionali, interamente su [[09 - Edge Functions]].

## Naming pubblico
- A livello commerciale/utente il servizio **non si chiama "newsletter"**: si chiama **"Appunti dalla barca"** (IT) / **"Notes from the boat"** (EN). Vale per copy home, consenso, toast, pagine `/newsletter/confirm` e `/unsubscribe`, SEO e le email utente (conferma iscrizione, benvenuto, digest).
- "newsletter" resta solo come termine tecnico/interno: nomi di tabelle (`newsletter_*`), edge functions (`newsletter-dispatch`, ecc.), pannello `AdminNewsletterManager` e categoria generica nella privacy policy.

## Domini e mail app
- Mail automatiche/transazionali/newsletter: `@mail.biteproject.it` (`SENDER_DOMAIN=mail.biteproject.it`).
- Mail ordinarie/casella admin: `@biteproject.it`.
- Package installato: `@pynkstudio/mailapp` da `https://github.com/PynkStudio/pynkstudio-mailapp`; questa app Vite usa API Vercel dedicate invece dei server action Next del package.
- Console admin: `/admin/mail` (`AdminMail.tsx`) con inbox, inviate, preferite, archivio, spam, compose e webhook Resend → [[10 - API Vercel]].
- Inbound mail: il webhook risolve alias admin da `admin_email_aliases` (`massimo`, `massimo.pernozzoli`, `mpernozzoli`, ecc. generati da profilo/email admin). Se c'è un match unico assegna e invia push a quell'admin; se non determina l'assegnazione notifica tutti gli admin.
- Implementazione assegnazione inbound: `src/server/mail-push.ts` carica prima `user_roles.user_id` e poi i profili admin con una query separata su `profiles`; non usare embed PostgREST `user_roles -> profiles` perché `user_roles` non dichiara una FK verso `profiles`.

## Iscrizione & gestione
- `newsletter-subscribe` → invia email di conferma (double opt-in)
- `confirm-newsletter-subscription` → attiva iscrizione (pagina `/newsletter/confirm` → [[05 - Frontend - Pagine\|NewsletterConfirm]])
- `my-newsletter-subscription` → stato/preferenze utente
- `handle-email-unsubscribe` → pagina `/unsubscribe`
- `handle-email-suppression` → gestione bounce/soppressioni
- Lib client: `src/lib/newsletter.ts`, `src/lib/email-notification-preferences.ts`

## Invio & digest
- `newsletter-dispatch` — dispatch campagne; dopo aver accodato invoca inline `process-email-queue` (se ci sono consegne accodate) così le campagne partono subito senza dipendere dal cron/dashboard.
- `send-newsletter-digest` — digest periodico
- `process-email-queue` — worker della coda email (verify_jwt). Triggerato da: `contact-form-submit`, `newsletter-dispatch` (inline) ed eventuale cron `pg_cron` lato dashboard Supabase (non versionato).
- `send-transactional-email` / `preview-transactional-email` — email transazionali + anteprima

## Tracking
- `newsletter-track-open` — pixel apertura
- `newsletter-track-click` — redirect tracciato click

## Notifiche di pubblicazione
- `notify-article-publication` — nuovo articolo
- `notify-story-subscribers` — nuove story
- `publish-scheduled-articles` — pubblicazione programmata
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — eventi booking, email e push admin → [[13 - Booking Voyage]]
- Booking voyage: la coda `voyage_booking_notifications` copre conferma richiesta, waitlist, approvazione admin, conferma utente, cancellazione, rifiuto, promozione dalla waitlist, aggiunta manuale, pagamento in sospeso/ricevuto/scaduto, cambio planning e notifiche admin correlate. Gli eventi admin (`admin_*`) inviano anche Web Push agli admin con device registrato; `push_sent_at` evita invii duplicati.
- Cambi planning booking: `voyage_booking_plan_changes` accoda `plan_change_pending` quando serve approvazione utente. La mail mostra tratte prima/proposta e rimanda al booking per accettare, annullare con rimborso completo o chiedere una variazione; i cambi auto-accettati per equipaggio non richiedono approvazione manuale.
- Inviti partecipanti: `/api/bookings/invite` invia `voyage-participant-invite` agli ospiti ancora pending e marca `invite_sent_at`.

## Auth email
- `auth-email-hook` (no JWT) — intercetta email di autenticazione Supabase
- Template React-email in `supabase/functions/_shared/email-templates/`: `signup`, `recovery`, `magic-link`, `invite`, `email-change`, `reauthentication`

## Template & helper condivisi
`_shared/`: `email-config.ts`, `email-preferences.ts`, `newsletter-email.tsx`, `newsletter-helpers.ts`, `newsletter-subscription-activation.ts`, `system-email-automation.ts`, `transactional-email-templates/`.

## Push (Web Push)
- `vapid-public-key` — espone la chiave pubblica VAPID; gestione preferenze notifiche in `ProfileNotificationsMenu.tsx`.
- Le push admin booking e mail usano `push_subscriptions` e le variabili `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`.

## Collegamenti
- [[09 - Edge Functions]] · [[16 - Admin]] (AdminNewsletterManager)
