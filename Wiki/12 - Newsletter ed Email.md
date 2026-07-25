---
tags: [newsletter, email, notifiche, funzionalita]
---
# 12 - Newsletter ed Email

⬅️ [[Home]] · sorgente: `apps/web/supabase/functions/`, `apps/web/src/lib/newsletter.ts`

Sistema completo di newsletter + email transazionali, interamente su [[09 - Edge Functions]].
Lo stack operativo è **Supabase + Vercel + Resend**: Lovable resta solo come origine storica del progetto e non è più un provider email/auth.

## Naming pubblico
- A livello commerciale/utente il servizio **non si chiama "newsletter"**: si chiama **"Appunti dalla barca"** (IT) / **"Notes from the boat"** (EN). Vale per copy home, consenso, toast, pagine `/newsletter/confirm` e `/unsubscribe`, SEO e le email utente (conferma iscrizione, benvenuto, digest).
- "newsletter" resta solo come termine tecnico/interno: nomi di tabelle (`newsletter_*`), edge functions (`newsletter-dispatch`, ecc.), pannello `AdminNewsletterManager` e categoria generica nella privacy policy.

## Domini e mail app
- Mail automatiche/transazionali/newsletter: `@mail.biteproject.it` (`SENDER_DOMAIN=mail.biteproject.it`).
- Mail ordinarie/casella admin: `@biteproject.it`.
- Provider invio/ricezione: **Resend**. Le code e i log vivono in Supabase (`email_send_log`, `email_send_state`, PGMQ); il worker `process-email-queue` invia con `RESEND_API_KEY`.
- Package installato: `@pynkstudio/mailapp` da `https://github.com/PynkStudio/pynkstudio-mailapp`; questa app Vite usa API Vercel dedicate invece dei server action Next del package.
- Console admin: `/admin/mail` (`AdminMail.tsx`) con inbox, inviate, preferite, archivio, spam, compose, thread conversazionali e webhook Resend; il compose può aprirsi già precompilato via query `compose=1&to=...&subject=...`, usata anche dalla matrice booking admin → [[10 - API Vercel]].
- UX console mail: header compatto con ricerca server-side per mittente, destinatario, corpo e data; lista e dettaglio non mostrano più badge dominio/routing come elementi primari. Mittente/destinatari e anteprima corpo hanno priorità visiva. Il mittente usa `from_name`, poi un nome inferito dalla firma del testo nuovo, e solo infine l'indirizzo email. L'anteprima non include la citazione dei messaggi precedenti; le citazioni testuali nel corpo vengono collassate in stile Apple Mail con "Mostra di più da..." e "Nascondi"; gli URL in testo semplice sono link cliccabili. La leggibilità del dettaglio è gestita da classi dedicate in `index.css`: larghezza massima da reader, header sticky desktop, `text-wrap` progressivo, `overflow-wrap` per URL/stringhe lunghe e scroll separato lista/dettaglio. Su mobile `/admin/mail?message=<id>` diventa una vista dettaglio dedicata con toolbar sticky: elenco, rispondi, rispondi a tutti, preferita e archivia.
- Allegati mail admin: gli inbound mostrano metadata allegati e preview media quando Resend fornisce un `download_url` firmato ancora valido; se manca o scade, `/api/email/attachment` rinnova il link prima del download. Il compose supporta allegati base64 inviati via Resend, aggiunta da file picker e drag&drop desktop, con limite totale raw di 3 MB per contenere il payload serverless.
- Inbound mail: il webhook `webhooks/email/inbound.ts` riceve `email.received`, usa l'ID Resend per chiamare `GET /emails/receiving/:id` e salva corpo plain/html, header e attachment metadata in `inbound_emails`. `email/inbox.ts` idrata anche i record legacy senza corpo quando hanno `resend_email_id`. La UI `/admin/mail` preferisce `text_body` quando presente, così preserva e visualizza i livelli di citazione (`>`, `>>`, ecc.); l'HTML è fallback sanificato. Le notifiche push mail puntano a `/admin/mail?message=<inbound_email_id>` per aprire direttamente il messaggio appena ricevuto nella PWA e usano il tag `mail:<inbound_email_id>` per poter essere revocate quando la mail viene letta.
- Routing inbound: il webhook risolve alias admin da `admin_email_aliases` (`massimo`, `massimo.pernozzoli`, `mpernozzoli`, ecc. generati da profilo/email admin). Se c'è un match unico assegna e invia push a quell'admin; se non determina l'assegnazione notifica tutti gli admin.
- Implementazione assegnazione inbound: `apps/web/src/server/mail-push.ts` carica prima `user_roles.user_id` e poi i profili admin con una query separata su `profiles`; non usare embed PostgREST `user_roles -> profiles` perché `user_roles` non dichiara una FK verso `profiles`.
- Threading conversazionale: `apps/web/src/server/mail-threading.ts` normalizza `Message-ID`, `In-Reply-To` e `References`, assegna `thread_key` a inbound/sent e usa fallback soggetto+partecipanti per i messaggi legacy o senza header. `/api/email/inbox` allega `thread_messages` ordinati per mostrare la conversazione completa; `/api/email/send` accetta `replyToMessageId` e invia gli header Resend `In-Reply-To`/`References` quando si risponde.

