

# Story Map — Logbook + Route Unificati

## Panoramica

Unire la pagina "Diario di bordo" e la pagina "Rotta" in un'unica esperienza interattiva ispirata ad Apple Foto: una mappa a schermo pieno con la rotta visibile e gli articoli georeferenziati come marker con cover image, navigabili con pannello laterale scorrevole.

## Architettura

```text
┌─────────────────────────────────────────────────┐
│  Header / filtri / toggle vista                 │
├──────────────────────┬──────────────────────────┤
│                      │                          │
│   Lista articoli     │       MAPPA              │
│   (scrollabile)      │   (Leaflet + rotte       │
│                      │    + marker articoli)     │
│   click/scroll →     │                          │
│   pan mappa          │   click marker →         │
│                      │   evidenzia articolo     │
│                      │                          │
├──────────────────────┴──────────────────────────┤
│  Stats rotta (miglia, tratte, progresso)        │
└─────────────────────────────────────────────────┘
```

Quando si clicca un articolo/marker, si apre un pannello modale laterale (slide-in da destra) con il contenuto completo, senza lasciare la mappa.

---

## Step 1 — Database: Nuova struttura rotte e georeferenziazione articoli

**Tabella `voyages`** (sostituisce il concetto di "viaggio intero"):
- `id`, `name`, `description`, `type` (enum: `water`, `land`), `status` (`active`/`completed`/`planned`), `created_at`, `updated_at`, `sort_order`

**Tabella `voyage_waypoints`** (sostituisce `route_legs`, waypoint multipli):
- `id`, `voyage_id` (FK), `lat`, `lng`, `name` (opzionale, es. nome porto), `sort_order`, `created_at`
- Per rotte acqua: linee rette tra waypoint, distanza calcolata come somma segmenti (haversine → NM)
- Per rotte terra: waypoint come punti di passaggio, routing OSM (OSRM) per il percorso stradale effettivo

**Modifiche a `logbook_articles`** — aggiungere colonne:
- `latitude` (float, nullable)
- `longitude` (float, nullable)  
- `voyage_id` (uuid, nullable, FK → voyages)
- `voyage_segment_start` (int, nullable) — indice waypoint inizio segmento
- `voyage_segment_end` (int, nullable) — indice waypoint fine segmento
- `location_name` (text, nullable) — es. "Porto di Bari"

Logica abbinamento articolo ↔ rotta:
- **Punto singolo**: solo lat/lng compilati, no voyage
- **Viaggio intero**: voyage_id senza segment_start/end
- **Segmento specifico**: voyage_id + segment_start + segment_end

Migrazione dei dati da `route_legs` ai nuovi `voyages` + `voyage_waypoints`.

**RLS**: voyages e waypoints leggibili da tutti, scrivibili solo da admin (come route_legs).

---

## Step 2 — API e calcolo distanze

- **Rotte acqua**: calcolo haversine client-side tra waypoint consecutivi → somma = NM totali
- **Rotte terra**: chiamata a OSRM (API pubblica, no key) `https://router.project-osrm.org/route/v1/driving/{waypoints}` per ottenere il percorso stradale e la distanza in km. Caching del risultato nel DB (`voyage.cached_geometry` come GeoJSON LineString)
- Funzione utility condivisa per calcolo distanze

---

## Step 3 — Componente mappa unificata (`VoyageMap`)

Componente React con Leaflet che mostra:
1. **Rotte** come polyline (acqua = linee tra waypoint, terra = percorso OSRM)
2. **Marker articoli** come cerchi con la cover image (CSS `border-radius: 50%`, `background-image`) e titolo sotto
3. **Waypoint** come cerchi piccoli sulla rotta
4. Stili differenziati: acqua (blu), terra (marrone), passato/corrente/futuro
5. Clustering con `react-leaflet-markercluster` per molti articoli

Interazioni:
- Click su marker articolo → evidenzia nella lista + apre pannello laterale
- Hover su segmento rotta → evidenzia articoli collegati (glow/pulse CSS)
- FitBounds automatico su tutti gli elementi visibili

---

## Step 4 — Layout pagina Logbook unificata

Ridisegno di `Journal.tsx` → layout split-view:
- **Sinistra (40%)**: lista articoli scrollabile con card (cover thumb + titolo + data + tags). Include stats rotta in alto (miglia, progresso). Filtri e ricerca.
- **Destra (60%)**: mappa interattiva a tutta altezza

Usa `react-resizable-panels` (già installato) per il layout split ridimensionabile.

**Scroll sync**: quando l'utente scrolla nella lista, `IntersectionObserver` rileva l'articolo visibile → `map.flyTo()` con animazione smooth verso la posizione dell'articolo, evidenziando il segmento rotta associato.

**Click su marker mappa**: scrolla la lista all'articolo corrispondente + lo evidenzia.

---

## Step 5 — Pannello laterale articolo (Slide-in reader)

Quando si clicca su un articolo (dalla lista o dal marker):
- Pannello slide-in da destra (overlay sulla mappa, ~50% larghezza)
- Contiene: cover image, titolo, autori, data, contenuto rich text, commenti, like
- Chiusura con X o click fuori
- La mappa rimane visibile e centrata sull'articolo

---

## Step 6 — Admin: gestione rotte e georeferenziazione

**Editor rotte** (evoluzione di `AdminRouteManager`):
- CRUD voyages con tipo acqua/terra
- Aggiunta waypoint con click sulla mappa (drag & drop per riordinare)
- Preview percorso in tempo reale
- Calcolo automatico distanza

**Editor articoli** (evoluzione di `ArticleEditor`):
- Sezione "Posizione" con mini-mappa per selezionare lat/lng (click per piazzare pin)
- Dropdown per selezionare voyage e segmento
- Geocoding con Nominatim (OSM) per cercare luoghi per nome

---

## Step 7 — Animazioni e polish

- Marker articoli: transizione scale on hover, pulse quando selezionato
- Segmenti rotta: glow animato quando associati all'articolo in focus
- `map.flyTo()` con easing smooth
- Transizione pannello laterale con framer-motion o CSS transitions
- Responsive: su mobile, mappa full-screen con lista come bottom sheet scorrevole

---

## Step 8 — Routing e cleanup

- Rimuovere la route `/route` da `App.tsx` e il file `Route.tsx`
- Rimuovere `nav.route` dalla navbar
- La pagina `/logbook` diventa l'unico punto di accesso
- Redirect `/route` → `/logbook`

---

## Dettagli tecnici

| Area | Tecnologia |
|------|-----------|
| Mappa | Leaflet + react-leaflet (già installato) |
| Layout split | react-resizable-panels (già installato) |
| Routing stradale | OSRM API pubblica (no key) |
| Geocoding | Nominatim OSM (no key) |
| Calcolo NM | Haversine formula client-side |
| Animazioni | CSS transitions + Leaflet flyTo |
| Marker custom | Leaflet DivIcon con HTML/CSS |
| Mobile | Bottom sheet pattern con touch gestures |

**Dipendenze nuove**: nessuna obbligatoria. Opzionali: `leaflet-markercluster` per clustering.

**Stima effort**: 4-5 step di implementazione, consigliabile procedere incrementalmente (DB → mappa base → articoli su mappa → interazioni → polish).

