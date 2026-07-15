---
tags: [content-model, dati, schema, reference]
---
# 17 - Content Model

⬅️ [[Home]] · sorgente: `docs/bite-atlas-architecture.md`, `docs/migration/SCHEMA.md`

Modello dati editoriale e geospaziale del progetto. Ogni entità ha ID semantico stabile, `machine_description` e `canonical_url` → esposto in [[15 - Semantic Layer (AI Agents)]].

## Entità principali

### 📄 Articoli / logbook
Campi chiave: `id`, `type`, `title`, `slug`, `language`, `summary`, `date.{published_at, updated_at}`, `coordinates`, `route_association.*` (voyage_id, segment_start/end, waypoint_start/end_id/label, location_name, distance {NM, km}, temporal_span), `tags`, `entities_involved`, `linked_media`, `related_articles`, `machine_description`, `canonical_url`.

### ⛵ Voyage / segmenti di rotta
`id`, `type`, `title`, `slug`, `language`, `summary`, `date.{start,end}`, `coordinates.{departure,arrival}`, `route_association.{waypoint_count, geometry_points, route_type, status, distance, geojson_url, semantic_url}`, `entities_involved`, `linked_media`, `related_articles`, `related_waypoints`, `canonical_url`.

### 📍 Waypoint / tappe
`id`, `type`, `title`, `slug`, `summary`, `date.{start,end,event_date,event_time}`, `coordinates`, `route_association.{voyage_id, sequence, visibility_mode, waypoint_type}`, `entities_involved`, `linked_media`, `related_articles`.

Nel backoffice rotte, un waypoint in `auto` viene trattato come narrativo non solo se è partenza/arrivo, ma anche quando viene personalizzato il nome o viene salvata una sosta prevista; il picker può comunque forzarlo manualmente a tecnico.

### 🔬 Observations
Note waypoint + scene/overlay mappa con coordinate esplicite. Campi: `observation_kind`, `date.{observed_at, source_published_at}`, `coordinates`, `route_association.{voyage_id, article_slug}`, ecc.

### 👥 Crew / Vessel
`id`, `type`, `name`, `slug`, `avatar_url`, `article_count`, `article_urls`. Vessel di riferimento: `id: vessel:s-y-spritz`, `name: S/Y Spritz`.

### 🖼️ Media
`asset_kind`, `url`, `mime_type`, `alt_text`, `extended_description`, `associated_entity_ids`, `canonical_source_url`.

### 🗺️ Maps
`map_kind`, `alt_text`, `extended_description`, `raw_data_url`, `related_entity_ids`.

## Proprietà GeoJSON → [[14 - Mappe e Layer Geospaziale]]
- **Rotte (LineString):** id, kind, title, slug, canonical_url, waypoint_count, geometry_points, route_type, status, distance_{nautical_miles,kilometers}, departure/arrival_label, start/end_date, related_article_ids.
- **Waypoint (Point):** id, kind, title, canonical_url, voyage_id, voyage_title, sequence, visibility_mode, waypoint_type, date_start/end, event_date, related_article_ids.

## Osservazioni citizen science → [[22 - Citizen Science e Osservazioni]]
Modello separato da quello editoriale: **normalizzato in scrittura, wide in lettura**.

- `observations` — il punto: `recorded_at` (timestamptz), `lat`/`lng` (fix GPS reale, **non** sulla rotta stimata), `gps_accuracy_m`, `depth_m`, `source` (`sensor`/`manual`/`simulated`), `qc_flag` (scala IODE), `voyage_id` risolto dal timestamp.
- `observation_measurements` — la lettura: `parameter_code`, `value`/`value_text`, `qc_flag`.
- `observation_parameters` — il catalogo: unità, tipo, range plausibile, rampa colore, accuratezza. **Aggiungere una variabile è una riga qui, non una migrazione.**
- Vista `observations_export` — una riga per punto, una colonna per parametro (`sst_degc`, `sst_degc_qc`, …), ISO 8601 UTC: la forma che serve a un ricercatore in Excel. Rigenerata da trigger sul catalogo.

## Persistenza
Tutto in Postgres su [[08 - Supabase]]; schema evoluto tramite le migrazioni in `apps/web/supabase/migrations/`.

## Collegamenti
- [[15 - Semantic Layer (AI Agents)]] · [[08 - Supabase]] · [[13 - Booking Voyage]] · [[22 - Citizen Science e Osservazioni]]
