import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Eye,
  Facebook,
  Globe,
  Heart,
  Instagram,
  Languages,
  Linkedin,
  Sparkles,
  User,
  X,
  Youtube,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { GeoArticle } from "@/lib/voyage-utils";
import { ALL_LANGUAGES } from "@/lib/i18n";
import ProfileAvatar from "@/components/ProfileAvatar";

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
}

interface Badge {
  id: string;
  badge_name: string;
  badge_icon: string | null;
}

interface ProfileArticle {
  id: string;
  title_en: string;
  title_it: string;
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
  | "social_website";

interface ProfileSlidePanelProps {
  profileId: string | null;
  article: GeoArticle | null;
  lang: "en" | "it";
  onBackToArticle: () => void;
  onClose: () => void;
}

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

const socials: Array<{
  key: SocialKey;
  icon: ({ size }: { size?: number }) => JSX.Element;
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
];

const ProfileSlidePanel = ({ profileId, article, lang, onBackToArticle, onClose }: ProfileSlidePanelProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ["logbook-profile-panel", profileId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const [profileRes, badgeRes, authorRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, name, bio, avatar_url, created_at, preferred_language, secondary_language, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website"
          )
          .eq("id", profileId!)
          .single(),
        supabase.from("profile_badges").select("id, badge_name, badge_icon").eq("profile_id", profileId!),
        supabase.from("article_authors").select("article_id").eq("profile_id", profileId!),
      ]);

      const articleIds = [...new Set((authorRes.data || []).map((row) => row.article_id))];
      const { data: articleData } = articleIds.length
        ? await supabase
            .from("logbook_articles")
            .select("id, title_en, title_it, published_at, view_count")
            .in("id", articleIds)
            .eq("status", "published")
            .order("published_at", { ascending: false, nullsFirst: false })
        : { data: [] as Array<{ id: string; title_en: string; title_it: string; published_at: string | null; view_count: number }> };

      const publishedIds = (articleData || []).map((entry) => entry.id);
      const { data: likeData } = publishedIds.length
        ? await supabase.from("article_likes").select("article_id").in("article_id", publishedIds)
        : { data: [] as Array<{ article_id: string }> };

