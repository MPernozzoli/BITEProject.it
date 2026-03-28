# Piano di implementazione — 7 punti

## 1. Centrare "Scroll to discover" nella home

In `src/pages/Index.tsx` (riga 79), il div con il testo "scroll to discover" e la freccia usa `left-1/2 -translate-x-1/2` ma è wrappato in `flex flex-col items-center` — basta verificare che non ci siano offset. Il fix è assicurarsi che il container sia centrato con `text-center` e che il contenuto sia allineato.

## 2. Rimuovere "Home" dalla navbar

In `src/components/Navbar.tsx`, rimuovere `{ to: "/", label: t("nav.home") }` dall'array `links` (riga 90). Il logo BITE già linka a `/`.

## 3. Editor rotte con mappa interattiva (Admin Voyage Manager)

Creare `src/components/admin/AdminVoyageManager.tsx` — sostituisce il vecchio `AdminRouteManager`:

- Lista voyages con CRUD (nome, tipo acqua/terra, status)
- Mappa MapLibre interattiva per piazzare waypoint con click
- Il primo click è l'inizio, i successivi sono waypoint intermedi, l'ultimo è la fine
- I waypoint sono di due tipi, uno solo tecnico (ad esempio, per evitare che il percorso passi attraverso la terra ferma, il secondo invece sono waypoint narrativi. Il primo non lo mostriamo in mappa, facciamo solo curvare il percorso, il seocndo lo indichiamo come punto e può avere info come: Nome, data (singola o doppia - da, a -) e può essere abbinato ad un articolo. 
- Drag & drop per riordinare waypoint nella lista laterale
- Calcolo automatico distanza (haversine NM per acqua, OSRM km per terra)
- Preview rotta in real-time sulla mappa
- nella pagina logbook al tasto + assoceremo una tendina con opzioni: rotta, articolo, storia. 

## 4. Associazione articoli/storie ai viaggi

Aggiungere sezione "Posizione & Viaggio" in `ArticleEditor.tsx`:

- Mini-mappa MapLibre per selezionare lat/lng con click
- Geocoding con Nominatim per cercare un luogo
- Dropdown per selezionare un voyage
- Tre modalità di associazione:
  - **"Tutto"**: assegna `voyage_id` senza segment start/end
  - **1 click sul percorso**: assegna un punto specifico (lat/lng del click, `voyage_segment_start` = indice waypoint più vicino)
  - **2 click sul percorso**: seleziona una leg (segment_start e segment_end = indici waypoint più vicini ai click)
- Per il punto singolo: si può cliccare anche in prossimità (non per forza sul percorso), registrando lat/lng reale e associandolo al voyage
- Per la leg: snap ai waypoint più vicini lungo il percorso

## 5. Articoli mostrati sulla mappa dinamicamente

Già parzialmente implementato in `VoyageMap.tsx`. Estendere:

- Per articoli associati a un segmento: posizionare il marker al punto medio del segmento
- Per articoli associati a tutto il viaggio: posizionare al punto medio della rotta
- Per articoli con solo lat/lng: usare quelle coordinate
- Click su marker → apre `ArticleSlidePanel`

## 6. Pan automatico mappa su selezione articolo

Già parzialmente implementato (flyTo su selectedArticleId). Estendere:

- Se l'articolo è associato a un segmento → fitBounds sui waypoint del segmento
- Se associato a tutto il viaggio → fitBounds su tutti i waypoint del voyage
- Se punto singolo → flyTo su lat/lng
- Se l'articolo ha un "successivo" nella stessa storia → mostrare link nel pannello

## 7. Associazione visuale sulla mappa nell'editor

Nell'editor articoli, quando un voyage è selezionato:

- Mostrare la rotta sulla mini-mappa
- Tasto "Tutto" per assegnare tutto il viaggio
- Click su un punto → assegna punto singolo (lat/lng del click, associato al voyage)
- Click su due punti → seleziona la leg tra i waypoint più vicini (snap al waypoint più prossimo sul percorso)
- Evidenziare visivamente il segmento selezionato

---

## File coinvolti


| File                                          | Azione                                                            |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `src/pages/Index.tsx`                         | Fix centering scroll indicator                                    |
| `src/components/Navbar.tsx`                   | Rimuovere link "Home"                                             |
| `src/components/admin/AdminVoyageManager.tsx` | **Nuovo** — editor rotte con mappa                                |
| `src/pages/AdminDashboard.tsx`                | Sostituire AdminRouteManager con AdminVoyageManager               |
| `src/pages/ArticleEditor.tsx`                 | Aggiungere sezione geo/voyage con mappa interattiva               |
| `src/components/voyage/VoyageMap.tsx`         | Estendere logica posizionamento marker per segmenti/viaggi interi |
| `src/pages/Journal.tsx`                       | Estendere logica pan/fitBounds per segmenti                       |
| `src/components/voyage/ArticleSlidePanel.tsx` | Aggiungere link "articolo successivo" se in una storia            |


## Nota tecnica

Le colonne DB necessarie (`latitude`, `longitude`, `voyage_id`, `voyage_segment_start`, `voyage_segment_end`, `location_name`) sono già presenti nella tabella `logbook_articles`. Le tabelle `voyages` e `voyage_waypoints` esistono già. Non servono migrazioni DB.