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
- `handle-email-suppression` (no jwt, bearer interno o service-role), `handle-email-unsubscribe` — bounce/unsubscribe. Il confronto del bearer `EMAIL_SUPPRESSION_WEBHOOK_SECRET` è a **tempo costante**, non `===`: un confronto stringa esce al primo byte diverso e permette di ricostruire il segreto byte per byte misurando i tempi di risposta.
- Template in `_shared/email-templates/` (signup, recovery, invite, magic-link, email-change, reauthentication) e `_shared/transactional-email-templates/`; i transazionali condividono `theme.tsx` per shell editoriale, card, pill, detail row, route box, callout e highlight importi. `voyage-briefing` gestisce le due mail briefing viaggio, incluso il visual delle prese tipo L/F nel secondo briefing.

## 📰 Newsletter → [[12 - Newsletter ed Email]]
- `newsletter-subscribe`, `confirm-newsletter-subscription`, `my-newsletter-subscription`
- `newsletter-dispatch`, `send-newsletter-digest`
- `newsletter-track-open`, `newsletter-track-click`
- **Dal 2 agosto 2026 sono file da ~10 righe** che montano un handler di `@pynkstudio/newsletterapp` con `serveNewsletter()`. Le uniche con un corpo sono `send-newsletter-digest` (content model BITE) e `newsletter-dispatch` (agganci a coda email e notifiche di engagement). Anche `handle-email-unsubscribe` e `handle-email-suppression` sono montaggi; quest'ultima tiene solo l'autorizzazione del chiamante.
- Import dall'albero `deno/` del package via URL raw, pinnato in `_shared/newsletterapp.ts`: Deno risolve gli specifier alla lettera e non può usare `dist/`, scritto con estensioni `.js` per Node ESM.
- `notify-article-publication`, `notify-story-subscribers`
- `publish-scheduled-articles` — pubblicazione articoli programmati. Espone `dry_run=1` per verificare la coda senza cambiare stato; in produzione viene invocata da `pg_cron` ogni minuto tramite `public.invoke_editorial_edge_function()`, `pg_net` e secret dedicato `SCHEDULED_ARTICLES_CRON_SECRET` / `scheduled_articles_cron_secret`.

## 🔔 Notifiche & engagement
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — notifiche prenotazioni, pagamenti, cambi planning e briefing viaggio; per gli eventi admin invia anche Web Push agli admin iscritti → [[13 - Booking Voyage]]
- `dispatch-voyage-availability-updates` — email non commerciali per utenti che hanno chiesto aggiornamenti su nuovi voyage partecipabili o disponibilità riaperta → [[13 - Booking Voyage]]
- `dispatch-community-live-notifications` — Web Push per gli utenti che hanno attivato "Avvisami" sui live BITE Crew; invia 10 minuti prima e quando la live inizia, usando `community_live_event_reminders` → [[23 - Community]]. Il testo della push è **risolto per destinatario** leggendo `preferred_language` del profilo: prima era testo italiano fisso per tutti, in violazione della regola bilingue → [[03 - Routing e i18n]]
- `editorial-readiness-alert` — controllo proattivo di prontezza articoli. Ogni ora verifica gli slot del sito in programma nelle prossime 24h: se l'articolo assegnato non è pronto (manca copertina, excerpt, contenuto, tipo editoriale), invia Web Push agli admin. USA `check_article_readiness()` (DB function) e logga in `editorial_alert_log` per evitare spam. Secret: `EDITORIAL_ALERT_CRON_SECRET`.
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
- `translate-editor-content` — traduzione contenuti editor (IT/EN) via OpenAI Responses API; legge `OPENAI_API_KEY` dai secret Supabase Functions e usa `TRANSLATION_OPENAI_MODEL` opzionale (default `gpt-5.6-luna`). Accetta anche la service key iniettata via `isInjectedServiceKey` (`_shared/service-auth.ts`): senza, un chiamante server-to-server con la key opaca `sb_secret_...` verrebbe rifiutato perché non c'è nessun claim `role` da leggere — è il percorso usato dal tool `article_translate` di [[25 - MCP Admin]].
- `optimize-article-seo` — genera ottimizzazione SEO bilingue per articoli pubblicati via OpenAI Responses API: meta title/description, social copy, keyword, alt cover, suggerimenti e frammenti JSON-LD. Viene invocata in background dall'editor su pubblicazione/edit e dal publish programmato `publish-scheduled-articles`; salta gli articoli già processati se `source_hash` non cambia, mentre il pulsante manuale "Ottimizza SEO" forza la rigenerazione.
- `sync-article-community-post` — quando un articolo `logbook_articles` viene pubblicato, crea o aggiorna un post BITE Crew pubblico collegato all'articolo. Usa OpenAI Responses API (`OPENAI_API_KEY`, modello `COMMUNITY_OPENAI_MODEL` o fallback SEO/OpenAI) per generare titolo e testo bilingue del post; se la generazione IA fallisce, crea comunque un post fallback usando titolo/excerpt dell'articolo e salva `metadata.generation_status`. Conserva tutti gli autori dell'articolo in `community_post_authors` e inserisce il riferimento all'articolo in `linked_resources`. Il post usa il thread pubblico `article_comments` del logbook, non `community_comments`. Viene invocata in background dall'editor articoli e in modo atteso da `publish-scheduled-articles`, così gli errori del publish programmato restano visibili nel risultato cron; accetta service-role o admin JWT.
- `contact-form-submit` — invio form contatti

## 👤 Profilo & storage
- `update-my-profile`
- `admin-storage-buckets` — provisioning bucket storage

## Codice condiviso (`_shared/`)
`email-config.ts`, `newsletter-email.tsx`, `newsletterapp.ts` (pin della versione del package), `newsletter.ts` (config + contesto + `serveNewsletter`), `public-semantic.ts`, `social-oauth-auth.ts`.

`email-preferences.ts`, `newsletter-helpers.ts`, `system-email-automation.ts` e `newsletter-subscription-activation.ts` sopravvivono come **adattatori sottili** verso `@pynkstudio/newsletterapp`, per non toccare le function non-newsletter che li importano. Non contengono logica: nuovi comportamenti vanno nel package → [[12 - Newsletter ed Email]].
`email-config.ts`, `auth-email-hook` e `send-transactional-email` usano `mail.biteproject.it` come sender domain per le email automatiche. L'invio effettivo passa da Resend in `process-email-queue`; la casella ordinaria admin vive invece su `/api/email/*` in [[10 - API Vercel]].

## Tracker di sorgente nelle email
`_shared/tracking.ts` è il gemello Deno di `src/lib/utm.ts` (le function non possono importare dal bundle del sito; `src/test/tracking-parity.test.ts` verifica che le due implementazioni restino d'accordo). `_shared/email-config.ts` espone `trackedUrl(lang, path, tracking)`: `localizedUrl` più i parametri `utm_*`.

Lo usano `send-newsletter-digest` (campagna = finestra del digest, non l'etichetta tradotta dell'edizione), `notify-story-subscribers` (campagna = slug della storia) e `dispatch-engagement-notifications`, che distingue la consegna via email da quella via push nel `utm_medium` — è l'unico modo per sapere quale delle due riporta davvero qualcuno sul sito.

Si taggano solo i link che **rientrano da fuori**. I link interni — feed community, sitemap, canonical, semantic layer — restano nudi: un `utm_*` lì sovrascriverebbe la provenienza reale della sessione in corso → [[26 - Sorgenti di Traffico]]

## Collegamenti
- [[08 - Supabase]] · [[10 - API Vercel]] · [[12 - Newsletter ed Email]]
