---
tags: [voyage, tracking, real-time, schedule, funzionalita]
---
# 21 - Tracking Real-Time Viaggi

⬅️ [[Home]] · sorgente: `apps/web/src/lib/voyage-schedule.ts`, `apps/web/src/components/voyage/VoyageLiveWidget.tsx`, migrazioni `20260715111314`, `20260715130000`, `20260715140000`

## Concetto
Ogni tappa ha date **previste** e, man mano che il viaggio procede, date **effettive** di arrivo e ripartenza inserite dall'admin. Le date effettive diventano la base di calcolo di tutto ciò che viene dopo: la catena a valle si ricalcola, gli stati di viaggio e tratta si derivano da sole, e le prenotazioni seguono.

Il tempo fra arrivo effettivo a un waypoint e ripartenza effettiva **è** la sosta effettiva: per questo gli actual stanno sul waypoint, non sulla tratta.

## I due schedule
`voyage_bookable_legs` porta due orari, non uno:

| Colonne | Significato | Chi le scrive |
|---|---|---|
| `baseline_*_window_*` | il piano come approvato l'ultima volta dall'admin | solo `sync_voyage_bookable_legs` (replan vero) |
| `starts_at_window_*`, `ends_at_window_*` | lo schedule **effettivo**, con gli actual dentro | `apply_voyage_schedule` a ogni actual |

Tutti i consumer esistenti (deposit resolver, refunds, matrice booking, Gantt, UI pubblica) leggevano già le colonne effettive, quindi prendono le date reali senza modifiche.

Il baseline serve a due cose che senza di lui non si possono calcolare: il pavimento per assorbire gli anticipi, e il metro per decidere se un ritardo va notificato.

## Regola di scheduling: il piano è un pavimento, non un offset
- **Il ritardo propaga.** Arrivo tardi → riparto tardi → tutta la catena scala.
- **L'anticipo viene assorbito** alla prima sosta: `partenza = max(arrivo + regola_sosta, partenza_prevista)`. Si allunga la sosta, le tappe successive non si muovono.
- **Partire in anticipo si può, ma solo a mano**: un actual è un pin e batte il pavimento.

Esempio (A→B→C, partenza prevista da A il 10/09, ripartenza da B il 13/09, arrivo a C il 15/09):

| Partenza effettiva da A | Arrivo a B | Ripartenza da B | Arrivo a C |
|---|---|---|---|
| 09/09 (anticipo) | 11/09 | **13/09** (assorbito) | 15/09 |
| 11/09 (ritardo) | 13/09 | 14/09 | **16/09** |

## Silenzioso vs notifica
La finestra prevista (`start_date_flex_days`) è la soglia:
- effettivo **dentro** `[baseline_starts_at_window_start, baseline_starts_at_window_end]` → le date si aggiornano in silenzio, l'utente che apre vede la data esatta e basta;
- effettivo **oltre** la finestra → parte un `voyage_booking_plan_changes` con `change_kind = 'schedule_delayed'`, e i trigger di `20260712125731` spediscono le email a viaggiatore e admin.

Con `flex_days = 0` la finestra è un punto: qualsiasi ritardo notifica.

La notifica scatta **una sola volta** per ritardo: `apply_voyage_schedule` confronta lo stato precedente con quello nuovo e apre un plan change solo per le tratte appena sforate.

## Stati derivati
Non più manuali. La regola sta in un posto solo, mirrorata su due lati:
- SQL: `voyage_leg_phase()`, `voyage_derived_status()`, `voyage_leg_is_bookable_now()`
- TS: `apps/web/src/lib/voyage-schedule.ts` → [[07 - Frontend - Lib e Hooks]]

**Tratta:** `completed` se c'è un arrivo effettivo; `active` se c'è una partenza effettiva senza arrivo; altrimenti decide l'orologio sulle finestre effettive (giorno solare, Europe/Rome). Un actual batte sempre l'orologio.

**Viaggio:** vince `voyages.status_override` se valorizzato; altrimenti lo decidono le fasi delle tratte (tutte planned → planned, tutte completed → completed, misto → active); se il viaggio non ha tratte (tutti quelli storici) si torna alle sue date.

`voyages.status` resta come **cache**, aggiornata da `refresh_voyage_status()` e dal cron `refresh-voyage-statuses` (ogni 15 min). La UI però ricalcola dal vivo con la lib TS, così una fase che gira per orologio è giusta a schermo senza aspettare il cron.

## Effetto sulle prenotazioni
`voyage_leg_is_bookable_now()` sostituisce `booking_leg_is_current_or_future()`: prenotabile **solo** una tratta `planned`. È più stretto di prima, che lasciava prenotare una tratta nel giorno stesso della partenza, e ora rifiuta anche una tratta effettivamente partita. → [[13 - Booking Voyage]]

