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
3. Selezione viaggio/tratte su `VoyagePage.tsx`/`Journal.tsx` → componenti `apps/web/src/components/booking/`.
   - Nella mappa del logbook (`Journal.tsx`), il click su **Partecipa** mantiene aperta la `VoyageLegend` in basso e mostra tutte le tratte nella sidebar/bottom sheet articoli tramite `voyage/BookingSidebarPanel.tsx`; le tratte non vengono preselezionate, l'utente sceglie quelle desiderate. Quando una tratta viene selezionata, viene evidenziata sia su `VoyageMap` sia sulla legenda; i badge di complessità restano nel pannello booking/popup e non nella legenda.
4. Riepilogo tratte scelte + totale del contributo alle spese vive, con copy esplicito non commerciale: non è biglietto, charter o servizio.
5. Passaggio **Dicci di te** (`CandidateInfoForm.tsx`): esperienza nautica con slider lineare, tipo navigazione, eta, lingue con livello, lavoro remoto, professione (campo testo facoltativo `workRole`, "Che lavoro fai?"), regimi alimentari/allergie, motivazione e note. Le risposte sono salvate in `candidate_info` JSONB; eta, lingue/livelli, lavoro, professione e altri campi riusabili vengono precompilati dalla candidatura piu recente e dalle lingue del profilo, mentre motivazione e note restano da riscrivere per ogni viaggio.
6. Conferma condizioni + calcolo contributo (`apps/web/src/lib/booking-deposit.ts`).
7. Creazione richiesta via RPC `request_voyage_booking`, con `candidate_info` salvato sulla richiesta → [[08 - Supabase]].
8. Pagamento Bunq o bonifico → [[11 - Pagamenti Bunq]].
9. Gestione partecipanti su `/bookings/:id/participants` → `ManageBookingParticipants.tsx` + `apps/web/api/bookings/invite.ts`.
10. Riepilogo prenotazioni su `/bookings` → `UserBookings.tsx`.

