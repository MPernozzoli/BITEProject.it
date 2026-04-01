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

export interface PublicContentArticle extends GeoArticle {
  category: string | null;
  story_id: string | null;
}

export interface PublicContentSnapshot {
  generatedAt: string;
  heroVideoPool: HomepageHeroVideoPool;
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

const getVideoMimeType = (filename: string) => {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return "video/mp4";
};

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

const fetchHeroVideoPool = async (): Promise<HomepageHeroVideoPool> => {
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

    return {
      desktop: createStorageVideoEntries(
        HOMEPAGE_HORIZONTAL_FOLDER,
        (desktopResult.data ?? []) as StorageListItem[],
        "Spritz sailing footage for the desktop hero"
      ),
      mobile: createStorageVideoEntries(
        HOMEPAGE_VERTICAL_FOLDER,
        (mobileResult.data ?? []) as StorageListItem[],
        "Spritz sailing footage for the mobile hero"
      ),
    };
  } catch {
    return {
      desktop: [],
      mobile: [],
    };
  }
};

export async function fetchPublicContentSnapshot(): Promise<PublicContentSnapshot> {
  const [heroVideoPool, articlesResponse, voyagesResponse, voyageWaypointsResponse] = await Promise.all([
    fetchHeroVideoPool(),
    supabase
      .from("logbook_articles")
      .select(
        "id, title_en, title_it, slug, cover_image, cover_focal_x, cover_focal_y, cover_zoom, excerpt_en, excerpt_it, published_at, latitude, longitude, voyage_id, voyage_segment_start, voyage_segment_end, location_name, story_id, category, view_count"
      )
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("voyages")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase
      .from("voyage_waypoints")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);

  if (articlesResponse.error) throw articlesResponse.error;
  if (voyagesResponse.error) throw voyagesResponse.error;
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

  return {
    generatedAt: new Date().toISOString(),
    heroVideoPool,
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
