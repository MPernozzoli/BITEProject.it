# Import tracciato reale + biglietto commemorativo — previsione di sviluppo

Data: 2026-08-17 · Sorgenti lette: `apps/web/supabase/migrations/{20260715111314_voyage_realtime_schedule,20260715130000_voyage_schedule_phases_and_actuals,20260712125731,20260710130000_booking_participants,20260810092000_contribution_proposal_gate_and_storage}.sql`, `apps/web/src/lib/voyage-schedule.ts`, `apps/web/src/lib/logbook-photo-points.ts`, `apps/web/src/components/voyage/VoyageLiveWidget.tsx`, `apps/web/src/components/admin/Voyage*Panel.tsx`, `apps/web/src/integrations/supabase/types.ts`, `apps/web/supabase/functions/_shared/transactional-email-templates/*`, `apps/web/api/bookings/invite.ts`, `vercel.json`, `AGENTS.md`, `Wiki/13`, `Wiki/21`, `Wiki/22`.

> **Stato.** A e B non sono implementate: il documento fissa il design concordato prima di scrivere codice, e le trappole già identificate leggendo lo schema esistente.
> **C è fatta e applicata in produzione** il 2026-08-17 — migrazione `20260817150000_no_delay_notifications_for_completed_legs.sql`. Vedi §3.

---

## 0. Sintesi in una pagina

Tre interventi. Il primo produce dati, il secondo li consuma, il terzo è indipendente ed è già fatto.

**A · Import dei tracciati reali.** L'admin carica gli export del plotter (GPX). Il sistema pulisce la traccia, **propone** soste e confini di tratta, l'admin conferma o corregge in una UI dedicata. Ne escono orari, miglia e geometria reali — **in tabelle dedicate, completamente separate dalla programmazione**.

**B · Biglietto commemorativo.** A viaggio concluso e traccia importata, ogni partecipante riceve un biglietto personale con le sue tratte, le sue miglia e la rotta disegnata — pianificato ed effettivo sovrapposti.

**C · Regola di notifica sulle tratte concluse** — ✅ **fatta**. Una tratta già conclusa o un viaggio terminato non genera più notifiche di variazione ai partecipanti. Prima le generava. Vedi §3.

Quattro decisioni che reggono tutto il resto:

1. **Il tracciato non tocca la programmazione. Mai.** Non scrive `voyage_waypoints.actual_*`, non chiama `apply_voyage_schedule`, non muove finestre, non apre plan change, non spedisce email. Vive in tabelle sue. Lo schedule engine descritto in [[Wiki/21 - Tracking Real-Time Viaggi]] resta l'unica autorità sulla programmazione e continua a funzionare esattamente come oggi. Vedi §1.2.
2. **Più tracciati per viaggio, anche a viaggio in corso.** Un viaggio ha N tracciati, caricabili mano a mano — ma **solo per tratte già concluse**. Vedi §1.3.
3. **L'algoritmo propone, l'umano decide.** Il rilevamento delle soste non scrive mai direttamente: produce una proposta che l'admin conferma in UI. Questo declassa ogni euristica imperfetta da "bug che spedisce numeri sbagliati a un ospite" a "suggerimento da aggiustare in dieci secondi".
4. **Il biglietto è un ricordo, non una fattura.** I miglia effettivi saranno quasi sempre **maggiori** dei pianificati (bordi, deviazioni, ripari), ma il contributo economico è calcolato su `booking_contribution_per_nm_eur` applicato ai **pianificati**. Il copy non deve mai lasciar intendere un conguaglio. Vedi §2.6.

---

# A · Import dei tracciati reali

## 1.1 Cosa risolve

Oggi la **rotta reale non esiste da nessuna parte** — `voyages.cached_geometry` contiene il pianificato — e i **miglia reali nemmeno**: c'è solo `voyage_bookable_legs.planned_nautical_miles`. Gli unici dati effettivi sono gli orari inseriti a mano dai tasti "Parti ora"/"Arriva ora" del `VoyageLiveWidget`, che restano quello che sono: la registrazione operativa del viaggio.

L'import aggiunge lo strato documentale — dove sei passato davvero, quanto hai davvero navigato — senza toccare quello operativo.

## 1.2 ⚠️ Separazione netta dalla programmazione

