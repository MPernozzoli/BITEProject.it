import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type MetricItem = {
  label: string;
  value: number;
  suffix: string;
};

type AudienceItem = {
  label: string;
  value: number;
};

type MetricsPayload = {
  metrics: MetricItem[];
  topCountries: AudienceItem[];
  audienceBreakdown: AudienceItem[];
  updatedAt: string;
  mediaKitUrl: string;
  source: "not-just-analytics" | "fallback-cache";
};

type CacheRow = {
  slug: string;
  source_url: string;
  payload: MetricsPayload;
  fetched_at: string;
};

type ProfileInfoMedia = {
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
};

type ProfileInfoResponse = {
  business_discovery?: {
    followers_count?: number;
    media_count?: number;
    media?: {
      data?: ProfileInfoMedia[];
    };
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_HOURS = 24;
const FALLBACK_POST_SAMPLE_SIZE = 25;
const DEFAULT_PROFILE_URL = "https://app.notjustanalytics.com/it/profiles/bitespack";
const DEFAULT_PROFILE_INFO_URL = "https://api.notjustanalytics.com/insights/ig/profile-info/bitespack";
const NOT_JUST_ANALYTICS_ENGAGEMENT_RATE = 12.16;

const metricLabels = (language: "it" | "en") => ({
  followers: language === "it" ? "Follower Instagram" : "Instagram Followers",
  reelViews: language === "it" ? "View medie reel" : "Avg. Reel Views",
  totalPosts: language === "it" ? "Post totali" : "Total posts",
  likes: language === "it" ? "Like medi / post" : "Avg. Likes / Post",
  comments: language === "it" ? "Commenti medi / post" : "Avg. Comments / Post",
  engagement: "Engagement Rate",
  sampled: language === "it" ? "Post analizzati" : "Posts Sampled",
  female: language === "it" ? "Pubblico femminile" : "Female audience",
  male: language === "it" ? "Pubblico maschile" : "Male audience",
  unknown: language === "it" ? "Non indicato" : "Undefined / not disclosed",
  other: language === "it" ? "Altro" : "Other",
});

const fallbackPayload = (mediaKitUrl: string, language: "it" | "en" = "en"): MetricsPayload => {
  const labels = metricLabels(language);
  return {
  metrics: [
    { label: labels.followers, value: 863, suffix: "" },
    { label: labels.engagement, value: NOT_JUST_ANALYTICS_ENGAGEMENT_RATE, suffix: "%" },
    { label: labels.likes, value: 74, suffix: "" },
    { label: labels.comments, value: 6, suffix: "" },
    { label: labels.sampled, value: FALLBACK_POST_SAMPLE_SIZE, suffix: "" },
    { label: labels.totalPosts, value: 91, suffix: "" },
  ],
  topCountries: [
    { label: "Italy", value: 62 },
    { label: "United States", value: 7 },
    { label: "Germany", value: 3 },
    { label: "France", value: 2 },
    { label: "United Kingdom", value: 2 },
    { label: labels.other, value: 24 },
  ],
  audienceBreakdown: [
    { label: labels.female, value: 40 },
    { label: labels.male, value: 32 },
    { label: labels.unknown, value: 27 },
  ],
  updatedAt: new Date().toISOString(),
  mediaKitUrl,
  source: "fallback-cache",
  };
};

const countryLabels: Record<string, string> = {
  IT: "Italy",
  US: "United States",
  DE: "Germany",
  FR: "France",
  GB: "United Kingdom",
  ES: "Spain",
  CA: "Canada",
  BR: "Brazil",
  JP: "Japan",
  NL: "Netherlands",
};

const json = (body: MetricsPayload, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const percent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

const toAudiencePercentages = (items: Array<{ label: string; count: number }>): AudienceItem[] => {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total <= 0) {
    return items.map((item) => ({ label: item.label, value: 0 }));
  }

  const normalized = items.map((item) => ({
    label: item.label,
    value: percent(item.count, total),
  }));

  const sum = normalized.reduce((acc, item) => acc + item.value, 0);
  const delta = 100 - sum;

  if (delta !== 0) {
    const last = normalized[normalized.length - 1];
    last.value = Math.max(0, last.value + delta);
  }

  return normalized;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const matchNumber = (html: string, pattern: RegExp, label: string) => {
  const match = html.match(pattern);
  if (!match) throw new Error(`Missing ${label}`);
  return Number(match[1]);
};

const matchString = (html: string, pattern: RegExp, label: string) => {
  const match = html.match(pattern);
  if (!match) throw new Error(`Missing ${label}`);
  return match[1];
};

const extractCountryItems = (html: string, language: "it" | "en"): AudienceItem[] => {
  const sectionMatch = html.match(/"data":\{"items":\[(.*?)\]\},"type":"audience_country"/s);
  if (!sectionMatch) return fallbackPayload("", language).topCountries;

  const rawItems = [...sectionMatch[1].matchAll(/\{"name":"([A-Z]{2})","value":(\d+)\}/g)].map((match) => ({
    code: match[1],
    count: Number(match[2]),
  }));

  const total = rawItems.reduce((sum, item) => sum + item.count, 0);
  const topFive = rawItems
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item) => ({
      label: countryLabels[item.code] ?? item.code,
      value: percent(item.count, total),
    }));

  const topFiveTotal = topFive.reduce((sum, item) => sum + item.value, 0);

  return [...topFive, { label: metricLabels(language).other, value: Math.max(0, 100 - topFiveTotal) }];
};

const extractAudienceBreakdown = (html: string, language: "it" | "en"): AudienceItem[] => {
  const match = html.match(/"data":\{"items":\{"male":(\d+),"female":(\d+),"undefined":(\d+)\}\},"type":"audience_gender"/);
  if (!match) return fallbackPayload("", language).audienceBreakdown;

  const male = Number(match[1]);
  const female = Number(match[2]);
  const undefinedCount = Number(match[3]);
  const total = male + female + undefinedCount;

  const labels = metricLabels(language);
  return toAudiencePercentages([
    { label: labels.female, count: female },
    { label: labels.male, count: male },
    { label: labels.unknown, count: undefinedCount },
  ]);
};

const parseNjaPayload = (html: string, mediaKitUrl: string, language: "it" | "en"): MetricsPayload => {
  const labels = metricLabels(language);
  const followers = matchNumber(html, /"followers_count":(\d+)/, "followers");
  const avgReelViews = matchNumber(html, /"name":"reels","social":"ig","play_rate":\d+,"views_avg":(\d+)/, "avg reel views");
  const avgLikes = matchNumber(html, /"name":"post","social":"ig","reach_er":"[\d.]+","avg_likes":(\d+)/, "avg likes");
  const avgComments = matchNumber(html, /"avg_comments":(\d+)/, "avg comments");
  const engagementRate = Number(matchString(html, /"er":"([\d.]+)"/, "engagement rate"));
  const updatedAt = matchString(html, /"updated_at":"([^"]+)"/, "updated at");

  return {
    metrics: [
      { label: labels.followers, value: followers, suffix: "" },
      { label: labels.reelViews, value: avgReelViews, suffix: "" },
      { label: labels.likes, value: avgLikes, suffix: "" },
      { label: labels.comments, value: avgComments, suffix: "" },
      { label: labels.engagement, value: Number(engagementRate.toFixed(1)), suffix: "%" },
      { label: labels.sampled, value: FALLBACK_POST_SAMPLE_SIZE, suffix: "" },
    ],
    topCountries: extractCountryItems(html, language),
    audienceBreakdown: extractAudienceBreakdown(html, language),
    updatedAt,
    mediaKitUrl,
    source: "not-just-analytics",
  };
};

