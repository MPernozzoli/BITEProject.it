---
tags: [legale, termini, rimborsi, booking, funzionalita]
---
# 24 - Termini e Condizioni

⬅️ [[Home]] · sorgente: `apps/web/src/pages/Terms.tsx`, `apps/web/src/server/bunq/refunds.ts`, `apps/web/src/lib/plan-change-reasons.ts`

> ⚠️ **Bozza non validata legalmente.** Il testo è scritto per reggere l'inquadramento non commerciale, ma non è stato rivisto da un avvocato. Vedi [[#Cosa manca]].

## Concetto
Pagina `/terms` (bilingue IT/EN, `LegalPageShell` come [[05 - Frontend - Pagine]] privacy/cookie) che copre **registrazione, community e partecipazione ai viaggi**. Il cardine di tutto il testo è la **natura non commerciale**: BITE non è agenzia, tour operator né vettore; i viaggi non sono pacchetti turistici; quello che i partecipanti versano è **contributo alle spese comuni**, non un prezzo → [[11 - Pagamenti Bunq]], [[13 - Booking Voyage]].

## Struttura della pagina
17 sezioni: natura del progetto · accettazione · registrazione/account · community e contenuti · come funziona la partecipazione · **modifiche al viaggio, meteo e sicurezza** · contributo alle spese · **cancellazioni e rimborsi** · rischi e responsabilità · limitazione di responsabilità · forza maggiore · proprietà intellettuale · **foto, riprese e registrazioni** · protezione dati · modifiche ai Termini · legge e foro · contatti.

## Regole di dominio scritte nei Termini
- **Cosa NON comprende il contributo:** spese personali e alimentari, biglietti, attività scelte durante il viaggio (immersioni, tour guidati, musei, ristoranti, escursioni).
- **Cambusa fuori dal contributo:** concordata di volta in volta, di norma divisione pro-capite con strumenti tipo Tricount/Splitwise.
- **Nessun conguaglio di norma:** il contributo è **forfettario**, non ricalcolato a fine viaggio né in aumento né in diminuzione. Adeguamento solo in via eccezionale e mai dovuto in automatico. Scelta voluta: evitare di doversi fare i conti a posteriori.
- **Niente annullamento per pochi partecipanti:** sarebbe un marker da attività commerciale. Si viaggia comunque, anche da soli.
- **Date e porti sempre orientativi:** possono cambiare anche all'improvviso e a viaggio iniziato. Il criterio guida è la **sicurezza dell'equipaggio**; le decisioni di chi conduce prevalgono su qualsiasi programma. Non sono inadempimento e non danno diritto a rimborsi extra.
- **Trasferimenti a carico del partecipante:** raggiungere la partenza e rientrare dall'arrivo, più alloggio/vitto/trasporto per attese o cambi di programma (es. pernotto in attesa dell'imbarco, punto di ritrovo spostato da città X a Y).
- **Consenso immagini:** la partecipazione implica accettare di essere fotografati/ripresi/registrati e la pubblicazione su tutte le piattaforme del progetto, con opt-out e rimozione via email per le pubblicazioni successive.

## Policy rimborsi (allineata al codice)
La fonte di verità è `refundPolicyPercent()` in `apps/web/src/server/bunq/refunds.ts`, applicata da `POST /api/bookings/status` → [[11 - Pagamenti Bunq]].

| Caso | Trigger | Rimborso |
|---|---|---|
| Rinuncia del viaggiatore | `user_cancelled` | 100% oltre 30 gg · 50% tra 15 e 30 · 0% sotto 15 |
| Annullamento/rifiuto da noi | `admin_cancelled`, `admin_rejected` | 100% sempre |
| Modifica piano rifiutata, **per forza maggiore** | `admin_plan_change_declined` | stesse fasce della rinuncia |
| Modifica piano rifiutata, **altre ragioni** | `admin_plan_change_declined` | 100% |

