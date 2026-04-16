# BITE Semantic And Geospatial Interface Layer

## Positioning

The main `biteproject.it` website remains the editorial experience for humans.

The companion layer is an internal technical interface that exposes structure already present in the project:

- content metadata
- voyage and waypoint relationships
- geospatial route data
- semantic links between places, articles, crew references, maps, and media
- machine-readable access for crawlers, agents, and public research use

This is not a second editorial website and not an "AI landing page".

## Domain strategy

No separate hostname.

Reason:

- This layer should function as the contact interface between `biteproject.it` and AI user agents that search within it.
- It should not read as a second website, product surface, or standalone archive.
- Keeping it same-origin preserves the primacy of the editorial site and makes the semantic layer a retrieval surface, not a parallel brand.
- The clean target shape is `biteproject.it/llms.txt` plus same-origin JSON and GeoJSON endpoints under a stable path such as `/data/`.

Current implementation in this repo does not change the human-facing UI. It exposes the same structure through Supabase public functions and uses the dynamic LLM feed as the discovery surface until same-origin routing is mounted on the main site.

## Sitemap

Human-facing site:

- `/`
- `/logbook`
- `/logbook/:slug`
- `/logbook/story/:slug`
- `/voyages`
- `/voyages/:id--slug`
- `/crew`
- `/manifesto`
- `/collaborations`
- `/contact`

Technical interface layer, recommended on the main domain:

- `/llms.txt`
- `/data/index.json`
- `/data/articles.json`
- `/data/voyages.json`
- `/data/waypoints.json`
- `/data/observations.json`
- `/data/refs.json`
- `/data/media.json`
- `/data/maps.json`
- `/data/graph.json`
- `/data/geo/routes.geojson`
- `/data/geo/waypoints.geojson`

Current public implementation through Supabase functions, as an implementation detail:

- `/functions/v1/public-llms`
- `/functions/v1/public-semantic`
- `/functions/v1/public-geo`
- `/functions/v1/public-sitemap`

## Content model

### Articles / logbook entries

Fields:

- `id`
- `type`
- `title`
- `slug`
- `language`
- `summary`
- `date.published_at`
- `date.updated_at`
- `coordinates`
- `route_association.voyage_id`
- `route_association.segment_start`
- `route_association.segment_end`
- `route_association.waypoint_start_id`
- `route_association.waypoint_end_id`
- `route_association.location_name`
- `tags`
- `entities_involved`
- `linked_media`
- `related_articles`
- `machine_description`
- `canonical_url`

### Voyages / route segments

Fields:

- `id`
- `type`
- `title`
- `slug`
- `language`
- `summary`
- `date.start`
- `date.end`
- `coordinates.departure`
- `coordinates.arrival`
- `route_association.waypoint_count`
- `route_association.geometry_points`
- `route_association.route_type`
- `route_association.status`
- `route_association.geojson_url`
- `route_association.semantic_url`
- `entities_involved`
- `linked_media`
- `related_articles`
- `related_waypoints`
- `machine_description`
- `canonical_url`

### Waypoints / stops

Fields:

- `id`
- `type`
- `title`
- `slug`
- `language`
- `summary`
- `date.start`
- `date.end`
- `date.event_date`
- `date.event_time`
- `coordinates`
- `route_association.voyage_id`
- `route_association.sequence`
- `route_association.visibility_mode`
- `route_association.waypoint_type`
- `entities_involved`
- `linked_media`
- `related_articles`
- `machine_description`
- `canonical_url`

### Observations / collected data points

Current practical definition:

- waypoint notes with coordinates and dates
- article map scenes with explicit coordinates
- article map overlays with explicit coordinates

Fields:

- `id`
- `type`
- `observation_kind`
- `title`
- `slug`
- `language`
- `summary`
- `date.observed_at`
- `date.source_published_at`
- `coordinates`
- `route_association.voyage_id`
- `route_association.article_slug`
- `entities_involved`
- `linked_media`
- `related_articles`
- `machine_description`

### Crew / vessel references

Fields:

- `id`
- `type`
- `name`
- `slug`
- `language`
- `summary`
- `canonical_url`
- `avatar_url`
- `article_count`
- `article_urls`
- `machine_description`

Vessel reference:

- `id: vessel:s-y-spritz`
- `type: vessel`
- `name: S/Y Spritz`

### Media assets

Fields:

- `id`
- `type`
- `asset_kind`
- `title`
- `slug`
- `language`
- `url`
- `mime_type`
- `alt_text`
- `extended_description`
- `associated_entity_ids`
- `canonical_source_url`
- `machine_description`

### Maps and route visualizations

Fields:

- `id`
- `type`
- `map_kind`
- `title`
- `slug`
- `language`
- `summary`
- `alt_text`
- `extended_description`
- `canonical_url`
- `raw_data_url`
- `related_entity_ids`
- `machine_description`

## Geospatial layer

Principles:

- A route map must never exist only as a rendered image.
- Every published route should have raw coordinates.
- Waypoints must be first-class geographic objects.
- Route-to-article and waypoint-to-article links must be explicit.

Current outputs:

- `public-geo?kind=routes` returns route `LineString` features
- `public-geo?kind=waypoints` returns waypoint `Point` features
- `voyage_id` filters are supported on both

GeoJSON route properties:

- `id`
- `kind`
- `title`
- `slug`
- `canonical_url`
- `waypoint_count`
- `geometry_points`
- `route_type`
- `status`
- `departure_label`
- `arrival_label`
- `start_date`
- `end_date`
- `related_article_ids`

GeoJSON waypoint properties:

- `id`
- `kind`
- `title`
- `canonical_url`
- `voyage_id`
- `voyage_title`
- `sequence`
- `visibility_mode`
- `waypoint_type`
- `date_start`
- `date_end`
- `event_date`
- `related_article_ids`

## Metadata strategy

Keep using:

- canonical editorial URLs on the main site
- existing JSON-LD on human pages
- `llms.txt` as discovery, not as the only data source

Add through the interface layer:

- stable semantic IDs
- explicit relationship graph JSON
- deterministic machine descriptions
- meaningful alt text and extended descriptions for images and maps
- raw geospatial access through GeoJSON

## Sample objects

### Voyage

```json
{
  "id": "voyage:abc123",
  "type": "voyage",
  "title": "Northern Passage",
  "slug": "northern-passage",
  "language": ["en", "it"],
  "summary": "Structured route record for the voyage from Tromso to Senja.",
  "route_association": {
    "waypoint_count": 8,
    "geometry_points": 142,
    "route_type": "sea",
    "status": "completed",
    "geojson_url": "https://.../functions/v1/public-geo?kind=routes&voyage_id=abc123",
    "semantic_url": "https://.../functions/v1/public-semantic?type=voyages&voyage_id=abc123"
  },
  "canonical_url": "https://biteproject.it/voyages/abc123--northern-passage"
}
```

### Waypoint

```json
{
  "id": "waypoint:def456",
  "type": "waypoint",
  "title": "Senja Anchorage",
  "coordinates": {
    "latitude": 69.1234,
    "longitude": 17.5678
  },
  "route_association": {
    "voyage_id": "voyage:abc123",
    "sequence": 3,
    "visibility_mode": "manual",
    "waypoint_type": "narrative"
  },
  "related_articles": ["article:ghi789"]
}
```

### Map

```json
{
  "id": "map:voyage:abc123",
  "type": "map",
  "map_kind": "voyage-route",
  "title": "Northern Passage route",
  "alt_text": "Route map for Northern Passage showing the sailing line from Tromso to Senja.",
  "extended_description": "Structured route map with ordered waypoints and raw GeoJSON access.",
  "raw_data_url": "https://.../functions/v1/public-geo?kind=routes&voyage_id=abc123"
}
```

## UI direction for a future same-origin interface surface

This is a later-phase public interface mounted inside the main domain, not part of the current repo change.

Page/component list:

- `DataIndexPage`
- `CollectionSummaryCards`
- `RouteArchiveTable`
- `WaypointDirectory`
- `MapAssetCards`
- `RelationshipGraphView`
- `JSONPreviewPanel`
- `GeoJSONDownloadActions`
- `EntityLinkBadges`

Visual direction:

- neutral palette, slightly warm or maritime, no startup gradients
- strong typography and clear density
- map views treated as research instruments
- layout based on cards, tables, and precise labels
- editorial restraint, not dashboard theater

## Endpoint list

Implemented now:

- `public-llms`
- `public-semantic`
- `public-geo`
- `public-sitemap`

Recommended stable vanity paths later:

- `biteproject.it/llms.txt`
- `biteproject.it/data/index.json`
- `biteproject.it/data/articles.json`
- `biteproject.it/data/voyages.json`
- `biteproject.it/data/waypoints.json`
- `biteproject.it/data/observations.json`
- `biteproject.it/data/refs.json`
- `biteproject.it/data/media.json`
- `biteproject.it/data/maps.json`
- `biteproject.it/data/graph.json`
- `biteproject.it/data/geo/routes.geojson`
- `biteproject.it/data/geo/waypoints.geojson`

## Stack recommendation

Lean, realistic stack:

- Lovable or custom React frontend for the editorial site
- Supabase Postgres as the primary content and route store
- Supabase Edge Functions for public machine-readable endpoints
- MapLibre for rendered route maps
- GeoJSON as the primary exchange format for maps
- JSON discovery documents for semantic access

Why this stack:

- It reuses the data already present in the project.
- It avoids standing up a second application too early.
- It keeps the machine layer public, cacheable, and maintainable.
- It keeps discovery and retrieval anchored to the same editorial domain.

## Phasing

### Phase 1: MVP

- semantic discovery index
- GeoJSON routes and waypoints
- stronger `llms.txt` discovery feed
- article, voyage, waypoint, media, map, and ref objects

### Phase 2: Improved semantic layer

- same-origin routing on `biteproject.it/data/*`
- richer relationship graph browsing
- more explicit bilingual field exposure
- GPX export where route quality supports it
- better media-level descriptions and provenance

### Phase 3: Advanced agent-facing functionality

- retrieval-oriented query endpoint with strict, documented filters
- entity search across routes, places, tags, and article summaries
- versioned schema docs
- optional signed snapshot exports for research reuse

## Guardrails

- do not mirror full article bodies into the interface layer
- do not create fake scientific metadata
- do not invent observations that are not grounded in stored coordinates or descriptions
- do not replace the editorial reading experience
- do not make the archive useful only for AI; it must also serve public research and technical transparency
