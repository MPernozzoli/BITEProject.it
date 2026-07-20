---
tags: [backend, edge-functions, serverless, supabase]
---
# 09 - Edge Functions

⬅️ [[Home]] · sorgente: `apps/web/supabase/functions/` · config JWT in `apps/web/supabase/config.toml`

32 funzioni serverless Supabase (Deno). Raggruppate per dominio:

## 📧 Email transazionale & sistema → [[12 - Newsletter ed Email]]
- `send-transactional-email` (verify_jwt) — invio email transazionali
- `dispatch-voyage-availability-updates` (verify_jwt) — invia gli aggiornamenti informativi su nuovi viaggi/tratte tornate disponibili, leggendo `voyage_availability_notifications`
- `preview-transactional-email` (verify_jwt) — anteprima template
- `process-email-queue` (verify_jwt) — worker coda email con invio Resend
- Il cron DB `process-email-queue` lo invoca ogni 5 minuti via `invoke_email_queue_worker()` con `EMAIL_QUEUE_CRON_SECRET` / `email_queue_cron_secret`; l'invoke accoda anche i reminder Crew Pass/live, chiama `dispatch-community-live-notifications` per le push live e poi spedisce le email accodate.
- `auth-email-hook` (no jwt, bearer `AUTH_EMAIL_HOOK_SECRET`) — hook email di autenticazione Supabase (signup, recovery, magic-link…)
- `handle-email-suppression` (no jwt, bearer interno o service-role), `handle-email-unsubscribe` — bounce/unsubscribe
- Template in `_shared/email-templates/` (signup, recovery, invite, magic-link, email-change, reauthentication) e `_shared/transactional-email-templates/`; i transazionali condividono `theme.tsx` per shell editoriale, card, pill, detail row, route box, callout e highlight importi. `voyage-briefing` gestisce le due mail briefing viaggio, incluso il visual delle prese tipo L/F nel secondo briefing.

## 📰 Newsletter → [[12 - Newsletter ed Email]]
- `newsletter-subscribe`, `confirm-newsletter-subscription`, `my-newsletter-subscription`
- `newsletter-dispatch`, `send-newsletter-digest`
- `newsletter-track-open`, `newsletter-track-click`
- `notify-article-publication`, `notify-story-subscribers`
- `publish-scheduled-articles` — pubblicazione articoli programmati. Espone `dry_run=1` per verificare la coda senza cambiare stato; in produzione viene invocata da `pg_cron` ogni minuto tramite `public.invoke_editorial_edge_function()`, `pg_net` e secret dedicato `SCHEDULED_ARTICLES_CRON_SECRET` / `scheduled_articles_cron_secret`.

## 🔔 Notifiche & engagement
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — notifiche prenotazioni, pagamenti, cambi planning e briefing viaggio; per gli eventi admin invia anche Web Push agli admin iscritti → [[13 - Booking Voyage]]
- `dispatch-voyage-availability-updates` — email non commerciali per utenti che hanno chiesto aggiornamenti su nuovi voyage partecipabili o disponibilità riaperta → [[13 - Booking Voyage]]
- `dispatch-community-live-notifications` — Web Push per gli utenti che hanno attivato "Avvisami" sui live BITE Crew; invia 10 minuti prima e quando la live inizia, usando `community_live_event_reminders` → [[23 - Community]]
- `vapid-public-key` — chiave push Web Push

## 🌐 Layer semantico pubblico → [[15 - Semantic Layer (AI Agents)]]
- `public-llms` — feed `llms.txt`
- `public-semantic` — oggetti JSON (articoli, voyage, waypoint, media, maps, refs)
- `public-geo` — GeoJSON rotte/waypoint
- `public-sitemap` — sitemap machine-readable

## 🗺️ Mappe / presenza
- (geo servito da `public-geo`) → [[14 - Mappe e Layer Geospaziale]]