const parseProfileInfoPayload = (
  profileInfo: ProfileInfoResponse,
  mediaKitUrl: string,
  language: "it" | "en",
): MetricsPayload => {
  const labels = metricLabels(language);
  const profile = profileInfo.business_discovery;
  const followers = profile?.followers_count;
  const media = profile?.media?.data ?? [];

  if (!followers || media.length === 0) {
    throw new Error("Missing profile-info metrics");
  }

  const sampledPosts = media.filter(
    (item) => typeof item.like_count === "number" || typeof item.comments_count === "number",
  );
  const avgLikes = average(sampledPosts.map((item) => item.like_count ?? 0));
  const avgComments = average(sampledPosts.map((item) => item.comments_count ?? 0));
  const latestTimestamp = sampledPosts
    .map((item) => item.timestamp)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    metrics: [
      { label: labels.followers, value: followers, suffix: "" },
      { label: labels.engagement, value: NOT_JUST_ANALYTICS_ENGAGEMENT_RATE, suffix: "%" },
      { label: labels.likes, value: Math.round(avgLikes), suffix: "" },
      { label: labels.comments, value: Number(avgComments.toFixed(1)), suffix: "" },
      { label: labels.sampled, value: sampledPosts.length, suffix: "" },
      { label: labels.totalPosts, value: profile?.media_count ?? sampledPosts.length, suffix: "" },
    ],
    topCountries: fallbackPayload(mediaKitUrl, language).topCountries,
    audienceBreakdown: fallbackPayload(mediaKitUrl, language).audienceBreakdown,
    updatedAt: latestTimestamp ?? new Date().toISOString(),
    mediaKitUrl,
    source: "not-just-analytics",
  };
};

