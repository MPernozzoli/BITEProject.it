---
tags: [pagamenti, bunq, booking, funzionalita]
---
# 11 - Pagamenti Bunq

⬅️ [[Home]] · sorgente: `docs/payments-bunq.md`, `apps/web/api/payments/bunq/`, `apps/web/src/server/bunq/`, `apps/web/src/lib/booking-deposit.ts`

## Cosa è
Il flusso di [[13 - Booking Voyage]] richiede un **contributo equo alle spese vive del viaggio** pagato via **Bunq** prima della conferma. Inquadramento legale: BITE **non** è charter/turismo/trasporto — è un viaggio privato della crew aperto a chi vuole partecipare condividendo parte dei costi reali. Il cibo è gestito a bordo e non incluso.

[[23 - Community]] riusa Bunq per il **Crew Pass** membership, ma come dominio separato dal contributo viaggio: importi membership e benefit booking sono tracciati in tabelle dedicate e riconciliati server-side.

## Calcolo importo (server-authoritative)
Ricalcolato in `apps/web/src/lib/booking-deposit.ts`, **mai** fidato dal client:

- **Minimo fisso:** €20 a persona per viaggio, applicato solo alla prima prenotazione attiva dell'utente su quel voyage. Se lo stesso utente crea una seconda prenotazione per altre tratte dello stesso viaggio, il fisso viene saltato e si addebita solo la parte variabile delle nuove tratte.
- **Parte variabile:** miglia nautiche pianificate per tratta × coefficiente `booking_contribution_per_nm_eur` del viaggio (default **€0,90/NM**).
- **Modificatori di tratta** (additivi, solo sulla parte variabile):
  - navigazione notturna: **+10%**
  - navigazione d'altura (`open_sea`): **+20%**
  - navigazione pericolosa (`danger_level > 0`): **+20%** — vedi `apps/web/src/lib/danger-reasons.ts`
- Importi per persona sommati sulle tratte selezionate, **nessun cap** per persona.
- **Totale = importo per persona × dimensione gruppo (party size)**.
- Copy UI: sempre "contributo alle spese", mai tariffa/biglietto/prezzo/charter.
- Tooltip UI: spiegazione sintetica e non numerica; comunica che la quota viene stimata con un coefficiente chilometrico per ripartire uniformemente le spese vive del viaggio tra i partecipanti.

## Limite Bunq
Bunq limita a **€500 per singola transazione**. `/request` ritorna `409 bunq_amount_exceeds_single_transaction_limit` se l'importo supera €500 → il client instrada l'utente al **bonifico bancario** (`apps/web/api/payments/bunq/bank-transfer.ts`, migrazione `bank_transfer_deposits`).

## Flusso
1. Utente accetta le condizioni nel modal e preme *Conferma e versa il contributo*.
2. Creazione richiesta via RPC `request_voyage_booking` → [[08 - Supabase]].
3. Client chiama `POST /api/payments/bunq/request` con `bookingRequestId` + access token Supabase.
4. La function ricalcola l'importo, crea una **request-inquiry** Bunq, salva una riga in `voyage_booking_deposits`, ritorna il link `bunq.me`.
5. Da quel momento parte la scadenza pagamento di **48 ore** (`voyage_booking_requests.expires_at`); le prenotazioni in sola attesa di approvazione admin non hanno scadenza.
6. Redirect a Bunq per il pagamento.
7. Liquidazione rilevata dal **webhook** (`POST /api/payments/bunq/webhook`) o, in fallback, da `GET /api/payments/bunq/status?bookingRequestId=...`; quando non restano depositi pendenti, la deadline viene azzerata.

## Rimborsi automatici
`apps/web/api/bookings/status.ts` applica la policy di rimborso prima di rendere terminale una prenotazione:

- cancellazione o rifiuto da admin: **100%** dei depositi pagati;
- cancellazione utente: **100%** se mancano più di 30 giorni alla partenza, **50%** tra 30 e 15 giorni, **0%** sotto i 15 giorni;
- proposta di modifica admin rifiutata dall'utente con annullamento viaggio: **100%** a prescindere dalle date.

La API Bunq non espone un refund dedicato per `request-inquiry`: il rimborso viene eseguito creando un `Payment` in uscita verso il `counterparty_alias` del pagamento ricevuto. `voyage_booking_deposits` conserva `payer_alias`, `refund_amount_cents`, `refund_policy`, `refund_reference` e `refund_payment_id`; lo stato può diventare `partially_refunded` per i rimborsi al 50% o `refunded` per quelli completi. Se Bunq non è configurato o manca l'alias pagatore, la prenotazione non viene annullata/rifiutata: l'operazione fallisce prima del cambio stato.

## Scadenza pending pagamento
`expire_pending_voyage_booking_payments()` è una RPC `service_role` schedulata ogni ora con `pg_cron`: cancella le prenotazioni attive con depositi `pending` più vecchi di 48 ore, marca quei depositi come `cancelled`, invia le notifiche e libera/promuove eventuali posti in waitlist. Non interviene sulle richieste che aspettano solo una decisione admin.

## Sicurezza webhook
`apps/web/api/payments/bunq/webhook.ts` richiede `BUNQ_WEBHOOK_SECRET`: la callback Bunq deve includerlo nella URL (`?secret=...`) oppure in header `x-bite-bunq-webhook-secret` se passa da un proxy. Senza secret valido l'endpoint risponde `401` e non tenta alcuna riconciliazione. Il polling `/status` resta il controllo live autorevole verso Bunq.

## Endpoint → [[10 - API Vercel]]
`request` · `status` · `webhook` · `bank-transfer` · `bookings/status` per transizioni terminali con rimborso

Membership Crew Pass: `membership/request` e `membership/status` creano/pollano request-inquiry Bunq separate dai depositi booking → [[23 - Community]].

## Codice server → [[07 - Frontend - Lib e Hooks]]
`apps/web/src/server/bunq/`: `client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `refunds.ts`, `bank-details.ts`, `supabase.ts`

## Collegamenti
- [[13 - Booking Voyage]] · [[10 - API Vercel]] · [[08 - Supabase]] · [[23 - Community]]
