import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SITE_URL = 'https://biteproject.it'
const SITE_NAME = 'BITE'
const DEFAULT_SUMMARY =
  'BITE is a bilingual editorial project from aboard S/Y Spritz, documenting routes, slow travel, remote work, refit, and life at sea.'

type AnySupabaseClient = SupabaseClient

type Coordinates = {
  latitude: number
  longitude: number
}

type DistanceMetrics = {
  nautical_miles: number | null
  kilometers: number | null
}

type TemporalSpan = {
  start: string | null
  end: string | null
}

type LinkedEntity = {
  id: string
  type: string
  label: string
  url?: string
}

type SemanticProject = {
  id: string
  type: 'project'
  name: string
  slug: string
  language: string[]
  summary: string
  canonical_url: string
  interface_mode: 'same-origin-agent-interface'
  interface_strategy: string
  preferred_public_paths: string[]
  vessel: {
    id: string
    type: 'vessel'
    name: string
    summary: string
  }
}

type SemanticCrewRef = {
  id: string
  type: 'crew_reference'
  name: string
  slug: string
  language: string[]
  summary: string
  canonical_url: string
  avatar_url: string | null
  article_count: number
  article_urls: string[]
  machine_description: string
}

type SemanticMapAsset = {
  id: string
  type: 'map'
  map_kind: 'voyage-route' | 'article-map'
  title: string
  slug: string
  language: string[]
  summary: string
  alt_text: string
  extended_description: string
  canonical_url: string
  raw_data_url: string
  related_entity_ids: string[]
  machine_description: string
}

type SemanticMediaAsset = {
  id: string
  type: 'media_asset'
  asset_kind: 'image' | 'video' | 'file' | 'map'
  title: string
  slug: string
  language: string[]
  url: string
  mime_type: string | null
  alt_text: string
  extended_description: string
  associated_entity_ids: string[]
  canonical_source_url: string
  machine_description: string
}

type SemanticVoyage = {
  id: string
  type: 'voyage'
  title: string
  slug: string
  language: string[]
  summary: string
  date: {
    start: string | null
    end: string | null
    updated_at: string | null
  }
  coordinates: {
    departure: Coordinates | null
    arrival: Coordinates | null
  }
  route_association: {
    waypoint_count: number
    geometry_points: number
    route_type: string
    status: string
    distance: DistanceMetrics
    geojson_url: string
    semantic_url: string
  }
  tags: string[]
  entities_involved: LinkedEntity[]
  linked_media: string[]
  related_articles: string[]
  related_waypoints: string[]
  machine_description: string
  canonical_url: string
}

type SemanticWaypoint = {
  id: string
  type: 'waypoint'
  title: string
  slug: string
  language: string[]
  summary: string
  date: {
    start: string | null
    end: string | null
    event_date: string | null
    event_time: string | null
  }
  coordinates: Coordinates
  route_association: {
    voyage_id: string
    voyage_slug: string
    voyage_url: string
    sequence: number
    visibility_mode: string
    waypoint_type: string
  }
  tags: string[]
  entities_involved: LinkedEntity[]
  linked_media: string[]
  related_articles: string[]
  machine_description: string
  canonical_url: string
}

type SemanticObservation = {
  id: string
  type: 'observation'
  observation_kind: 'waypoint-note' | 'map-scene' | 'map-overlay'
  title: string
  slug: string
  language: string[]
  summary: string
  date: {
    observed_at: string | null
    source_published_at: string | null
  }
  coordinates: Coordinates
  route_association: {
    voyage_id: string | null
    article_slug: string | null
  }
  entities_involved: LinkedEntity[]
  linked_media: string[]
  related_articles: string[]
  machine_description: string
}

type SemanticArticle = {
  id: string
  type: 'article'
  title: string
  slug: string
  language: string[]
  summary: string
  date: {
    published_at: string | null
    updated_at: string | null
  }
  coordinates: Coordinates | null
  route_association: {
    voyage_id: string | null
    voyage_slug: string | null
    voyage_url: string | null
    segment_start: number | null
    segment_end: number | null
    waypoint_start_id: string | null
    waypoint_end_id: string | null
    waypoint_start_label: string | null
    waypoint_end_label: string | null
    location_name: string | null
    distance: DistanceMetrics
    temporal_span: TemporalSpan
  }
  tags: string[]
  entities_involved: LinkedEntity[]
  linked_media: string[]
  related_articles: string[]
  machine_description: string
  canonical_url: string
}

type SemanticRelationship = {
  subject: string
  predicate: string
  object: string
}

type SemanticEndpointCatalog = {
  llms: string
  sitemap: string
  semantic_index: string
  articles: string
  voyages: string
  waypoints: string
  observations: string
  refs: string
  media: string
  maps: string
  graph: string
  geo_routes: string
  geo_waypoints: string
}

type GeoFeature = {
  type: 'Feature'
  geometry: {
    type: 'Point' | 'LineString'
    coordinates: [number, number] | [number, number][]
  }
  properties: Record<string, unknown>
}

type SemanticDataset = {
  generated_at: string
  schema_version: string
  project: SemanticProject
  endpoints: SemanticEndpointCatalog
  articles: SemanticArticle[]
  voyages: SemanticVoyage[]
  waypoints: SemanticWaypoint[]
  observations: SemanticObservation[]
  refs: {
    crew: SemanticCrewRef[]
    vessels: SemanticProject['vessel'][]
  }
  media: SemanticMediaAsset[]
  maps: SemanticMapAsset[]
  relationships: SemanticRelationship[]
  geo: {
    routes: GeoFeature[]
    waypoints: GeoFeature[]
  }
}

type ArticleRow = {
  id: string
  slug: string
  title_en: string | null
  title_it: string | null
  excerpt_en: string | null
  excerpt_it: string | null
  content_en: unknown
  content_it: unknown
  cover_image: string | null
  published_at: string | null
  updated_at: string | null
  latitude: number | null
  longitude: number | null
  voyage_id: string | null
  voyage_segment_start: number | null
  voyage_segment_end: number | null
  voyage_waypoint_start_id: string | null
  voyage_waypoint_end_id: string | null
  location_name: string | null
  story_id: string | null
  category: string | null
  article_map_scenes: unknown
}

type VoyageRow = {
  id: string
  name: string
  name_en: string | null
  name_it: string | null
  slug: string
  description: string | null
  description_en: string | null
  description_it: string | null
  start_date: string | null
  end_date: string | null
  status: string
  type: string
  updated_at: string | null
  cached_geometry: unknown
}

type WaypointRow = {
  id: string
  voyage_id: string
  name: string | null
  name_en: string | null
  name_it: string | null
  description_en: string | null
  description_it: string | null
  date_start: string | null
  date_end: string | null
  event_date: string | null
  event_time: string | null
  lat: number
  lng: number
  media: unknown
  sort_order: number
  visibility_mode: string
  waypoint_type: string
}

