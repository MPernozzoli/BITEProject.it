import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { User, Instagram, Youtube, Facebook, Linkedin, Globe, ExternalLink } from "lucide-react";
import ProfileAvatar from "@/components/ProfileAvatar";

interface ProfileData {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
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
  awarded_at: string;
}

const socialLink = (url: string | null | undefined) => {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `https://${url}`;
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

const socials = [
  { key: "social_instagram", icon: Instagram, label: "Instagram", prefix: "https://instagram.com/" },
  { key: "social_youtube", icon: Youtube, label: "YouTube", prefix: "https://youtube.com/@" },
  { key: "social_tiktok", icon: TikTokIcon, label: "TikTok", prefix: "https://tiktok.com/@" },
  { key: "social_facebook", icon: Facebook, label: "Facebook", prefix: "https://facebook.com/" },
  { key: "social_x", icon: XIcon, label: "X", prefix: "https://x.com/" },
  { key: "social_linkedin", icon: Linkedin, label: "LinkedIn", prefix: "https://linkedin.com/in/" },
  { key: "social_website", icon: Globe, label: "Website", prefix: "" },
] as const;

const PublicProfile = () => {
  const { id } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, bio, avatar_url, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website")
        .eq("id", id)
        .single();
      if (data) setProfile(data as ProfileData);

      const { data: badgeData } = await supabase
        .from("profile_badges")
        .select("*")
        .eq("profile_id", id)
        .order("awarded_at", { ascending: false });
      if (badgeData) setBadges(badgeData);

      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen pt-28 pb-16 px-6 flex items-start justify-center">
        <p className="text-muted-foreground font-sans text-sm">Caricamento...</p>
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

  const activeSocials = socials.filter((s) => {
    const val = profile[s.key as keyof ProfileData] as string | null;
    return val && val.trim() !== "";
  });

  return (
    <div className="min-h-screen pt-28 pb-16 px-6 md:px-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-muted flex items-center justify-center mb-4">
            <ProfileAvatar
              name={profile.name || "Anonymous"}
              avatarUrl={profile.avatar_url}
              imgClassName="img-cover"
              fallback={<User className="text-muted-foreground" size={40} />}
            />
          </div>
          <h1 className="editorial-heading text-2xl md:text-3xl mb-2">{profile.name || "Anonymous"}</h1>
          {profile.bio && (
            <p className="text-sm font-sans text-muted-foreground max-w-md leading-relaxed">{profile.bio}</p>
          )}
        </div>

        {/* Socials */}
        {activeSocials.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {activeSocials.map((s) => {
              const val = profile[s.key as keyof ProfileData] as string;
              const href = socialLink(s.prefix && !val.startsWith("http") ? `${s.prefix}${val}` : val);
              const Icon = s.icon;
              return (
                <a
                  key={s.key}
                  href={href || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm font-sans text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  <Icon size={16} />
                  {s.label}
                  <ExternalLink size={10} className="opacity-40" />
                </a>
              );
            })}
          </div>
        )}

        {/* Badges */}
        {badges.length > 0 && (
          <div className="border-t border-border pt-8">
            <h2 className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-4 text-center">
              {lang === "it" ? "Badge" : "Badges"}
            </h2>
            <div className="flex flex-wrap justify-center gap-3">
              {badges.map((b) => (
                <div key={b.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted text-xs font-sans">
                  {b.badge_icon && <span>{b.badge_icon}</span>}
                  <span>{b.badge_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicProfile;
