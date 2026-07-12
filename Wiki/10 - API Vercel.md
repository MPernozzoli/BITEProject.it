---
tags: [backend, api, vercel, serverless]
---
# 10 - API Vercel

⬅️ [[Home]] · sorgente: `apps/web/api/` · runtime: Vercel Functions

Endpoint serverless su Vercel (distinti dalle [[09 - Edge Functions]] Supabase). Usano gli helper in `apps/web/src/server/` → [[07 - Frontend - Lib e Hooks]].

## 💳 Pagamenti Bunq (`apps/web/api/payments/bunq/`) → [[11 - Pagamenti Bunq]]
| Endpoint | Metodo | Scopo |
|---|---|---|
| `request.ts` | POST | crea request-inquiry Bunq, ricalcola importo, salva `voyage_booking_deposits`, arma la deadline pagamento 48h, accoda email `payment_pending`, ritorna link `bunq.me`. `409` se importo > €500 |
| `status.ts` | GET | fallback polling: ri-verifica lo stato del pagamento per `bookingRequestId`, azzera la deadline quando non restano pending e accoda `payment_received` |
| `webhook.ts` | POST | riceve callback Bunq alla liquidazione, azzera la deadline quando non restano pending e accoda `payment_received` |
| `bank-transfer.ts` | POST | flusso alternativo bonifico bancario (per importi oltre limite Bunq), con stessa deadline 48h ed email `payment_pending` |

## 📅 Booking (`apps/web/api/bookings/`)
- `invite.ts` — invito partecipanti a una prenotazione; autorizza il lead della prenotazione o un admin, accetta `language` (`it`/`en`) dalla UI corrente e invia `voyage-participant-invite` agli ospiti pending → [[13 - Booking Voyage]]
- `status.ts` — transizioni terminali `cancelled`/`rejected` con policy rimborso Bunq prima del cambio stato: admin 100%, utente 100/50/0 in base ai giorni dalla partenza, proposta admin rifiutata 100% → [[11 - Pagamenti Bunq]]

## ✉️ Mail admin (`apps/web/api/email/`, `apps/web/api/webhooks/email/`) → [[12 - Newsletter ed Email]]
| Endpoint | Metodo | Scopo |
|---|---|---|
| `email/inbox.ts` | GET | lista inbox/sent e contatori per la pagina `/admin/mail`; idrata i messaggi inbound legacy senza corpo recuperandoli da Resend quando hanno `resend_email_id` |
| `email/send.ts` | POST | invio mail ordinarie da `@biteproject.it` e automatiche/newsletter da `@mail.biteproject.it` via Resend |
| `email/message.ts` | POST | azioni admin sui messaggi inbound: letto/non letto, preferita, archivio, spam, delete |
| `webhooks/email/inbound.ts` | POST | webhook Resend per email ricevute e tracking delivery/open/click/bounce; per `email.received` recupera corpo, header e attachment metadata dalla Received Emails API prima di salvare in `inbound_emails` |

## 🔎 SEO / crawler
- `sitemap.ts` — sitemap dinamica (esposta come `/sitemap-live.xml` via rewrite `vercel.json`)
- `prerender.ts` — prerendering per bot/crawler, in coppia con `middleware.ts` a livello edge. Per `logbook` e `voyages` genera HTML server-side con liste `<a>` IT/EN verso tutti i contenuti pubblici; per articoli e rotte genera canonical/hreflang, OpenGraph/Twitter, JSON-LD (`BlogPosting`/`Trip`), testo ed internal linking.
- `llms.ts` — proxy same-origin per `public-llms`, esposto come `/llms.txt` e `/llms-full.txt`, così gli agenti AI leggono il feed dal dominio canonico.

## Note
- La logica Bunq server-side vive in `apps/web/src/server/bunq/` (`client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `refunds.ts`, `bank-details.ts`, `supabase.ts`).
- Gli importi sono **sempre ricalcolati lato server** (`apps/web/src/lib/booking-deposit.ts`), mai fidati dal client.

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[13 - Booking Voyage]] · [[18 - Deploy e Configurazione]]
