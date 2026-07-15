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

## Mappa `/Data/map`
`MapPage.tsx` disegna **rotte** (da `cached_geometry`) + **nuvole di punti**. I WPT narrativi (e in generale `voyage_waypoints`) **non** sono mostrati: sulla mappa dati due tipi di pallino sarebbero ambigui.

Filtri: chip per anno + `from`/`to` liberi, e select del tipo di dato popolata dal catalogo.

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

## Da fare
- Endpoint di **ingest** per l'Arduino (device key + `observation_device_keys`) → [[09 - Edge Functions]] o [[10 - API Vercel]].
- Collegare `/Data/downloads` e `/Data/data` a `observations_export` (oggi sono ancora mock).
- Esporre le osservazioni nel layer machine-readable → [[15 - Semantic Layer (AI Agents)]].

## Collegamenti
- [[19 - Sub-App (pack e data)]] · [[14 - Mappe e Layer Geospaziale]] · [[08 - Supabase]] · [[17 - Content Model]] · [[13 - Booking Voyage]] · [[15 - Semantic Layer (AI Agents)]]