Test di regressione: `apps/web/src/test/booking-refund-policy.test.ts` (11 casi, copre ogni fascia, entrambi i rami e i limiti dell'override).

## Motivazione della modifica e forza maggiore
Quando l'admin propone una modifica di tratte, **deve** scegliere una motivazione: è quella a decidere il rimborso dovuto se il viaggiatore rifiuta.

- Catalogo in `apps/web/src/lib/plan-change-reasons.ts`. Forza maggiore: `weather`, `safety`, `technical_failure`, `authority_order`, `health_emergency`. Non forza maggiore: `crew_reorganization`, `logistics`, `other`.
- **Selettore unico, flag derivato:** non esiste una spunta "forza maggiore" separata, così una coppia contraddittoria (forza maggiore + riorganizzazione equipaggio) non è rappresentabile. Il boolean autoritativo `force_majeure` è derivato e salvato **server-side** da `admin_propose_voyage_booking_legs` (migrazione `20260721120000_plan_change_reason.sql`, helper SQL `plan_change_reason_is_force_majeure`); le label TS servono solo alla UI.
- Salvato in `voyage_booking_plan_changes.metadata` (`change_reason`, `force_majeure`) e specchiato in `voyage_booking_requests.plan_change_metadata`.
- **Scelte difensive volute:** motivazione assente ⇒ trattata come **non** forza maggiore (100%), perché un dato mancante non deve mai ridurre il rimborso di qualcuno; `declinedChangeWasForceMajeure()` legge solo la modifica in `pending_user_approval`, per non leggere per sbaglio una proposta partita dal viaggiatore (`pending_admin_approval`).

## Override manuale del rimborso
`refundBookingDeposits(db, booking, trigger, overridePercent)` accetta una percentuale scelta da un admin, che può **solo alzare** il risultato di policy: un override più basso viene ignorato invece che rifiutato, così un valore stale o malformato non paga mai meno di quanto promettono i Termini. Passa da `refundPercentOverride` in `POST /api/bookings/status` e da `updateBookingStatusWithRefund()`.

## UI admin → [[16 - Admin]]
- `PlanChangeProposalDialog.tsx` (nuovo) sostituisce il `window.prompt` in `AdminVoyageBookings.tsx`: un `prompt` non può ospitare un select. Raccoglie motivazione + messaggio e **mostra la conseguenza sul rimborso prima di inviare**.
- `VoyageCandidatesPanel.tsx` ha un `<select>` inline con la stessa avvertenza, accanto alla nota di proposta.

## Cosa manca
- [ ] **Migrazione non applicata.** `supabase/migrations/20260721120000_plan_change_reason.sql` è scritta ma non eseguita. Finché non gira, la UI passa `_change_reason` a una funzione che non lo accetta e **le proposte falliscono**: va deployata insieme al codice.
- [ ] **Override senza UI.** La capacità è cablata end-to-end e testata, ma non c'è nessun controllo per usarla. Nota di flusso emersa in implementazione: il rifiuto lo fa **il viaggiatore** da `UserBookings.tsx`, quindi non c'è un admin presente in quel momento — l'override ha senso solo come azione **successiva**, es. "integra rimborso" in `AdminBookingRefunds.tsx` (`/admin/bookings/rimborsi`).
- [ ] **Validazione legale.** L'inquadramento non commerciale è delicato: ricorrenza, margine o promozione dei viaggi possono farlo riqualificare come attività commerciale o come trasporto/pacchetto, con obblighi ben diversi. Serve un avvocato marittimo/turistico.
- [ ] **Punto da segnalare al legale:** "le modifiche per forza maggiore non danno diritto a rimborsi ulteriori" tutela il progetto, ma se un cambio di **date** rende impossibile partecipare è di fatto una rinuncia indotta; con un consumatore la ragionevolezza può essere valutata diversamente.
- [ ] **Dialog admin non provato interattivamente.** `/admin/bookings` richiede login. Verificati typecheck, 117 test e transform Vite, non il click reale.
- [ ] **T&C mancanti per altre superfici:** crew/equipaggio e booking con clausole specifiche non sono ancora scritti (questa bozza copre solo il sito principale: registrazione + viaggi).
- [ ] **Nessun consenso versionato.** I Termini non sono accettati esplicitamente né tracciati per versione: non c'è modo di provare quale versione un utente abbia accettato. Da valutare insieme al flusso candidatura di [[13 - Booking Voyage]].

## Collegamenti
- [[13 - Booking Voyage]] · [[11 - Pagamenti Bunq]] · [[16 - Admin]] · [[05 - Frontend - Pagine]] · [[10 - API Vercel]]
