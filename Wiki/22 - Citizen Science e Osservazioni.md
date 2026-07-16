---
tags: [citizen-science, dati, osservazioni, mappe, funzionalita]
---
# 22 - Citizen Science e Osservazioni

⬅️ [[Home]] · sorgente: `apps/web/supabase/migrations/20260715120000_citizen_science_observations.sql`, `apps/data/src/pages/MapPage.tsx`, `apps/data/src/hooks/use-observations.ts`, `apps/data/src/lib/observation-scale.ts`

È la parte **citizen science** del progetto, pubblicata su `data.biteproject.it` (→ [[19 - Sub-App (pack e data)]]): raccoglie e mostra i campionamenti presi durante i viaggi, in una forma utilizzabile da istituti di ricerca e università.

## Principio guida
La rotta del logbook (`voyages.cached_geometry`) è una **rotta stimata**, non la tratta realmente percorsa. Le osservazioni portano il fix GPS reale del logger di bordo, quindi **i punti non stanno sulla linea** ed è corretto così: la linea è contesto, i punti sono il dato.

## Modello dati
Storage **normalizzato** (una riga per parametro misurato), export **wide** (una colonna per parametro). Aggiungere un sensore = una riga nel catalogo, **nessuna migrazione**.

| Tabella | Ruolo |
|---|---|
| `observation_parameters` | catalogo delle variabili: `code`, `unit_code`, unità, tipo, range plausibile, `color_ramp`, accuratezza, descrizioni IT/EN |
| `observation_devices` | logger di bordo e pseudo-device per l'inserimento manuale. Pubblicamente leggibile: non contiene segreti |
| `observation_device_keys` | credenziali di ingest **hashate**, tabella separata proprio per non esporle tramite le viste pubbliche. Nessuna policy: solo `service_role` |
| `observations` | il punto di campionamento: `recorded_at`, `lat`/`lng`, `gps_accuracy_m`, `depth_m`, `source`, `qc_flag`, `voyage_id` |
| `observation_measurements` | la singola lettura: `parameter_code`, `value`/`value_text`, `qc_flag` |

- **`source`**: `sensor` (logger), `manual` (equipaggio), `simulated` (dati demo — **non** misure reali).
- **`qc_flag`**: scala **IODE** (IOC/UNESCO), quella che gli istituti già leggono: `0` no QC · `1` good · `2` probably good · `3` probably bad · `4` bad · `9` missing.

## Attribuzione automatica del viaggio
`resolve_voyage_for_timestamp(timestamptz)` mappa un timestamp su un viaggio acqua:
1. per **finestra di date** (`Europe/Rome`, stessa convenzione degli helper booking → [[13 - Booking Voyage]]);
2. in fallback, sull'**unico** viaggio con `status = 'active'` (si fa sempre un viaggio alla volta).

Ritorna `null` se ambiguo: un punto fuori da ogni finestra resta non attribuito invece di finire sul viaggio sbagliato. Il trigger `observations_set_voyage_trg` la applica in `before insert` quando `voyage_id` è nullo — è il percorso che userà l'Arduino di bordo. `reattribute_observation_voyages()` ricalcola tutto dopo una modifica alle date viaggio (solo `service_role`).

## Viste
- **`observations_map`** — una riga per punto pubblicato, letture ripiegate in `measurements jsonb`: alimenta la mappa senza un secondo round trip.
- **`observations_export`** — **wide, analysis-ready**: una riga per punto, una colonna per parametro pubblicato (`<code>_<unit>`, es. `sst_degc`, `dissolved_oxygen_mgl`), ciascuna seguita dal suo flag QC (`sst_degc_qc`), timestamp ISO 8601 UTC. È quello che un ricercatore scarica in CSV/Excel.

`observations_export` è **rigenerata automaticamente** da `rebuild_observations_export_view()`, chiamata dal trigger `observation_parameters_rebuild_export_trg` a ogni insert/update/delete sul catalogo. Per questo `code` e `unit_code` hanno un check che li vincola a una forma sicura da usare come identificatori SQL.

Entrambe le viste sono `security_invoker = on`, quindi rispettano la RLS delle tabelle base.

## Struttura del portale
La **mappa è la home** (`/`): la home di un portale dati è il dato. Restano solo quattro altre viste — `/methodology`, `/sensors`, `/downloads`, `/collaborate` — più il redirect `/contact`.

Sono state eliminate `HomePage`, `AboutPage`, `DataExplorerPage` (dataset interamente inventati: su un portale scientifico è peggio di niente), `MissionsPage` (la mappa mostra già i viaggi, e il sito principale ha già `/voyages`) e il placeholder morto `Index`. Il testo di About è confluito in `/methodology` (inquadramento della piattaforma e "citizen science senza hype") e in `/downloads` ("perché pubblicare liberamente").

Le rotte ritirate **redirigono**, non danno 404: `/map` `/data` `/missions` → `/`, `/about` → `/methodology`. Un URL salvato da un ricercatore deve continuare a risolvere.

## Mappa (home)
`MapPage.tsx` disegna **rotte** (da `cached_geometry`) + **nuvole di punti**. I WPT narrativi (e in generale `voyage_waypoints`) **non** sono mostrati: sulla mappa dati due tipi di pallino sarebbero ambigui.

Mostra solo i viaggi con `status` **`completed` o `active`**: una rotta `planned` non ha osservazioni, quindi su una mappa di dati è una promessa, non un record.

### Layout (coerente con `/logbook`)
La mappa è **full-bleed** e i controlli galleggiano sopra, come nella mappa del logbook — non più una barra di filtri impilata sopra la mappa. Il pannello è `MapControlPanel.tsx`, che riprende lo stile di `ArticleSlidePanel` del logbook (glass `rounded-[28px]`, `bg-background/72`, `backdrop-blur-2xl`, `animate-slide-in-right`) ed è **collassabile**: da chiuso resta un launcher «Filters & layers» in alto a destra (utile su mobile e per vedere la mappa piena).

