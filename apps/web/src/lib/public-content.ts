import { supabase } from "@/integrations/supabase/client";
import type { GeoArticle, Voyage, VoyageWaypoint } from "@/lib/voyage-utils";

export interface HeroMedia {
  kind: "video";
  src: string;
  alt: string;
  poster?: string;
  mimeType?: string;
}

export interface HomepageHeroVideoPool {
  desktop: HeroMedia[];
  mobile: HeroMedia[];
}

export interface HomepageHeroImagePool {
  desktop: string[];
  mobile: string[];
}

export interface HeroVideoPoolVersion {
  desktopSources: string[];
  mobileSources: string[];
}

export interface PublicContentArticle extends GeoArticle {
  category: string | null;
  story_id: string | null;
}

export interface PublicContentVersion {
  articlesCount: number;
  articlesUpdatedAt: string | null;
  voyagesCount: number;
  voyagesUpdatedAt: string | null;
  voyageWaypointsCount: number;
  voyageWaypointsUpdatedAt: string | null;
}

export interface PublicContentSnapshot {
  generatedAt: string;
  version: PublicContentVersion;
  heroVideoVersion: HeroVideoPoolVersion;
  heroVideoPool: HomepageHeroVideoPool;
  heroImagePool: HomepageHeroImagePool;
  articles: PublicContentArticle[];
  voyages: Voyage[];
  voyageWaypoints: VoyageWaypoint[];
}

type StorageListItem = {
  name: string;
};

const HOMEPAGE_MEDIA_BUCKET = "homepage-media";
const HOMEPAGE_HORIZONTAL_FOLDER = "hero-horizontal";
const HOMEPAGE_VERTICAL_FOLDER = "hero-vertical";
const SUPPORTED_HERO_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "m4v", "mov"]);
const SUPPORTED_HERO_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

const getVideoMimeType = (filename: string) => {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return "video/mp4";
};

const createStorageImageUrls = (folder: string, files: StorageListItem[]): string[] =>
  files
    .filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return Boolean(extension && SUPPORTED_HERO_IMAGE_EXTENSIONS.has(extension));
    })
    .map((file) => {
      const path = `${folder}/${file.name}`;
      const { data } = supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    });

const createStorageVideoEntries = (folder: string, files: StorageListItem[], alt: string): HeroMedia[] =>
  files
    .filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return Boolean(extension && SUPPORTED_HERO_VIDEO_EXTENSIONS.has(extension));
    })
    .map((file) => {
      const path = `${folder}/${file.name}`;
      const { data } = supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).getPublicUrl(path);

      return {
        kind: "video",
        src: data.publicUrl,
        alt,
        mimeType: getVideoMimeType(file.name),
      };
    });


const fetchHeroMediaPools = async (): Promise<{
  videoPool: HomepageHeroVideoPool;
  imagePool: HomepageHeroImagePool;
}> => {
  try {
    const [desktopResult, mobileResult] = await Promise.all([
      supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_HORIZONTAL_FOLDER, {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      }),
      supabase.storage.from(HOMEPAGE_MEDIA_BUCKET).list(HOMEPAGE_VERTICAL_FOLDER, {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      }),
    ]);

    if (desktopResult.error && mobileResult.error) {
      throw desktopResult.error;
    }

    const desktopFiles = (desktopResult.data ?? []) as StorageListItem[];
    const mobileFiles = (mobileResult.data ?? []) as StorageListItem[];

    return {
      videoPool: {
        desktop: createStorageVideoEntries(
          HOMEPAGE_HORIZONTAL_FOLDER,
          desktopFiles,
          "Spritz sailing footage for the desktop hero"
        ),
        mobile: createStorageVideoEntries(
          HOMEPAGE_VERTICAL_FOLDER,
          mobileFiles,
          "Spritz sailing footage for the mobile hero"
        ),
      },
      imagePool: {
        desktop: createStorageImageUrls(HOMEPAGE_HORIZONTAL_FOLDER, desktopFiles),
        mobile: createStorageImageUrls(HOMEPAGE_VERTICAL_FOLDER, mobileFiles),
      },
    };
  } catch {
    return {
      videoPool: { desktop: [], mobile: [] },
      imagePool: { desktop: [], mobile: [] },
    };
  }
};

const fetchHeroVideoPool = async (): Promise<HomepageHeroVideoPool> =>
  (await fetchHeroMediaPools()).videoPool;

export const buildHeroVideoPoolVersion = (pool: HomepageHeroVideoPool): HeroVideoPoolVersion => ({
  desktopSources: pool.desktop.map((media) => media.src).sort(),
  mobileSources: pool.mobile.map((media) => media.src).sort(),
});

export const isHeroVideoPoolVersionEqual = (
  left: HeroVideoPoolVersion | null | undefined,
  right: HeroVideoPoolVersion | null | undefined
) => (
  !!left
  && !!right
  && left.desktopSources.length === right.desktopSources.length
  && left.mobileSources.length === right.mobileSources.length
  && left.desktopSources.every((src, index) => src === right.desktopSources[index])
  && left.mobileSources.every((src, index) => src === right.mobileSources[index])
);

