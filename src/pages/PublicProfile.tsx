import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowUpRight,
  BookOpen,
  MessageCircle,
  Eye,
  Facebook,
  Globe,
  Heart,
  Instagram,
  Languages,
  Linkedin,
  MapPin,
  User,
  Youtube,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_LANGUAGES, useI18n } from "@/lib/i18n";
import { clampCoverFocal, coverImageStyle } from "@/lib/article-cover";
import { getArticleDisplayLocationLabel, type VoyageWaypoint } from "@/lib/voyage-utils";
import ProfileAvatar from "@/components/ProfileAvatar";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";

interface ProfileData {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string | null;
  preferred_language: string | null;
  secondary_language: string | null;
  social_instagram: string | null;
  social_youtube: string | null;
  social_tiktok: string | null;
  social_facebook: string | null;
  social_x: string | null;
  social_linkedin: string | null;
  social_website: string | null;
  social_seapeople: string | null;
}

interface Badge {
  id: string;
  badge_name: string;
  badge_icon: string | null;
  awarded_at: string;
}

interface ProfileArticle {
  id: string;
  slug: string;
  title_en: string;
  title_it: string;
  excerpt_en: string | null;
  excerpt_it: string | null;
  cover_image: string | null;
  cover_focal_x: number;
  cover_focal_y: number;
  cover_zoom: number;
  location_name: string | null;
  voyage_id: string | null;
  voyage_segment_start: number | null;
  voyage_segment_end: number | null;
  voyage_waypoint_start_id: string | null;
  voyage_waypoint_end_id: string | null;
  category: string;
  published_at: string | null;
  view_count: number;
  like_count: number;
}

type SocialKey =
  | "social_instagram"
  | "social_youtube"
  | "social_tiktok"
  | "social_facebook"
  | "social_x"
  | "social_linkedin"
  | "social_website"
  | "social_seapeople";

const socialLink = (url: string | null | undefined) => {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `https://${url}`;
};

const socialDisplay = (value: string, key: SocialKey) => {
  if (key === "social_website") {
    try {
      const href = value.startsWith("http") ? value : `https://${value}`;
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return value;
    }
  }

  if (value.startsWith("http")) {
    try {
      const url = new URL(value);
      return url.pathname.replace(/^\/+/, "") || url.hostname;
    } catch {
      return value;
    }
  }

  return value;
};

const languageLabel = (code: string | null | undefined) => {
  if (!code) return null;
  return ALL_LANGUAGES.find((entry) => entry.code === code)?.label || code.toUpperCase();
};

const TikTokIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const XIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const socials: Array<{
  key: SocialKey;
  icon: React.ComponentType<any>;
  label: string;
  prefix: string;
}> = [
  { key: "social_instagram", icon: Instagram, label: "Instagram", prefix: "https://instagram.com/" },
  { key: "social_youtube", icon: Youtube, label: "YouTube", prefix: "https://youtube.com/@" },
  { key: "social_tiktok", icon: TikTokIcon, label: "TikTok", prefix: "https://tiktok.com/@" },
  { key: "social_facebook", icon: Facebook, label: "Facebook", prefix: "https://facebook.com/" },
  { key: "social_x", icon: XIcon, label: "X", prefix: "https://x.com/" },
  { key: "social_linkedin", icon: Linkedin, label: "LinkedIn", prefix: "https://linkedin.com/in/" },
  { key: "social_website", icon: Globe, label: "Website", prefix: "" },
  { key: "social_seapeople", icon: SeaPeopleIcon, label: "SeaPeople", prefix: "https://dashboard.seapeopleapp.com/" },
];