## Iscrizione & gestione
- `newsletter-subscribe` → invia email di conferma (double opt-in)
- `confirm-newsletter-subscription` → attiva iscrizione (pagina `/newsletter/confirm` → [[05 - Frontend - Pagine\|NewsletterConfirm]])
- `my-newsletter-subscription` → stato/preferenze utente
- `handle-email-unsubscribe` → pagina `/unsubscribe`
- `handle-email-suppression` → gestione interna bounce/soppressioni; i webhook pubblici Resend della mail app passano da Vercel (`/api/webhooks/email/inbound`)
- Protezione di `newsletter-subscribe`: honeypot, consenso obbligatorio, cooldown per indirizzo (`resend_cooldown_minutes`) e rate limit per IP (10 richieste/ora) tramite `consume_rate_limit()` — il cooldown per indirizzo da solo non impediva di iterare su indirizzi diversi usando il dominio per spedire conferme non richieste. La ricerca del subscriber usa due query separate invece di un `.or()` costruito per concatenazione, perché i valori interpolati nei filtri PostgREST non sono parametrizzati.
- Lib client: `apps/web/src/lib/newsletter.ts`, `apps/web/src/lib/email-notification-preferences.ts`

## Invio & digest
- `newsletter-dispatch` — dispatch campagne; dopo aver accodato invoca inline `process-email-queue` (se ci sono consegne accodate) così le campagne partono subito senza dipendere dal cron/dashboard.
- Cron `newsletter-dispatch` ogni 5 minuti via `invoke_newsletter_dispatch()` (migrazione `20260725100000`). Senza questo job nulla invocava la funzione a parte il bottone "Invia ora" dell'admin: campagne schedulate, automazioni su iscrizione/disiscrizione e digest settimanale non partivano mai da soli. La funzione accetta l'header `x-cron-secret` (stesso segreto Vault `email_queue_cron_secret` del worker di coda) oltre a service-role key e JWT admin.
- `send-newsletter-digest` — digest periodico, innescato da `processWeeklyDigestAutomation()` dentro `newsletter-dispatch`
- `process-email-queue` — worker della coda email (verify_jwt) con invio Resend, retry/backoff e DLQ. Triggerato da: `contact-form-submit`, `newsletter-dispatch` (inline) e dal cron versionato `process-email-queue` ogni 5 minuti via `invoke_email_queue_worker()`.
- `send-transactional-email` / `preview-transactional-email` — email transazionali + anteprima service-role; i template registrati condividono uno shell editoriale BITE e componenti brand per card, pill, dettagli, tratte e importi.
- `dispatch-voyage-availability-updates` — svuota la coda `voyage_availability_notifications` e invia il template transazionale `voyage-availability-update` agli utenti che hanno chiesto aggiornamenti sui nuovi viaggi o sulle tratte piene tornate disponibili.

## Tracking
- `newsletter-track-open` — pixel apertura
- `newsletter-track-click` — redirect tracciato click
- Entrambi registrano tramite le funzioni SQL `newsletter_register_open()` / `newsletter_register_click()`: l'incremento dei contatori è atomico, perché il precedente read-modify-write perdeva le aperture concorrenti (proxy immagini, prefetch, client multipli).
- `newsletter-track-click` **fallisce chiuso**: se la coppia `delivery`/`token` non corrisponde a una consegna reale, reindirizza a `PUBLIC_SITE_URL` e non al `?url=` richiesto. Prima rediregeva comunque, rendendo l'endpoint un open redirect sul dominio del progetto — utilizzabile per phishing e dannoso per la reputazione del dominio mittente.

