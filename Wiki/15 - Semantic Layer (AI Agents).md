---
tags: [semantic, ai, llms, geojson, seo]
---
# 15 - Semantic Layer (AI Agents)

⬅️ [[Home]] · sorgente: `docs/bite-atlas-architecture.md` · function `public-*`

## Cos'è
Un **layer tecnico machine-readable** (JSON, GeoJSON, `llms.txt`) che espone la struttura già presente nel progetto — metadati contenuti, relazioni voyage/waypoint, dati geospaziali, link semantici — per **crawler, agenti AI e ricerca pubblica**.

> Non è un secondo sito editoriale né una "AI landing page": è una **superficie di retrieval** ancorata allo stesso dominio `biteproject.it`.

## Strategia dominio
- **Nessun hostname separato.** Target pulito: `biteproject.it/llms.txt` + JSON/GeoJSON same-origin sotto `/data/`.
- Implementazione attuale (dettaglio tecnico) tramite Supabase functions → [[09 - Edge Functions]]:
  - `public-llms` → feed `llms.txt`
  - `public-semantic` → oggetti JSON
  - `public-geo` → GeoJSON → [[14 - Mappe e Layer Geospaziale]]
  - `public-sitemap` → sitemap

## Vanity path raccomandati (fase futura, same-origin)
`/llms.txt`, `/data/index.json`, `/data/articles.json`, `/data/voyages.json`, `/data/waypoints.json`, `/data/observations.json`, `/data/refs.json`, `/data/media.json`, `/data/maps.json`, `/data/graph.json`, `/data/geo/routes.geojson`, `/data/geo/waypoints.geojson`.

## Modello contenuti esposto → [[17 - Content Model]]
Articoli, Voyage, Waypoint, Observations, Crew/Vessel (`vessel:s-y-spritz` = S/Y Spritz), Media, Maps — ciascuno con ID semantico stabile, `machine_description`, `canonical_url`.

## Fasi (roadmap)
1. **MVP** — indice discovery, GeoJSON rotte/waypoint, `llms.txt`, oggetti base. *(stato attuale)*
2. **Semantic migliorato** — routing same-origin `/data/*`, graph browsing, bilingue esplicito, export GPX, descrizioni media.
3. **Agent-facing avanzato** — endpoint query con filtri documentati, entity search, schema versionato, snapshot firmati per ricerca.

## Guardrail
- Non replicare i corpi completi degli articoli nel layer.
- Niente metadati "scientifici" falsi né observation non ancorate a coordinate/descrizioni reali.
- Non sostituire l'esperienza di lettura editoriale.
- L'archivio deve servire anche ricerca pubblica e trasparenza, non solo AI.

## Sotto-app collegata
`apps/data` (`@biteproject/data`, build in `/_data/`) è la superficie applicativa di questo layer → [[19 - Sub-App (pack e data)]].

## Collegamenti
- [[17 - Content Model]] · [[14 - Mappe e Layer Geospaziale]] · [[09 - Edge Functions]]