const PublicProfile = () => {
  const { id } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [articles, setArticles] = useState<ProfileArticle[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [totalLikes, setTotalLikes] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);

      const [profileRes, badgeRes, authorRes, commentRes] = await Promise.all([
        supabase
          .from("public_profiles")
          .select(
            "id, name, bio, avatar_url, created_at, preferred_language, secondary_language, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website, social_seapeople"
          )
          .eq("id", id)
          .single(),
        supabase
          .from("profile_badges")
          .select("*")
          .eq("profile_id", id)
          .order("awarded_at", { ascending: false }),
        supabase
          .from("article_authors")
          .select("article_id")
          .eq("profile_id", id),
        supabase.from("article_comments").select("id", { count: "exact", head: true }).eq("profile_id", id),
      ]);

      if (profileRes.data) setProfile(profileRes.data as ProfileData);
      setBadges((badgeRes.data || []) as Badge[]);
      setCommentCount(commentRes.count || 0);

      const { data: authoredComments } = await supabase
        .from("article_comments")
        .select("id")
        .eq("profile_id", id);

      const commentIds = (authoredComments || []).map((comment) => comment.id);
      const { count: commentLikesCount } = commentIds.length
        ? await supabase.from("comment_likes").select("id", { count: "exact", head: true }).in("comment_id", commentIds)
        : { count: 0 };

      const articleIds = [...new Set((authorRes.data || []).map((row) => row.article_id))];
      if (!articleIds.length) {
        setArticles([]);
        setTotalLikes(commentLikesCount || 0);
        setLoading(false);
        return;
      }

      const { data: articleData } = await supabase
        .from("logbook_articles")
        .select(
          "id, slug, title_en, title_it, excerpt_en, excerpt_it, cover_image, cover_focal_x, cover_focal_y, cover_zoom, location_name, voyage_id, voyage_segment_start, voyage_segment_end, voyage_waypoint_start_id, voyage_waypoint_end_id, category, published_at, view_count"
        )
        .in("id", articleIds)
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false });

      const publishedIds = (articleData || []).map((article) => article.id);
      const { data: likeData } = publishedIds.length
        ? await supabase.from("article_likes").select("article_id").in("article_id", publishedIds)
        : { data: [] as Array<{ article_id: string }> };

      const likeCounts = (likeData || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.article_id] = (acc[row.article_id] || 0) + 1;
        return acc;
      }, {});

      const articleLikesTotal = Object.values(likeCounts).reduce((sum, count) => sum + count, 0);
      setTotalLikes(articleLikesTotal + (commentLikesCount || 0));

      setArticles(
        (articleData || []).map((article) => ({
          ...article,
          like_count: likeCounts[article.id] || 0,
        })) as ProfileArticle[]
      );
      setLoading(false);
    };

    void load();
  }, [id]);

  const activeSocials = useMemo(() => {
    if (!profile) return [];
    return socials
      .map((social) => {
        const rawValue = profile[social.key];
        if (!rawValue || rawValue.trim() === "") return null;
        const href = socialLink(social.prefix && !rawValue.startsWith("http") ? `${social.prefix}${rawValue}` : rawValue);
        if (!href) return null;
        return {
          ...social,
          href,
          rawValue,
          displayValue: socialDisplay(rawValue, social.key),
        };
      })
      .filter(Boolean) as Array<(typeof socials)[number] & { href: string; rawValue: string; displayValue: string }>;
  }, [profile]);

  const profileLanguages = useMemo(() => {
    if (!profile) return [];
    return [...new Set([profile.preferred_language, profile.secondary_language].filter(Boolean))]
      .map((code) => languageLabel(code || null))
      .filter(Boolean) as string[];
  }, [profile]);

  const formatNumber = (value: number) => value.toLocaleString(lang === "it" ? "it-IT" : "en-US");
  const totalViews = articles.reduce((sum, article) => sum + Number(article.view_count || 0), 0);
  const featuredArticle = articles[0] || null;

  const profileArticleVoyageIdsKey = useMemo(() => {
    const ids = [...new Set(articles.map((a) => a.voyage_id).filter(Boolean))] as string[];
    ids.sort();
    return ids.join(",");
  }, [articles]);

  const { data: profileVoyageWaypoints = [] } = useQuery({
    queryKey: ["public-profile-voyage-waypoints", profileArticleVoyageIdsKey],
    enabled: profileArticleVoyageIdsKey.length > 0,
    queryFn: async () => {
      const ids = profileArticleVoyageIdsKey.split(",").filter(Boolean);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("voyage_waypoints")
        .select("*")
        .in("voyage_id", ids)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VoyageWaypoint[];
    },
  });

  const profileArticleWaypointsMap = useMemo(() => {
    const m: Record<string, VoyageWaypoint[]> = {};
    profileVoyageWaypoints.forEach((wp) => {
      if (!m[wp.voyage_id]) m[wp.voyage_id] = [];
      m[wp.voyage_id].push(wp);
    });
    return m;
  }, [profileVoyageWaypoints]);

  const featuredArticleLocationLabel = useMemo(() => {
    if (!featuredArticle) return "";
    return getArticleDisplayLocationLabel(featuredArticle, profileArticleWaypointsMap, lang);
  }, [featuredArticle, profileArticleWaypointsMap, lang]);
  const recentArticles = articles.slice(1, 4);
  const hasPublishedArticles = articles.length > 0;
  const stats = hasPublishedArticles
    ? [
        {
          label: lang === "it" ? "Articoli" : "Articles",
          value: formatNumber(articles.length),
          icon: BookOpen,
        },
        {
          label: lang === "it" ? "Visualizzazioni" : "Views",
          value: formatNumber(totalViews),
          icon: Eye,
        },
        {
          label: lang === "it" ? "Mi piace" : "Likes",
          value: formatNumber(totalLikes),
          icon: Heart,
        },
        {
          label: lang === "it" ? "Commenti" : "Comments",
          value: formatNumber(commentCount),
          icon: MessageCircle,
        },
      ]
    : [
        {
          label: lang === "it" ? "Mi piace" : "Likes",
          value: formatNumber(totalLikes),
          icon: Heart,
        },
        {
          label: lang === "it" ? "Commenti" : "Comments",
          value: formatNumber(commentCount),
          icon: MessageCircle,
        },
      ];

  if (loading) {
    return (
      <div className="min-h-screen pt-28 pb-16 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse rounded-[36px] bg-muted h-[320px] mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="animate-pulse rounded-[28px] bg-muted h-44 md:col-span-2" />
            <div className="animate-pulse rounded-[28px] bg-muted h-44" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen pt-28 pb-16 px-6 flex flex-col items-center justify-center">
        <p className="text-muted-foreground font-sans">{lang === "it" ? "Profilo non trovato" : "Profile not found"}</p>
      </div>
    );
  }
  const memberSince = profile.created_at
    ? new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(profile.created_at))
    : null;

  return (
    <div className="min-h-screen pt-24 pb-20 px-6 md:px-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <section className="relative overflow-hidden rounded-[38px] border border-white/55 bg-[linear-gradient(145deg,rgba(255,255,255,0.85),rgba(247,245,239,0.74))] shadow-[0_28px_90px_rgba(15,23,42,0.10)]">
          <div className="absolute -top-20 right-8 w-64 h-64 rounded-full bg-accent/12 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-primary/8 blur-3xl" />

          <div className="relative grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 p-6 md:p-8 lg:p-10">
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center gap-5">
                <div className="w-28 h-28 md:w-32 md:h-32 rounded-[32px] overflow-hidden bg-muted ring-1 ring-white/70 shadow-[0_14px_45px_rgba(15,23,42,0.12)]">
                  <ProfileAvatar
                    name={profile.name || "Anonymous"}
                    avatarUrl={profile.avatar_url}
                    imgClassName="img-cover"
                    fallback={<User className="text-muted-foreground w-full h-full p-8" />}
                  />
                </div>

                <div className="min-w-0">
                  <h1 className="editorial-heading text-3xl md:text-5xl leading-none mb-3">
                    {profile.name || "Anonymous"}
                  </h1>
                  <div className="flex flex-wrap gap-2">
                    {memberSince && (
                      <span className="rounded-full border border-white/70 bg-background/75 px-3 py-1.5 text-xs font-sans text-muted-foreground">
                        {lang === "it" ? "Membro da" : "Member since"} {memberSince}
                      </span>
                    )}
                    {profileLanguages.map((language) => (
                      <span
                        key={language}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-background/75 px-3 py-1.5 text-xs font-sans text-muted-foreground"
                      >
                        <Languages size={12} className="text-accent" />
                        {language}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-stone-200/85 bg-white/72 p-5 md:p-6 shadow-[0_16px_36px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.45)]">
                <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-3">
                  {lang === "it" ? "Biografia" : "Biography"}
                </p>
                <p className="editorial-body text-foreground/88 leading-[1.9] whitespace-pre-wrap">
                  {profile.bio?.trim() || (lang === "it" ? "Nessuna biografia disponibile al momento." : "No biography available yet.")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 h-fit">
              {stats.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-[28px] border border-stone-200/85 bg-white/72 p-5 md:p-6 shadow-[0_16px_36px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.45)]"
                  >
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-background/75 border border-white/70 mb-4">
                      <Icon size={16} className="text-accent" />
                    </div>
                    <p className="editorial-heading text-3xl md:text-4xl leading-none mb-2">{item.value}</p>
                    <p className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {activeSocials.length > 0 && (
          <section className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                  {lang === "it" ? "Dove trovarmi" : "Find me online"}
                </p>
                <h2 className="editorial-heading text-2xl md:text-3xl">
                  {lang === "it" ? "Social e link" : "Socials and links"}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activeSocials.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.key}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group rounded-[26px] border border-stone-200/90 bg-white/76 p-4 md:p-5 hover:translate-y-[-2px] hover:shadow-[0_16px_40px_rgba(15,23,42,0.08)] transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-white/70 bg-background/70 mb-4">
                          <Icon size={17} className="text-accent" />
                        </div>
                        <p className="font-sans font-medium text-foreground">{social.label}</p>
                        <p className="text-sm font-sans text-muted-foreground mt-1 break-all">{social.displayValue}</p>
                      </div>
                      <ArrowUpRight size={16} className="text-muted-foreground group-hover:text-accent transition-colors" />
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {(badges.length > 0 || featuredArticle || recentArticles.length > 0) && (
          <section className="grid grid-cols-1 xl:grid-cols-[0.72fr_1.28fr] gap-6">
            <div className="space-y-6">
              {badges.length > 0 && (
                <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                    {lang === "it" ? "Riconoscimenti" : "Recognition"}
                  </p>
                  <h2 className="editorial-heading text-2xl md:text-3xl mb-6">
                    {lang === "it" ? "Badge e specialità" : "Badges and specialties"}
                  </h2>

                  <div className="flex flex-wrap gap-3">
                    {badges.map((badge) => (
                      <div
                        key={badge.id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/65 bg-white/60 px-4 py-2 text-sm font-sans text-foreground"
                      >
                        {badge.badge_icon && <span className="text-base leading-none">{badge.badge_icon}</span>}
                        <span>{badge.badge_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!featuredArticle && (
                <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                    {lang === "it" ? "Attività" : "Activity"}
                  </p>
                  <h2 className="editorial-heading text-2xl md:text-3xl mb-3">
                    {lang === "it" ? "Ancora nessun articolo pubblicato" : "No published articles yet"}
                  </h2>
                  <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                    {lang === "it"
                      ? "Quando questo autore pubblicherà nel logbook, qui compariranno i suoi articoli più recenti."
                      : "When this author publishes in the logbook, their latest entries will appear here."}
                  </p>
                </div>
              )}
            </div>

            {(featuredArticle || recentArticles.length > 0) && (
              <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                  {lang === "it" ? "Dal logbook" : "From the logbook"}
                </p>
                <h2 className="editorial-heading text-2xl md:text-3xl mb-6">
                  {lang === "it" ? "Ultimi articoli pubblicati" : "Latest published entries"}
                </h2>

                <div className="space-y-5">
                  {featuredArticle && (
                    <Link
                      to={`/logbook/${featuredArticle.slug}`}
                      className="group grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-hidden rounded-[30px] border border-stone-200/90 bg-white/78 hover:shadow-[0_20px_50px_rgba(15,23,42,0.10)] transition-all"
                    >
                      <div className="relative min-h-[260px] overflow-hidden bg-muted">
                        {featuredArticle.cover_image ? (
                          <img
                            src={featuredArticle.cover_image}
                            alt=""
                            className="absolute inset-0 max-w-none transition-transform duration-700 group-hover:scale-[1.04]"
                            style={coverImageStyle(
                              featuredArticle.cover_image,
                              clampCoverFocal(
                                Number(featuredArticle.cover_focal_x ?? 50),
                                Number(featuredArticle.cover_focal_y ?? 50),
                                Number(featuredArticle.cover_zoom ?? 1)
                              )
                            )}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 font-serif text-3xl">
                            BITE
                          </div>
                        )}
                      </div>

                      <div className="p-5 md:p-6 flex flex-col">
                        <div className="flex flex-wrap gap-2 mb-4">
                          {featuredArticleLocationLabel && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-background/75 px-3 py-1 text-[11px] font-sans text-muted-foreground">
                              <MapPin size={11} className="text-accent" />
                              {featuredArticleLocationLabel}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-background/75 px-3 py-1 text-[11px] font-sans text-muted-foreground">
                            <Eye size={11} className="text-accent" />
                            {formatNumber(featuredArticle.view_count)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-background/75 px-3 py-1 text-[11px] font-sans text-muted-foreground">
                            <Heart size={11} className="text-accent" />
                            {formatNumber(featuredArticle.like_count)}
                          </span>
                        </div>

                        <h3 className="editorial-heading text-2xl leading-tight mb-3 group-hover:text-accent transition-colors">
                          {lang === "en" ? featuredArticle.title_en : featuredArticle.title_it || featuredArticle.title_en}
                        </h3>
                        <p className="text-sm font-sans text-muted-foreground leading-relaxed line-clamp-4">
                          {lang === "en"
                            ? featuredArticle.excerpt_en
                            : featuredArticle.excerpt_it || featuredArticle.excerpt_en}
                        </p>

                        <div className="mt-auto pt-6 flex items-center justify-between gap-4">
                          <span className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">
                            {featuredArticle.published_at
                              ? format(new Date(featuredArticle.published_at), lang === "it" ? "d MMM yyyy" : "MMM d, yyyy")
                              : featuredArticle.category}
                          </span>
                          <span className="inline-flex items-center gap-2 text-sm font-sans text-foreground">
                            {lang === "it" ? "Apri articolo" : "Open article"}
                            <ArrowUpRight size={15} className="text-accent" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  )}

                  {recentArticles.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {recentArticles.map((article) => (
                        <Link
                          key={article.id}
                          to={`/logbook/${article.slug}`}
                          className="group rounded-[28px] border border-stone-200/90 bg-white/76 overflow-hidden hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] transition-all"
                        >
                          <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                            {article.cover_image ? (
                              <img
                                src={article.cover_image}
                                alt=""
                                className="absolute inset-0 max-w-none transition-transform duration-700 group-hover:scale-[1.04]"
                                style={coverImageStyle(
                                  article.cover_image,
                                  clampCoverFocal(
                                    Number(article.cover_focal_x ?? 50),
                                    Number(article.cover_focal_y ?? 50),
                                    Number(article.cover_zoom ?? 1)
                                  )
                                )}
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/35 font-serif text-2xl">
                                BITE
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans text-muted-foreground">
                                <Eye size={10} className="text-accent" />
                                {formatNumber(article.view_count)}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans text-muted-foreground">
                                <Heart size={10} className="text-accent" />
                                {formatNumber(article.like_count)}
                              </span>
                            </div>
                            <h3 className="font-serif text-lg leading-tight mb-2 group-hover:text-accent transition-colors line-clamp-2">
                              {lang === "en" ? article.title_en : article.title_it || article.title_en}
                            </h3>
                            <p className="text-xs font-sans text-muted-foreground line-clamp-3">
                              {lang === "en" ? article.excerpt_en : article.excerpt_it || article.excerpt_en}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default PublicProfile;
