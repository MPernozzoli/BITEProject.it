---
tags: [content-model, dati, schema, reference]
---
# 17 - Content Model

⬅️ [[Home]] · sorgente: `docs/bite-atlas-architecture.md`, `docs/migration/SCHEMA.md`

Modello dati editoriale e geospaziale del progetto. Ogni entità ha ID semantico stabile, `machine_description` e `canonical_url` → esposto in [[15 - Semantic Layer (AI Agents)]].

## Entità principali

### 📄 Articoli / logbook
Campi chiave: `id`, `type`, `title`, `slug`, `language`, `summary`, `date.{published_at, updated_at}`, `coordinates`, `route_association.*` (voyage_id, segment_start/end, waypoint_start/end_id/label, location_name, distance {NM, km}, temporal_span), `tags`, `entities_involved`, `linked_media`, `related_articles`, `machine_description`, `canonical_url`.

SEO generata da IA: `article_seo_optimizations` è una tabella one-to-one per articoli pubblicati. Contiene `title_*`, `description_*`, social title/description, `keywords_*`, alt cover, `structured_data`, `recommendations`, `model`, `source_hash`, stato (`pending/processing/ready/failed`) e timestamp. La pagina pubblica usa il record `ready` per i meta tag e arricchisce il JSON-LD, senza modificare il contenuto editoriale; l'admin usa i record `failed` come warning non bloccante e `source_hash` evita rigenerazioni automatiche su contenuto invariato.

Sincronizzazione community: alla pubblicazione di un articolo, `sync-article-community-post` genera un post BITE Crew pubblico tramite IA. Il post mantiene `metadata.source_article_id` per idempotenza, salva il link all'articolo in `linked_resources` e replica tutti gli autori editoriali in `community_post_authors` con ordinamento. Il post non crea una seconda discussione: usa lo stesso thread `article_comments` della pagina logbook, così commenti e like commento sono condivisi tra sito principale e Crew.

### ✅ Readiness check (check_article_readiness)
Function PostgreSQL che verifica se un articolo ha tutti i campi obbligatori per la pubblicazione. Campi controllati: `title_it`, `title_en`, `excerpt_it`, `excerpt_en`, `content_it`, `content_en`, `cover_image`, `editorial_type`. Restituisce `{ ready: boolean, missing: string[], article_id }`. Usata da `editorial-readiness-alert` per le notifiche push proactive e potentially dal trigger di scheduling.

### 📝 Content Notes (backlog idee)
Tabella `content_notes` per raccogliere idee, appunti e bozze non ancora assegnate al piano editoriale. Stati: `note` (idea libera), `selected` (pronta da promuovere), `draft` (promossa a bozza articolo), `archived`. Campi: `title`, `body`, `pillar` (experience/practical/reflective), `pinned`, `promoted_to_article_id` (FK opzionale all'articolo creato). RLS: solo admin. La promozione crea un `logbook_articles` draft e collega la nota.

### 📊 Article scoring (5-point rubric)
Funzione `compute_article_score(uuid)` calcola un punteggio 0-2 per cinque assi, totale /10:
- **Reach**: lettori unici negli ultimi 30gg (0=<50, 1=50-500, 2=>500)
- **Read**: dwell time medio + profondità scroll (dwell>=90s AND scroll>=50%=2, either>=30s OR scroll>=30%=1)
- **React**: (likes+comments+shares)/100 lettori (>=5%=2, >=1%=1)
- **Retain**: lettori unici totali (0=<50, 1=50-200, 2=>200)
- **Lead**: click su link/CTA negli ultimi 30gg (>=10=2, >=3=1)

Eventi di tracking: `article_share_events`, `article_click_events`, `article_scroll_events`. RLS: insert pubblico (anon+auth), select admin. Le RPC `record_article_share/click/scroll` sono accessibili a `anon`/`authenticated`.

### ⛵ Voyage / segmenti di rotta
`id`, `type`, `title`, `slug`, `language`, `summary`, `date.{start,end}`, `coordinates.{departure,arrival}`, `route_association.{waypoint_count, geometry_points, route_type, status, distance, geojson_url, semantic_url}`, `entities_involved`, `linked_media`, `related_articles`, `related_waypoints`, `canonical_url`.

I riferimenti community salvano i viaggi con URL canonico `/voyages/:id--slug`; le tratte prenotabili sono salvate come snapshot `kind: "leg"` con `voyageId`, label partenza-arrivo e URL del viaggio con query `?leg=<bookable_leg_id>`.

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

Per BITE Crew, `community_posts.linked_resources` e `community_comments.linked_resources` sono array JSONB denormalizzati. Ogni item contiene almeno `kind` (`article`, `story`, `voyage`, `leg`), `id`, `label` e `href`; opzionalmente `subtitle`, `coverImage` e `voyageId`. La scelta evita dipendenze RLS/FK tra la sub-app community e tutte le superfici editoriali, pur mantenendo link espliciti verso contenuti principali. Gli autori dei post restano normalizzati in `community_post_authors`; `community_posts.author_profile_id` resta il primo autore per retrocompatibilità e ownership RLS. `community_comments` resta il thread dei post nativi Crew; i post automatici da articolo usano invece `article_comments`.

## Collegamenti
- [[15 - Semantic Layer (AI Agents)]] · [[08 - Supabase]] · [[13 - Booking Voyage]] · [[22 - Citizen Science e Osservazioni]]
