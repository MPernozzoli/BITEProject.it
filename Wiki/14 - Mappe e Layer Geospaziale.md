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
  - Nei tooltip waypoint dei voyage prenotabili mostra anche le date della sosta (`Arrivo` dalla leg in ingresso, `Ripartenza` dalla leg in uscita); i voyage senza booking attivo non espongono queste date nel tooltip.
- `ArticleMapAside.tsx` / `LazyArticleMapAside.tsx` — mappa laterale in articolo. Quando l'articolo è collegato a un viaggio prenotabile, `ArticleReader.tsx` carica `get_public_voyage_leg_availability` e mostra sulla minimappa la CTA **Partecipa** solo se esiste almeno un tratto ancora disponibile; per articoli agganciati a un segmento considera solo le tratte comprese nel segmento.
- `MapLoadingPlaceholder.tsx` — placeholder di caricamento
- `AdminMapPresenceManager.tsx`, `ArticleMiniMapEditor.tsx`, `AdminVoyageManager.tsx` — editing lato admin → [[16 - Admin]]
- `AdminVoyageManager.tsx` usa `requestFullscreen()` sul workspace mappa per l'editor rotte, ascolta `fullscreenchange` per sincronizzare lo stato UI e forza `map.resize()` dopo il cambio dimensione.

## Dati geo
- Coordinate degli articoli: `apps/web/src/lib/article-map.ts`, `article-map-anchor.ts`
- Presenza sulla mappa (tracker): `apps/web/src/lib/map-presence.ts`, pagina `AdminMapPresence.tsx` (`/admin/trackers`)
- Naming waypoint admin: `apps/web/src/lib/voyage-utils.ts` usa Nominatim per il reverse geocoding e, se il risultato è troppo generico per coordinate in mare, cerca con Overpass toponimi vicini usando endpoint fallback e un raggio più ampio per città/paesi. Se il marker sembra una fermata costiera/portuale usa il nome città secco; se è più al largo preferisce il nome reale di baia/cala/località/capo/isola. Le coordinate non vengono più salvate come nome default: il fallback è `WPT NN`, e i vecchi nomi in formato coordinate sono considerati provvisori. Nell'inspector WPT delle rotte acqua c'è anche il controllo manuale `Auto / Città / Baia o toponimo`.

## Principi (da doc architettura)
- Una rotta **non deve mai** esistere solo come immagine renderizzata.
- Ogni rotta pubblicata deve avere **coordinate raw**.
- I waypoint sono **oggetti geografici di prima classe**.
- Link rotta→articolo e waypoint→articolo devono essere espliciti.

## Mappa server-side per le anteprime social (`apps/web/src/server/og/`)
Quando una rotta viene condivisa (WhatsApp, Facebook, Telegram, Slack) l'anteprima non è più l'immagine generica del sito ma **la mappa di quella rotta**, generata da `GET /api/og/voyage?slug=...` → [[10 - API Vercel]].

- `route-map.ts` — proiezione Web Mercator, scelta dello zoom che fa entrare il bbox, download delle tile CARTO `light_all` (stessa base del sito, stessa `VITE_CARTO_API_KEY`) e disegno di rotta, soste e marker. I colori vengono da `getVoyageStrokeColor` di `VoyageMap.tsx`: acqua/terra per tipo, tonalità per stato.
- `raster.ts`, `png.ts`, `font.ts` — compositing RGBA, codec PNG su `node:zlib` e font bitmap 5x7 per l'attribuzione OSM/CARTO stampata nell'immagine (viaggia da sola, fuori dal sito).
- Geometria: `cached_geometry.coordinates` se c'è, altrimenti i waypoint in linea retta — stessa priorità di `VoyagePage.tsx`. Le soste marcate sono i waypoint "narrativi", con la regola di `getWaypointEffectiveType`.
- Niente `sharp` né `canvas`: sul runtime serverless non ci sono binari nativi, quindi tile e output sono decodificati/codificati a mano.

> La mappa renderizzata resta un **derivato**: le coordinate raw restano la fonte, coerentemente con i principi qui sopra.

## Esposizione machine-readable → [[15 - Semantic Layer (AI Agents)]]
La function `public-geo` serve GeoJSON:
- `public-geo?kind=routes` → feature `LineString` (rotte)
- `public-geo?kind=waypoints` → feature `Point` (waypoint)
- filtro `voyage_id` supportato su entrambi

Proprietà GeoJSON rotte/waypoint dettagliate in [[17 - Content Model]].

## Mappa dati (`data.biteproject.it`) → [[22 - Citizen Science e Osservazioni]]
`apps/data/src/pages/MapPage.tsx` è una mappa MapLibre indipendente da quella del logbook: disegna le rotte da `cached_geometry` e sopra la nuvola di punti dei campionamenti, **senza waypoint** (due tipi di pallino sulla stessa mappa sarebbero ambigui).

Regole colore, codificate in `apps/data/src/lib/observation-scale.ts` e coperte da test in `apps/data/src/test/observation-scale.test.ts`:
- una sola scala colore per volta: **identità** (viaggio, palette categorica a ordine fisso) senza parametro selezionato, **magnitudine** (rampa sequenziale a tonalità singola) con un parametro selezionato;
- la palette dei viaggi si assegna dalla lista completa dei viaggi, così un filtro non ricolora i superstiti;
- la rampa sequenziale parte dallo step 250 e non dal più chiaro: sono marker su un basemap chiaro, non un riempimento heatmap;
- direzione del vento = scala **ciclica** fissa 0–360 (0° e 360° sono la stessa direzione).

Layout full-bleed con pannello di controllo galleggiante `MapControlPanel.tsx` (stile `ArticleSlidePanel`, collassabile) e carosello dei tipi di dato navigabile con frecce/tastiera → dettagli in [[22 - Citizen Science e Osservazioni]].

> ⚠️ Il container della mappa va dimensionato esplicitamente (`h-full w-full`), **non** con `absolute inset-0`: `maplibre-gl.css` marca `.maplibregl-map` con `position: relative` a pari specificità ma più avanti nel bundle, annulla il posizionamento assoluto e la mappa collassa a 0px.

## Collegamenti
- [[10 - API Vercel]] · [[15 - Semantic Layer (AI Agents)]] · [[17 - Content Model]] · [[13 - Booking Voyage]] · [[22 - Citizen Science e Osservazioni]]