## Disiscrizione a un solo click (RFC 8058)
- `process-email-queue` emette `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click` su ogni messaggio in coda che porta un `unsubscribe_token` (newsletter, transazionali con token, contact form). Le email di autenticazione non ne hanno e non devono averlo. È un requisito dei bulk sender per Gmail, Yahoo e Microsoft.
- Il target è `/api/email/unsubscribe` sul dominio del brand, non su `*.supabase.co`: è l'URL che i provider mostrano accanto al mittente e concorre alla reputazione del dominio. In `GET` reindirizza alla pagina `/unsubscribe` (scelta granulare + motivo), in `POST` inoltra il one-click a `handle-email-unsubscribe`, che già gestiva il corpo `List-Unsubscribe=One-Click`.

## Notifiche di pubblicazione
- `notify-article-publication` — nuovo articolo
- `notify-story-subscribers` — nuove story
- `publish-scheduled-articles` — pubblicazione programmata
- `dispatch-engagement-notifications` — like/commenti/letture
- `dispatch-voyage-booking-notifications` — eventi booking, email e push admin → [[13 - Booking Voyage]]
- `dispatch-voyage-availability-updates` — aggiornamenti informativi non commerciali su nuovi voyage partecipabili o disponibilità riaperta su tratte osservate → [[13 - Booking Voyage]]
- Booking voyage: la coda `voyage_booking_notifications` copre conferma richiesta, waitlist, approvazione admin, conferma utente, cancellazione, rifiuto, promozione dalla waitlist, aggiunta manuale, pagamento in sospeso/ricevuto/scaduto, cambio planning, briefing viaggio e notifiche admin correlate. Le mail utente e admin usano la stessa struttura visuale: pill di stato, riepilogo operativo, box tratte, importi evidenziati e callout messaggi. Per `payment_pending` con `bank_transfer`, il copy dice esplicitamente che la candidatura non viene esaminata finche Bunq non conferma importo e causale. Gli eventi admin (`admin_*`) inviano anche Web Push agli admin con device registrato; `push_sent_at` evita invii duplicati.
- Audit email booking: `dispatch-voyage-booking-notifications` passa a `send-transactional-email` metadata tecnici (`notification_id`, `booking_request_id`, `event_type`, `payment_reference`, `payment_method`), che finiscono in `email_send_log.metadata` e nel payload PGMQ processato da `process-email-queue`.
- Aggiornamenti disponibilità viaggio: `voyage-availability-update` usa la stessa shell editoriale, ma il copy resta volutamente informativo ("hai chiesto aggiornamenti", "chiedere di partecipare", "si è liberata disponibilità") e rimanda a `/bookings?voyage=<id>`. Non crea candidatura automatica e non sostituisce il flusso booking.
- Briefing viaggio: il template React Email `voyage-briefing` gestisce `first_briefing` e `second_briefing`. Il primo briefing viene accodato automaticamente quando un booking passa a `user_confirmed` o quando un partecipante invitato accetta; include riepilogo viaggio/tratte, spostamenti flessibili, bagaglio morbido, abbigliamento caldo/antivento, scarpe da barca e prodotti già a bordo. Il secondo briefing è predisposto per invio operativo successivo e copre vita a bordo, lavaggio a mano, Starlink, audio/proiettore, prese tipo L/F con visual, USB-A/USB-C, frigo e suggerimenti esperienze.
- Cambi planning booking: `voyage_booking_plan_changes` accoda `plan_change_pending` quando serve approvazione utente. La mail mostra tratte prima/proposta e rimanda al booking per accettare, annullare con rimborso completo o chiedere una variazione; i cambi auto-accettati per equipaggio non richiedono approvazione manuale.
- Inviti partecipanti: `/api/bookings/invite` invia il template React Email `voyage-participant-invite` agli ospiti ancora pending e marca `invite_sent_at`; può essere chiamato dal lead oppure dall'admin quando l'invito nasce da `/admin/bookings` con email esterna. La lingua dell'invito segue la lingua del sito al momento dell'invio (`/it` → italiano, `/en` → inglese) e il link punta alla sezione booking nella stessa lingua.

