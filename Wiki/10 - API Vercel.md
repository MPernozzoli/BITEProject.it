---
tags: [backend, api, vercel, serverless]
---
# 10 - API Vercel

⬅️ [[Home]] · sorgente: `api/` · runtime: Vercel Functions

Endpoint serverless su Vercel (distinti dalle [[09 - Edge Functions]] Supabase). Usano gli helper in `src/server/` → [[07 - Frontend - Lib e Hooks]].

## 💳 Pagamenti Bunq (`api/payments/bunq/`) → [[11 - Pagamenti Bunq]]
| Endpoint | Metodo | Scopo |
|---|---|---|
| `request.ts` | POST | crea request-inquiry Bunq, ricalcola importo, salva `voyage_booking_deposits`, arma la deadline pagamento 48h, ritorna link `bunq.me`. `409` se importo > €500 |
| `status.ts` | GET | fallback polling: ri-verifica lo stato del pagamento per `bookingRequestId` e azzera la deadline quando non restano pending |
| `webhook.ts` | POST | riceve callback Bunq alla liquidazione e azzera la deadline quando non restano pending |
| `bank-transfer.ts` | POST | flusso alternativo bonifico bancario (per importi oltre limite Bunq), con stessa deadline 48h |

## 📅 Booking (`api/bookings/`)
- `invite.ts` — invito partecipanti a una prenotazione → [[13 - Booking Voyage]]

## 🔎 SEO / crawler
- `sitemap.ts` — sitemap dinamica (esposta come `/sitemap-live.xml` via rewrite `vercel.json`)
- `prerender.ts` — prerendering per bot/crawler, in coppia con `middleware.ts` a livello edge

## Note
- La logica Bunq server-side vive in `src/server/bunq/` (`client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts`).
- Gli importi sono **sempre ricalcolati lato server** (`src/lib/booking-deposit.ts`), mai fidati dal client.

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]]