const isFresh = (fetchedAt: string) =>
  Date.now() - new Date(fetchedAt).getTime() < CACHE_HOURS * 60 * 60 * 1000;

const getSupabaseAdmin = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for admin client");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const {
    slug = "bitespack",
    mediaKitUrl = DEFAULT_PROFILE_URL,
    profileInfoUrl = DEFAULT_PROFILE_INFO_URL,
    language = "en",
  } = await request.json().catch(() => ({}));
  const normalizedLanguage = language === "it" ? "it" : "en";
  const cacheSlug = `${slug}:${normalizedLanguage}:profile-info-v2`;
  const fallback = fallbackPayload(mediaKitUrl, normalizedLanguage);

  try {
    const supabase = getSupabaseAdmin();
    const { data: cacheRow } = await supabase
      .from("external_metrics_cache")
      .select("slug, source_url, payload, fetched_at")
      .eq("slug", cacheSlug)
      .maybeSingle<CacheRow>();

    if (cacheRow && isFresh(cacheRow.fetched_at)) {
      return json(cacheRow.payload);
    }

    const profileInfoResponse = await fetch(profileInfoUrl, {
      headers: {
        "origin": "https://app.notjustanalytics.com",
        "referer": mediaKitUrl,
        "user-agent": "Mozilla/5.0 (compatible; FreyjaCollectiveBot/1.0; +https://pack.biteproject.it/)",
      },
    });

    if (profileInfoResponse.ok) {
      const profileInfo = await profileInfoResponse.json();
      const payload = parseProfileInfoPayload(profileInfo, mediaKitUrl, normalizedLanguage);

      await supabase.from("external_metrics_cache").upsert({
        slug: cacheSlug,
        source_url: profileInfoUrl,
        payload,
        fetched_at: new Date().toISOString(),
      });

      return json(payload);
    }

    const response = await fetch(mediaKitUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; FreyjaCollectiveBot/1.0; +https://pack.biteproject.it/)",
      },
    });

    if (!response.ok) {
      throw new Error(`NJA fetch failed with ${response.status}`);
    }

    const html = await response.text();
    const payload = parseNjaPayload(html, mediaKitUrl, normalizedLanguage);

    await supabase.from("external_metrics_cache").upsert({
      slug: cacheSlug,
      source_url: mediaKitUrl,
      payload,
      fetched_at: new Date().toISOString(),
    });

    return json(payload);
  } catch (error) {
    console.error("Failed to refresh NJA metrics:", error);

    try {
      const supabase = getSupabaseAdmin();
      const { data: cacheRow } = await supabase
        .from("external_metrics_cache")
        .select("payload")
        .eq("slug", cacheSlug)
        .maybeSingle<{ payload: MetricsPayload }>();

      if (cacheRow?.payload) return json(cacheRow.payload);
    } catch (cacheError) {
      console.error("Failed to read cached fallback payload:", cacheError);
    }

    return json(fallback);
  }
});