**Questa è la regola non negoziabile della feature.**

Il tracciato è un **record documentale**, la programmazione è un **sistema operativo**: guida `is_bookable`, gli stati derivati, il widget live, la disponibilità in prenotazione e le email di ritardo. Mescolarli significa che un import fatto per ricostruire la storia può, come effetto collaterale, cambiare cosa è prenotabile e spedire posta agli ospiti.

Concretamente, l'import **non deve**:

- scrivere su `voyage_waypoints.actual_arrival_at` / `actual_departure_at`;
- scrivere su `voyage_bookable_legs.actual_*` (che sono comunque derivati, non sorgente);
- chiamare `set_voyage_waypoint_actual()` o `apply_voyage_schedule()`.

Perché quella strada è velenosa, in concreto:

```sql
-- set_voyage_waypoint_actual(), migrazione 20260715130000, riga ~418
perform public.apply_voyage_schedule(v_waypoint.voyage_id, true);
--                                                          ^^^^ notify HARDCODED
```

`_notify = true` fa aprire un `voyage_booking_plan_changes` per ogni scostamento nuovo oltre la finestra baseline, e i trigger di `20260712125731` spediscono le email a viaggiatore e admin. Un import che passasse di lì spedirebbe **notifiche di ritardo retroattive** per tratte concluse da settimane. (La regola C di §3 chiude comunque questo buco alla radice, ma la separazione resta il presidio primario.)

**Conseguenza accettata: le due nozioni possono divergere.** L'orario che l'admin ha premuto sul widget e quello che dice il GPS non coincideranno mai al minuto. Va bene: servono a cose diverse. Ma la UI di riconciliazione (§1.6) **deve mostrare il diff**, e offrire un'azione separata ed esplicita — *"correggi anche l'orario di programmazione"* — che passa per la RPC ufficiale. Azione manuale, mai automatica, mai implicita nell'import.

## 1.3 Più tracciati per viaggio, anche in corso

Un viaggio ha **N tracciati**. Non c'è motivo di imporne uno: il plotter si esporta a fine tappa, o a fine settimana, o si scarica in due pezzi perché si è riavviato.

L'import è quindi **incrementale e permesso a viaggio in corso**, con un solo vincolo:

> **Si importa solo per tratte già concluse** — tratte con fase `completed`, cioè con arrivo effettivo registrato (`voyage_leg_phase` → [[Wiki/21 - Tracking Real-Time Viaggi]]).

Una tratta `active` o `planned` non accetta tracciato: sarebbe un dato parziale che poi va ri-importato, e il biglietto non deve mai leggere mezze tratte. La validazione va nel backend, non solo nella UI.

Ne segue che ogni tracciato ha uno **scope**: l'insieme di tratte che copre. Determinato dal rilevamento e confermato dall'admin in riconciliazione. Due tracciati non possono coprire la stessa tratta — l'ultimo confermato sostituisce il precedente, che resta archiviato ma non applicato.

E ne segue che l'emissione del biglietto (§2.3) si sblocca quando **tutte le tratte del partecipante** hanno copertura, non quando "il viaggio ha un tracciato".

## 1.4 Schema

Tutto nuovo, niente colonne aggiunte alle tabelle di programmazione.

| Tabella | Contenuto |
|---|---|
| `voyage_tracks` | un upload: `voyage_id`, `storage_path` del file originale, `format`, `sha256`, `imported_at`, `imported_by`, `notes`, `confirmed_at`, `superseded_by` |
| `voyage_track_points` | punti puliti: `track_id`, `ts`, `lat`, `lng`, `sog`, `cog`. Indice su `(track_id, ts)` |
| `voyage_track_legs` | **il risultato riconciliato, una riga per tratta coperta**: `leg_id`, `track_id`, `actual_departure_at`, `actual_arrival_at`, `actual_nm`, `moving_hours`, `max_sog`, `avg_sog`, `geometry jsonb` (semplificata per il rendering) |
| `voyage_track_stops` | soste rilevate e confermate: `track_id`, `waypoint_id` (nullable — le soste non previste non ne hanno ancora uno), `started_at`, `ended_at`, `lat`, `lng` |