## Regole di dominio
- **No doppia prenotazione** della stessa tratta (migrazione `prevent_duplicate_leg_booking`).
- **Minimo fisso contributo:** i €20 sono una tantum per utente/viaggio. Una seconda prenotazione dello stesso utente su altre tratte dello stesso voyage non riapplica il fisso, ma mantiene la parte variabile per NM e complessità → [[11 - Pagamenti Bunq]].
- **Scadenza pending pagamento:** una prenotazione senza pagamento pendente non scade mentre aspetta l'approvazione admin; quando viene creato un deposito Bunq/bonifico `pending`, la deadline è 48 ore ed è gestita da `expire_pending_voyage_booking_payments()` → [[11 - Pagamenti Bunq]].
- **Max ospiti** per prenotazione (`backfill_voyage_booking_max_guests`).
- **Tratte prenotabili** con motivi di pericolo (`voyage_bookable_legs_danger_reasons`) → `apps/web/src/lib/danger-reasons.ts`.
- **Solo tratte future:** prenotabile solo una tratta in stato `planned` (`voyage_leg_is_bookable_now()`, che sostituisce `booking_leg_is_current_or_future()`). Una tratta in corso o già partita non è più prenotabile → [[21 - Tracking Real-Time Viaggi]].
- **Notifiche admin solo a chi ha un profilo:** `enqueue_admin_voyage_booking_notifications` fa join su `profiles`. Senza quel join un ruolo admin orfano in `user_roles` (utente cancellato) viola la foreign key di `voyage_booking_notifications.recipient_profile_id` e **fa abortire la transazione chiamante**: dieci funzioni la usano, incluse `request_voyage_booking`, `confirm_voyage_booking` e `cancel_voyage_booking`, quindi l'effetto è il blocco totale delle prenotazioni.
- **Contributi dinamici** per NM (`dynamic_voyage_contributions`).
- **Ricalcolo planning:** `sync_voyage_bookable_legs` riconcilia le tratte canoniche invece di disattivare soltanto quelle obsolete. Se vengono aggiunti/rimossi waypoint intermedi aggiorna i legami `voyage_booking_request_legs` sulle nuove sottotratte/tratte unite e cancella le legs non piu presenti nel planning. Se cambia un endpoint reale della prenotazione, crea un record `voyage_booking_plan_changes` in attesa di approvazione utente con la proposta di nuovo imbarco/sbarco; le prenotazioni equipaggio (`is_crew`) sono auto-accettate.
- **Cambio piano booking:** `voyage_booking_plan_changes` accoda automaticamente email `plan_change_pending` quando il cambio richiede approvazione utente. La mail propone nuova tratta, annullamento con rimborso completo o variazione manuale; i record auto-accettati per equipaggio restano `email_status = skipped`.
- **Email e push booking:** la pipeline `voyage_booking_notifications` → `dispatch-voyage-booking-notifications` → `send-transactional-email` invia conferma richiesta, waitlist, approvazione, conferma utente, cancellazione, rifiuto, promozione waitlist, aggiunta manuale, pagamenti pending/ricevuti/scaduti, cambio planning, briefing viaggio e notifiche admin. Gli eventi admin (`admin_*`) inviano anche Web Push agli admin con `push_subscriptions` attive; la coda registra `push_sent_at` per evitare duplicati.
- **Briefing viaggio:** `voyage_booking_settings` ha campi bilingue separati per `first_briefing_content_*` e `second_briefing_content_*`. Il trigger `enqueue_first_voyage_briefing_for_booking` accoda `first_briefing` quando una richiesta passa a `user_confirmed`; `enqueue_first_voyage_briefing_for_participant` fa lo stesso per un invitato che accetta. Il dispatcher usa il template `voyage-briefing`; `second_briefing` e supportato dalla pipeline ma non ha ancora trigger automatico.
- **Inviti partecipanti:** `/api/bookings/invite` usa il template `voyage-participant-invite` per gli ospiti pending; se il pagamento e separato include il contributo stimato per persona. La lingua della mail segue la route corrente al momento dell'invio (`/it` o `/en`). Il link porta alla sezione booking nella stessa lingua: l'ospite deve accedere/iscriversi con la stessa email, poi compila `candidate_info`, accetta condizioni e prosegue con pagamento o conferma.
- **Lingue candidato:** le lingue del profilo (`preferred_language`, `secondary_language`) precompilano il form per italiano, inglese, francese, spagnolo, tedesco, portoghese e altre lingue diffuse se riconosciute. Nel form ogni lingua è un chip ciclico: premendolo piu volte passa da principiante a me la cavo, esperto e madrelingua; il livello viene salvato in `candidate_info.languageLevels`. Il campo **Aggiungi altra lingua** ha autocomplete per lingue come russo, turco, cinese, arabo, olandese, scandinave, polacco, ucraino, rumeno, greco, giapponese e coreano; se la lingua è riconosciuta diventa un chip, altrimenti resta in `candidate_info.otherLanguages`.
- **Revisione candidati:** `/admin/candidates` mostra le candidature fuori dalla Gantt operativa, con profilo pubblico completo (foto, bio, lingue profilo, link social), risposte `candidate_info`, tratte richieste e azioni approva/scarta/proponi tratte alternative. Sotto le informazioni candidato c'è una Gantt di revisione che mostra dove il candidato entrerebbe e con chi; i click sulla riga del candidato compongono una proposta, non modificano direttamente la prenotazione. Le proposte usano `admin_propose_voyage_booking_legs`, creano `voyage_booking_plan_changes` e mettono la richiesta in `plan_change_status = pending_user_approval`. Approvazione, rifiuto e proposta possono includere un messaggio admin destinato all'utente.
- **Modifiche tratte da Gantt booking:** il drag/resize in `/admin/bookings` non aggiorna più direttamente `voyage_booking_request_legs` per i viaggiatori: crea una proposta tramite `admin_propose_voyage_booking_legs`, manda email/push `plan_change_pending` e lascia all'utente le azioni **accetta**, **controproponi**, **rifiuta** o **annulla con rimborso completo**. Solo l'azione utente `accept_proposed_change`, gestita server-side da `respond_voyage_booking_plan_change`, applica davvero le tratte proposte.
- **Modifiche tratte lato utente:** ogni cambio non-admin passa da uno stato pending/approvazione (`voyage_booking_plan_changes` o metadata equivalenti); la Gantt di `/admin/bookings` resta uno strumento operativo admin, ma genera proposte invece di modifiche arbitrarie definitive sui viaggiatori.
- **Rimborsi su annullamento/rifiuto:** le azioni terminali che possono dover restituire contributi pagati passano da `POST /api/bookings/status`, non direttamente dalle RPC client. Il server applica la policy di [[11 - Pagamenti Bunq]]: admin cancellazione/rifiuto 100%, utente 100% oltre 30 giorni dalla partenza, 50% tra 30 e 15 giorni, 0% sotto 15 giorni, e 100% se l'utente rifiuta una proposta di modifica admin annullando il viaggio.