## 📱 Social & contenuti
- `social-oauth-start`, `social-oauth-callback` — OAuth social publishing. Instagram usa il flusso **Instagram API with Instagram Login**: redirect su `https://www.instagram.com/oauth/authorize`, scope `instagram_business_basic` + `instagram_business_content_publish`, exchange su `api.instagram.com/oauth/access_token` e long-lived token su `graph.instagram.com/access_token`. La function richiede `SOCIAL_OAUTH_STATE_SECRET`, `SOCIAL_OAUTH_CALLBACK_URL`, `SOCIAL_OAUTH_FRONTEND_URL` e, per Instagram, `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` come secret Supabase.
- `instagram-metrics` — endpoint pubblico per `apps/pack`: legge server-side solo la connessione OAuth del canale `instagram_dogs`, aggiorna `pack.external_metrics_cache` e restituisce metriche compatte per il sito cani. Se il profilo non è ancora collegato o Instagram fallisce, Pack mantiene lo snapshot statico.
- `publish-social-queue` — coda pubblicazione social. Pubblica i target social scaduti usando slot locale o `publish_at`, salva `platform_post_id`, permalink e `published_at`, quindi sincronizza snapshot in `editorial_post_insights`. Oggi il publish automatico copre Instagram image/reel/story e YouTube video/short con token OAuth collegato; TikTok viene marcato con errore strutturato finché non è completato il flusso Direct Post/provider review. La function supporta `dry_run=1`, usa il secret dedicato `SOCIAL_PUBLISH_CRON_SECRET` / `social_publish_cron_secret` ed è schedulata via `pg_cron` ogni 5 minuti.
- `translate-editor-content` — traduzione contenuti editor (IT/EN) via OpenAI Responses API; legge `OPENAI_API_KEY` dai secret Supabase Functions e usa `TRANSLATION_OPENAI_MODEL` opzionale (default `gpt-5.6-luna`).
- `optimize-article-seo` — genera ottimizzazione SEO bilingue per articoli pubblicati via OpenAI Responses API: meta title/description, social copy, keyword, alt cover, suggerimenti e frammenti JSON-LD. Viene invocata in background dall'editor su pubblicazione/edit e dal publish programmato `publish-scheduled-articles`; salta gli articoli già processati se `source_hash` non cambia, mentre il pulsante manuale "Ottimizza SEO" forza la rigenerazione.
- `sync-article-community-post` — quando un articolo `logbook_articles` viene pubblicato, crea o aggiorna un post BITE Crew pubblico collegato all'articolo. Usa OpenAI Responses API (`OPENAI_API_KEY`, modello `COMMUNITY_OPENAI_MODEL` o fallback SEO/OpenAI) per generare titolo e testo bilingue del post, conserva tutti gli autori dell'articolo in `community_post_authors` e inserisce il riferimento all'articolo in `linked_resources`. Il post usa il thread pubblico `article_comments` del logbook, non `community_comments`. Viene invocata in background dall'editor articoli e da `publish-scheduled-articles`; accetta service-role o admin JWT.
- `contact-form-submit` — invio form contatti

## 👤 Profilo & storage
- `update-my-profile`
- `admin-storage-buckets` — provisioning bucket storage

## Codice condiviso (`_shared/`)
`email-config.ts`, `email-preferences.ts`, `newsletter-email.tsx`, `newsletter-helpers.ts`, `newsletter-subscription-activation.ts`, `public-semantic.ts`, `social-oauth-auth.ts`, `system-email-automation.ts`.
`email-config.ts`, `auth-email-hook` e `send-transactional-email` usano `mail.biteproject.it` come sender domain per le email automatiche. L'invio effettivo passa da Resend in `process-email-queue`; la casella ordinaria admin vive invece su `/api/email/*` in [[10 - API Vercel]].

## Collegamenti
- [[08 - Supabase]] · [[10 - API Vercel]] · [[12 - Newsletter ed Email]]
