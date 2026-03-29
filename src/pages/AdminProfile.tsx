import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Save, Camera, Globe, Instagram, Youtube, Facebook, Linkedin, Link as LinkIcon, BookOpen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ALL_LANGUAGES, SITE_LANGUAGES, type ExtendedLanguage } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { toast } from "sonner";
import ProfileAvatar from "@/components/ProfileAvatar";
import AvatarCropDialog from "@/components/admin/AvatarCropDialog";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";

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

const AdminProfile = () => {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState<ExtendedLanguage>("it");
  const [secondaryLanguage, setSecondaryLanguage] = useState<string | null>(null);
  const [socials, setSocials] = useState({
    social_instagram: "",
    social_youtube: "",
    social_tiktok: "",
    social_facebook: "",
    social_x: "",
    social_linkedin: "",
    social_website: "",
    social_seapeople: "",
  });
  const [storySubscriptions, setStorySubscriptions] = useState<Array<{ id: string; story_id: string; story: { title_it: string; title_en: string; slug: string } }>>([]);
  const { lang } = useI18n();

  const isSiteNative = SITE_LANGUAGES.includes(preferredLanguage as any);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate("/login", { state: { from: "/profile" }, replace: true });
      return;
    }
    loadProfile();
  }, [authLoading, session]);

  useEffect(() => {
    return () => {
      if (pendingAvatarUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pendingAvatarUrl);
      }
    };
  }, [pendingAvatarUrl]);

  const loadProfile = async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileLoaded(true);
      return;
    }

    try {
      setEmail(session?.user.email || "");

      const { data, error } = await supabase
        .from("profiles")
        .select("name, bio, avatar_url, preferred_language, secondary_language, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website, social_seapeople")
        .eq("id", userId)
        .single();
      if (error) {
        if (isAuthFailureError(error)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: "/profile" }, replace: true });
          return;
        }
        console.error("Profile load error:", error);
      }

      if (data) {
        setName(data.name || "");
        setBio(data.bio || "");
        setAvatarUrl(data.avatar_url || "");
        if (data.preferred_language) setPreferredLanguage(data.preferred_language as ExtendedLanguage);
        if (data.secondary_language) setSecondaryLanguage(data.secondary_language);
        setSocials({
          social_instagram: data.social_instagram || "",
          social_youtube: data.social_youtube || "",
          social_tiktok: data.social_tiktok || "",
          social_facebook: data.social_facebook || "",
          social_x: data.social_x || "",
          social_linkedin: data.social_linkedin || "",
          social_website: data.social_website || "",
          social_seapeople: data.social_seapeople || "",
        });
      }

      const currentEmail = (session?.user.email || "").trim().toLowerCase();
      const newsletterQuery = supabase
        .from("newsletter_subscribers")
        .select("*");
      const { data: sub, error: subError } = await (currentEmail
        ? newsletterQuery.or(`profile_id.eq.${userId},email.eq.${currentEmail}`)
        : newsletterQuery.eq("profile_id", userId))
        .maybeSingle();
      if (subError) {
        if (isAuthFailureError(subError)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: "/profile" }, replace: true });
          return;
        }
        console.error("Newsletter subscription load error:", subError);
      }
      if (sub) setNewsletterSubscribed(sub.subscribed);

      const { data: storySubs, error: storySubsError } = await supabase
        .from("story_subscriptions")
        .select("id, story_id, stories(title_it, title_en, slug)")
        .eq("profile_id", userId);
      if (storySubsError) {
        if (isAuthFailureError(storySubsError)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: "/profile" }, replace: true });
          return;
        }
        console.error("Story subscriptions load error:", storySubsError);
        return;
      }

      if (storySubs) {
        setStorySubscriptions(
          storySubs.map((s: any) => ({ id: s.id, story_id: s.story_id, story: s.stories }))
        );
      }
    } finally {
      setProfileLoaded(true);
    }
  };

  const resetPendingAvatar = () => {
    setPendingAvatarUrl(null);
    setAvatarCropOpen(false);
  };

  const handleAvatarSelected = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Seleziona un file immagine valido.");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setPendingAvatarUrl(nextUrl);
    setAvatarCropOpen(true);
  };

  const handleAvatarUpload = async (blob: Blob) => {
    setUploadingAvatar(true);

    try {
      const path = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const { error } = await supabase.storage.from("logbook-media").upload(path, blob, {
        contentType: blob.type || "image/png",
      });

      if (error) throw error;

      const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
      setAvatarUrl(urlData.publicUrl);
      resetPendingAvatar();
      toast.success("Foto profilo pronta. Salva il profilo per pubblicarla.");
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error("Impossibile caricare la foto profilo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLanguageChange = (lang: ExtendedLanguage) => {
    setPreferredLanguage(lang);
    if (SITE_LANGUAGES.includes(lang as any)) {
      setSecondaryLanguage(null);
    } else if (!secondaryLanguage || !SITE_LANGUAGES.includes(secondaryLanguage as any)) {
      setSecondaryLanguage("it");
    }
  };

  const saveProfile = async () => {
    if (!session) return;
    setSaving(true);
    const userId = session.user.id;
    await supabase.from("profiles").update({
      name,
      bio,
      avatar_url: avatarUrl,
      preferred_language: preferredLanguage,
      secondary_language: isSiteNative ? null : secondaryLanguage,
      ...socials,
    }).eq("id", userId);

    const normalizedEmail = email.trim().toLowerCase();
    const subscriptionQuery = supabase
      .from("newsletter_subscribers")
      .select("id");
    const { data: existingSub } = await (normalizedEmail
      ? subscriptionQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
      : subscriptionQuery.eq("profile_id", userId))
      .maybeSingle();
    if (existingSub) {
      await supabase
        .from("newsletter_subscribers")
        .update({
          profile_id: userId,
          subscribed: newsletterSubscribed,
          email: normalizedEmail,
          preferred_language: preferredLanguage,
          source: "profile",
        })
        .eq("id", existingSub.id);
    } else {
      await supabase.from("newsletter_subscribers").insert({
        profile_id: userId,
        email: normalizedEmail,
        subscribed: newsletterSubscribed,
        preferred_language: preferredLanguage,
        source: "profile",
      });
    }

    setSaving(false);
  };

  if (authLoading || (!profileLoaded && session)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="editorial-heading text-3xl mb-8">Il mio profilo</h1>

        {/* Avatar */}
        <div className="flex items-center gap-6 mb-8">
          <div className="relative w-24 h-24 rounded-full overflow-hidden bg-muted flex items-center justify-center group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
            <ProfileAvatar
              name={name || "Avatar"}
              avatarUrl={avatarUrl}
              imgClassName="img-cover"
              fallback={<Camera className="text-muted-foreground" size={32} />}
            />
            <div className="absolute inset-0 bg-primary/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="text-primary-foreground" size={20} />
            </div>
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-background/75 backdrop-blur-sm flex items-center justify-center text-[11px] font-sans text-foreground">
                Upload...
              </div>
            )}
          </div>
          <div>
            <p className="font-sans font-medium">{name || "Il tuo nome"}</p>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarSelected(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Fields */}
        <div className="space-y-6">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent border border-border px-4 py-3 font-sans focus:outline-none focus:border-accent transition-colors" />
          </div>
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Bio</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className="w-full bg-transparent border border-border px-4 py-3 font-sans focus:outline-none focus:border-accent transition-colors resize-none" placeholder="Racconta qualcosa di te..." />
          </div>

          {/* Language */}
          <div className="border-t border-border pt-6">
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3 flex items-center gap-2">
              <Globe size={14} /> Lingua preferita
            </label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {ALL_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => handleLanguageChange(l.code)}
                  className={`px-4 py-2.5 text-sm font-sans border transition-colors ${
                    preferredLanguage === l.code
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {!isSiteNative && (
              <div>
                <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                  Seconda lingua (contenuti del sito)
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Il sito è disponibile solo in italiano e inglese. Seleziona la lingua in cui visualizzare i contenuti.
                </p>
                <div className="flex gap-2">
                  {SITE_LANGUAGES.map((code) => {
                    const label = ALL_LANGUAGES.find((l) => l.code === code)?.label || code;
                    return (
                      <button
                        key={code}
                        onClick={() => setSecondaryLanguage(code)}
                        className={`px-5 py-2.5 text-sm font-sans border transition-colors ${
                          secondaryLanguage === code
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Socials */}
          <div className="border-t border-border pt-6">
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-4 flex items-center gap-2">
              <LinkIcon size={14} /> Social & Link
            </label>
            <div className="space-y-3">
              {[
                { key: "social_instagram", icon: <Instagram size={16} />, placeholder: "username" },
                { key: "social_youtube", icon: <Youtube size={16} />, placeholder: "@canale" },
                { key: "social_tiktok", icon: <TikTokIcon size={16} />, placeholder: "@username" },
                { key: "social_facebook", icon: <Facebook size={16} />, placeholder: "pagina o profilo" },
                { key: "social_x", icon: <XIcon size={16} />, placeholder: "@username" },
                { key: "social_linkedin", icon: <Linkedin size={16} />, placeholder: "username" },
                { key: "social_website", icon: <Globe size={16} />, placeholder: "https://tuosito.com" },
                { key: "social_seapeople", icon: <SeaPeopleIcon size={16} />, placeholder: "link al profilo o slug" },
              ].map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="text-muted-foreground w-5 flex-shrink-0 flex items-center justify-center">{s.icon}</span>
                  <input
                    type="text"
                    value={socials[s.key as keyof typeof socials]}
                    onChange={(e) => setSocials((prev) => ({ ...prev, [s.key]: e.target.value }))}
                    placeholder={s.placeholder}
                    className="flex-1 bg-transparent border border-border px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Newsletter */}
          <div className="border-t border-border pt-6">
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3 block">Newsletter</label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setNewsletterSubscribed(!newsletterSubscribed)}
                className={`relative w-10 h-5 rounded-full transition-colors ${newsletterSubscribed ? "bg-accent" : "bg-muted"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-primary-foreground shadow transition-transform ${newsletterSubscribed ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
              <div>
                <span className="text-sm font-sans">{newsletterSubscribed ? "Iscritto alla newsletter" : "Non iscritto alla newsletter"}</span>
                <p className="text-xs text-muted-foreground mt-0.5">Ricevi aggiornamenti su nuovi articoli e novità dal progetto.</p>
              </div>
            </label>
          </div>

          {/* Story Subscriptions */}
          {storySubscriptions.length > 0 && (
            <div className="border-t border-border pt-6">
              <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-3 flex items-center gap-2">
                <BookOpen size={14} /> Iscrizioni alle storie
              </label>
              <div className="space-y-2">
                {storySubscriptions.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between border border-border px-4 py-3">
                    <Link to={`/stories/${sub.story.slug}`} className="text-sm font-sans hover:text-accent transition-colors">
                      {lang === "en" ? sub.story.title_en : sub.story.title_it}
                    </Link>
                    <button
                      onClick={async () => {
                        await supabase.from("story_subscriptions").delete().eq("id", sub.id);
                        setStorySubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
                      }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Disiscriviti"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={saveProfile} disabled={saving || uploadingAvatar} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50">
            <Save size={14} /> {saving ? "Salvataggio..." : "Salva profilo"}
          </button>
        </div>
      </div>

      <AvatarCropDialog
        open={avatarCropOpen}
        imageUrl={pendingAvatarUrl}
        loading={uploadingAvatar}
        onOpenChange={(open) => {
          if (!open) resetPendingAvatar();
          else setAvatarCropOpen(true);
        }}
        onCancel={resetPendingAvatar}
        onConfirm={handleAvatarUpload}
      />
    </div>
  );
};

export default AdminProfile;
