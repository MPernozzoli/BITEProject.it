---
tags: [mappe, geo, maplibre, funzionalita]
---
# 14 - Mappe e Layer Geospaziale

⬅️ [[Home]] · sorgente: `apps/web/src/lib/maplibre.ts`, `apps/web/src/lib/map-presence.ts`, `apps/web/src/components/*Map*`

## Stack mappe
- **maplibre-gl 5** — rendering mappe vettoriali
- **supercluster** — clustering marker
- Wrapper: `apps/web/src/lib/maplibre.ts`

## Componenti
- `LazyVoyageMap.tsx` — mappa rotta viaggio (lazy) → usata da `VoyagePage.tsx`
- `VoyageMap.tsx` — mappa MapLibre del logbook; durante il booking riceve le tratte selezionate e disegna un overlay verde sopra i segmenti interessati.
- `ArticleMapAside.tsx` / `LazyArticleMapAside.tsx` — mappa laterale in articolo
- `MapLoadingPlaceholder.tsx` — placeholder di caricamento
- `AdminMapPresenceManager.tsx`, `ArticleMiniMapEditor.tsx`, `AdminVoyageManager.tsx` — editing lato admin → [[16 - Admin]]
- `AdminVoyageManager.tsx` usa `requestFullscreen()` sul workspace mappa per l'editor rotte, ascolta `fullscreenchange` per sincronizzare lo stato UI e forza `map.resize()` dopo il cambio dimensione.

## Dati geo
- Coordinate degli articoli: `apps/web/src/lib/article-map.ts`, `article-map-anchor.ts`
- Presenza sulla mappa (tracker): `apps/web/src/lib/map-presence.ts`, pagina `AdminMapPresence.tsx` (`/admin/trackers`)
- Naming waypoint admin: `apps/web/src/lib/voyage-utils.ts` usa Nominatim per il reverse geocoding e, se il risultato è troppo generico per coordinate in mare, cerca con Overpass toponimi vicini. Se il marker sembra una fermata costiera/portuale usa il nome città secco; se è più al largo preferisce il nome reale di baia/cala/località/capo/isola. Nell'inspector WPT delle rotte acqua c'è anche il controllo manuale `Auto / Città / Baia o toponimo`.

## Principi (da doc architettura)
- Una rotta **non deve mai** esistere solo come immagine renderizzata.
- Ogni rotta pubblicata deve avere **coordinate raw**.
- I waypoint sono **oggetti geografici di prima classe**.
- Link rotta→articolo e waypoint→articolo devono essere espliciti.

## Esposizione machine-readable → [[15 - Semantic Layer (AI Agents)]]
La function `public-geo` serve GeoJSON:
- `public-geo?kind=routes` → feature `LineString` (rotte)
- `public-geo?kind=waypoints` → feature `Point` (waypoint)
- filtro `voyage_id` supportato su entrambi

Proprietà GeoJSON rotte/waypoint dettagliate in [[17 - Content Model]].

## Collegamenti
- [[15 - Semantic Layer (AI Agents)]] · [[17 - Content Model]] · [[13 - Booking Voyage]]
