---
tags: [pagamenti, bunq, booking, funzionalita]
---
# 11 - Pagamenti Bunq

⬅️ [[Home]] · sorgente: `docs/payments-bunq.md`, `api/payments/bunq/`, `src/server/bunq/`, `src/lib/booking-deposit.ts`

## Cosa è
Il flusso di [[13 - Booking Voyage]] richiede un **contributo equo alle spese vive del viaggio** pagato via **Bunq** prima della conferma. Inquadramento legale: BITE **non** è charter/turismo/trasporto — è un viaggio privato della crew aperto a chi vuole partecipare condividendo parte dei costi reali. Il cibo è gestito a bordo e non incluso.

## Calcolo importo (server-authoritative)
Ricalcolato in `src/lib/booking-deposit.ts`, **mai** fidato dal client:

- **Minimo fisso:** €20 a persona, applicato una sola volta (indipendente dal numero di tratte).
- **Parte variabile:** miglia nautiche pianificate per tratta × coefficiente `booking_contribution_per_nm_eur` del viaggio (default **€0,90/NM**).
- **Modificatori di tratta** (additivi, solo sulla parte variabile):
  - navigazione notturna: **+10%**
  - navigazione d'altura (`open_sea`): **+20%**
  - navigazione pericolosa (`danger_level > 0`): **+20%** — vedi `src/lib/danger-reasons.ts`
- Importi per persona sommati sulle tratte selezionate, **nessun cap** per persona.
- **Totale = importo per persona × dimensione gruppo (party size)**.
- Copy UI: sempre "contributo alle spese", mai tariffa/biglietto/prezzo/charter.
- Tooltip UI: spiegazione sintetica e non numerica; comunica che la quota viene stimata con un coefficiente chilometrico per ripartire uniformemente le spese vive del viaggio tra i partecipanti.

## Limite Bunq
Bunq limita a **€500 per singola transazione**. `/request` ritorna `409 bunq_amount_exceeds_single_transaction_limit` se l'importo supera €500 → il client instrada l'utente al **bonifico bancario** (`api/payments/bunq/bank-transfer.ts`, migrazione `bank_transfer_deposits`).

## Flusso
1. Utente accetta le condizioni nel modal e preme *Conferma e versa il contributo*.
2. Creazione richiesta via RPC `request_voyage_booking` → [[08 - Supabase]].
3. Client chiama `POST /api/payments/bunq/request` con `bookingRequestId` + access token Supabase.
4. La function ricalcola l'importo, crea una **request-inquiry** Bunq, salva una riga in `voyage_booking_deposits`, ritorna il link `bunq.me`.
5. Da quel momento parte la scadenza pagamento di **48 ore** (`voyage_booking_requests.expires_at`); le prenotazioni in sola attesa di approvazione admin non hanno scadenza.
6. Redirect a Bunq per il pagamento.
7. Liquidazione rilevata dal **webhook** (`POST /api/payments/bunq/webhook`) o, in fallback, da `GET /api/payments/bunq/status?bookingRequestId=...`; quando non restano depositi pendenti, la deadline viene azzerata.

## Scadenza pending pagamento
`expire_pending_voyage_booking_payments()` è una RPC `service_role` schedulata ogni ora con `pg_cron`: cancella le prenotazioni attive con depositi `pending` più vecchi di 48 ore, marca quei depositi come `cancelled`, invia le notifiche e libera/promuove eventuali posti in waitlist. Non interviene sulle richieste che aspettano solo una decisione admin.

## Sicurezza webhook
`api/payments/bunq/webhook.ts` richiede `BUNQ_WEBHOOK_SECRET`: la callback Bunq deve includerlo nella URL (`?secret=...`) oppure in header `x-bite-bunq-webhook-secret` se passa da un proxy. Senza secret valido l'endpoint risponde `401` e non tenta alcuna riconciliazione. Il polling `/status` resta il controllo live autorevole verso Bunq.

## Endpoint → [[10 - API Vercel]]
`request` · `status` · `webhook` · `bank-transfer`

## Codice server → [[07 - Frontend - Lib e Hooks]]
`src/server/bunq/`: `client.ts`, `payment-requests.ts`, `deposit-resolver.ts`, `bank-details.ts`, `supabase.ts`

## Collegamenti
- [[13 - Booking Voyage]] · [[10 - API Vercel]] · [[08 - Supabase]]