type StoryRow = {
  id: string
  slug: string
  title_en: string | null
  title_it: string | null
}

type AuthorLinkRow = {
  article_id: string
  profile_id: string
}

type TagLinkRow = {
  article_id: string
  tag_id: string
}

type ProfileRow = {
  id: string
  name: string | null
  avatar_url: string | null
}

type TagRow = {
  id: string
  name: string
}

type ExtractedImage = {
  src: string
  alt?: string
  title?: string
  caption?: string
}

type WaypointMediaItem = {
  kind: 'image' | 'video' | 'file'
  mime_type: string | null
  name: string | null
  path: string | null
  url: string
}

type ArticleScene = {
  id: string
  title_en: string
  title_it: string
  description_en: string
  description_it: string
  latitude: number | null
  longitude: number | null
  overlays: Array<{
    id: string
    kind: string
    label_en: string
    label_it: string
    latitude: number | null
    longitude: number | null
  }>
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

const formatDate = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const nauticalMilesToKilometers = (value: number) => value * 1.852

const haversineNauticalMiles = (
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
) => {
  const earthRadiusNm = 3440.065
  const deltaLatitude = ((endLatitude - startLatitude) * Math.PI) / 180
  const deltaLongitude = ((endLongitude - startLongitude) * Math.PI) / 180
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos((startLatitude * Math.PI) / 180) *
      Math.cos((endLatitude * Math.PI) / 180) *
      Math.sin(deltaLongitude / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const buildDistanceMetricsFromWaypointCoordinates = (
  points: Array<Pick<WaypointRow, 'lat' | 'lng'>>
): DistanceMetrics => {
  if (points.length < 2) {
    return { nautical_miles: points.length === 1 ? 0 : null, kilometers: points.length === 1 ? 0 : null }
  }

  let nauticalMiles = 0
  for (let index = 1; index < points.length; index += 1) {
    nauticalMiles += haversineNauticalMiles(
      points[index - 1].lat,
      points[index - 1].lng,
      points[index].lat,
      points[index].lng
    )
  }

  return {
    nautical_miles: Number(nauticalMiles.toFixed(2)),
    kilometers: Number(nauticalMilesToKilometers(nauticalMiles).toFixed(2)),
  }
}

const buildDistanceMetricsFromLineCoordinates = (
  coordinates: [number, number][]
): DistanceMetrics => {
  if (coordinates.length < 2) {
    return { nautical_miles: coordinates.length === 1 ? 0 : null, kilometers: coordinates.length === 1 ? 0 : null }
  }

  let nauticalMiles = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const [startLongitude, startLatitude] = coordinates[index - 1]
    const [endLongitude, endLatitude] = coordinates[index]
    nauticalMiles += haversineNauticalMiles(startLatitude, startLongitude, endLatitude, endLongitude)
  }

  return {
    nautical_miles: Number(nauticalMiles.toFixed(2)),
    kilometers: Number(nauticalMilesToKilometers(nauticalMiles).toFixed(2)),
  }
}

const getWaypointEffectiveMoment = (waypoint: Pick<WaypointRow, 'event_date' | 'date_start' | 'date_end'>) =>
  formatDate(waypoint.event_date) || formatDate(waypoint.date_start) || formatDate(waypoint.date_end)

const compareNullableDates = (left: string | null, right: string | null) => {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right)
}

const buildTemporalSpanFromWaypoints = (
  points: Array<Pick<WaypointRow, 'event_date' | 'date_start' | 'date_end'>>
): TemporalSpan => {
  const timestamps = points
    .map((point) => getWaypointEffectiveMoment(point))
    .filter((value): value is string => Boolean(value))
    .sort(compareNullableDates)

  return {
    start: timestamps[0] || null,
    end: timestamps[timestamps.length - 1] || null,
  }
}

const trimOrNull = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const coalesceText = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const trimmed = trimOrNull(value)
    if (trimmed) return trimmed
  }
  return null
}

const getArticleTitle = (article: Pick<ArticleRow, 'slug' | 'title_en' | 'title_it'>) =>
  coalesceText(article.title_en, article.title_it, article.slug) || article.slug

const getVoyageTitle = (voyage: Pick<VoyageRow, 'name' | 'name_en' | 'name_it'>) =>
  coalesceText(voyage.name_en, voyage.name_it, voyage.name) || voyage.name

const getWaypointTitle = (waypoint: Pick<WaypointRow, 'name' | 'name_en' | 'name_it' | 'lat' | 'lng'>, index: number) =>
  coalesceText(
    waypoint.name_en,
    waypoint.name_it,
    waypoint.name,
    `${Math.abs(waypoint.lat).toFixed(2)}, ${Math.abs(waypoint.lng).toFixed(2)}`
  ) || `Waypoint ${index + 1}`

const getVoyagePath = (voyage: Pick<VoyageRow, 'slug'>) => `/voyages/${voyage.slug}`

const getArticleUrl = (article: Pick<ArticleRow, 'slug'>) => `${SITE_URL}/logbook/${article.slug}`
const getVoyageUrl = (voyage: Pick<VoyageRow, 'slug'>) => `${SITE_URL}${getVoyagePath(voyage)}`
const getStoryUrl = (story: Pick<StoryRow, 'slug'>) => `${SITE_URL}/logbook/story/${story.slug}`
const getProfileUrl = (profileId: string) => `${SITE_URL}/profile/${profileId}`

const buildFunctionUrl = (supabaseUrl: string, functionName: string, search = '') =>
  `${supabaseUrl}/functions/v1/${functionName}${search}`

export const buildSemanticEndpoints = (supabaseUrl: string): SemanticEndpointCatalog => ({
  llms: buildFunctionUrl(supabaseUrl, 'public-llms'),
  sitemap: buildFunctionUrl(supabaseUrl, 'public-sitemap'),
  semantic_index: buildFunctionUrl(supabaseUrl, 'public-semantic'),
  articles: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=articles'),
  voyages: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=voyages'),
  waypoints: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=waypoints'),
  observations: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=observations'),
  refs: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=refs'),
  media: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=media'),
  maps: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=maps'),
  graph: buildFunctionUrl(supabaseUrl, 'public-semantic', '?type=graph'),
  geo_routes: buildFunctionUrl(supabaseUrl, 'public-geo', '?kind=routes'),
  geo_waypoints: buildFunctionUrl(supabaseUrl, 'public-geo', '?kind=waypoints'),
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const normalizeWaypointMedia = (value: unknown): WaypointMediaItem[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const candidate = asRecord(item)
    if (!candidate) return []
    const url = trimOrNull(typeof candidate.url === 'string' ? candidate.url : null)
    if (!url) return []

    const kind = candidate.kind === 'image' || candidate.kind === 'video' ? candidate.kind : 'file'
    return [{
      kind,
      mime_type: trimOrNull(typeof candidate.mime_type === 'string' ? candidate.mime_type : null),
      name: trimOrNull(typeof candidate.name === 'string' ? candidate.name : null),
      path: trimOrNull(typeof candidate.path === 'string' ? candidate.path : null),
      url,
    }]
  })
}

