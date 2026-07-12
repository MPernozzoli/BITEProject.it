---
tags: [backend, supabase, database, auth]
---
# 08 - Supabase

⬅️ [[Home]] · sorgente: `supabase/`, `src/integrations/supabase/`

Supabase è il **backend unico** del progetto.

- **Project ID:** `ekwloweuicrqjjgabfdp` (in `supabase/config.toml`)
- **Client:** `src/integrations/supabase/client.ts` (URL/key da env — vedi [[18 - Deploy e Configurazione]])
- **Tipi:** `src/integrations/supabase/types.ts` (generati dallo schema)

## Componenti usati
| Componente | Uso |
|---|---|
| **Postgres** | store primario di contenuti, viaggi, waypoint, booking, newsletter |
| **Auth** | login utenti e admin → `useAuth` in [[07 - Frontend - Lib e Hooks]] |
| **Storage** | media editoriali, avatar, asset (bucket gestiti da function `admin-storage-buckets`) |
| **Edge Functions** | logica serverless → [[09 - Edge Functions]] |
| **RLS** | policy di sicurezza per riga (definite nelle migrazioni) |
| **RPC** | funzioni SQL richiamate dal client (es. `request_voyage_booking`) |

## Migrazioni (`supabase/migrations/`)
**36 file**, naming `AAAAMMGGhhmmss_descrizione.sql`. Le più recenti riguardano il dominio booking/pagamenti:

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

> Schema di riferimento della migrazione originale: `docs/migration/SCHEMA.md`.

## RPC/tabelle chiave (dal dominio applicativo)
- `request_voyage_booking` (RPC) — crea richiesta di prenotazione → [[13 - Booking Voyage]]
- `expire_pending_voyage_booking_payments` (RPC + `pg_cron`) — cancella prenotazioni attive con pagamento pendente scaduto, senza scadenza per l'attesa admin
- `voyage_booking_deposits` — depositi/contributi → [[11 - Pagamenti Bunq]]
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
