---
tags: [mappe, geo, maplibre, funzionalita]
---
# 14 - Mappe e Layer Geospaziale

⬅️ [[Home]] · sorgente: `src/lib/maplibre.ts`, `src/lib/map-presence.ts`, `src/components/*Map*`

## Stack mappe
- **maplibre-gl 5** — rendering mappe vettoriali
- **supercluster** — clustering marker
- Wrapper: `src/lib/maplibre.ts`

## Componenti
- `LazyVoyageMap.tsx` — mappa rotta viaggio (lazy) → usata da `VoyagePage.tsx`
- `ArticleMapAside.tsx` / `LazyArticleMapAside.tsx` — mappa laterale in articolo
- `MapLoadingPlaceholder.tsx` — placeholder di caricamento
- `AdminMapPresenceManager.tsx`, `ArticleMiniMapEditor.tsx` — editing lato admin → [[16 - Admin]]

## Dati geo
- Coordinate degli articoli: `src/lib/article-map.ts`, `article-map-anchor.ts`
- Presenza sulla mappa (tracker): `src/lib/map-presence.ts`, pagina `AdminMapPresence.tsx` (`/admin/trackers`)

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
