---
tags: [backend, supabase, database, auth]
---
# 08 - Supabase

⬅️ [[Home]] · sorgente: `apps/web/supabase/`, `apps/web/src/integrations/supabase/`

Supabase è il **backend unico** del progetto.

- **Project ID:** `ekwloweuicrqjjgabfdp` (in `apps/web/supabase/config.toml`)
- **Client:** `apps/web/src/integrations/supabase/client.ts` (URL/key da env — vedi [[18 - Deploy e Configurazione]])
- **Tipi:** `apps/web/src/integrations/supabase/types.ts` (generati dallo schema). **Rigenerali quando cambi lo schema:** erano rimasti indietro al punto di non conoscere le tabelle `voyage_booking_*`, e il codice li aggirava con cast a client non tipizzato (`typedSupabase`, `rpc(... as never)`). Il build Vite non fa typecheck, quindi la deriva non si nota: il controllo vero è `npx tsc --noEmit -p tsconfig.app.json` da `apps/web` (il `tsconfig.json` radice ha `files: []` e non controlla nulla).

## Componenti usati
| Componente | Uso |
|---|---|
| **Postgres** | store primario di contenuti, viaggi, waypoint, booking, newsletter |
| **Auth** | login utenti e admin → `useAuth` in [[07 - Frontend - Lib e Hooks]] |
| **Storage** | media editoriali, avatar, asset (bucket gestiti da function `admin-storage-buckets`) |
| **Edge Functions** | logica serverless → [[09 - Edge Functions]] |
| **RLS** | policy di sicurezza per riga (definite nelle migrazioni) |
| **RPC** | funzioni SQL richiamate dal client (es. `request_voyage_booking`) |

## Account di test (agenti)
Esiste un utente di test creato per far autenticare gli agenti AI e verificare i flussi loggati (booking, `candidate_info`, ecc.).

- **email:** `claude-test@biteproject.it` · **user id:** `f1b264cf-1f1c-4540-9d67-c00d1cb4d1f1` · non admin.
- **Credenziali (password) solo in `AGENTS.md`** (file gitignored): mai committarle né duplicarle in note tracciate.
- Creato via SQL admin: riga `auth.users` (email confermata), `auth.identities` provider `email`, `public.profiles` (`preferred_language = it`).
- La UI di login è **passwordless** (OTP email / magic link, OAuth, passkey): la password serve solo per il **login programmatico** in test, es. `supabase.auth.signInWithPassword(...)` da console del browser. Il provider email/password è attivo a livello API anche se non esposto nella UI → dettagli e snippet in `AGENTS.md`.
- Le passkey usano `@supabase/supabase-js` con `auth.experimental.passkey: true`. Il login, la registrazione e il completamento profilo vengono eseguiti da `biteproject.it` anche quando partono dal sottodominio admin, così la cerimonia WebAuthn resta coerente con Relying Party ID e Relying Party Origins configurati in Supabase.

## Migrazioni (`apps/web/supabase/migrations/`)
**37+ file**, naming `AAAAMMGGhhmmss_descrizione.sql`. Le più recenti riguardano booking/pagamenti e la mail app admin:

- `..._prevent_duplicate_leg_booking.sql`
- `..._backfill_voyage_booking_max_guests.sql`
- `..._voyage_bookable_legs_danger_reasons.sql`
- `..._dynamic_voyage_contributions.sql` — coefficiente `booking_contribution_per_nm_eur`
- `..._fix_admin_booking_status_ambiguous_request_id.sql`
- `..._bank_transfer_deposits.sql` — pagamento via bonifico
- `..._admin_voyage_booking_notifications.sql`
- `..._editorial_media_storage_bucket_gap_fix.sql`
- `..._expire_pending_booking_payments.sql` — scadenza automatica 48h dei pagamenti booking `pending`
- `..._harden_security_definer_rpc_privileges.sql` — revoche `anon` su RPC `SECURITY DEFINER` sensibili e RLS su `_migration_chunks`
- `..._set_search_path_on_flagged_functions.sql` — `search_path` esplicito sulle funzioni segnalate dagli advisor
- `..._restrict_logbook_media_listing.sql` — rimuove il listing pubblico di `logbook-media`, mantenendo lettura admin e URL pubblici noti
- `..._normalize_duplicate_migration_gaps.sql` — sostituisce due migrazioni duplicate per timestamp e aggiunge i constraint mancanti sulle date flessibili voyage
- `..._restrict_homepage_media_listing.sql` — limita il listing pubblico di `homepage-media` ai soli media hero usati dalla home
- `..._restrict_internal_booking_rpc_helpers.sql` — rende service-role-only gli helper interni di manutenzione/promozione waitlist/notifiche booking
- `..._reconcile_voyage_booking_plan_changes.sql` — rende `sync_voyage_bookable_legs` una riconciliazione completa: aggiorna le prenotazioni sulle nuove tratte canoniche, registra `voyage_booking_plan_changes` e cancella le legs obsolete.
- `..._voyage_booking_email_flows.sql` — estende gli eventi `voyage_booking_notifications` per pagamenti e cambio planning, attiva trigger email su `voyage_booking_plan_changes` e backfill delle notifiche pending.
- `..._bite_mailapp.sql` — tabelle `inbound_emails`, `sent_emails`, `email_tracking_events`, `email_spam_senders`, `admin_email_aliases` per `/admin/mail`, con RLS admin e inserimenti server-side via [[10 - API Vercel]].
- `..._mail_conversation_threads.sql` / `..._normalize_mail_thread_message_ids.sql` — aggiungono threading conversazionale alla mail app (`thread_key`, `message_id`, `in_reply_to`, `references`) su inbound/sent e normalizzano gli ID legacy per agganciare risposte future.
- `..._sent_email_attachments.sql` — aggiunge `sent_emails.attachments` per salvare metadata degli allegati inviati dalla console admin senza persistere il contenuto base64.
- `..._booking_admin_push_notifications.sql` — aggiunge `push_sent_at` a `voyage_booking_notifications` e indicizza gli eventi admin pending per le push.
- `..._granular_push_notification_preferences.sql` — aggiunge i toggle granulari `push_mail_enabled`, `push_voyage_admin_enabled`, `push_voyage_user_enabled` su `email_notification_preferences`.
- `..._voyage_candidate_info.sql` — aggiunge `candidate_info` JSONB a `voyage_booking_requests` e `voyage_booking_participants`, estende `request_voyage_booking`/`accept_booking_participation`, introduce `admin_propose_voyage_booking_legs` per proporre tratte alternative dalla revisione candidati o dal Gantt booking, aggiunge `respond_voyage_booking_plan_change` per accettazione/controproposta/rifiuto/annullamento utente e porta i messaggi admin nelle notifiche utente di proposta/approvazione/rifiuto.
- `..._admin_booking_email_invites.sql` — abilita gli inviti booking creati da admin verso email non ancora registrate e trasferisce la prenotazione al profilo reale quando l'invitato accetta.
- `..._normalize_candidate_info_defaults.sql` — normalizza i valori nulli e rende `candidate_info` obbligatorio con default `{}` su richieste e partecipanti booking.
- `..._bunq_booking_refunds.sql` — estende `voyage_booking_deposits` con alias pagatore e campi audit rimborso (`refund_amount_cents`, `refund_policy`, `refund_reference`, `refund_payment_id`) e aggiunge lo stato `partially_refunded`.
- `..._voyage_booking_briefings.sql` — aggiunge i contenuti bilingue per prima/seconda mail briefing in `voyage_booking_settings`, estende `voyage_booking_notifications` con `first_briefing`/`second_briefing` e accoda automaticamente il primo briefing alla conferma booking o all'accettazione di un partecipante.
- `..._observation_parameter_limitations.sql` — aggiunge `limitations_en`/`limitations_it` a `observation_parameters`, portando nel catalogo il testo sui limiti che era hardcoded in `/Data/sensors` → [[22 - Citizen Science e Osservazioni]].
- `..._citizen_science_observations.sql` — introduce il dominio **citizen science** (`observation_parameters`, `observation_devices`, `observation_device_keys`, `observations`, `observation_measurements`), l'attribuzione automatica del viaggio dal timestamp e le viste `observations_map` / `observations_export` → [[22 - Citizen Science e Osservazioni]].
- `..._editorial_post_insights.sql` — aggiunge `editorial_post_insights`, snapshot metrici e note qualitative per ogni `editorial_publish_targets` social; RLS admin-only, utile al cockpit social del piano editoriale → [[16 - Admin]].
- `..._editorial_social_publish_metadata.sql` — aggiunge metadati provider a `editorial_publish_targets` (`platform_post_id`, permalink, `published_at`, `metrics_synced_at`) e versiona gli autopublisher editoriali con `pg_cron` + `pg_net` tramite `public.invoke_editorial_edge_function()`.
- `..._hours_stop_departure_time.sql` — aggiorna `booking_next_departure`: per le soste brevi (`stop_mode = 'hours'`) usa `stop_departure_time` quando presente, altrimenti mantiene il fallback `arrivo + stop_hours`.
- `..._validate_hours_stop_departure_time.sql` — rende invalido un `stop_departure_time` non successivo all'arrivo per le soste brevi; per ripartenze il giorno dopo va usato `stop_mode = 'nights'`.
- `..._editorial_cron_secret_auth.sql` — aggiorna `public.invoke_editorial_edge_function()` per usare secret dedicati (`scheduled_articles_cron_secret`, `social_publish_cron_secret`) salvati in Supabase Vault e corrispondenti Edge secrets; fallback opzionale a `supabase_service_role_key`.
- `..._voyage_candidates_do_not_hold_seats.sql` — aggiorna disponibilità e RPC booking: le candidature `requested`/`waitlisted` non occupano capacità, mentre i posti vengono scalati solo da richieste `admin_approved` o `user_confirmed`.
- `..._voyage_booking_drafts.sql` — introduce `voyage_booking_drafts`, una bozza candidatura per utente/viaggio con `leg_ids`, `party_size`, `message` e `candidate_info`; RLS limita lettura/scrittura al proprietario, con lettura admin per audit/supporto.
- `..._article_seo_optimizations.sql` — introduce `article_seo_optimizations`, tabella one-to-one con `logbook_articles` per SEO generata da IA (title/description social e meta, keyword, alt cover, frammenti JSON-LD, raccomandazioni, stato e audit modello). Lettura pubblica solo per articoli pubblicati, gestione admin/service-role.
- `..._voyage_availability_updates.sql` — introduce `voyage_availability_watches` e `voyage_availability_notifications`, RPC `list_my_voyage_availability_watches`/`set_voyage_availability_watch` e trigger che accodano email quando un voyage diventa partecipabile o una tratta piena torna disponibile → [[13 - Booking Voyage]].
- `..._email_queue_cron_for_availability_updates.sql` — aggiunge `invoke_email_queue_worker()` e cron `process-email-queue` ogni 5 minuti; il worker svuota anche `voyage_availability_notifications`.
- `..._email_queue_cron_secret_auth.sql` — aggiorna `invoke_email_queue_worker()` per usare `email_queue_cron_secret` da Vault, con fallback opzionale a `supabase_service_role_key`.
- `..._community_membership.sql` — introduce il dominio [[23 - Community]]: tier, subscription, pagamenti membership, audit benefit, post/community commenti/reaction/live events, RLS e Realtime.
- `..._community_membership_advisor_fixes.sql` — rende `touch_updated_at` conforme agli advisor e separa le policy admin community per evitare warning multipolicy sulle nuove tabelle.
- `..._community_engagement_surfaces.sql` — aggiunge live messages, poll, opzioni/voti, policy member-only e trigger per poll a scelta singola.
- `..._community_poll_stats_no_definer_rpc.sql` — sostituisce la RPC aggregata dei poll con `community_poll_option_stats` mantenuta da trigger non eseguibile dal client, eliminando il warning advisor su funzione `SECURITY DEFINER`.
- `..._community_livekit_manual_renewals.sql` — aggiunge LiveKit metadata sui live event, ruolo community moderator tramite `app_role = moderator`, prezzi Crew Pass mensili/annuali, `period_count` 1-3 sui pagamenti e reminder email membership accodati dal cron email esistente.
- `..._community_admin_governance.sql` — aggiunge RPC admin-only `admin_list_community_roles()` e `admin_set_community_moderator()` per governare la community da `/admin?section=community` senza esporre gestione ruoli generica al client.
- `..._community_feed_channels.sql` — aggiunge `community_channels`, collega i post a un canale, introduce `post_type`/media/link metadata, seed `main`, `boat-tips`, `ricette`, RLS per subfeed tier-gated e policy per post creati da membri attivi.
- `..._community_inline_composer_surfaces.sql` — abilita il composer unico del feed: `created_by` sui live event e policy per membri attivi che creano/aggiornano/eliminano poll, opzioni poll e live propri collegati ai post.
- `..._community_live_reminders.sql` — aggiunge `community_live_event_reminders`, dispatch email pre-live/start, lista push due service-role-only e aggancio del cron email alla Edge Function `dispatch-community-live-notifications`.
- `..._community_article_auto_posts.sql` — aggiunge `community_post_authors` per post multi-autore, backfill dall'autore primario, indice unico idempotente su `community_posts.metadata->>'source_article_id'` e policy RLS per leggere/scrivere gli autori dei post in base alla leggibilità/proprietà del post.
- `..._community_post_authors_realtime.sql` — aggiunge `community_post_authors` alla publication `supabase_realtime`.
- `..._public_article_cross_threads.sql` — rende pubblici i post Crew automatici collegati ad articoli (`metadata.source_article_id`) e azzera eventuale `min_tier_id`; i commenti restano sul thread `article_comments` del logbook.
- `..._harden_article_thread_rls_auth_calls.sql` — ottimizza le policy RLS di `article_comments` e `comment_likes` usando `(select auth.uid())`, senza cambiare permessi funzionali.
- `..._consolidate_community_posts_rls_policies.sql` — accorpa le policy admin/member di `community_posts` per evitare policy permissive duplicate su insert/update/delete.

