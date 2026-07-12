---
tags: [backend, api, vercel, serverless]
---
# 10 - API Vercel

⬅️ [[Home]] · sorgente: `api/` · runtime: Vercel Functions

Endpoint serverless su Vercel (distinti dalle [[09 - Edge Functions]] Supabase). Usano gli helper in `src/server/` → [[07 - Frontend - Lib e Hooks]].

## 💳 Pagamenti Bunq (`api/payments/bunq/`) → [[11 - Pagamenti Bunq]]
| Endpoint | Metodo | Scopo |
|---|---|---|
| `request.ts` | POST | crea request-inquiry Bunq, ricalcola importo, salva `voyage_booking_deposits`, arma la deadline pagamento 48h, accoda email `payment_pending`, ritorna link `bunq.me`. `409` se importo > €500 |
| `status.ts` | GET | fallback polling: ri-verifica lo stato del pagamento per `bookingRequestId`, azzera la deadline quando non restano pending e accoda `payment_received` |
| `webhook.ts` | POST | riceve callback Bunq alla liquidazione, azzera la deadline quando non restano pending e accoda `payment_received` |
| `bank-transfer.ts` | POST | flusso alternativo bonifico bancario (per importi oltre limite Bunq), con stessa deadline 48h ed email `payment_pending` |

## 📅 Booking (`api/bookings/`)
- `invite.ts` — invito partecipanti a una prenotazione → [[13 - Booking Voyage]]

## ✉️ Mail admin (`api/email/`, `api/webhooks/email/`) → [[12 - Newsletter ed Email]]
| Endpoint | Metodo | Scopo |
|---|---|---|
| `email/inbox.ts` | GET | lista inbox/sent e contatori per la pagina `/admin/mail` |
| `email/send.ts` | POST | invio mail ordinarie da `@biteproject.it` e automatiche/newsletter da `@mail.biteproject.it` via Resend |
| `email/message.ts` | POST | azioni admin sui messaggi inbound: letto/non letto, preferita, archivio, spam, delete |
| `webhooks/email/inbound.ts` | POST | webhook Resend per email ricevute e tracking delivery/open/click/bounce |

## 🔎 SEO / crawler
- `sitemap.ts` — sitemap dinamica (esposta come `/sitemap-live.xml` via rewrite `vercel.json`)
- `prerender.ts` — prerendering per bot/crawler, in coppia con `middleware.ts` a livello edge

## Note
- La logica Bunq server-side vive in `src/server/bunq/` (`client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts`).
- Gli importi sono **sempre ricalcolati lato server** (`src/lib/booking-deposit.ts`), mai fidati dal client.

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]]
