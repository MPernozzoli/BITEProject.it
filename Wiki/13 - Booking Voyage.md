---
tags: [booking, voyage, prenotazioni, funzionalita]
---
# 13 - Booking Voyage

⬅️ [[Home]] · sorgente: `src/components/booking/`, `src/lib/booking-*.ts`, `api/bookings/`

## Concetto
Gli utenti possono **partecipare a un viaggio** (voyage) prenotando una o più **tratte** (legs). Non è una vendita: è una partecipazione con **contributo alle spese** → [[11 - Pagamenti Bunq]].

## Flusso utente
1. Login/registrazione (`/login`, `/signup`) → `UserLogin.tsx`.
2. Completamento profilo obbligatorio (`/complete-profile`) → `CompleteProfile.tsx`, logica in `src/lib/profile-completeness.ts`.
3. Selezione viaggio/tratte su `VoyagePage.tsx` → componenti `src/components/booking/`.
   - Nella mappa del logbook (`Journal.tsx`), il click su **Partecipa** mantiene aperta la `VoyageLegend` in basso e sposta la scelta di tutte le tratte nella sidebar/bottom sheet articoli tramite `voyage/BookingSidebarPanel.tsx`.
4. Conferma condizioni + calcolo contributo (`src/lib/booking-deposit.ts`).
5. Creazione richiesta via RPC `request_voyage_booking` → [[08 - Supabase]].
6. Pagamento Bunq o bonifico → [[11 - Pagamenti Bunq]].
7. Gestione partecipanti su `/bookings/:id/participants` → `ManageBookingParticipants.tsx` + `api/bookings/invite.ts`.
8. Riepilogo prenotazioni su `/bookings` → `UserBookings.tsx`.

## Regole di dominio
- **No doppia prenotazione** della stessa tratta (migrazione `prevent_duplicate_leg_booking`).
- **Scadenza pending pagamento:** una prenotazione senza pagamento pendente non scade mentre aspetta l'approvazione admin; quando viene creato un deposito Bunq/bonifico `pending`, la deadline è 48 ore ed è gestita da `expire_pending_voyage_booking_payments()` → [[11 - Pagamenti Bunq]].
- **Max ospiti** per prenotazione (`backfill_voyage_booking_max_guests`).
- **Tratte prenotabili** con motivi di pericolo (`voyage_bookable_legs_danger_reasons`) → `src/lib/danger-reasons.ts`.
- **Contributi dinamici** per NM (`dynamic_voyage_contributions`).

## Lib coinvolte → [[07 - Frontend - Lib e Hooks]]
`booking-deposit.ts`, `booking-payment.ts`, `booking-participants.ts`, `booking-utils.ts`, `voyage-utils.ts`, `danger-reasons.ts`.

## Lato admin → [[16 - Admin]]
- `AdminVoyageBookings.tsx` (`/admin/bookings`) — gestione prenotazioni
- `AdminVoyageManager.tsx` — configurazione viaggi/tratte
- Notifiche: `dispatch-voyage-booking-notifications` → [[12 - Newsletter ed Email]]

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[10 - API Vercel]] · [[14 - Mappe e Layer Geospaziale]]