## Auth email
- `auth-email-hook` (no JWT, bearer `AUTH_EMAIL_HOOK_SECRET`) — intercetta email di autenticazione Supabase e accoda i template su `auth_emails`
- Template React-email in `apps/web/supabase/functions/_shared/email-templates/`: `signup`, `recovery`, `magic-link`, `invite`, `email-change`, `reauthentication`
- Localizzazione (it/en): ogni template accetta una prop `locale` (`'it' | 'en'`, con copy dict interno) e imposta `<Html lang={locale}>`; anche `EMAIL_SUBJECTS` in `auth-email-hook/index.ts` è per-locale. La risoluzione della lingua (`resolveLocale`) segue: `user_metadata.lang` (impostato al signup da `UserLogin.tsx` con `data: { name, lang }`) → fallback `profiles.preferred_language` (lookup service-role per `user.id`) → `DEFAULT_LOCALE = 'it'`, coerente col fallback pubblico del sito ([[03 - Routing e i18n]]). Vale sia per il webhook nativo Supabase (`parseNativeHook`) sia per l'envelope legacy interno (`parseLegacyEnvelope`, che legge `payload.data.lang`/`payload.data.user_id`). L'endpoint `/preview` accetta `locale` nel body (default `it`).

## Template & helper condivisi
`_shared/`: `email-config.ts`, `email-preferences.ts`, `newsletter-email.tsx`, `newsletter-helpers.ts`, `newsletter-subscription-activation.ts`, `system-email-automation.ts`, `transactional-email-templates/`. In `transactional-email-templates/theme.tsx` vivono i componenti condivisi di brand; `voyage-participant-invite` usa layout card, riepilogo tratta/contributo e step numerati per guidare signup/login, compilazione dati candidato e conferma.

## Push (Web Push)
- `vapid-public-key` — espone la chiave pubblica VAPID; gestione preferenze notifiche in `ProfileNotificationsMenu.tsx` / `AdminProfile.tsx`.
- Le push usano `push_subscriptions` e le variabili `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`. La stessa coppia VAPID deve essere presente sia nei secret Supabase Functions sia nelle env Vercel, perché il client legge la public key da `vapid-public-key` mentre le push mail admin partono dalle API Vercel.
- Le push mail admin passano da `/api/webhooks/email/inbound` → `sendMailPushNotification()` in `apps/web/src/server/mail-push.ts`; lato Vercel `web-push` va importato come default ESM per esporre `sendNotification`. Quando `/api/email/message` marca una mail come letta, archiviata, spam o eliminata, `revokeMailPushNotification()` invia un payload `mail-read` agli admin notificati; il service worker chiude le notifiche con lo stesso tag senza mostrarne una nuova, così gli altri admin non restano con alert obsoleti.
- Su iOS/iPadOS la richiesta permesso funziona solo dalla web app installata in Home e dopo tap utente. `AdminProfile.tsx` rilegge lo stato al ritorno da Impostazioni/focus e distingue permesso negato da errori di registrazione device.
- Preferenze granulari in `email_notification_preferences`: `push_publication_enabled` (articoli/storie), `push_engagement_enabled` (like/commenti), `push_mail_enabled` (mail admin), `push_voyage_admin_enabled` (booking da gestire), `push_voyage_user_enabled` (booking/viaggi dell'utente).
- Notifiche in-app engagement: `ProfileNotificationsMenu.tsx` carica solo righe `engagement_notifications` senza `read_at`; il click su una notifica imposta `read_at` e la rimuove subito dal menu. Per le notifiche di pubblicazione articolo/storia, `useArticleReads.tsx` imposta `read_at` anche quando l'utente legge direttamente l'articolo, così il badge "nuovo articolo" sparisce pure senza passare dal menu.
- `AdminProfile.tsx` mostra solo i controlli applicabili: mail e viaggi admin solo agli admin; viaggi utente solo a chi ha almeno una richiesta/partecipazione booking. Il salvataggio passa da `update-my-profile` perché `email_notification_preferences` non è scrivibile direttamente dal client. Se la public key VAPID cambia, il client annulla la subscription vecchia e ne registra una nuova; `AdminDashboard.tsx` ripete questa sincronizzazione in background quando il permesso push è già `granted`.
- Regola per nuovi sistemi push: ogni nuovo dominio che invia Web Push deve dichiarare una colonna/preferenza dedicata o riusare esplicitamente una categoria esistente, filtrare l'invio lato server prima di leggere/spedire le subscription e documentare il controllo in questa sezione.

## Collegamenti
- [[09 - Edge Functions]] · [[16 - Admin]] (AdminNewsletterManager)