const extractImagesFromContent = (content: unknown): ExtractedImage[] => {
  const images: ExtractedImage[] = []
  const seen = new Set<string>()

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    const record = asRecord(node)
    if (!record) return

    const attrs = asRecord(record.attrs)

    if (record.type === 'image' && attrs) {
      const src = trimOrNull(typeof attrs.src === 'string' ? attrs.src : null)
      if (src && !seen.has(src)) {
        seen.add(src)
        images.push({
          src,
          alt: trimOrNull(typeof attrs.alt === 'string' ? attrs.alt : null) || undefined,
          title: trimOrNull(typeof attrs.title === 'string' ? attrs.title : null) || undefined,
        })
      }
    }

    if (record.type === 'mediaFigure' && attrs && attrs.kind !== 'youtube') {
      const src = trimOrNull(typeof attrs.src === 'string' ? attrs.src : null)
      if (src && !seen.has(src)) {
        seen.add(src)
        images.push({
          src,
          alt: trimOrNull(typeof attrs.alt === 'string' ? attrs.alt : null) || undefined,
          title: trimOrNull(typeof attrs.title === 'string' ? attrs.title : null) || undefined,
          caption: trimOrNull(typeof attrs.caption === 'string' ? attrs.caption : null) || undefined,
        })
      }
    }

    for (const value of Object.values(record)) {
      visit(value)
    }
  }

  visit(content)
  return images
}

const normalizeArticleScenes = (value: unknown): ArticleScene[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry, index) => {
    const item = asRecord(entry)
    if (!item) return []

    const overlays = Array.isArray(item.overlays)
      ? item.overlays.flatMap((overlayEntry, overlayIndex) => {
          const overlay = asRecord(overlayEntry)
          if (!overlay) return []
          return [{
            id: trimOrNull(asString(overlay.id)) || `overlay-${index + 1}-${overlayIndex + 1}`,
            kind: trimOrNull(asString(overlay.kind)) || 'anchor',
            label_en: asString(overlay.label_en),
            label_it: asString(overlay.label_it),
            latitude: asNumber(overlay.latitude),
            longitude: asNumber(overlay.longitude),
          }]
        })
      : []

    return [{
      id: trimOrNull(asString(item.id)) || `scene-${index + 1}`,
      title_en: asString(item.title_en),
      title_it: asString(item.title_it),
      description_en: asString(item.description_en),
      description_it: asString(item.description_it),
      latitude: asNumber(item.latitude),
      longitude: asNumber(item.longitude),
      overlays,
    }]
  })
}

const getCachedGeometryCoordinates = (value: unknown): [number, number][] => {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.coordinates)) return []

  return record.coordinates.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return []
    const lng = asNumber(coordinate[0])
    const lat = asNumber(coordinate[1])
    if (lng == null || lat == null) return []
    return [[lng, lat] as [number, number]]
  })
}

const pushRelationship = (
  relationships: SemanticRelationship[],
  seen: Set<string>,
  subject: string,
  predicate: string,
  object: string
) => {
  const key = `${subject}|${predicate}|${object}`
  if (seen.has(key)) return
  seen.add(key)
  relationships.push({ subject, predicate, object })
}