`voyage_track_legs` è la tabella che legge il biglietto. È anche il posto giusto per la geometria reale del viaggio intero, ricomposta per unione — da decidere se materializzarla su `voyages` come colonna a parte (**mai** dentro `cached_geometry`, che è il pianificato) o calcolarla al volo. → decisione #4 in §5.

Il **file originale va tenuto intoccato** in storage: se fra un anno si migliora il filtro, si ri-deriva tutto senza ri-chiedere l'export a nessuno. Bucket privato, stesso pattern di `20260810092000_contribution_proposal_gate_and_storage.sql`.

## 1.5 Pipeline

```
upload GPX  →  parse  →  filtro  →  rilevamento soste e scope (PROPOSTA)
                                          ↓
                              UI di riconciliazione (admin conferma)
                                          ↓
                    voyage_track_legs + voyage_track_stops
                    (nessuna scrittura sulla programmazione)
```

**Formato.** GPX come primario: lo esportano tutti (Garmin, Raymarine, B&G, Furuno). CSV come fallback per gli export strani. **Niente parser NMEA** al primo giro.

**Filtro — è la parte che decide se i numeri sono credibili.** Tre regole, tutte necessarie:

- **Soglia di velocità (~0.5 kn).** Senza, lo *swing all'ancora* gonfia i miglia in modo assurdo: una barca ormeggiata che ruota sul suo raggio con la deriva GPS accumula miglia di nulla per tutta la notte. È il problema numero uno.
- **Salti impossibili.** Punti consecutivi a distanza incompatibile con l'intervallo temporale → scartati.
- **Gap.** Plotter spento in porto o riacceso a metà tratta: un buco temporale grande non va tracciato come una retta attraverso mezzo Adriatico, va marcato come interruzione.

**Fusi orari.** Gli export dei plotter sono quasi sempre UTC, ma non tutti. Se si sbaglia, l'attribuzione delle tratte è sfalsata di ore. Il parser deve dichiarare esplicitamente cosa ha assunto, e la UI mostrarlo.

**Rilevamento soste e scope.** Una sosta è un intervallo sotto soglia più lungo di N minuti. Ogni sosta viene proposta con durata, posizione media e waypoint pianificato più vicino; da lì si deriva quali tratte il tracciato copre. Doppia validazione: prossimità al waypoint **e** coerenza con gli actual di programmazione già registrati, con avviso quando le due non concordano.

## 1.6 UI di riconciliazione

È qui che va il peso del lavoro, e vale la pena farla bene perché si userà dopo ogni tratta. Sta accanto a `VoyageStopsPanel.tsx` e `VoyageLegsPanel.tsx`, che fanno il lavoro equivalente sul pianificato.

- mappa con traccia reale e rotta pianificata sovrapposte;
- timeline sotto, con le soste rilevate come blocchi;
- azioni: **conferma**, **aggiusta gli estremi**, **unisci** due soste, **dividi** una sosta, **lega a un waypoint** esistente, **promuovi a waypoint nuovo**;
- **diff esplicito contro gli actual di programmazione**, con l'azione separata di §1.2 per allinearli se lo si vuole;
- elenco dei tracciati già caricati sul viaggio, con lo scope di ciascuno.

**Le soste non previste.** La traccia mostrerà ripari cercati, cambi di programma, notti dove non si doveva essere. Possono restare solo in `voyage_track_stops` (documentali) oppure essere promosse a `voyage_waypoints` reali — `visibility_mode` esiste già per decidere cosa mostrare in pubblico. Attenzione: **promuovere una sosta a waypoint tocca la programmazione**, quindi è un'azione a parte con le sue conseguenze, non un effetto dell'import.

Per il biglietto sono materiale ottimo comunque: *"2 tappe non previste"* dice più di qualunque numero.

**Il re-import non calpesta le correzioni a mano.** Regola più semplice che regge: **il re-import propone sempre, non applica mai in automatico** — mostra il diff rispetto a quanto già confermato e l'admin sceglie. Il tracciato sostituito resta con `superseded_by` valorizzato.

## 1.7 Ricadute fuori perimetro

Due cose che l'import regala e che valgono da sole lo sviluppo:

- **La rotta reale sulle pagine viaggio**, oggi assente.
- **Geolocalizzazione automatica delle foto.** `logbook-photo-points.ts` ha `coordinates_source: "exif" | "manual"`. Con una traccia si aggiunge `"track"`: dal timestamp della foto si interpola la posizione sulla rotta reale. Per le foto da reflex — che GPS non ne hanno — è la differenza tra piazzarle a mano una per una e non fare nulla. → [[Wiki/17 - Content Model]]

---

# B · Biglietto commemorativo

## 2.1 Concetto

Una **carta d'imbarco al contrario**: emessa a viaggio concluso, riempita con i dati reali. Il punto di ancoraggio è `voyage_booking_participants`, **non** la prenotazione: ogni persona a bordo ha il suo biglietto, con il suo nome e le tratte che ha fatto davvero (`voyage_booking_request_legs`).

L'elemento centrale è il **confronto pianificato/effettivo**: la linea che avevi previsto contro la traccia vera piena di bordi e deviazioni. La differenza fra le due *è* il racconto del viaggio.

## 2.2 Modello dati

```
voyage_mementos
  id, participant_id (UNIQUE), booking_request_id, voyage_id, profile_id
  serial            -- "BITE-2026-0042", progressivo: è ciò che dà valore collezionistico
  public_token      -- pagina condivisibile
  payload jsonb     -- SNAPSHOT IMMUTABILE
  image_path, pdf_path
  issued_at, emailed_at, revoked_at
```

L'`UNIQUE` su `participant_id` dà l'idempotenza dell'emissione gratis.

**Il `payload` è la decisione architetturale importante.** All'emissione si congela tutto: nome viaggio nella lingua della persona, tappe, miglia pianificate ed effettive, date, geometrie, compagni di bordo. I dati riconciliati sono **editabili in admin**: una correzione fatta un anno dopo non deve riscrivere il ricordo di chi era a bordo.

Campo `has_actual_track`: se le tratte del partecipante non hanno copertura (plotter spento, export perso) il renderer sceglie il layout senza sezione confronto invece di rompersi.

## 2.3 Emissione

Cron giornaliero, stesso pattern di `dispatch-voyage-booking-notifications`.

**Gate:** viaggio `completed` **e tutte le tratte del partecipante coperte** da un tracciato confermato (§1.3). Non "il viaggio ha un tracciato": con l'import incrementale la copertura è per tratta, e due partecipanti sullo stesso viaggio possono maturare il biglietto in momenti diversi.

**Selezione:** partecipanti `accepted` su prenotazioni `confirmed`, esclusi cancelled/refunded, senza memento già emesso.

Da decidere (§5): emissione diretta oppure stato `draft` con approvazione admin. Al primo giro la seconda è più prudente.

## 2.4 Rendering

**Satori + resvg** (JSX → SVG → PNG), in una **Vercel Function Node** in `apps/web/api/mementos/render.ts`. Il biglietto si scrive come componente React, come già si fa per le email in `_shared/transactional-email-templates/`. Font embeddati, output deterministico, nessun browser.

Scartate: SVG a mano (si perde l'auto-layout del testo — nomi e tappe di lunghezza variabile diventano misurazione manuale); headless browser (Playwright c'è ma solo come devDependency, troppo pesante in produzione). Da verificare in spike se resvg gira accettabilmente sotto Deno; in caso contrario la Vercel Function Node resta la scelta.

Due formati: **1200×1600 verticale** (il biglietto) e **1200×630** (card OG).

La rotta si proietta in un `path` SVG con Mercator normalizzata sul bounding box del viaggio. **Pianificato tratteggiato e sottile, effettivo pieno**, sovrapposti — non due mappe affiancate: il valore sta nella sovrapposizione.

Numeri, pochi, con l'effettivo dominante:

```
    142 nm  percorsi          (pianificati 118)
   23h 40m  in navigazione
     7.4 kn velocità massima
```

Storage: bucket `mementos` privato, signed URL.

## 2.5 Distribuzione

- **Email**: nuovo template `voyage-memento.tsx` registrato in `_shared/transactional-email-templates/registry.ts`, fratello di `voyage-briefing.tsx`.
- **Pagina** `/memento/:token`: il catch-all SPA di `vercel.json` la copre già, **nessuna rewrite da aggiungere**. Meta OG via `api/prerender.ts` così la condivisione mostra il biglietto. Aggiungere `X-Robots-Tag: noindex` nel gruppo header già esistente.
- **PDF**: opzionale e successivo — è solo l'immagine incorporata in un A4.