export async function fetchHeroVideoPoolVersion(): Promise<HeroVideoPoolVersion> {
  const heroVideoPool = await fetchHeroVideoPool();
  return buildHeroVideoPoolVersion(heroVideoPool);
}

const getLatestTimestamp = (values: Array<string | null | undefined>) =>
  values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
  }, null);

const buildPublicContentVersion = ({
  articles,
  voyages,
  voyageWaypoints,
}: {
  articles: Array<{ updated_at?: string | null; published_at?: string | null }>;
  voyages: Array<{ updated_at?: string | null }>;
  voyageWaypoints: Array<{ created_at?: string | null }>;
}): PublicContentVersion => ({
  articlesCount: articles.length,
  articlesUpdatedAt: getLatestTimestamp(
    articles.map((article) => article.updated_at ?? article.published_at ?? null)
  ),
  voyagesCount: voyages.length,
  voyagesUpdatedAt: getLatestTimestamp(voyages.map((voyage) => voyage.updated_at ?? null)),
  voyageWaypointsCount: voyageWaypoints.length,
  voyageWaypointsUpdatedAt: getLatestTimestamp(
    voyageWaypoints.map((waypoint) => waypoint.created_at ?? null)
  ),
});

export const isPublicContentVersionEqual = (
  left: PublicContentVersion | null | undefined,
  right: PublicContentVersion | null | undefined
) => (
  !!left
  && !!right
  && left.articlesCount === right.articlesCount
  && left.articlesUpdatedAt === right.articlesUpdatedAt
  && left.voyagesCount === right.voyagesCount
  && left.voyagesUpdatedAt === right.voyagesUpdatedAt
  && left.voyageWaypointsCount === right.voyageWaypointsCount
  && left.voyageWaypointsUpdatedAt === right.voyageWaypointsUpdatedAt
);