      const likeCounts = (likeData || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.article_id] = (acc[row.article_id] || 0) + 1;
        return acc;
      }, {});

      return {
        profile: (profileRes.data || null) as ProfileData | null,
        badges: (badgeRes.data || []) as Badge[],
        articles: (articleData || []).map((entry) => ({
          ...entry,
          like_count: likeCounts[entry.id] || 0,
        })) as ProfileArticle[],
      };
    },
  });

  const activeSocials = useMemo(() => {
    if (!data?.profile) return [];
    return socials
      .map((social) => {
        const rawValue = data.profile[social.key];
        if (!rawValue || rawValue.trim() === "") return null;
        const href = socialLink(social.prefix && !rawValue.startsWith("http") ? `${social.prefix}${rawValue}` : rawValue);
        if (!href) return null;
        return {
          ...social,
          href,
          displayValue: socialDisplay(rawValue, social.key),
        };
      })
      .filter(Boolean) as Array<(typeof socials)[number] & { href: string; displayValue: string }>;
  }, [data?.profile]);

  const profileLanguages = useMemo(() => {
    if (!data?.profile) return [];
    return [...new Set([data.profile.preferred_language, data.profile.secondary_language].filter(Boolean))]
      .map((code) => languageLabel(code || null))
      .filter(Boolean) as string[];
  }, [data?.profile]);

  if (!profileId) return null;

  const profile = data?.profile || null;
  const articles = (data?.articles || []).filter((entry) => entry.id !== article?.id);
  const totalViews = (data?.articles || []).reduce((sum, entry) => sum + Number(entry.view_count || 0), 0);
  const totalLikes = (data?.articles || []).reduce((sum, entry) => sum + Number(entry.like_count || 0), 0);
  const memberSince = profile?.created_at
    ? new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(profile.created_at))
    : null;
  const formatNumber = (value: number) => value.toLocaleString(lang === "it" ? "it-IT" : "en-US");

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden" onClick={onClose} aria-hidden />

      <div className="fixed inset-x-3 top-24 bottom-4 sm:left-auto sm:right-4 sm:w-[440px] xl:w-[460px] z-50 overflow-hidden rounded-[32px] border border-white/55 bg-background/72 shadow-[0_30px_90px_rgba(15,23,42,0.18)] backdrop-blur-2xl animate-slide-in-right flex flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/45 bg-background/55 px-5 py-4 backdrop-blur-xl shrink-0">
          <button
            type="button"
            onClick={onBackToArticle}
            className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-2 text-xs font-sans text-foreground hover:text-accent transition-colors"
          >
            <ArrowLeft size={14} />
            {lang === "it" ? "Torna all'articolo" : "Back to article"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={lang === "it" ? "Chiudi" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 md:px-5 md:py-5 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              <div className="rounded-[28px] bg-muted h-44" />
              <div className="rounded-[28px] bg-muted h-32" />
              <div className="rounded-[28px] bg-muted h-48" />
            </div>
          ) : !profile ? (
            <div className="rounded-[28px] border border-white/55 bg-white/58 p-6 text-center">
              <p className="font-sans text-muted-foreground">
                {lang === "it" ? "Profilo non trovato." : "Profile not found."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-white/55 bg-white/58 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-background/75 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-4">
                  <Sparkles size={12} className="text-accent" />
                  {lang === "it" ? "Profilo autore" : "Author profile"}
                </div>

                <div className="flex items-center gap-4 mb-5">
                  <div className="w-20 h-20 rounded-[24px] overflow-hidden bg-muted">
                    <ProfileAvatar
                      name={profile.name || "Anonymous"}
                      avatarUrl={profile.avatar_url}
                      imgClassName="img-cover"
                      fallback={<User className="text-muted-foreground w-full h-full p-5" />}
                    />
                  </div>

                  <div className="min-w-0">
                    <h2 className="editorial-heading text-2xl leading-tight mb-2">{profile.name || "Anonymous"}</h2>
                    <div className="flex flex-wrap gap-2">
                      {memberSince && (
                        <span className="rounded-full border border-white/70 bg-background/75 px-3 py-1 text-[11px] font-sans text-muted-foreground">
                          {lang === "it" ? "Membro da" : "Member since"} {memberSince}
                        </span>
                      )}
                      {profileLanguages.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-background/75 px-3 py-1 text-[11px] font-sans text-muted-foreground"
                        >
                          <Languages size={11} className="text-accent" />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-sm font-sans text-foreground/88 leading-[1.8] whitespace-pre-wrap">
                  {profile.bio?.trim() || (lang === "it" ? "Nessuna biografia disponibile al momento." : "No biography available yet.")}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: lang === "it" ? "Articoli" : "Articles", value: formatNumber(data.articles.length), icon: BookOpen },
                  { label: lang === "it" ? "Visualizzazioni" : "Views", value: formatNumber(totalViews), icon: Eye },
                  { label: lang === "it" ? "Mi piace" : "Likes", value: formatNumber(totalLikes), icon: Heart },
                  { label: lang === "it" ? "Link attivi" : "Active links", value: formatNumber(activeSocials.length), icon: Globe },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-[24px] border border-white/55 bg-white/52 p-4">
                      <div className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/70 bg-background/75 mb-3">
                        <Icon size={14} className="text-accent" />
                      </div>
                      <p className="editorial-heading text-2xl leading-none mb-1">{item.value}</p>
                      <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                    </div>
                  );
                })}
              </div>

              {activeSocials.length > 0 && (
                <div className="rounded-[26px] border border-white/55 bg-white/50 p-4">
                  <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                    {lang === "it" ? "Social e link" : "Socials and links"}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeSocials.map((social) => {
                      const Icon = social.icon;
                      return (
                        <a
                          key={social.key}
                          href={social.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-[22px] border border-white/65 bg-background/72 px-4 py-3 hover:bg-background/88 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/70 bg-white/70 mb-3">
                                <Icon size={14} className="text-accent" />
                              </div>
                              <p className="text-sm font-sans font-medium text-foreground">{social.label}</p>
                              <p className="text-xs font-sans text-muted-foreground mt-1 break-all">{social.displayValue}</p>
                            </div>
                            <ExternalLink size={14} className="text-muted-foreground" />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {(data.badges.length > 0 || articles.length > 0) && (
                <div className="rounded-[26px] border border-white/55 bg-white/50 p-4 space-y-4">
                  {data.badges.length > 0 && (
                    <div>
                      <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                        {lang === "it" ? "Badge" : "Badges"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {data.badges.map((badge) => (
                          <span
                            key={badge.id}
                            className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-background/72 px-3 py-1.5 text-xs font-sans text-foreground"
                          >
                            {badge.badge_icon ? <span>{badge.badge_icon}</span> : null}
                            {badge.badge_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {articles.length > 0 && (
                    <div>
                      <p className="text-[10px] font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3">
                        {lang === "it" ? "Articoli recenti" : "Recent articles"}
                      </p>
                      <div className="space-y-3">
                        {articles.slice(0, 3).map((entry) => (
                          <div key={entry.id} className="rounded-[20px] border border-white/65 bg-background/72 px-4 py-3">
                            <p className="font-serif text-lg leading-tight mb-2">
                              {lang === "en" ? entry.title_en : entry.title_it || entry.title_en}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 text-[11px] font-sans text-muted-foreground">
                              {entry.published_at ? (
                                <span>{format(new Date(entry.published_at), lang === "it" ? "d MMM yyyy" : "MMM d, yyyy")}</span>
                              ) : null}
                              <span className="inline-flex items-center gap-1">
                                <Eye size={11} className="text-accent" />
                                {formatNumber(entry.view_count)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Heart size={11} className="text-accent" />
                                {formatNumber(entry.like_count)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ProfileSlidePanel;
