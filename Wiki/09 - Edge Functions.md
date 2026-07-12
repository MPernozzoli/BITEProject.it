---
tags: [backend, edge-functions, serverless, supabase]
---
# 09 - Edge Functions

⬅️ [[Home]] · sorgente: `supabase/functions/` · config JWT in `supabase/config.toml`

28 funzioni serverless Supabase (Deno). Raggruppate per dominio:

## 📧 Email transazionale & sistema → [[12 - Newsletter ed Email]]
- `send-transactional-email` (verify_jwt) — invio email transazionali
- `preview-transactional-email` — anteprima template
- `process-email-queue` — worker coda email
- `auth-email-hook` (no jwt) — hook email di autenticazione (signup, recovery, magic-link…)
- `handle-email-suppression`, `handle-email-unsubscribe` — bounce/unsubscribe
- Template in `_shared/email-templates/` (signup, recovery, invite, magic-link, email-change, reauthentication) e `_shared/transactional-email-templates/`

## 📰 Newsletter → [[12 - Newsletter ed Email]]
- `newsletter-subscribe`, `confirm-newsletter-subscription`, `my-newsletter-subscription`
- `newsletter-dispatch`, `send-newsletter-digest`
- `newsletter-track-open`, `newsletter-track-click`
- `notify-article-publication`, `notify-story-subscribers`
- `publish-scheduled-articles` — pubblicazione articoli programmati

## 🔔 Notifiche & engagement
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — notifiche prenotazioni, pagamenti e cambi planning; per gli eventi admin invia anche Web Push agli admin iscritti → [[13 - Booking Voyage]]
- `vapid-public-key` — chiave push Web Push

## 🌐 Layer semantico pubblico → [[15 - Semantic Layer (AI Agents)]]
- `public-llms` — feed `llms.txt`
- `public-semantic` — oggetti JSON (articoli, voyage, waypoint, media, maps, refs)
- `public-geo` — GeoJSON rotte/waypoint
- `public-sitemap` — sitemap machine-readable

## 🗺️ Mappe / presenza
- (geo servito da `public-geo`) → [[14 - Mappe e Layer Geospaziale]]

## 📱 Social & contenuti
- `social-oauth-start`, `social-oauth-callback` — OAuth social publishing
- `publish-social-queue` — coda pubblicazione social
- `translate-editor-content` — traduzione contenuti editor (IT/EN)
- `contact-form-submit` — invio form contatti

## 👤 Profilo & storage
- `update-my-profile`
- `admin-storage-buckets` — provisioning bucket storage

## Codice condiviso (`_shared/`)
`email-config.ts`, `email-preferences.ts`, `newsletter-email.tsx`, `newsletter-helpers.ts`, `newsletter-subscription-activation.ts`, `public-semantic.ts`, `social-oauth-auth.ts`, `system-email-automation.ts`.
`email-config.ts`, `auth-email-hook` e `send-transactional-email` usano `mail.biteproject.it` come sender domain per le email automatiche; la casella ordinaria admin vive invece su `/api/email/*` in [[10 - API Vercel]].

## Collegamenti
- [[08 - Supabase]] · [[10 - API Vercel]] · [[12 - Newsletter ed Email]]
