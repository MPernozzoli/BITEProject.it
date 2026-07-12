---
tags: [booking, voyage, prenotazioni, funzionalita]
---
# 13 - Booking Voyage

⬅️ [[Home]] · sorgente: `apps/web/src/components/booking/`, `apps/web/src/lib/booking-*.ts`, `apps/web/api/bookings/`

## Concetto
Gli utenti possono **partecipare a un viaggio** (voyage) prenotando una o più **tratte** (legs). Non è una vendita: è una partecipazione con **contributo alle spese** → [[11 - Pagamenti Bunq]].

## Flusso utente
1. Login/registrazione (`/login`, `/signup`) → `UserLogin.tsx`.
2. Completamento profilo obbligatorio (`/complete-profile`) → `CompleteProfile.tsx`, logica in `apps/web/src/lib/profile-completeness.ts`.
3. Selezione viaggio/tratte su `VoyagePage.tsx` → componenti `apps/web/src/components/booking/`.
   - Nella mappa del logbook (`Journal.tsx`), il click su **Partecipa** mantiene aperta la `VoyageLegend` in basso e mostra tutte le tratte nella sidebar/bottom sheet articoli tramite `voyage/BookingSidebarPanel.tsx`; le tratte non vengono preselezionate, l'utente sceglie quelle desiderate. Quando una tratta viene selezionata, viene evidenziata sia su `VoyageMap` sia sulla legenda; i badge di complessità restano nel pannello booking/popup e non nella legenda.
4. Conferma condizioni + calcolo contributo (`apps/web/src/lib/booking-deposit.ts`).
5. Creazione richiesta via RPC `request_voyage_booking` → [[08 - Supabase]].
6. Pagamento Bunq o bonifico → [[11 - Pagamenti Bunq]].
7. Gestione partecipanti su `/bookings/:id/participants` → `ManageBookingParticipants.tsx` + `apps/web/api/bookings/invite.ts`.
8. Riepilogo prenotazioni su `/bookings` → `UserBookings.tsx`.

## Regole di dominio
- **No doppia prenotazione** della stessa tratta (migrazione `prevent_duplicate_leg_booking`).
- **Scadenza pending pagamento:** una prenotazione senza pagamento pendente non scade mentre aspetta l'approvazione admin; quando viene creato un deposito Bunq/bonifico `pending`, la deadline è 48 ore ed è gestita da `expire_pending_voyage_booking_payments()` → [[11 - Pagamenti Bunq]].
- **Max ospiti** per prenotazione (`backfill_voyage_booking_max_guests`).
- **Tratte prenotabili** con motivi di pericolo (`voyage_bookable_legs_danger_reasons`) → `apps/web/src/lib/danger-reasons.ts`.
- **Contributi dinamici** per NM (`dynamic_voyage_contributions`).
- **Ricalcolo planning:** `sync_voyage_bookable_legs` riconcilia le tratte canoniche invece di disattivare soltanto quelle obsolete. Se vengono aggiunti/rimossi waypoint intermedi aggiorna i legami `voyage_booking_request_legs` sulle nuove sottotratte/tratte unite e cancella le legs non piu presenti nel planning. Se cambia un endpoint reale della prenotazione, crea un record `voyage_booking_plan_changes` in attesa di approvazione utente con la proposta di nuovo imbarco/sbarco; le prenotazioni equipaggio (`is_crew`) sono auto-accettate.
- **Cambio piano booking:** `voyage_booking_plan_changes` accoda automaticamente email `plan_change_pending` quando il cambio richiede approvazione utente. La mail propone nuova tratta, annullamento con rimborso completo o variazione manuale; i record auto-accettati per equipaggio restano `email_status = skipped`.
- **Email e push booking:** la pipeline `voyage_booking_notifications` → `dispatch-voyage-booking-notifications` → `send-transactional-email` invia conferma richiesta, waitlist, approvazione, conferma utente, cancellazione, rifiuto, promozione waitlist, aggiunta manuale, pagamenti pending/ricevuti/scaduti, cambio planning e notifiche admin. Gli eventi admin (`admin_*`) inviano anche Web Push agli admin con `push_subscriptions` attive; la coda registra `push_sent_at` per evitare duplicati.
- **Inviti partecipanti:** `/api/bookings/invite` usa il template `voyage-participant-invite` per gli ospiti pending; se il pagamento e separato include il contributo stimato per persona.

## Privacy e policy legali → [[05 - Frontend - Pagine]]
Le pagine `PrivacyPolicy.tsx` e `CookiePolicy.tsx` sono aggiornate al 12 luglio 2026 per coprire il flusso booking:
- dati richiesta partecipazione: viaggio, tratte, party size, messaggio/note, stati, task pre-partenza e cambi piano;
- dati invitati: nome, cognome, email, stato invito e profilo collegato dopo accettazione;
- dati contributo spese: importo stimato, metodo, riferimento pagamento, stato deposito, scadenza, Bunq/bunq.me o dettagli bonifico;
- notifiche transazionali, Web Push admin e strumenti tecnici di sessione/local storage necessari a booking e pagamenti.

## Lib coinvolte → [[07 - Frontend - Lib e Hooks]]
`booking-deposit.ts`, `booking-payment.ts`, `booking-participants.ts`, `booking-utils.ts`, `voyage-utils.ts`, `danger-reasons.ts`.

## Lato admin → [[16 - Admin]]
- `AdminVoyageBookings.tsx` (`/admin/bookings`) — gestione prenotazioni
- `AdminVoyageManager.tsx` — configurazione viaggi/tratte
- Notifiche: `dispatch-voyage-booking-notifications` invia email e push admin → [[12 - Newsletter ed Email]]
- Ricalcolo tratte: `sync_voyage_bookable_legs` aggiorna anche le prenotazioni esistenti e genera audit trail `voyage_booking_plan_changes`.

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[10 - API Vercel]] · [[14 - Mappe e Layer Geospaziale]] · [[12 - Newsletter ed Email]]
