---
tags: [voyage, tracking, gpx, mappe, biglietto, funzionalita]
---
# 29 - Tracciati Reali GPX

⬅️ [[Home]] · sorgente: `apps/web/src/lib/voyage-track-*.ts`, `apps/web/src/components/admin/VoyageTrack*.tsx`, `apps/web/src/pages/AdminVoyageTracks.tsx`, migrazione `20260923095529_voyage_recorded_tracks.sql` · design originale: `docs/voyage-track-import-and-memento-plan.md` (parte A)

## Concetto
I GPX registrati a bordo diventano la **rotta reale** del viaggio: miglia misurate, tempi di navigazione, velocità, soste. Alimentano il biglietto ricordo ([[13 - Booking Voyage]]) e il confronto **previsto vs effettivo** della pagina viaggio.

Regola non negoziabile: **il tracciato è documentale e non tocca la programmazione**. Non scrive `voyage_waypoints.actual_*`, non chiama `apply_voyage_schedule`, non apre plan change, non spedisce email. Gli orari "Parti ora"/"Arriva ora" di [[21 - Tracking Real-Time Viaggi]] restano l'unica autorità operativa; l'editor si limita a mostrare lo scarto fra i due.

## Il problema che risolve la riconciliazione
Un file non corrisponde né al viaggio né a una tratta: può coprire una tratta, un pezzo, o più tratte; di solito parte poco dopo aver mollato gli ormeggi e finisce in una rada invece che sul pin previsto. Quindi l'algoritmo non cerca le tratte, cerca i **confini** fra una tratta e l'altra, e poi taglia.

## Pipeline (tutta nel browser dell'admin, lineare: 127k punti ≈ 35 ore a 1 Hz in meno di 1 s)
1. **Parser** (`voyage-track-gpx.ts`) — tokenizer XML proprio e lineare (il `DOMParser` di jsdom è quadratico: 25k punti = 37 s). Legge `trk/trkseg/trkpt` (fallback `rte/rtept`), `time`, `ele`, `speed`/`course` GPX 1.0, `hdop`/`sat`, e **ogni valore numerico dentro `<extensions>`** (Garmin `gpxtpx:speed/course/depth/wtemp/atemp`, OpenCPN, Navionics…). Velocità e rotta vengono normalizzate; tutto il resto finisce in `extras` e ne vengono calcolate min/media/max per tratta, senza modifiche al parser. Orari senza fuso → letti come UTC (standard GPX) e segnalati in UI.
2. **Pulizia** (`voyage-track-analysis.ts`) — ordina per tempo, scarta duplicati e salti GPS (solo se impossibili *da entrambi i lati*, oltre 35 kn), marca le interruzioni (nuovo `trkseg` o silenzio > 10 min).
3. **Velocità** — se il file ha una velocità registrata, **l'unità viene riconosciuta da sola** confrontandola con quella derivata da posizione/tempo (m/s, nodi o km/h); se non combacia con nessuna, si usa la derivata. Finestra adattiva ±30 s, con almeno un vicino per lato (i plotter loggano spesso ogni 30–60 s).
4. **Soste spaziali, non a soglia di velocità** — "rimasti entro 300 m per almeno 20 minuti". Il brandeggio all'ancora con la deriva GPS, con una soglia di velocità, diventerebbe miglia fantasma per tutta la notte. Le miglia dentro una sosta non si contano. Una pausa di registrazione in porto è una sosta anch'essa.
5. **Matching** (`voyage-track-matching.ts`) — per ogni confine di tratta raccoglie i candidati sul tracciato:
   - `stop`: una sosta entro 3 mn dalla tappa (arrivo = inizio sosta, partenza = fine);
   - `pass`: il punto di massimo avvicinamento entro 3 mn, navigando senza fermarsi (tappa saltata o cambio tratta al volo — es. Santa Maria di Leuca);
   - `trackStart`/`trackEnd`: la registrazione inizia/finisce entro 8 mn dalla tappa ("ho acceso il registratore dopo la partenza").
   Le posizioni di un confine includono l'**alias** (`alias_of_waypoint_id`): "Messina" aggancia la sosta a Reggio Calabria. Ogni candidato ha un punteggio (distanza) penalizzato dal disaccordo con gli actual di programmazione, se registrati. Una programmazione dinamica sceglie la sequenza crescente migliore sia nell'ordine delle tappe sia nel tempo; i confini saltati nel mezzo vengono tagliati al punto più vicino e marcati "incerto". Prima del primo aggancio / dopo l'ultimo, se la barca si muoveva, nasce un segmento **parziale** della tratta adiacente.
6. **Catena** — con tratte prenotabili i confini sono le loro tappe; per i **viaggi storici senza tratte** i confini sono le tappe narrative reali in ordine (le "skipped" escluse). Le soste dentro una tratta prendono il nome della tappa reale più vicina (anche `added`, es. Otranto), altrimenti "sosta fuori programma".