> Schema di riferimento della migrazione originale: `docs/migration/SCHEMA.md`.

## RPC/tabelle chiave (dal dominio applicativo)
- `request_voyage_booking` (RPC) — registra una candidatura viaggio (`requested`) senza bloccare posti → [[13 - Booking Voyage]]
- `voyage_booking_drafts` — persistenza cloud delle bozze candidatura per utenti autenticati; gli anonimi usano `localStorage` e la bozza viene migrata/sincronizzata dopo login → [[13 - Booking Voyage]]
- `admin_propose_voyage_booking_legs` (RPC admin) — registra una proposta di tratte alternative in `voyage_booking_plan_changes`, con messaggio admin opzionale in metadata, senza modificare direttamente la matrice Gantt → [[13 - Booking Voyage]]
- `respond_voyage_booking_plan_change` (RPC utente) — risponde a una proposta pending: accetta e applica le tratte proposte, contropropone con messaggio, rifiuta o annulla la richiesta con notifica admin.
- `admin_create_voyage_booking_invite_by_email` (RPC admin) — crea una prenotazione da email esterna e una partecipazione pending invitabile via mail → [[13 - Booking Voyage]]
- `accept_booking_participation` (RPC) — collega l'invito all'utente autenticato, salva `candidate_info` e, per gli inviti admin one-person, trasferisce la richiesta dal profilo placeholder al profilo reale.
- `sync_voyage_bookable_legs` (RPC admin) — ricalcola le tratte prenotabili e riconcilia le prenotazioni esistenti con il planning corrente; congela poi il piano come baseline e rideriva lo schedule effettivo dagli actual. Il corpo storico vive in `sync_voyage_bookable_legs_plan` (interno) → [[21 - Tracking Real-Time Viaggi]]
- `compute_voyage_schedule` / `apply_voyage_schedule` / `set_voyage_waypoint_actual` — motore schedule, ricalcolo a cascata dalle date effettive e RPC di registrazione arrivo/partenza → [[21 - Tracking Real-Time Viaggi]]
- `voyage_leg_phase` / `voyage_derived_status` / `voyage_leg_is_bookable_now` — regole di fase viaggio/tratta e prenotabilità, mirrorate in `src/lib/voyage-schedule.ts` → [[21 - Tracking Real-Time Viaggi]]
- `refresh_all_voyage_statuses` (RPC + `pg_cron` `refresh-voyage-statuses`, ogni 15 min) — aggiorna la cache `voyages.status`; la UI ricalcola comunque dal vivo
- `voyage_booking_plan_changes` — audit/predisposizione approvazione utente per cambi planning booking → [[13 - Booking Voyage]]
- `voyage_booking_notifications` — coda email booking per utenti/admin, inclusi pagamenti, modifiche planning e briefing viaggio; gli eventi utente e `admin_*` registrano anche `push_sent_at` per Web Push filtrate dalle preferenze → [[12 - Newsletter ed Email]]
- `voyage_availability_watches` / `voyage_availability_notifications` — preferenze utente e coda email per aggiornamenti informativi su nuovi viaggi partecipabili o disponibilità riaperta su tratte osservate; dispatch via `dispatch-voyage-availability-updates` → [[12 - Newsletter ed Email]]
- `invoke_email_queue_worker` (RPC service-role/postgres) — invoca `process-email-queue` da `pg_cron` usando `email_queue_cron_secret` in Vault; il worker richiama anche i dispatcher booking/disponibilità prima dell'invio.
- `expire_pending_voyage_booking_payments` (RPC + `pg_cron`) — cancella prenotazioni attive con pagamento pendente scaduto, senza scadenza per l'attesa admin
- `voyage_booking_deposits` — depositi/contributi e audit rimborsi automatici; i bonifici restano `pending` finché API Bunq non trova un movimento in entrata con causale e importo esatto, e `admin_set_voyage_booking_status` impedisce approvazione/conferma finché esiste un deposito pending → [[11 - Pagamenti Bunq]]
- `inbound_emails` / `sent_emails` — casella admin e storico invii per mail ordinarie `@biteproject.it` e automatiche `@mail.biteproject.it`; `assigned_to_profile_id` collega gli inbound a un admin quando l'alias destinatario è deterministico. Entrambe le tabelle hanno campi conversazionali (`thread_key`, `message_id`, `in_reply_to`, `references`) per comporre thread inbound/outbound; `inbound_emails.attachments` conserva metadata e URL firmati temporanei Resend, `sent_emails.attachments` conserva solo metadata degli allegati inviati → [[12 - Newsletter ed Email]]
- `editorial_plan_channels` / `editorial_plan_slots` / `editorial_publish_targets` / `editorial_post_insights` — modello calendario editoriale multicanale: slot sito/social, asset e target di pubblicazione, metadati provider dei post pubblicati e snapshot insight per reach/views/engagement e note post-pubblicazione → [[16 - Admin]]
- `article_seo_optimizations` — output SEO generato da `optimize-article-seo`; la pagina articolo lo usa per meta title/description, keyword e arricchimento JSON-LD quando `status = ready`, mentre la dashboard admin segnala i record `failed` → [[17 - Content Model]]
- `membership_tiers` / `membership_subscriptions` / `membership_payments` / `membership_benefit_events` — modello Crew Pass e pagamenti Bunq membership → [[23 - Community]]
- `community_channels` / `community_posts` / `community_post_authors` / `community_comments` / `community_reactions` / `community_live_events` / `community_live_messages` — canali/subfeed, feed protetto, autori multipli dei post, discussioni native Crew, reaction e live thread della sub-app `apps/crew`; post e commenti hanno `linked_resources` JSONB per snapshot/link a articoli, stories, viaggi e tratte dell'app principale. I post automatici da articoli usano invece `article_comments`/`comment_likes` come thread pubblico condiviso con il logbook → [[23 - Community]]
- `community_live_event_reminders` — opt-in "Avvisami" sui live programmati, con campi `advance_*_sent_at` e `start_*_sent_at` per email e Web Push → [[23 - Community]]
- `community_polls` / `community_poll_options` / `community_poll_votes` / `community_poll_option_stats` — poll della community, voti member-only e conteggi aggregati leggibili senza esporre i voti degli altri utenti → [[23 - Community]]
- `has_community_moderation_role` — helper RLS per consentire moderazione a `admin` e `moderator` senza allargare i permessi admin.
- `can_read_community_channel` — helper RLS per canali pubblici/member/tier; `can_read_community_post` lo usa per filtrare i post collegati a subfeed.
- `admin_list_community_roles` / `admin_set_community_moderator` — RPC `SECURITY DEFINER` protette da `has_role(auth.uid(), 'admin')`: l'admin globale è anche admin community e può assegnare/rimuovere solo il ruolo `moderator` per commenti/live.
- `dispatch_membership_renewal_reminders` — RPC service-role/postgres che accoda email di rinnovo manuale Crew Pass nella coda transazionale esistente.
- `dispatch_community_live_event_email_reminders` / `list_due_community_live_event_push_reminders` — RPC service-role/postgres per reminder live: la prima accoda mail transazionali, la seconda alimenta il dispatcher Web Push.
- `resolve_voyage_for_timestamp` / `reattribute_observation_voyages` / `rebuild_observations_export_view` — helper `SECURITY DEFINER` **service-role-only** del dominio citizen science: attribuzione del viaggio dal timestamp e rigenerazione della vista di export dal catalogo parametri → [[22 - Citizen Science e Osservazioni]]
- Tabelle articoli, voyage, waypoint, media, profili, newsletter → modello in [[17 - Content Model]]