export async function buildPublicSemanticDataset(
  supabase: AnySupabaseClient,
  supabaseUrl: string
): Promise<SemanticDataset> {
  const endpoints = buildSemanticEndpoints(supabaseUrl)

  const [articlesRes, voyagesRes, storiesRes] = await Promise.all([
    supabase
      .from('logbook_articles')
      .select('id, slug, title_en, title_it, excerpt_en, excerpt_it, content_en, content_it, cover_image, published_at, updated_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, voyage_waypoint_start_id, voyage_waypoint_end_id, location_name, story_id, category, article_map_scenes')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('voyages')
      .select('id, name, name_en, name_it, slug, description, description_en, description_it, start_date, end_date, status, type, updated_at, cached_geometry')
      .eq('is_published', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('stories')
      .select('id, slug, title_en, title_it')
      .order('updated_at', { ascending: false, nullsFirst: false }),
  ])

  if (articlesRes.error || voyagesRes.error || storiesRes.error) {
    throw new Error('Unable to read public semantic content')
  }

  const articles = (articlesRes.data || []) as ArticleRow[]
  const voyages = (voyagesRes.data || []) as VoyageRow[]
  const stories = (storiesRes.data || []) as StoryRow[]
  const voyageIds = voyages.map((voyage) => voyage.id)
  const articleIds = articles.map((article) => article.id)

  const [waypointsRes, authorLinksRes, tagLinksRes] = await Promise.all([
    voyageIds.length
      ? supabase
          .from('voyage_waypoints')
          .select('id, voyage_id, name, name_en, name_it, description_en, description_it, date_start, date_end, event_date, event_time, lat, lng, media, sort_order, visibility_mode, waypoint_type')
          .in('voyage_id', voyageIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    articleIds.length
      ? supabase.from('article_authors').select('article_id, profile_id').in('article_id', articleIds)
      : Promise.resolve({ data: [], error: null }),
    articleIds.length
      ? supabase.from('article_tags').select('article_id, tag_id').in('article_id', articleIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (waypointsRes.error || authorLinksRes.error || tagLinksRes.error) {
    throw new Error('Unable to read public semantic relationships')
  }

  const waypoints = (waypointsRes.data || []) as WaypointRow[]
  const authorLinks = (authorLinksRes.data || []) as AuthorLinkRow[]
  const tagLinks = (tagLinksRes.data || []) as TagLinkRow[]

  const profileIds = [...new Set(authorLinks.map((link) => link.profile_id))]
  const tagIds = [...new Set(tagLinks.map((link) => link.tag_id))]

  const [profilesRes, tagsRes] = await Promise.all([
    profileIds.length
      ? supabase.from('public_profiles').select('id, name, avatar_url').in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
    tagIds.length
      ? supabase.from('tags').select('id, name').in('id', tagIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (profilesRes.error || tagsRes.error) {
    throw new Error('Unable to read public semantic labels')
  }

  const profiles = (profilesRes.data || []) as ProfileRow[]
  const tags = (tagsRes.data || []) as TagRow[]

  const storyMap = new Map(stories.map((story) => [story.id, story]))
  const voyageMap = new Map(voyages.map((voyage) => [voyage.id, voyage]))
  const waypointsByVoyageId = new Map<string, WaypointRow[]>()
  const articleIdsByVoyageId = new Map<string, string[]>()
  const articleIdsByStoryId = new Map<string, string[]>()
  const articleTagsById = new Map<string, string[]>()
  const articleAuthorsById = new Map<string, ProfileRow[]>()
  const articleIdsByProfileId = new Map<string, string[]>()
  const tagMap = new Map(tags.map((tag) => [tag.id, tag.name]))
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))

  for (const waypoint of waypoints) {
    if (!waypointsByVoyageId.has(waypoint.voyage_id)) {
      waypointsByVoyageId.set(waypoint.voyage_id, [])
    }
    waypointsByVoyageId.get(waypoint.voyage_id)?.push(waypoint)
  }

  for (const link of tagLinks) {
    const tagName = tagMap.get(link.tag_id)
    if (!tagName) continue
    if (!articleTagsById.has(link.article_id)) {
      articleTagsById.set(link.article_id, [])
    }
    articleTagsById.get(link.article_id)?.push(tagName)
  }

  for (const link of authorLinks) {
    const profile = profileMap.get(link.profile_id)
    if (!profile) continue

    if (!articleAuthorsById.has(link.article_id)) {
      articleAuthorsById.set(link.article_id, [])
    }
    articleAuthorsById.get(link.article_id)?.push(profile)

    if (!articleIdsByProfileId.has(profile.id)) {
      articleIdsByProfileId.set(profile.id, [])
    }
    articleIdsByProfileId.get(profile.id)?.push(link.article_id)
  }

  for (const article of articles) {
    if (article.voyage_id) {
      if (!articleIdsByVoyageId.has(article.voyage_id)) {
        articleIdsByVoyageId.set(article.voyage_id, [])
      }
      articleIdsByVoyageId.get(article.voyage_id)?.push(article.id)
    }

    if (article.story_id) {
      if (!articleIdsByStoryId.has(article.story_id)) {
        articleIdsByStoryId.set(article.story_id, [])
      }
      articleIdsByStoryId.get(article.story_id)?.push(article.id)
    }
  }

  const project: SemanticProject = {
    id: `${SITE_URL}#project`,
    type: 'project',
    name: SITE_NAME,
    slug: 'bite',
    language: ['en', 'it'],
    summary: DEFAULT_SUMMARY,
    canonical_url: SITE_URL,
    interface_mode: 'same-origin-agent-interface',
    interface_strategy:
      'The semantic and geospatial layer should remain part of biteproject.it and act as the contact surface between the editorial site and AI user agents. It should not be published as a separate hostname or parallel site.',
    preferred_public_paths: [
      '/llms.txt',
      '/data/index.json',
      '/data/articles.json',
      '/data/voyages.json',
      '/data/waypoints.json',
      '/data/observations.json',
      '/data/maps.json',
      '/data/graph.json',
      '/data/geo/routes.geojson',
      '/data/geo/waypoints.geojson',
    ],
    vessel: {
      id: 'vessel:s-y-spritz',
      type: 'vessel',
      name: 'S/Y Spritz',
      summary: 'Primary sailing vessel and recurring geographic entity across BITE routes, logbook entries, and map narratives.',
    },
  }

  const relationships: SemanticRelationship[] = []
  const relationshipKeys = new Set<string>()

  const mediaAssets: SemanticMediaAsset[] = []
  const mediaAssetIds = new Set<string>()
  const mapAssets: SemanticMapAsset[] = []
  const semanticVoyages: SemanticVoyage[] = []
  const semanticWaypoints: SemanticWaypoint[] = []
  const semanticArticles: SemanticArticle[] = []
  const semanticObservations: SemanticObservation[] = []
  const routeFeatures: GeoFeature[] = []
  const waypointFeatures: GeoFeature[] = []

  const voyageSlugById = new Map<string, string>()
  const waypointSemanticIdById = new Map<string, string>()

  const addMediaAsset = (asset: SemanticMediaAsset) => {
    if (mediaAssetIds.has(asset.id)) return
    mediaAssetIds.add(asset.id)
    mediaAssets.push(asset)
  }

  for (const voyage of voyages) {
    const voyageTitle = getVoyageTitle(voyage)
    const voyageUrl = getVoyageUrl(voyage)
    const voyageSlug = slugify(voyageTitle)
    voyageSlugById.set(voyage.id, voyageSlug)
    const voyageWaypoints = (waypointsByVoyageId.get(voyage.id) || []).sort((a, b) => a.sort_order - b.sort_order)
    const relatedArticleIds = articleIdsByVoyageId.get(voyage.id) || []
    const geometryCoordinates =
      getCachedGeometryCoordinates(voyage.cached_geometry).length >= 2
        ? getCachedGeometryCoordinates(voyage.cached_geometry)
        : voyageWaypoints.map((waypoint) => [waypoint.lng, waypoint.lat] as [number, number])
    const routeDistance =
      geometryCoordinates.length >= 2
        ? buildDistanceMetricsFromLineCoordinates(geometryCoordinates)
        : buildDistanceMetricsFromWaypointCoordinates(voyageWaypoints)
    const departure = voyageWaypoints[0] || null
    const arrival = voyageWaypoints[voyageWaypoints.length - 1] || null
    const departureLabel = departure ? getWaypointTitle(departure, 0) : 'Unspecified departure'
    const arrivalLabel = arrival ? getWaypointTitle(arrival, voyageWaypoints.length - 1) : 'Open arrival'
    const voyageSummary =
      coalesceText(voyage.description_en, voyage.description_it, voyage.description) ||
      `${departureLabel} to ${arrivalLabel} route aboard S/Y Spritz.`
    const voyageId = `voyage:${voyage.id}`

    const mapId = `map:voyage:${voyage.id}`
    mapAssets.push({
      id: mapId,
      type: 'map',
      map_kind: 'voyage-route',
      title: `${voyageTitle} route`,
      slug: `${voyageSlug}-route`,
      language: ['en', 'it'],
      summary: `Structured route view for ${voyageTitle}.`,
      alt_text: `Route map for ${voyageTitle} showing the sailing line from ${departureLabel} to ${arrivalLabel}.`,
      extended_description:
        `${voyageTitle} route visualization with ${voyageWaypoints.length} ordered waypoint${voyageWaypoints.length === 1 ? '' : 's'}, ` +
        `${geometryCoordinates.length} route coordinate${geometryCoordinates.length === 1 ? '' : 's'}, ` +
        `and linked logbook entries for the voyage.`,
      canonical_url: voyageUrl,
      raw_data_url: `${endpoints.geo_routes}&voyage_id=${encodeURIComponent(voyage.id)}`,
      related_entity_ids: [voyageId, ...relatedArticleIds.map((id) => `article:${id}`)],
      machine_description:
        `Geo route asset for ${voyageTitle}. Use the raw data URL for line geometry and the canonical voyage page for editorial context.`,
    })

    semanticVoyages.push({
      id: voyageId,
      type: 'voyage',
      title: voyageTitle,
      slug: voyageSlug,
      language: ['en', 'it'],
      summary: voyageSummary,
      date: {
        start: formatDate(voyage.start_date),
        end: formatDate(voyage.end_date),
        updated_at: formatDate(voyage.updated_at),
      },
      coordinates: {
        departure: departure ? { latitude: departure.lat, longitude: departure.lng } : null,
        arrival: arrival ? { latitude: arrival.lat, longitude: arrival.lng } : null,
      },
      route_association: {
        waypoint_count: voyageWaypoints.length,
        geometry_points: geometryCoordinates.length,
        route_type: voyage.type,
        status: voyage.status,
        distance: routeDistance,
        geojson_url: `${endpoints.geo_routes}&voyage_id=${encodeURIComponent(voyage.id)}`,
        semantic_url: `${endpoints.voyages}&voyage_id=${encodeURIComponent(voyage.id)}`,
      },
      tags: [],
      entities_involved: [
        { id: project.id, type: 'project', label: project.name, url: project.canonical_url },
        { id: project.vessel.id, type: 'vessel', label: project.vessel.name },
      ],
      linked_media: [mapId],
      related_articles: relatedArticleIds.map((id) => `article:${id}`),
      related_waypoints: voyageWaypoints.map((waypoint) => `waypoint:${waypoint.id}`),
      machine_description:
        `${voyageTitle} is a ${voyage.type} route with ${voyageWaypoints.length} waypoint${voyageWaypoints.length === 1 ? '' : 's'} and ${relatedArticleIds.length} linked article${relatedArticleIds.length === 1 ? '' : 's'}.`,
      canonical_url: voyageUrl,
    })

    pushRelationship(relationships, relationshipKeys, project.id, 'contains', voyageId)
    pushRelationship(relationships, relationshipKeys, voyageId, 'describedBy', mapId)

    if (geometryCoordinates.length >= 2) {
      routeFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: geometryCoordinates,
        },
        properties: {
          id: voyageId,
          kind: 'voyage-route',
          title: voyageTitle,
          slug: voyageSlug,
          canonical_url: voyageUrl,
          waypoint_count: voyageWaypoints.length,
          geometry_points: geometryCoordinates.length,
          route_type: voyage.type,
          status: voyage.status,
          distance_nautical_miles: routeDistance.nautical_miles,
          distance_kilometers: routeDistance.kilometers,
          departure_label: departureLabel,
          arrival_label: arrivalLabel,
          start_date: formatDate(voyage.start_date),
          end_date: formatDate(voyage.end_date),
          related_article_ids: relatedArticleIds.map((id) => `article:${id}`),
        },
      })
    }
  }

  for (const [voyageId, voyageWaypoints] of waypointsByVoyageId.entries()) {
    const voyage = voyageMap.get(voyageId)
    if (!voyage) continue
    const voyageTitle = getVoyageTitle(voyage)
    const voyageSlug = voyageSlugById.get(voyageId) || slugify(voyageTitle)
    const voyageUrl = getVoyageUrl(voyage)
    const relatedArticleIds = articleIdsByVoyageId.get(voyageId) || []

    voyageWaypoints
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((waypoint, index) => {
        const waypointTitle = getWaypointTitle(waypoint, index)
        const waypointId = `waypoint:${waypoint.id}`
        waypointSemanticIdById.set(waypoint.id, waypointId)
        const waypointMedia = normalizeWaypointMedia(waypoint.media)
        const waypointSummary =
          coalesceText(waypoint.description_en, waypoint.description_it) ||
          `Waypoint ${index + 1} on ${voyageTitle}.`
        const relatedArticles = articles
          .filter((article) =>
            article.voyage_id === voyageId &&
            (
              article.voyage_waypoint_start_id === waypoint.id ||
              article.voyage_waypoint_end_id === waypoint.id
            )
          )
          .map((article) => `article:${article.id}`)

        semanticWaypoints.push({
          id: waypointId,
          type: 'waypoint',
          title: waypointTitle,
          slug: `${voyageSlug}-${String(index + 1).padStart(2, '0')}-${slugify(waypointTitle)}`,
          language: ['en', 'it'],
          summary: waypointSummary,
          date: {
            start: formatDate(waypoint.date_start),
            end: formatDate(waypoint.date_end),
            event_date: formatDate(waypoint.event_date),
            event_time: trimOrNull(waypoint.event_time),
          },
          coordinates: {
            latitude: waypoint.lat,
            longitude: waypoint.lng,
          },
          route_association: {
            voyage_id: `voyage:${voyageId}`,
            voyage_slug: voyageSlug,
            voyage_url: voyageUrl,
            sequence: index,
            visibility_mode: waypoint.visibility_mode,
            waypoint_type: waypoint.waypoint_type,
          },
          tags: [],
          entities_involved: [
            { id: `voyage:${voyageId}`, type: 'voyage', label: voyageTitle, url: voyageUrl },
            { id: project.vessel.id, type: 'vessel', label: project.vessel.name },
          ],
          linked_media: waypointMedia.map((item, mediaIndex) => `media:waypoint:${waypoint.id}:${mediaIndex}`),
          related_articles: relatedArticles,
          machine_description:
            `${waypointTitle} is waypoint ${index + 1} on ${voyageTitle} at ${waypoint.lat.toFixed(4)}, ${waypoint.lng.toFixed(4)}.`,
          canonical_url: voyageUrl,
        })

        pushRelationship(relationships, relationshipKeys, `voyage:${voyageId}`, 'hasWaypoint', waypointId)

        waypointFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [waypoint.lng, waypoint.lat],
          },
          properties: {
            id: waypointId,
            kind: 'voyage-waypoint',
            title: waypointTitle,
            canonical_url: voyageUrl,
            voyage_id: `voyage:${voyageId}`,
            voyage_title: voyageTitle,
            sequence: index,
            visibility_mode: waypoint.visibility_mode,
            waypoint_type: waypoint.waypoint_type,
            date_start: formatDate(waypoint.date_start),
            date_end: formatDate(waypoint.date_end),
            event_date: formatDate(waypoint.event_date),
            related_article_ids: relatedArticles,
          },
        })

        waypointMedia.forEach((item, mediaIndex) => {
          const mediaId = `media:waypoint:${waypoint.id}:${mediaIndex}`
          addMediaAsset({
            id: mediaId,
            type: 'media_asset',
            asset_kind: item.kind,
            title: item.name || `${waypointTitle} media ${mediaIndex + 1}`,
            slug: `${slugify(waypointTitle)}-${mediaIndex + 1}`,
            language: ['en', 'it'],
            url: item.url,
            mime_type: item.mime_type,
            alt_text: `Media attached to waypoint ${waypointTitle} on ${voyageTitle}.`,
            extended_description:
              `Raw waypoint media for ${waypointTitle}. Refer to the canonical voyage page and waypoint summary for narrative context.`,
            associated_entity_ids: [waypointId, `voyage:${voyageId}`],
            canonical_source_url: voyageUrl,
            machine_description:
              `Waypoint media asset for ${waypointTitle} on ${voyageTitle}.`,
          })
          pushRelationship(relationships, relationshipKeys, waypointId, 'hasMedia', mediaId)
        })

        if (trimOrNull(waypoint.description_en) || trimOrNull(waypoint.description_it) || formatDate(waypoint.event_date)) {
          semanticObservations.push({
            id: `observation:waypoint:${waypoint.id}`,
            type: 'observation',
            observation_kind: 'waypoint-note',
            title: `${waypointTitle} note`,
            slug: `${slugify(waypointTitle)}-note`,
            language: ['en', 'it'],
            summary:
              coalesceText(waypoint.description_en, waypoint.description_it) ||
              `Observation linked to waypoint ${waypointTitle}.`,
            date: {
              observed_at: formatDate(waypoint.event_date) || formatDate(waypoint.date_start) || formatDate(waypoint.date_end),
              source_published_at: null,
            },
            coordinates: {
              latitude: waypoint.lat,
              longitude: waypoint.lng,
            },
            route_association: {
              voyage_id: `voyage:${voyageId}`,
              article_slug: null,
            },
            entities_involved: [
              { id: waypointId, type: 'waypoint', label: waypointTitle, url: voyageUrl },
              { id: `voyage:${voyageId}`, type: 'voyage', label: voyageTitle, url: voyageUrl },
            ],
            linked_media: waypointMedia.map((_, mediaIndex) => `media:waypoint:${waypoint.id}:${mediaIndex}`),
            related_articles: relatedArticles,
            machine_description:
              `Waypoint observation located at ${waypointTitle} on ${voyageTitle}.`,
          })
          pushRelationship(relationships, relationshipKeys, waypointId, 'documents', `observation:waypoint:${waypoint.id}`)
        }
      })
  }

  const articleTitleById = new Map(articles.map((article) => [article.id, getArticleTitle(article)]))

  for (const article of articles) {
    const articleId = `article:${article.id}`
    const articleTitle = getArticleTitle(article)
    const articleUrl = getArticleUrl(article)
    const story = article.story_id ? storyMap.get(article.story_id) : null
    const voyage = article.voyage_id ? voyageMap.get(article.voyage_id) : null
    const voyageTitle = voyage ? getVoyageTitle(voyage) : null
    const voyageUrl = voyage ? getVoyageUrl(voyage) : null
    const voyageSlug = article.voyage_id ? voyageSlugById.get(article.voyage_id) || null : null
    const relatedArticles = new Set<string>()
    const articleTags = [...new Set(articleTagsById.get(article.id) || [])]
    const authors = articleAuthorsById.get(article.id) || []
    const images = [
      ...extractImagesFromContent(article.content_en),
      ...extractImagesFromContent(article.content_it),
    ]
    const articleScenes = normalizeArticleScenes(article.article_map_scenes)
    const articleMediaIds: string[] = []
    const articleVoyageWaypoints = article.voyage_id
      ? (waypointsByVoyageId.get(article.voyage_id) || []).sort((left, right) => left.sort_order - right.sort_order)
      : []
    const explicitStartWaypointIndex = article.voyage_waypoint_start_id
      ? articleVoyageWaypoints.findIndex((waypoint) => waypoint.id === article.voyage_waypoint_start_id)
      : -1
    const explicitEndWaypointIndex = article.voyage_waypoint_end_id
      ? articleVoyageWaypoints.findIndex((waypoint) => waypoint.id === article.voyage_waypoint_end_id)
      : -1
    const fallbackSegmentStart = article.voyage_segment_start ?? article.voyage_segment_end
    const fallbackSegmentEnd = article.voyage_segment_end ?? article.voyage_segment_start
    const rawSegmentStartIndex = explicitStartWaypointIndex >= 0 ? explicitStartWaypointIndex : fallbackSegmentStart
    const rawSegmentEndIndex = explicitEndWaypointIndex >= 0 ? explicitEndWaypointIndex : fallbackSegmentEnd
    const normalizedSegmentStartIndex =
      rawSegmentStartIndex != null && articleVoyageWaypoints.length > 0
        ? Math.max(0, Math.min(rawSegmentStartIndex, articleVoyageWaypoints.length - 1))
        : null
    const normalizedSegmentEndIndex =
      rawSegmentEndIndex != null && articleVoyageWaypoints.length > 0
        ? Math.max(0, Math.min(rawSegmentEndIndex, articleVoyageWaypoints.length - 1))
        : normalizedSegmentStartIndex
    const hasSegmentRange = normalizedSegmentStartIndex != null && normalizedSegmentEndIndex != null
    const segmentStartIndex =
      hasSegmentRange ? Math.min(normalizedSegmentStartIndex as number, normalizedSegmentEndIndex as number) : null
    const segmentEndIndex =
      hasSegmentRange ? Math.max(normalizedSegmentStartIndex as number, normalizedSegmentEndIndex as number) : null
    const articleSegmentWaypoints =
      segmentStartIndex != null && segmentEndIndex != null
        ? articleVoyageWaypoints.slice(segmentStartIndex, segmentEndIndex + 1)
        : []
    const segmentDistance = buildDistanceMetricsFromWaypointCoordinates(articleSegmentWaypoints)
    const segmentTemporalSpan = buildTemporalSpanFromWaypoints(articleSegmentWaypoints)
    const startWaypoint = articleSegmentWaypoints[0] || null
    const endWaypoint = articleSegmentWaypoints[articleSegmentWaypoints.length - 1] || null

    if (article.story_id) {
      for (const siblingId of articleIdsByStoryId.get(article.story_id) || []) {
        if (siblingId !== article.id) relatedArticles.add(`article:${siblingId}`)
      }
    }

    if (article.voyage_id) {
      for (const siblingId of articleIdsByVoyageId.get(article.voyage_id) || []) {
        if (siblingId !== article.id) relatedArticles.add(`article:${siblingId}`)
      }
    }

    if (article.cover_image) {
      const mediaId = `media:article:${article.id}:cover`
      articleMediaIds.push(mediaId)
      addMediaAsset({
        id: mediaId,
        type: 'media_asset',
        asset_kind: 'image',
        title: `${articleTitle} cover image`,
        slug: `${article.slug}-cover`,
        language: ['en', 'it'],
        url: article.cover_image,
        mime_type: null,
        alt_text: `Cover image for the BITE article ${articleTitle}.`,
        extended_description:
          `Primary cover image associated with the article ${articleTitle}. Use the article page for editorial interpretation.`,
        associated_entity_ids: [articleId],
        canonical_source_url: articleUrl,
        machine_description:
          `Primary article cover image for ${articleTitle}.`,
      })
      pushRelationship(relationships, relationshipKeys, articleId, 'hasMedia', mediaId)
    }

    images.forEach((image, imageIndex) => {
      const mediaId = `media:article:${article.id}:inline:${imageIndex}`
      articleMediaIds.push(mediaId)
      addMediaAsset({
        id: mediaId,
        type: 'media_asset',
        asset_kind: 'image',
        title: image.title || image.caption || `${articleTitle} image ${imageIndex + 1}`,
        slug: `${article.slug}-image-${imageIndex + 1}`,
        language: ['en', 'it'],
        url: image.src,
        mime_type: null,
        alt_text: image.alt || image.caption || `Inline image from the BITE article ${articleTitle}.`,
        extended_description:
          image.caption ||
          `Inline image extracted from ${articleTitle}. Read the surrounding article copy before inferring specific claims.`,
        associated_entity_ids: [articleId],
        canonical_source_url: articleUrl,
        machine_description:
          `Inline image asset extracted from ${articleTitle}.`,
      })
      pushRelationship(relationships, relationshipKeys, articleId, 'hasMedia', mediaId)
    })

    if (articleScenes.length > 0) {
      const mapId = `map:article:${article.id}`
      articleMediaIds.push(mapId)
      mapAssets.push({
        id: mapId,
        type: 'map',
        map_kind: 'article-map',
        title: `${articleTitle} map scenes`,
        slug: `${article.slug}-map`,
        language: ['en', 'it'],
        summary: `Map scene metadata for the article ${articleTitle}.`,
        alt_text: `Map scenes for the article ${articleTitle}, with anchored geographic viewpoints and overlays where available.`,
        extended_description:
          `${articleTitle} contains ${articleScenes.length} map scene${articleScenes.length === 1 ? '' : 's'} with explicit coordinates or overlays. ` +
          `Use the semantic endpoint for scene-level observations and the canonical article page for narrative context.`,
        canonical_url: articleUrl,
        raw_data_url: `${endpoints.articles}&slug=${encodeURIComponent(article.slug)}`,
        related_entity_ids: [articleId, ...(article.voyage_id ? [`voyage:${article.voyage_id}`] : [])],
        machine_description:
          `Structured article map asset for ${articleTitle}.`,
      })
      pushRelationship(relationships, relationshipKeys, articleId, 'describedBy', mapId)

      articleScenes.forEach((scene, sceneIndex) => {
        if (scene.latitude == null || scene.longitude == null) return

        const observationId = `observation:article-scene:${article.id}:${scene.id}`
        semanticObservations.push({
          id: observationId,
          type: 'observation',
          observation_kind: 'map-scene',
          title:
            coalesceText(scene.title_en, scene.title_it) ||
            `${articleTitle} scene ${sceneIndex + 1}`,
          slug: `${article.slug}-scene-${sceneIndex + 1}`,
          language: ['en', 'it'],
          summary:
            coalesceText(scene.description_en, scene.description_it) ||
            `Map scene ${sceneIndex + 1} from ${articleTitle}.`,
          date: {
            observed_at: null,
            source_published_at: formatDate(article.published_at),
          },
          coordinates: {
            latitude: scene.latitude,
            longitude: scene.longitude,
          },
          route_association: {
            voyage_id: article.voyage_id ? `voyage:${article.voyage_id}` : null,
            article_slug: article.slug,
          },
          entities_involved: [
            { id: articleId, type: 'article', label: articleTitle, url: articleUrl },
            ...(voyage && voyageUrl ? [{ id: `voyage:${voyage.id}`, type: 'voyage', label: getVoyageTitle(voyage), url: voyageUrl }] : []),
          ],
          linked_media: [],
          related_articles: [articleId],
          machine_description:
            `Article map scene observation for ${articleTitle}.`,
        })
        pushRelationship(relationships, relationshipKeys, articleId, 'documents', observationId)

        scene.overlays.forEach((overlay, overlayIndex) => {
          if (overlay.latitude == null || overlay.longitude == null) return

          const overlayLabel =
            coalesceText(overlay.label_en, overlay.label_it) ||
            `${overlay.kind} overlay ${overlayIndex + 1}`

          const overlayObservationId = `observation:article-overlay:${article.id}:${overlay.id}`
          semanticObservations.push({
            id: overlayObservationId,
            type: 'observation',
            observation_kind: 'map-overlay',
            title: overlayLabel,
            slug: `${article.slug}-${slugify(overlayLabel)}`,
            language: ['en', 'it'],
            summary: `Map overlay of type ${overlay.kind} from the article ${articleTitle}.`,
            date: {
              observed_at: null,
              source_published_at: formatDate(article.published_at),
            },
            coordinates: {
              latitude: overlay.latitude,
              longitude: overlay.longitude,
            },
            route_association: {
              voyage_id: article.voyage_id ? `voyage:${article.voyage_id}` : null,
              article_slug: article.slug,
            },
            entities_involved: [
              { id: articleId, type: 'article', label: articleTitle, url: articleUrl },
            ],
            linked_media: [],
            related_articles: [articleId],
            machine_description:
              `Article map overlay observation for ${articleTitle}.`,
          })
          pushRelationship(relationships, relationshipKeys, articleId, 'documents', overlayObservationId)
        })
      })
    }

    const articleSummary =
      coalesceText(article.excerpt_en, article.excerpt_it) ||
      `${articleTitle} is a BITE logbook entry${article.location_name ? ` located near ${article.location_name}` : ''}.`

    semanticArticles.push({
      id: articleId,
      type: 'article',
      title: articleTitle,
      slug: article.slug,
      language: ['en', 'it'],
      summary: articleSummary,
      date: {
        published_at: formatDate(article.published_at),
        updated_at: formatDate(article.updated_at),
      },
      coordinates:
        article.latitude != null && article.longitude != null
          ? { latitude: article.latitude, longitude: article.longitude }
          : null,
      route_association: {
        voyage_id: article.voyage_id ? `voyage:${article.voyage_id}` : null,
        voyage_slug: voyageSlug,
        voyage_url: voyageUrl,
        segment_start: article.voyage_segment_start,
        segment_end: article.voyage_segment_end,
        waypoint_start_id: article.voyage_waypoint_start_id ? waypointSemanticIdById.get(article.voyage_waypoint_start_id) || `waypoint:${article.voyage_waypoint_start_id}` : null,
        waypoint_end_id: article.voyage_waypoint_end_id ? waypointSemanticIdById.get(article.voyage_waypoint_end_id) || `waypoint:${article.voyage_waypoint_end_id}` : null,
        waypoint_start_label: startWaypoint ? getWaypointTitle(startWaypoint, segmentStartIndex || 0) : null,
        waypoint_end_label: endWaypoint ? getWaypointTitle(endWaypoint, segmentEndIndex || 0) : null,
        location_name: trimOrNull(article.location_name),
        distance: segmentDistance,
        temporal_span: segmentTemporalSpan,
      },
      tags: articleTags,
      entities_involved: [
        { id: project.id, type: 'project', label: project.name, url: project.canonical_url },
        { id: project.vessel.id, type: 'vessel', label: project.vessel.name },
        ...authors.map((author) => ({
          id: `crew:${author.id}`,
          type: 'crew_reference',
          label: author.name || 'BITE crew',
          url: getProfileUrl(author.id),
        })),
        ...(story ? [{
          id: `story:${story.id}`,
          type: 'story',
          label: coalesceText(story.title_en, story.title_it, story.slug) || story.slug,
          url: getStoryUrl(story),
        }] : []),
        ...(voyage && voyageUrl ? [{
          id: `voyage:${voyage.id}`,
          type: 'voyage',
          label: voyageTitle || getVoyageTitle(voyage),
          url: voyageUrl,
        }] : []),
      ],
      linked_media: articleMediaIds,
      related_articles: [...relatedArticles],
      machine_description:
        `${articleTitle} is a bilingual BITE article${voyageTitle ? ` linked to the voyage ${voyageTitle}` : ''}${article.location_name ? ` near ${article.location_name}` : ''}` +
        `${segmentDistance.kilometers != null ? ` with a linked route segment of ${segmentDistance.kilometers} km` : ''}.`,
      canonical_url: articleUrl,
    })

    pushRelationship(relationships, relationshipKeys, project.id, 'contains', articleId)
    if (article.voyage_id) pushRelationship(relationships, relationshipKeys, articleId, 'aboutVoyage', `voyage:${article.voyage_id}`)
    if (article.voyage_waypoint_start_id) {
      pushRelationship(
        relationships,
        relationshipKeys,
        articleId,
        'startsAtWaypoint',
        waypointSemanticIdById.get(article.voyage_waypoint_start_id) || `waypoint:${article.voyage_waypoint_start_id}`
      )
    }
    if (article.voyage_waypoint_end_id) {
      pushRelationship(
        relationships,
        relationshipKeys,
        articleId,
        'endsAtWaypoint',
        waypointSemanticIdById.get(article.voyage_waypoint_end_id) || `waypoint:${article.voyage_waypoint_end_id}`
      )
    }
    if (story) pushRelationship(relationships, relationshipKeys, articleId, 'partOfStory', `story:${story.id}`)
    authors.forEach((author) => pushRelationship(relationships, relationshipKeys, `crew:${author.id}`, 'authored', articleId))
  }

  const crewRefs: SemanticCrewRef[] = profiles
    .filter((profile) => articleIdsByProfileId.has(profile.id))
    .map((profile) => {
      const authoredArticleIds = articleIdsByProfileId.get(profile.id) || []
      const authoredArticleUrls = authoredArticleIds
        .map((articleId) => {
          const article = articles.find((entry) => entry.id === articleId)
          return article ? getArticleUrl(article) : null
        })
        .filter((value): value is string => Boolean(value))
      const name = trimOrNull(profile.name) || 'BITE crew'
      const refId = `crew:${profile.id}`
      pushRelationship(relationships, relationshipKeys, project.id, 'hasContributor', refId)

      return {
        id: refId,
        type: 'crew_reference',
        name,
        slug: slugify(name),
        language: ['en', 'it'],
        summary: `${name} is a public contributor reference derived from published BITE articles.`,
        canonical_url: getProfileUrl(profile.id),
        avatar_url: profile.avatar_url,
        article_count: authoredArticleIds.length,
        article_urls: authoredArticleUrls,
        machine_description:
          `${name} appears as a credited public contributor on ${authoredArticleIds.length} published BITE article${authoredArticleIds.length === 1 ? '' : 's'}.`,
      }
    })

  crewRefs.sort((left, right) => right.article_count - left.article_count || left.name.localeCompare(right.name))
  semanticArticles.sort((left, right) => (right.date.published_at || '').localeCompare(left.date.published_at || ''))
  semanticObservations.sort((left, right) => (right.date.source_published_at || right.date.observed_at || '').localeCompare(left.date.source_published_at || left.date.observed_at || ''))

  return {
    generated_at: new Date().toISOString(),
    schema_version: '2026-04-11',
    project,
    endpoints,
    articles: semanticArticles,
    voyages: semanticVoyages,
    waypoints: semanticWaypoints,
    observations: semanticObservations,
    refs: {
      crew: crewRefs,
      vessels: [project.vessel],
    },
    media: mediaAssets,
    maps: mapAssets,
    relationships,
    geo: {
      routes: routeFeatures,
      waypoints: waypointFeatures,
    },
  }
}