Contenuto del pannello:
- **Titolo + conteggio** punti (prima erano un header separato sopra la mappa).
- **Carosello del tipo di dato**: si scorre tra i parametri con le frecce ‹ › o con **←/→ da tastiera**, come si sfogliano gli articoli/media del logbook. La posizione 0 è «All data types»; i pallini sotto sono il "dove sono nel set" (come il pager articoli). Le frecce tastiera sono escluse quando il focus è su un input **o sulla canvas MapLibre** (lì le frecce fanno il pan della camera). La **scala colore** del parametro selezionato è inline sotto il carosello, non più un box separato.
- **Viaggi** cliccabili (link al sito principale).
- **Time**: chip anno come filtro principale; l'intervallo `from`/`to` esatto è dietro il toggle **Custom range**, chiuso di default.

Il filtro temporale e per tipo di dato resta identico a prima; è cambiata solo la loro presentazione.

### Tooltip → ponte narrativo
Il popup riusa le classi `.voyage-popup*` del logbook (definite nel foglio di stile condiviso), con `--voyage-popup-accent` legato al colore del viaggio sulla mappa: un ricercatore incontra lo stesso oggetto che troverebbe su biteproject.it. Il **titolo è il nome del viaggio** e in fondo c'è l'azione *Read this voyage →* verso `biteproject.it/en/voyages/{id}--{slug}`; anche i nomi in legenda e in `/downloads` sono link. `lib/voyage-link.ts` replica `buildVoyagePath()` di `apps/web` (l'alias `@` impedisce l'import diretto): è sicuro, perché il sito rilegge solo l'id prima di `--` e lo slug è cosmetico.

> ⚠️ Il popup elenca tutte le variabili e arriva a ~550px, più alto della mappa su un portatile, e il box mappa ha `overflow: hidden`. La classe `.observation-popup` (in `apps/data/src/index.css`) limita `.voyage-popup__body` con scroll interno. Il cap sta lì e non sulla classe condivisa, perché il popup del logbook non cresce mai così.

**Regole colore** (una sola scala per volta → [[14 - Mappe e Layer Geospaziale]]):
- Nessun parametro selezionato → i punti portano l'**identità** del viaggio (palette categorica, ordine fisso, assegnata dalla lista completa dei viaggi così che filtrare non ricolori i superstiti).
- Un parametro selezionato → i punti portano la **magnitudine** (rampa sequenziale a tonalità singola, chiaro→scuro) e le rotte passano in grigio recessivo.
- La scala sequenziale usa il **range presente nei dati filtrati**, non il range plausibile del catalogo (SST è catalogata 10–30 °C ma una tratta estiva copre ~20–27: sul range del catalogo tutti i punti collasserebbero sullo stesso step). La legenda stampa sempre il range in uso.
- I parametri **ciclici** (direzione del vento) sono l'eccezione: scala fissa 0–360, perché stirarla sul range osservato ruoterebbe il significato di ogni colore.

Il tooltip mostra sempre timestamp ISO 8601 UTC, viaggio, tutte le letture con unità e flag QC, posizione con accuratezza GPS, QC di posizione e strumento — più un badge esplicito quando `source = 'simulated'`.

## Dati demo attualmente in produzione
797 punti **simulati** sui due viaggi acqua completati (2024 e 2025), legati al device `sim-demo-01`. Servono a sviluppare la mappa prima che esista l'Arduino. Sono marcati `source = 'simulated'` e vanno rimossi prima del lancio pubblico:

```sql
delete from public.observations
where device_id = (select id from public.observation_devices where code = 'sim-demo-01');
```

## Sensori e Download: niente più mock
- **`/sensors`** legge `observation_parameters`: aggiungere un sensore è una riga nel catalogo, mai una modifica alla pagina. Prima era una lista scritta a mano di 7 sensori mentre il catalogo ne aveva 10 — **mentiva già**. Le colonne `limitations_en`/`limitations_it` ospitano il testo editoriale sui limiti di ogni variabile; dove è `null` la card dichiara «Limitations not yet documented» invece di tacere, perché il silenzio si leggerebbe come "nessun limite noto". Solo l'icona resta mappata nel frontend.
- **`/downloads`** serve davvero `observations_export`, per intero o per singolo viaggio, in CSV e JSON, con conteggi reali. `lib/csv.ts` fa l'escaping RFC 4180 e antepone il **BOM UTF-8**: senza, Excel legge il file con la codepage locale e sfascia i simboli di grado nelle colonne di unità.

## Da fare
- Endpoint di **ingest** per l'Arduino (device key + `observation_device_keys`) → [[09 - Edge Functions]] o [[10 - API Vercel]].
- Esporre le osservazioni nel layer machine-readable → [[15 - Semantic Layer (AI Agents)]].
- **Nessuno dei sensori è ancora a bordo.** `/methodology` e `/sensors` descrivono strumenti e campionamento continuo al presente, ma l'Arduino non esiste e i 797 punti sono simulati: valutare un flag `is_operational` sul catalogo e un tempo verbale onesto prima di aprire il portale ai ricercatori.
- **`biteproject.it` non linka `data.biteproject.it` da nessuna parte**: il ponte narrativo oggi funziona solo in uscita.

## Collegamenti
- [[19 - Sub-App (pack e data)]] · [[14 - Mappe e Layer Geospaziale]] · [[08 - Supabase]] · [[17 - Content Model]] · [[13 - Booking Voyage]] · [[15 - Semantic Layer (AI Agents)]]
