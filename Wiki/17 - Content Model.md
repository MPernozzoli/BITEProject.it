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

## Persistenza
Tutto in Postgres su [[08 - Supabase]]; schema evoluto tramite le 36 migrazioni.

## Collegamenti
- [[15 - Semantic Layer (AI Agents)]] · [[08 - Supabase]] · [[13 - Booking Voyage]]