**Bilinguismo obbligatorio** (`AGENTS.md`): email e pagina in IT ed EN dal primo giorno, lingua risolta dal profilo (`preferred_language`), non default silenzioso. Il nome del viaggio deve seguire la lingua dell'email — stesso problema già risolto in `api/bookings/invite.ts`. I nomi delle tappe hanno `name_it`/`name_en`.

## 2.6 Due avvertenze di contenuto

**I compagni di bordo.** Metterne i nomi è ciò che rende il biglietto davvero commemorativo, ma su una pagina pubblicamente condivisibile è pubblicazione di dati personali di terzi. Via d'uscita proposta: **versione pubblica** con solo dati del viaggio e nome del destinatario; **versione privata** (in `/bookings`, dietro auth) con l'equipaggio completo. Così non servono consensi da raccogliere.

**Effettivo vs pianificato e il contributo.** Vedi §0 punto 4. Copy del tipo *"miglia realmente percorse"* invece di un numero nudo accostato a una cifra economica.

---

# C · Niente notifiche sulle tratte concluse — ✅ FATTA

Applicata in produzione il 2026-08-17, migrazione `20260817150000_no_delay_notifications_for_completed_legs.sql`. Indipendente da A e B.

## 3.1 La regola

> Una variazione su una **tratta già conclusa**, o su un **viaggio terminato**, non genera alcuna notifica ai partecipanti. È una correzione a posteriori di informazioni non più rilevanti per chi c'era. Solo le tratte **ancora attive o future** notificano.

Esempio: la barca è già a Palermo e per qualunque motivo viene corretta la tratta Bari → Santa Maria di Leuca. Chi ha partecipato a quella tratta **non riceve nulla**: è finita, il dato corretto è documentale.

## 3.2 Come è stata implementata

`apply_voyage_schedule()` è stata riscritta a partire dalla versione corrente (`20260722150000`, verificata contro il DB live prima di toccarla). Due guardie prima del blocco di notifica, il resto identico:

**Guardia 1 — viaggio concluso.** `refresh_voyage_status()` era chiamata con `perform`; ora il suo risultato viene catturato e, se è `completed`, la funzione esce prima di annunciare qualsiasi cosa. Serve soprattutto per `status_override = 'completed'`: l'admin dichiara concluso un viaggio a cui manca ancora qualche arrivo effettivo, e senza questa guardia le tratte scoperte notificherebbero comunque.

**Guardia 2 — tratta conclusa.** La selezione delle tratte da annunciare ora fa join sulle righe appena aggiornate e filtra per fase:

```sql
  from pg_temp.voyage_effective_buffer buffer
  join public.voyage_bookable_legs leg on leg.id = buffer.leg_id
  where buffer.is_late
    and not buffer.was_late
    and public.voyage_leg_phase(...) <> 'completed';
```

Il join legge lo stato **post-ricalcolo**, non quello precedente: una tratta il cui arrivo effettivo è stato registrato in questa stessa chiamata risulta già `completed` e tace correttamente.

Nessuna modifica a `compute_voyage_schedule`, al baseline, al filtro sulla tratta d'imbarco o all'auto-accept di crew e admin.

## 3.3 Caso di confine da conoscere

Una tratta **senza arrivo effettivo registrato** diventa comunque `completed` **per orologio** quando passa `ends_at_window_end` (è già la regola di `voyage_leg_phase`), e da quel momento tace. Dimenticarsi di premere "arriva ora" non tiene la tratta notificabile in eterno — coerente con la regola, ma va saputo.

## 3.4 Mirror TS: non serviva

La regola di fase è specchiata in SQL e TS (`apps/web/src/lib/voyage-schedule.ts`), ma **la definizione di fase non è stata toccata** — solo chi la usa. Il TS non decide mai quando aprire un plan change: lo rende soltanto (`UserBookingMatrix.tsx`, `UserBookings.tsx`). Nessuna modifica lato client, `voyage-schedule.test.ts` invariato.

## 3.5 Verifica