## Hardening remoto applicato
- `expire_pending_voyage_booking_payments` è schedulata ogni ora su Supabase Cron.
- Gli autopublisher editoriali `publish-scheduled-articles` e `publish-social-queue` sono schedulati via Supabase Cron; entrambi passano da `public.invoke_editorial_edge_function()` e si autenticano con secret cron dedicati sincronizzati tra Edge Function secrets e Supabase Vault.
- `process-email-queue` è schedulato ogni 5 minuti via `public.invoke_email_queue_worker()`; richiede `email_queue_cron_secret` in Vault e `EMAIL_QUEUE_CRON_SECRET` tra i secret Supabase Functions. Lo stesso invoke accoda i reminder Crew Pass/live e chiama `dispatch-community-live-notifications` per le push live.
- Le RPC booking/partecipanti/admin che richiedono login non sono più eseguibili dal ruolo `anon`.
- `_migration_exec` non è più eseguibile da `anon`/`authenticated`; `_migration_chunks` ha RLS e nessun accesso diretto client.
- `logbook-media` non consente più listing pubblico degli oggetti; resta servibile tramite public object URL.
- `homepage-media` consente listing pubblico solo per `hero-horizontal/` e `hero-vertical/` con estensioni media consentite.
- Il flusso `supabase db push --dry-run` è tornato pulito dopo la rimozione delle migrazioni duplicate `20260416113000_voyage_date_windows.sql` e `20260710130000_crew_auto_booking.sql`.
- Gli helper interni `deactivate_past_voyage_bookable_legs`, `promote_waitlisted_voyage_bookings`, `enqueue_voyage_booking_notification` e `enqueue_admin_voyage_booking_notifications` non sono più invocabili direttamente da `anon`/`authenticated`; restano utilizzabili da `service_role` e da funzioni `SECURITY DEFINER` server-side.
- Le migration community sono state applicate al remoto e `supabase db advisors --linked` non segnala warning filtrando `community_`, `membership_`, `sync_community`, `get_community` e `touch_updated_at`.
- Restano warning advisor da valutare separatamente: le RPC `SECURITY DEFINER` pubbliche/`authenticated` sono intenzionali ma richiedono revisione puntuale, e la leaked-password protection va abilitata nelle impostazioni Auth Supabase.

## Collegamenti
- Funzioni serverless: [[09 - Edge Functions]]
- Modello dati: [[17 - Content Model]]
- API pagamenti che parlano con Supabase: [[10 - API Vercel]]
