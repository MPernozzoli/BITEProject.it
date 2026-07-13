---
tags: [backend, supabase, database, auth]
---
# 08 - Supabase

⬅️ [[Home]] · sorgente: `apps/web/supabase/`, `apps/web/src/integrations/supabase/`

Supabase è il **backend unico** del progetto.

- **Project ID:** `ekwloweuicrqjjgabfdp` (in `apps/web/supabase/config.toml`)
- **Client:** `apps/web/src/integrations/supabase/client.ts` (URL/key da env — vedi [[18 - Deploy e Configurazione]])
- **Tipi:** `apps/web/src/integrations/supabase/types.ts` (generati dallo schema)

## Componenti usati
| Componente | Uso |
|---|---|
| **Postgres** | store primario di contenuti, viaggi, waypoint, booking, newsletter |
| **Auth** | login utenti e admin → `useAuth` in [[07 - Frontend - Lib e Hooks]] |
| **Storage** | media editoriali, avatar, asset (bucket gestiti da function `admin-storage-buckets`) |
| **Edge Functions** | logica serverless → [[09 - Edge Functions]] |
| **RLS** | policy di sicurezza per riga (definite nelle migrazioni) |
| **RPC** | funzioni SQL richiamate dal client (es. `request_voyage_booking`) |

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
- `..._booking_admin_push_notifications.sql` — aggiunge `push_sent_at` a `voyage_booking_notifications` e indicizza gli eventi admin pending per le push.
- `..._granular_push_notification_preferences.sql` — aggiunge i toggle granulari `push_mail_enabled`, `push_voyage_admin_enabled`, `push_voyage_user_enabled` su `email_notification_preferences`.
- `..._voyage_candidate_info.sql` — aggiunge `candidate_info` JSONB a `voyage_booking_requests` e `voyage_booking_participants`, estende `request_voyage_booking`/`accept_booking_participation`, introduce `admin_propose_voyage_booking_legs` per proporre tratte alternative dalla revisione candidati o dal Gantt booking, aggiunge `respond_voyage_booking_plan_change` per accettazione/controproposta/rifiuto/annullamento utente e porta i messaggi admin nelle notifiche utente di proposta/approvazione/rifiuto.
- `..._admin_booking_email_invites.sql` — abilita gli inviti booking creati da admin verso email non ancora registrate e trasferisce la prenotazione al profilo reale quando l'invitato accetta.
- `..._normalize_candidate_info_defaults.sql` — normalizza i valori nulli e rende `candidate_info` obbligatorio con default `{}` su richieste e partecipanti booking.
- `..._bunq_booking_refunds.sql` — estende `voyage_booking_deposits` con alias pagatore e campi audit rimborso (`refund_amount_cents`, `refund_policy`, `refund_reference`, `refund_payment_id`) e aggiunge lo stato `partially_refunded`.
- `..._voyage_booking_briefings.sql` — aggiunge i contenuti bilingue per prima/seconda mail briefing in `voyage_booking_settings`, estende `voyage_booking_notifications` con `first_briefing`/`second_briefing` e accoda automaticamente il primo briefing alla conferma booking o all'accettazione di un partecipante.

> Schema di riferimento della migrazione originale: `docs/migration/SCHEMA.md`.

## RPC/tabelle chiave (dal dominio applicativo)
- `request_voyage_booking` (RPC) — crea richiesta di prenotazione → [[13 - Booking Voyage]]
- `admin_propose_voyage_booking_legs` (RPC admin) — registra una proposta di tratte alternative in `voyage_booking_plan_changes`, con messaggio admin opzionale in metadata, senza modificare direttamente la matrice Gantt → [[13 - Booking Voyage]]
- `respond_voyage_booking_plan_change` (RPC utente) — risponde a una proposta pending: accetta e applica le tratte proposte, contropropone con messaggio, rifiuta o annulla la richiesta con notifica admin.
- `admin_create_voyage_booking_invite_by_email` (RPC admin) — crea una prenotazione da email esterna e una partecipazione pending invitabile via mail → [[13 - Booking Voyage]]
- `accept_booking_participation` (RPC) — collega l'invito all'utente autenticato, salva `candidate_info` e, per gli inviti admin one-person, trasferisce la richiesta dal profilo placeholder al profilo reale.
- `sync_voyage_bookable_legs` (RPC admin) — ricalcola le tratte prenotabili e riconcilia le prenotazioni esistenti con il planning corrente
- `voyage_booking_plan_changes` — audit/predisposizione approvazione utente per cambi planning booking → [[13 - Booking Voyage]]
- `voyage_booking_notifications` — coda email booking per utenti/admin, inclusi pagamenti, modifiche planning e briefing viaggio; gli eventi utente e `admin_*` registrano anche `push_sent_at` per Web Push filtrate dalle preferenze → [[12 - Newsletter ed Email]]
- `expire_pending_voyage_booking_payments` (RPC + `pg_cron`) — cancella prenotazioni attive con pagamento pendente scaduto, senza scadenza per l'attesa admin
- `voyage_booking_deposits` — depositi/contributi e audit rimborsi automatici → [[11 - Pagamenti Bunq]]
- `inbound_emails` / `sent_emails` — casella admin e storico invii per mail ordinarie `@biteproject.it` e automatiche `@mail.biteproject.it`; `assigned_to_profile_id` collega gli inbound a un admin quando l'alias destinatario è deterministico. Entrambe le tabelle hanno campi conversazionali (`thread_key`, `message_id`, `in_reply_to`, `references`) per comporre thread inbound/outbound → [[12 - Newsletter ed Email]]
- Tabelle articoli, voyage, waypoint, media, profili, newsletter → modello in [[17 - Content Model]]

## Hardening remoto applicato
- `expire_pending_voyage_booking_payments` è schedulata ogni ora su Supabase Cron.
- Le RPC booking/partecipanti/admin che richiedono login non sono più eseguibili dal ruolo `anon`.
- `_migration_exec` non è più eseguibile da `anon`/`authenticated`; `_migration_chunks` ha RLS e nessun accesso diretto client.
- `logbook-media` non consente più listing pubblico degli oggetti; resta servibile tramite public object URL.
- `homepage-media` consente listing pubblico solo per `hero-horizontal/` e `hero-vertical/` con estensioni media consentite.
- Il flusso `supabase db push --dry-run` è tornato pulito dopo la rimozione delle migrazioni duplicate `20260416113000_voyage_date_windows.sql` e `20260710130000_crew_auto_booking.sql`.
- Gli helper interni `deactivate_past_voyage_bookable_legs`, `promote_waitlisted_voyage_bookings`, `enqueue_voyage_booking_notification` e `enqueue_admin_voyage_booking_notifications` non sono più invocabili direttamente da `anon`/`authenticated`; restano utilizzabili da `service_role` e da funzioni `SECURITY DEFINER` server-side.
- Restano warning advisor da valutare separatamente: le RPC `SECURITY DEFINER` pubbliche/`authenticated` sono intenzionali ma richiedono revisione puntuale, e la leaked-password protection va abilitata nelle impostazioni Auth Supabase.

## Collegamenti
- Funzioni serverless: [[09 - Edge Functions]]
- Modello dati: [[17 - Content Model]]
- API pagamenti che parlano con Supabase: [[10 - API Vercel]]