export const buildSemanticIndexResponse = (dataset: SemanticDataset) => ({
  generated_at: dataset.generated_at,
  schema_version: dataset.schema_version,
  project: dataset.project,
  counts: {
    articles: dataset.articles.length,
    voyages: dataset.voyages.length,
    waypoints: dataset.waypoints.length,
    observations: dataset.observations.length,
    crew_references: dataset.refs.crew.length,
    media_assets: dataset.media.length,
    maps: dataset.maps.length,
    relationships: dataset.relationships.length,
  },
  endpoints: dataset.endpoints,
  collections: [
    { key: 'articles', url: dataset.endpoints.articles, count: dataset.articles.length },
    { key: 'voyages', url: dataset.endpoints.voyages, count: dataset.voyages.length },
    { key: 'waypoints', url: dataset.endpoints.waypoints, count: dataset.waypoints.length },
    { key: 'observations', url: dataset.endpoints.observations, count: dataset.observations.length },
    { key: 'refs', url: dataset.endpoints.refs, count: dataset.refs.crew.length + dataset.refs.vessels.length },
    { key: 'media', url: dataset.endpoints.media, count: dataset.media.length },
    { key: 'maps', url: dataset.endpoints.maps, count: dataset.maps.length },
    { key: 'graph', url: dataset.endpoints.graph, count: dataset.relationships.length },
  ],
  featured: {
    recent_articles: dataset.articles.slice(0, 5).map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      canonical_url: article.canonical_url,
      distance_kilometers: article.route_association.distance.kilometers,
      temporal_span: article.route_association.temporal_span,
    })),
    voyages: dataset.voyages.slice(0, 5).map((voyage) => ({
      id: voyage.id,
      title: voyage.title,
      summary: voyage.summary,
      canonical_url: voyage.canonical_url,
      geojson_url: voyage.route_association.geojson_url,
      distance_kilometers: voyage.route_association.distance.kilometers,
      distance_nautical_miles: voyage.route_association.distance.nautical_miles,
    })),
  },
})

export const filterSemanticItems = <T extends Record<string, unknown>>(
  items: T[],
  searchParams: URLSearchParams,
  options?: {
    slugKey?: keyof T
    voyageKey?: keyof T
  }
) => {
  let filtered = items
  const slug = trimOrNull(searchParams.get('slug'))
  const voyageId = trimOrNull(searchParams.get('voyage_id'))
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw) || items.length, 200)) : null

  if (slug && options?.slugKey) {
    const sk = options.slugKey as string
    filtered = filtered.filter((item) => (item as Record<string, unknown>)[sk] === slug)
  }

  if (voyageId && options?.voyageKey) {
    const vk = options.voyageKey as string
    filtered = filtered.filter((item) => (item as Record<string, unknown>)[vk] === voyageId || (item as Record<string, unknown>)[vk] === `voyage:${voyageId}`)
  }

  return limit ? filtered.slice(0, limit) : filtered
}