- definizione live: entrambe le guardie presenti, `security definer` e grant invariati (`anon` no, `authenticated` sì);
- tavola di verità del predicato eseguita su DB reale: `completed` (per actual **e** per orologio) → silenzio; `active` e `planned` → notificano;
- **nessun effetto osservabile sui dati attuali**: in produzione oggi esiste un solo viaggio con tratte (`Atlantic Bound!`, 20 tratte tutte `planned`), quindi nessuna tratta conclusa da proteggere. La regola vale dalla prima tratta che si conclude in poi — che è il momento migliore per averla già dentro.

## 3.4 Perché conta anche per A

Con la separazione di §1.2 l'import non passa comunque da `apply_voyage_schedule`. Ma se in futuro si usa l'azione manuale *"correggi anche l'orario di programmazione"* su una tratta conclusa, senza la regola C quella correzione spedirebbe posta. C chiude il buco alla radice, la separazione lo tiene chiuso in ogni caso: due presidi indipendenti sullo stesso rischio.

---

## 4. Cosa **non** cambia

Vale la pena scriverlo, perché è il criterio di accettazione della feature A:

- `voyage_waypoints.actual_*` restano scritti **solo** da `set_voyage_waypoint_actual()`, cioè dai tasti del widget live;
- `compute_voyage_schedule` / `apply_voyage_schedule` / `sync_voyage_bookable_legs` non cambiano comportamento (salvo la condizione di fase di §3.2);
- `voyage_bookable_legs.is_bookable`, le finestre e il baseline non sono influenzati da nessun import;
- `voyages.cached_geometry` continua a contenere il **pianificato**;
- il `VoyageLiveWidget` e gli stati derivati continuano a leggere solo la programmazione.

Se dopo l'implementazione un import cambia uno qualunque di questi, la separazione è rotta.

---

## 5. Decisioni ancora aperte

| # | Decisione | Opzioni |
|---|---|---|
| 1 | Emissione biglietto | diretta · con stato `draft` e approvazione admin |
| 2 | Compagni di bordo in pubblico | mai (proposto) · con opt-in per partecipante |
| 3 | Tratte senza tracciato | memento coi soli pianificati (proposto) · nessun memento |
| 4 | Geometria reale del viaggio intero | colonna materializzata su `voyages`, separata da `cached_geometry` · calcolata al volo da `voyage_track_legs` |
| 5 | Runtime del renderer | Vercel Function Node (proposto) · edge function Deno, se resvg regge |
| 6 | Soste non previste | solo documentali in `voyage_track_stops` · promuovibili a waypoint con azione esplicita (proposto) |

---

## 6. Ordine di implementazione

**C · Regola di notifica** — ✅ fatta e applicata (`20260817150000`).

**A · Import** — il grosso del lavoro.

1. Schema (`voyage_tracks`, `voyage_track_points`, `voyage_track_legs`, `voyage_track_stops`) + bucket
2. Parser GPX + filtro (velocità, salti, gap) + test su una traccia vera
3. Rilevamento soste e scope come **proposta**, con vincolo "solo tratte concluse"
4. UI di riconciliazione in admin, multi-tracciato
5. Derivazione miglia reali e geometrie in `voyage_track_legs`
6. `coordinates_source: "track"` per le foto (opzionale, subito dopo)

**B · Biglietto** — a quel punto è la parte facile.

7. Tabella `voyage_mementos` + funzione che costruisce il `payload`
8. Renderer Satori, iterato su dati veri finché il biglietto non convince — **è qui che va il tempo di design**
9. Cron di emissione (gate per copertura tratte) + template email IT/EN
10. Pagina pubblica + OG
11. PDF, badge, integrazione osservazioni citizen science

---

## 7. Collegamenti

- [[Wiki/21 - Tracking Real-Time Viaggi]] — schedule engine, actual sui waypoint, stati derivati, notifiche di ritardo. **Da aggiornare** con A e C.
- [[Wiki/13 - Booking Voyage]] — partecipanti, legs prenotate, contributo per miglio.
- [[Wiki/12 - Newsletter ed Email]] — template transazionali e risoluzione della lingua.
- [[Wiki/14 - Mappe e Layer Geospaziale]] — geometrie e proiezioni.
- [[Wiki/17 - Content Model]] — logbook photo points.
- [[Wiki/16 - Admin]] — pannelli viaggio, dove si innesta la UI di riconciliazione.