## Privacy e policy legali → [[05 - Frontend - Pagine]]
Le pagine `PrivacyPolicy.tsx` e `CookiePolicy.tsx` sono aggiornate al 12 luglio 2026 per coprire il flusso booking:
- dati richiesta partecipazione: viaggio, tratte, party size, messaggio/note, informazioni candidato (`candidate_info`), stati, task pre-partenza e cambi piano;
- dati invitati: nome, cognome, email, stato invito e profilo collegato dopo accettazione;
- dati contributo spese: importo stimato, metodo, riferimento pagamento, stato deposito, scadenza, Bunq/bunq.me o dettagli bonifico;
- notifiche transazionali, Web Push admin e strumenti tecnici di sessione/local storage necessari a booking e pagamenti.

## Lib coinvolte → [[07 - Frontend - Lib e Hooks]]
`booking-deposit.ts`, `booking-payment.ts`, `booking-refunds.ts`, `booking-participants.ts`, `booking-utils.ts`, `voyage-utils.ts`, `danger-reasons.ts`.

## Lato admin → [[16 - Admin]]
- `AdminVoyageBookings.tsx` (`/admin/bookings`) — gestione prenotazioni; il drag Gantt genera proposte pending per l'utente
- Sezione settings `/admin/bookings`: gestisce due mail briefing bilingue. La prima parte alla conferma e contiene spostamenti flessibili, bagaglio e dotazioni gia a bordo; la seconda e operativa/pre-partenza e mostra anche le prese tipo L/F, USB-A/USB-C, Starlink, frigo, lavaggio e suggerimenti rotta.
- `AdminVoyageCandidates.tsx` (`/admin/candidates`) — revisione candidature, profilo pubblico, Gantt di contesto e proposte tratte alternative con messaggio admin
- Nel Gantt booking l'admin può aggiungere persone registrate oppure scegliere **Altri...** e inserire una email: la RPC `admin_create_voyage_booking_invite_by_email` crea una prenotazione/partecipazione pending e l'endpoint `/api/bookings/invite` spedisce l'invito. La matrice mostra nella colonna persona solo il nome cliccabile; il dettaglio profilo si apre in modale con azione per scrivere una mail via `/admin/mail`, mentre lo stato viene scritto per esteso direttamente sulle barre delle tratte.
- `AdminVoyageManager.tsx` — configurazione viaggi/tratte
- Notifiche: `dispatch-voyage-booking-notifications` invia email e push admin → [[12 - Newsletter ed Email]]
- Ricalcolo tratte: `sync_voyage_bookable_legs` aggiorna anche le prenotazioni esistenti e genera audit trail `voyage_booking_plan_changes`. Congela anche il baseline e rideriva lo schedule effettivo → [[21 - Tracking Real-Time Viaggi]].
- Widget viaggio in corso in dashboard admin (`VoyageLiveWidget.tsx`), con versione read-only su `/bookings` → [[21 - Tracking Real-Time Viaggi]].

## Collegamenti
- [[11 - Pagamenti Bunq]] · [[10 - API Vercel]] · [[14 - Mappe e Layer Geospaziale]] · [[12 - Newsletter ed Email]] · [[21 - Tracking Real-Time Viaggi]]