## Editor manuale — `/admin/tracks`
`AdminVoyageTracks.tsx` → `VoyageTracksManager.tsx` → `VoyageTrackEditor.tsx` + `VoyageTrackMap.tsx` → [[16 - Admin]]
- Caricamento multiplo; SHA-256 del file contro i doppioni; l'originale va intoccato nel bucket privato `voyage-tracks` (`{voyage_id}/{sha256}.gpx`), così un filtro migliore in futuro ri-deriva tutto senza richiedere l'export.
- Mappa: rotta pianificata tratteggiata, segmenti colorati per tratta, grigio le parti non assegnate, tappe e soste. Le maniglie verde/rossa del segmento selezionato si **trascinano lungo la traccia**.
- Per segmento: tratta assegnabile, slider inizio/fine, **Dividi** (clic sulla traccia: la seconda parte prende la tratta successiva), **Unisci al successivo**, **Escludi**; metriche live (miglia registrate vs previste, in movimento, media/max, distanza d'inizio/fine dalla tappa, miglia colmate su interruzioni, canali extra), soste interne con nome, scarto dagli orari registrati in programmazione, avvisi su tratte duplicate o già coperte da un altro tracciato.
- "Parti non assegnate" recuperabili come segmento; "Rifai proposta automatica" riparte da zero.
- **Salva bozza** (non pubblico) / **Conferma** (pubblico). Confermare richiede che ogni segmento abbia una tratta. Il salvataggio inserisce i nuovi segmenti *prima* di cancellare i vecchi. Archivia = toglie dal pubblico senza perdere il lavoro; Elimina = file + segmenti.
- Tabella **Copertura per tratta**: solo tracciati confermati, cioè esattamente quello che vedono biglietti e pagina.

## Modello dati → [[08 - Supabase]]
| Tabella | Contenuto |
|---|---|
| `voyage_tracks` | un file: path nel bucket, sha256, creator, intervallo, `capabilities` (cosa porta il file, unità velocità, fuso), `quality` (scarti, interruzioni), `stats`, geometria d'anteprima, `status` `draft`/`confirmed`/`archived` |
| `voyage_track_segments` | un intervallo del tracciato assegnato a una tratta (`leg_id`, oppure solo la coppia `from/to_waypoint_id` per i viaggi storici): `started_at`/`ended_at` (**l'autorità**: gli indici di punto sono solo cache dell'editor), miglia, miglia colmate, tempi, media/max, `start_gap_nm`/`end_gap_nm`, confidenza, soste, extras, geometria semplificata `{c,t,s,b}`, profilo di velocità |

Un tracciato → N segmenti; una tratta → N segmenti anche da file diversi (registrazione interrotta e ripresa). Trigger `validate_voyage_track_segment` verifica che segmento, tracciato, tratta e tappe appartengano allo stesso viaggio.

**RLS**: admin tutto; `anon`/`authenticated` leggono solo i segmenti di tracciati `confirmed` di viaggi pubblicati. Attenzione: la policy admin copre anche la lettura, quindi le query lato utente filtrano *esplicitamente* `voyage_tracks.status = 'confirmed'` (`TRACK_SEGMENT_CONFIRMED_SELECT` + `CONFIRMED_TRACK_FILTER` in `voyage-track-summary.ts`) — altrimenti un admin vedrebbe le bozze su pagina e biglietto.

## Dove si vede
- **Biglietto ricordo** (`VoyageTicketCard.tsx`, `lib/voyage-tickets.ts`): "Miglia percorse" misurate dal tracciato quando ogni tratta conclusa ne ha uno; `milesSource` = `track` / `mixed` / `planned` e il copy lo dichiara ("misurate dal tracciato GPS", "estremi stimati", "in parte dal tracciato"). Aggiunge schizzo SVG rotta prevista (tratteggio) vs reale, tempo in navigazione, media/max, soste fuori programma. È dentro il PNG scaricabile. L'email `voyage_ticket_ready` linka la pagina, quindi il biglietto si aggiorna se il tracciato viene confermato dopo l'invio.
- **Pagina viaggio** (`VoyagePlannedVsActual.tsx`, `VoyageRouteHeroMap` prop `actualTrack`): la mappa hero sovrappone la rotta reale (la prevista diventa tratteggiata); la sezione "Previsto vs effettivo" mostra totali, tratta per tratta miglia con scostamento %, partenza/arrivo registrati vs finestra baseline prevista, tempo in movimento, media/max, e il **profilo di velocità** della tratta selezionata con le soste. Non compare finché non c'è almeno un tracciato confermato. IT/EN.

## Onestà dei numeri
- `estimatedNm` = miglia registrate + estremi mancanti in linea retta; coverage `partial` se un estremo manca per più di 1,5 mn.
- Le miglia effettive saranno quasi sempre **maggiori** delle pianificate (bordi, ridossi): il contributo resta calcolato sulle pianificate e il copy non parla mai di conguaglio.
- Velocità massima su mediana mobile di 5 punti: un fix sballato non stabilisce record.

## Non implementato (prossimi passi possibili)
- Azione esplicita "allinea anche l'orario di programmazione" dal diff dell'editor (passerebbe per `set_voyage_waypoint_actual`; oggi solo mostrato).
- Promuovere una sosta fuori programma a waypoint reale.
- Geolocalizzazione foto da tracciato (`coordinates_source: "track"`, [[17 - Content Model]]).
- Import CSV/NMEA; tracciato live da dispositivo (vedi [[21 - Tracking Real-Time Viaggi]]).

## Collegamenti
- [[21 - Tracking Real-Time Viaggi]] · [[13 - Booking Voyage]] · [[14 - Mappe e Layer Geospaziale]] · [[16 - Admin]] · [[08 - Supabase]] · [[06 - Frontend - Componenti]] · [[07 - Frontend - Lib e Hooks]] · [[05 - Frontend - Pagine]]