export async function fetchPublicContentVersion(): Promise<PublicContentVersion> {
  const [
    articleCountResponse,
    latestArticleResponse,
    voyageCountResponse,
    latestVoyageResponse,
    publishedVoyageIdsResponse,
  ] = await Promise.all([
    supabase
      .from("logbook_articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
    supabase
      .from("logbook_articles")
      .select("updated_at, published_at")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("voyages")
      .select("id", { count: "exact", head: true })
      .eq("is_published", true),
    supabase
      .from("voyages")
      .select("updated_at")
      .eq("is_published", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("voyages")
      .select("id")
      .eq("is_published", true),
  ]);

  if (articleCountResponse.error) throw articleCountResponse.error;
  if (latestArticleResponse.error) throw latestArticleResponse.error;
  if (voyageCountResponse.error) throw voyageCountResponse.error;
  if (latestVoyageResponse.error) throw latestVoyageResponse.error;
  if (publishedVoyageIdsResponse.error) throw publishedVoyageIdsResponse.error;

  const publishedVoyageIds = (publishedVoyageIdsResponse.data ?? []).map((voyage) => voyage.id);
  const [waypointCountResponse, latestWaypointResponse] = publishedVoyageIds.length
    ? await Promise.all([
        supabase
          .from("voyage_waypoints")
          .select("id", { count: "exact", head: true })
          .in("voyage_id", publishedVoyageIds),
        supabase
          .from("voyage_waypoints")
          .select("updated_at")
          .in("voyage_id", publishedVoyageIds)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    : [
        { count: 0, error: null },
        { data: null, error: null },
      ];

  if (waypointCountResponse.error) throw waypointCountResponse.error;
  if (latestWaypointResponse.error) throw latestWaypointResponse.error;

  return {
    articlesCount: articleCountResponse.count ?? 0,
    articlesUpdatedAt:
      latestArticleResponse.data?.updated_at
      ?? latestArticleResponse.data?.published_at
      ?? null,
    voyagesCount: voyageCountResponse.count ?? 0,
    voyagesUpdatedAt: latestVoyageResponse.data?.updated_at ?? null,
    voyageWaypointsCount: waypointCountResponse.count ?? 0,
    voyageWaypointsUpdatedAt: latestWaypointResponse.data?.updated_at ?? null,
  };
}

export async function fetchPublicContentSnapshot(): Promise<PublicContentSnapshot> {
  const [heroMediaPools, articlesResponse, voyagesResponse] = await Promise.all([
    fetchHeroMediaPools(),
    supabase
      .from("logbook_articles")
      .select(
        "id, title_en, title_it, slug, cover_image, cover_focal_x, cover_focal_y, cover_zoom, excerpt_en, excerpt_it, published_at, updated_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, voyage_waypoint_start_id, voyage_waypoint_end_id, location_name, story_id, category, view_count"
      )
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("voyages")
      .select("*")
      .eq("is_published", true)
      .order("sort_order", { ascending: true }),
  ]);

  if (articlesResponse.error) throw articlesResponse.error;
  if (voyagesResponse.error) throw voyagesResponse.error;
  const publishedVoyageIds = (voyagesResponse.data ?? []).map((voyage) => voyage.id);
  const voyageWaypointsResponse = publishedVoyageIds.length
    ? await supabase
        .from("voyage_waypoints")
        .select("*")
        .in("voyage_id", publishedVoyageIds)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  if (voyageWaypointsResponse.error) throw voyageWaypointsResponse.error;

  const articles = articlesResponse.data ?? [];
  const articleIds = articles.map((article) => article.id);

  const [authorLinksResponse, tagLinksResponse, likesResponse] = articleIds.length
    ? await Promise.all([
        supabase.from("article_authors").select("article_id, profile_id").in("article_id", articleIds),
        supabase.from("article_tags").select("article_id, tag_id").in("article_id", articleIds),
        supabase.from("article_likes").select("article_id").in("article_id", articleIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (authorLinksResponse.error) throw authorLinksResponse.error;
  if (tagLinksResponse.error) throw tagLinksResponse.error;
  if (likesResponse.error) throw likesResponse.error;

  const profileIds = [...new Set((authorLinksResponse.data ?? []).map((link) => link.profile_id))];
  const tagIds = [...new Set((tagLinksResponse.data ?? []).map((link) => link.tag_id))];

  const [profilesResponse, tagsResponse] = await Promise.all([
    profileIds.length
      ? supabase.from("public_profiles").select("id, name, avatar_url").in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    tagIds.length
      ? supabase.from("tags").select("id, name").in("id", tagIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResponse.error) throw profilesResponse.error;
  if (tagsResponse.error) throw tagsResponse.error;

  const profileMap = Object.fromEntries((profilesResponse.data ?? []).map((profile) => [profile.id, profile]));
  const tagMap = Object.fromEntries((tagsResponse.data ?? []).map((tag) => [tag.id, tag]));

  const articleAuthorsMap: Record<string, { id: string; name: string; avatar_url: string | null }[]> = {};
  (authorLinksResponse.data ?? []).forEach((link) => {
    const profile = profileMap[link.profile_id];
    if (!profile) return;
    if (!articleAuthorsMap[link.article_id]) articleAuthorsMap[link.article_id] = [];
    articleAuthorsMap[link.article_id].push({
      id: profile.id,
      name: profile.name,
      avatar_url: profile.avatar_url,
    });
  });

  const articleTagsMap: Record<string, { id: string; name: string }[]> = {};
  (tagLinksResponse.data ?? []).forEach((link) => {
    const tag = tagMap[link.tag_id];
    if (!tag) return;
    if (!articleTagsMap[link.article_id]) articleTagsMap[link.article_id] = [];
    articleTagsMap[link.article_id].push({
      id: tag.id,
      name: tag.name,
    });
  });

  const likeCounts: Record<string, number> = {};
  (likesResponse.data ?? []).forEach((like) => {
    likeCounts[like.article_id] = (likeCounts[like.article_id] || 0) + 1;
  });

  const snapshotVersion = buildPublicContentVersion({
    articles,
    voyages: voyagesResponse.data ?? [],
    voyageWaypoints: voyageWaypointsResponse.data ?? [],
  });

  return {
    generatedAt: new Date().toISOString(),
    version: snapshotVersion,
    heroVideoVersion: buildHeroVideoPoolVersion(heroMediaPools.videoPool),
    heroVideoPool: heroMediaPools.videoPool,
    heroImagePool: heroMediaPools.imagePool,
    articles: articles.map((article) => ({
      id: article.id,
      title_en: article.title_en,
      title_it: article.title_it,
      slug: article.slug,
      cover_image: article.cover_image,
      cover_focal_x: article.cover_focal_x,
      cover_focal_y: article.cover_focal_y,
      cover_zoom: article.cover_zoom,
      excerpt_en: article.excerpt_en,
      excerpt_it: article.excerpt_it,
      published_at: article.published_at,
      latitude: article.latitude,
      longitude: article.longitude,
      voyage_id: article.voyage_id,
      voyage_segment_start: article.voyage_segment_start,
      voyage_segment_end: article.voyage_segment_end,
      voyage_waypoint_start_id: article.voyage_waypoint_start_id,
      voyage_waypoint_end_id: article.voyage_waypoint_end_id,
      location_name: article.location_name,
      story_id: article.story_id,
      category: article.category,
      authors: articleAuthorsMap[article.id] || [],
      tags: articleTagsMap[article.id] || [],
      likeCount: likeCounts[article.id] || 0,
      viewCount: Number(article.view_count ?? 0),
    })),
    voyages: (voyagesResponse.data ?? []) as Voyage[],
    voyageWaypoints: (voyageWaypointsResponse.data ?? []) as unknown as VoyageWaypoint[],
  };
}
