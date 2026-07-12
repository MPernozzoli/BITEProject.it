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

> Schema di riferimento della migrazione originale: `docs/migration/SCHEMA.md`.

## RPC/tabelle chiave (dal dominio applicativo)
- `request_voyage_booking` (RPC) — crea richiesta di prenotazione → [[13 - Booking Voyage]]
- `voyage_booking_deposits` — depositi/contributi → [[11 - Pagamenti Bunq]]
- Tabelle articoli, voyage, waypoint, media, profili, newsletter → modello in [[17 - Content Model]]

## Collegamenti
- Funzioni serverless: [[09 - Edge Functions]]
- Modello dati: [[17 - Content Model]]
- API pagamenti che parlano con Supabase: [[10 - API Vercel]]