## Widget
`VoyageLiveWidget.tsx` → [[06 - Frontend - Componenti]]. Nessuna pagina dedicata:
- **admin** in `AdminDashboard.tsx`, con i tasti "Parti ora"/"Arriva ora" e il chevron che apre data/ora manuale per quando ci si è dimenticati di segnare sul momento;
- **read-only** in `UserBookings.tsx`, limitato ai viaggi su cui l'utente ha una prenotazione (prop `voyageIds`).

Compare da **7 giorni prima** della partenza prevista e resta finché il viaggio non è concluso. Mostra **solo la prima tratta da chiudere**: la successiva appare solo dopo che partenza e arrivo effettivi sono stati registrati.

Il tasto chiede sempre il dato mancante, deciso da `getPendingActual()` sull'actual e non sulla fase: se la data prevista passa senza che nessuno abbia premuto "parti ora", la tratta è `active` per orologio ma il widget continua a chiedere la **partenza**, non l'arrivo.

Le date mostrate sono la **finestra intera**, con `formatBookingWindow` di `booking-utils.ts` — la stessa funzione e lo stesso formato della matrice booking: `10–13 set h 07:30`. Non si sceglie un bordo solo: mostrare solo l'early nasconderebbe la flessibilità, e accostare la partenza più presto all'arrivo più tardi farebbe sembrare Bari → Santa Maria di Leuca (21 ore) una traversata di quattro giorni.

Quando arriva un actual la finestra collassa (`start == end`) e `formatBookingWindow` **degrada da sola a data singola** (`11 set h 07:30`), senza logica extra nel widget; l'etichetta passa da "Partenza prevista" a "Partito il". La fase invece usa `ends_at_window_end`, il bordo tardo: una tratta non è conclusa finché non è passato l'arrivo più tardi possibile.

Nota: `formatBookingWindow` formatta nel fuso del browser, non forzando Europe/Rome. È il comportamento della matrice e il widget lo eredita per coerenza, ma per un equipaggio che naviga all'estero le due viste mostrerebbero l'ora locale del dispositivo.

## Funzioni SQL → [[08 - Supabase]]
| Funzione | Ruolo |
|---|---|
| `compute_voyage_schedule(_voyage_id, _use_actuals)` | motore: percorre la catena dei waypoint pubblici. `false` = baseline, `true` = effettivo col pavimento |
| `apply_voyage_schedule(_voyage_id, _notify)` | ricalcola l'effettivo dagli actual, baseline intatto, apre i plan change per i ritardi nuovi |
| `set_voyage_waypoint_actual(_waypoint_id, _kind, _at)` | RPC dietro i tasti del widget; `_at = null` cancella |
| `sync_voyage_bookable_legs(_voyage_id)` | replan admin: ricostruisce il piano, lo congela come baseline, poi rideriva l'effettivo |
| `sync_voyage_bookable_legs_plan(_voyage_id)` | interna: il vecchio corpo del sync, rinominato intatto. Non conosce gli actual, quindi il suo output **è** il baseline |
| `voyage_leg_phase`, `voyage_derived_status`, `voyage_leg_is_bookable_now` | le regole di fase |
| `refresh_voyage_status`, `refresh_all_voyage_statuses` | cache di `voyages.status` |

## Note e debiti
- `voyage_waypoints.date_start`/`date_end` sono `text` e hanno nomi ingannevoli: `date_start` è la **ripartenza**, `date_end` è l'**arrivo**. Le colonne actual sono `timestamptz` con nomi espliciti.
- `route_legs` (con `status`/`started_at`/`completed_at`) è un abbozzo precedente di questa stessa idea, ma **non è orfana**: la legge e ci scrive la edge function `sync-bite-data` di [[19 - Sub-App (pack e data)]], e `useRouteLegs` in `apps/data/src/hooks/use-voyages.ts` la espone (senza chiamanti). Non va droppata senza prima sciogliere quel nodo. Il componente admin che la gestiva (`AdminRouteManager.tsx`) non era montato da nessuna rotta ed è stato rimosso.
- `voyage-schedule.ts` e le funzioni SQL implementano la stessa regola: vanno cambiate insieme. `src/test/voyage-schedule.test.ts` la fissa.

## Collegamenti
- [[13 - Booking Voyage]] · [[16 - Admin]] · [[08 - Supabase]] · [[06 - Frontend - Componenti]] · [[07 - Frontend - Lib e Hooks]] · [[14 - Mappe e Layer Geospaziale]]
