import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  Facebook,
  Globe,
  Instagram,
  Languages,
  Linkedin,
  Link as LinkIcon,
  Mail,
  Save,
  UserRound,
  X,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ProfileAvatar from "@/components/ProfileAvatar";
import AvatarCropDialog from "@/components/admin/AvatarCropDialog";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";
import { useAuth } from "@/hooks/useAuth";
import { ALL_LANGUAGES, SITE_LANGUAGES, useI18n, type ExtendedLanguage } from "@/lib/i18n";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TikTokIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const XIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

type SocialFieldKey =
  | "social_instagram"
  | "social_youtube"
  | "social_tiktok"
  | "social_facebook"
  | "social_x"
  | "social_linkedin"
  | "social_website"
  | "social_seapeople";

type StorySubscriptionRow = {
  id: string;
  story_id: string;
  stories: {
    title_it: string;
    title_en: string;
    slug: string;
  } | null;
};

const COPY = {
  it: {
    loading: "Caricamento...",
    title: "Il mio profilo",
    subtitle:
      "Gestisci identita, preferenze e presenza pubblica con lo stesso linguaggio visivo del resto del sito.",
    badge: "Area personale",
    previewTitle: "Come appari alla community",
    previewText:
      "Nome, avatar, bio e link vengono riutilizzati nei commenti, nelle firme autore e nella scheda pubblica.",
    changePhoto: "Cambia foto",
    photoHint: "PNG o JPG. Puoi ritagliare l'immagine prima di salvarla.",
    viewPublicProfile: "Apri profilo pubblico",
    stats: {
      primaryLanguage: "Lingua principale",
      storySubscriptions: "Storie seguite",
      socialLinks: "Link attivi",
      newsletter: "Newsletter",
    },
    sections: {
      identityEyebrow: "Identita",
      identityTitle: "Nome, bio e riconoscibilita",
      identityText: "Aggiorna le informazioni che compaiono nella tua presenza pubblica.",
      preferencesEyebrow: "Preferenze",
      preferencesTitle: "Lingua e comunicazioni",
      preferencesText: "Definisci lingua madre, fallback del sito e aggiornamenti email.",
      socialsEyebrow: "Dove ti si trova",
      socialsTitle: "Social e link esterni",
      socialsText: "Aggiungi solo i riferimenti che vuoi mostrare davvero nella scheda pubblica.",
      subscriptionsEyebrow: "Follow",
      subscriptionsTitle: "Storie che stai seguendo",
      subscriptionsText: "Qui trovi le iscrizioni attive ai thread narrativi del progetto.",
      saveEyebrow: "Salvataggio",
      saveTitle: "Pubblica le modifiche del profilo",
      saveText: "Le modifiche restano locali finche non salvi. Avatar incluso.",
    },
    fields: {
      name: "Nome visibile",
      email: "Email account",
      bio: "Bio",
      bioPlaceholder: "Racconta chi sei, cosa fai e cosa porti a bordo.",
      preferredLanguage: "Lingua preferita",
      secondaryLanguage: "Lingua dei contenuti del sito",
      secondaryHint:
        "Il sito e disponibile solo in italiano e inglese. Seleziona il fallback da usare per i contenuti.",
      newsletterTitle: "Aggiornamenti editoriali via email",
      newsletterHint:
        "Attiva per ricevere nuovi articoli, digest e comunicazioni del progetto nella tua casella.",
    },
    newsletter: {
      on: "Iscritta",
      off: "Non iscritta",
    },
    subscription: {
      empty: "Non stai seguendo nessuna storia al momento.",
      remove: "Rimuovi",
      removed: "Iscrizione rimossa.",
      removeError: "Impossibile aggiornare le iscrizioni alle storie.",
    },
    actions: {
      save: "Salva modifiche",
      saving: "Salvataggio...",
      upload: "Upload...",
      avatarReady: "Foto profilo pronta. Salva il profilo per pubblicarla.",
      avatarError: "Impossibile caricare la foto profilo.",
      invalidImage: "Seleziona un file immagine valido.",
      saveSuccess: "Profilo aggiornato.",
      saveError: "Impossibile salvare il profilo.",
    },
    misc: {
      noSecondaryLanguage: "Nessuna",
    },
  },
  en: {
    loading: "Loading...",
    title: "My profile",
    subtitle:
      "Manage identity, preferences, and public presence using the same visual system as the rest of the site.",
    badge: "Personal area",
    previewTitle: "How you appear to the community",
    previewText:
      "Name, avatar, bio, and links are reused across comments, author signatures, and the public profile card.",
    changePhoto: "Change photo",
    photoHint: "PNG or JPG. You can crop the image before saving.",
    viewPublicProfile: "Open public profile",
    stats: {
      primaryLanguage: "Primary language",
      storySubscriptions: "Followed stories",
      socialLinks: "Active links",
      newsletter: "Newsletter",
    },
    sections: {
      identityEyebrow: "Identity",
      identityTitle: "Name, bio, and recognizability",
      identityText: "Update the details that show up in your public presence.",
      preferencesEyebrow: "Preferences",
      preferencesTitle: "Language and communications",
      preferencesText: "Set native language, site fallback, and email updates.",
      socialsEyebrow: "Where to find you",
      socialsTitle: "Social and external links",
      socialsText: "Add only the references you actually want to expose on your public card.",
      subscriptionsEyebrow: "Following",
      subscriptionsTitle: "Stories you are following",
      subscriptionsText: "Your active subscriptions to the narrative threads of the project live here.",
      saveEyebrow: "Save",
      saveTitle: "Publish profile changes",
      saveText: "Changes stay local until you save them. Avatar included.",
    },
    fields: {
      name: "Display name",
      email: "Account email",
      bio: "Bio",
      bioPlaceholder: "Tell people who you are, what you do, and what you bring aboard.",
      preferredLanguage: "Preferred language",
      secondaryLanguage: "Site content language",
      secondaryHint:
        "The site is only available in Italian and English. Select the fallback language for editorial content.",
      newsletterTitle: "Editorial updates by email",
      newsletterHint:
        "Enable this to receive new articles, digests, and project updates in your inbox.",
    },
    newsletter: {
      on: "Subscribed",
      off: "Off",
    },
    subscription: {
      empty: "You are not following any stories right now.",
      remove: "Remove",
      removed: "Subscription removed.",
      removeError: "Unable to update story subscriptions.",
    },
    actions: {
      save: "Save changes",
      saving: "Saving...",
      upload: "Upload...",
      avatarReady: "Profile photo ready. Save the profile to publish it.",
      avatarError: "Unable to upload the profile photo.",
      invalidImage: "Select a valid image file.",
      saveSuccess: "Profile updated.",
      saveError: "Unable to save the profile.",
    },
    misc: {
      noSecondaryLanguage: "None",
    },
  },
} as const;

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
  const [storySubscriptions, setStorySubscriptions] = useState<
    Array<{ id: string; story_id: string; story: { title_it: string; title_en: string; slug: string } }>
  >([]);
  const [removingStoryId, setRemovingStoryId] = useState<string | null>(null);
  const [socials, setSocials] = useState<Record<SocialFieldKey, string>>({
    social_instagram: "",
    social_youtube: "",
    social_tiktok: "",
    social_facebook: "",
    social_x: "",
    social_linkedin: "",
    social_website: "",
    social_seapeople: "",
  });
  const { lang } = useI18n();

  const copy = COPY[lang === "en" ? "en" : "it"];
  const isSiteNative = SITE_LANGUAGES.includes(preferredLanguage as "it" | "en");
  const activeSocialCount = Object.values(socials).filter((value) => value.trim()).length;
  const preferredLanguageLabel =
    ALL_LANGUAGES.find((language) => language.code === preferredLanguage)?.label ?? preferredLanguage;
  const secondaryLanguageLabel = secondaryLanguage
    ? ALL_LANGUAGES.find((language) => language.code === secondaryLanguage)?.label ?? secondaryLanguage
    : copy.misc.noSecondaryLanguage;

  const socialFields: Array<{
    key: SocialFieldKey;
    label: string;
    placeholder: string;
    icon: JSX.Element;
  }> = [
    { key: "social_instagram", label: "Instagram", placeholder: "@username", icon: <Instagram size={16} className="text-accent" /> },
    { key: "social_youtube", label: "YouTube", placeholder: "@channel", icon: <Youtube size={16} className="text-accent" /> },
    { key: "social_tiktok", label: "TikTok", placeholder: "@username", icon: <TikTokIcon size={16} className="text-accent" /> },
    { key: "social_facebook", label: "Facebook", placeholder: lang === "en" ? "page or profile" : "pagina o profilo", icon: <Facebook size={16} className="text-accent" /> },
    { key: "social_x", label: "X", placeholder: "@username", icon: <XIcon size={16} className="text-accent" /> },
    { key: "social_linkedin", label: "LinkedIn", placeholder: "username", icon: <Linkedin size={16} className="text-accent" /> },
    { key: "social_website", label: lang === "en" ? "Website" : "Sito web", placeholder: "https://example.com", icon: <Globe size={16} className="text-accent" /> },
    { key: "social_seapeople", label: "SeaPeople", placeholder: lang === "en" ? "profile link or slug" : "link profilo o slug", icon: <SeaPeopleIcon size={16} className="text-accent" /> },
  ];

  const stats = [
    { label: copy.stats.primaryLanguage, value: preferredLanguageLabel, icon: Languages },
    { label: copy.stats.storySubscriptions, value: String(storySubscriptions.length).padStart(2, "0"), icon: BookOpen },
    { label: copy.stats.socialLinks, value: String(activeSocialCount).padStart(2, "0"), icon: LinkIcon },
    { label: copy.stats.newsletter, value: newsletterSubscribed ? copy.newsletter.on : copy.newsletter.off, icon: Mail },
  ];

  const loadNewsletterState = useCallback(
    async (userId: string, currentEmail: string) => {
      const { data: newsletterState, error: newsletterError } = await supabase.functions.invoke(
        "my-newsletter-subscription",
        {
          body: {},
        },
      );

      if (!newsletterError) {
        setNewsletterSubscribed(Boolean(newsletterState?.subscribed));
        return;
      }

      console.error("Newsletter subscription load via function failed:", newsletterError);

      const normalizedEmail = currentEmail.trim().toLowerCase();
      const newsletterQuery = supabase.from("newsletter_subscribers").select("subscribed");
      const { data: fallbackSubscription, error: fallbackError } = await (normalizedEmail
        ? newsletterQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
        : newsletterQuery.eq("profile_id", userId))
        .maybeSingle();

      if (fallbackError) {
        console.error("Newsletter subscription fallback load error:", fallbackError);
        return;
      }

      setNewsletterSubscribed(Boolean(fallbackSubscription?.subscribed));
    },
    [],
  );

  const syncNewsletterPreference = useCallback(
    async (userId: string, currentEmail: string, subscribed: boolean) => {
      const normalizedEmail = currentEmail.trim().toLowerCase();
      const subscriptionQuery = supabase.from("newsletter_subscribers").select("id");
      const { data: existingSub, error: existingSubError } = await (normalizedEmail
        ? subscriptionQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
        : subscriptionQuery.eq("profile_id", userId))
        .maybeSingle();

      if (existingSubError) {
        console.error("Direct newsletter lookup failed, trying function fallback:", existingSubError);

        const { error } = await supabase.functions.invoke("my-newsletter-subscription", {
          body: {
            subscribed,
            source: "profile",
          },
        });

        if (!error) {
          return;
        }

        console.error("Newsletter sync via function failed:", error);

        if (subscribed) {
          const { error: subscribeError } = await supabase.functions.invoke("newsletter-subscribe", {
            body: {
              email: normalizedEmail,
              consent: true,
              source: "profile",
              preferredLanguage,
            },
          });

          if (subscribeError) {
            throw subscribeError;
          }

          return;
        }

        throw error;
      }

      if (subscribed) {
        const mutation = existingSub?.id
          ? supabase
              .from("newsletter_subscribers")
              .update({
                profile_id: userId,
                email: normalizedEmail,
                subscribed: true,
              })
              .eq("id", existingSub.id)
          : supabase.from("newsletter_subscribers").insert({
              profile_id: userId,
              email: normalizedEmail,
              subscribed: true,
            });

        const { error: subscribeError } = await mutation;

        if (subscribeError) {
          throw subscribeError;
        }

        return;
      }

      if (existingSub?.id) {
        const { error: subscriberError } = await supabase
          .from("newsletter_subscribers")
          .update({
            profile_id: userId,
            email: normalizedEmail,
            subscribed: false,
          })
          .eq("id", existingSub.id);

        if (subscriberError) {
          throw subscriberError;
        }
      }
    },
    [preferredLanguage],
  );

  const loadProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileLoaded(true);
      return;
    }

    try {
      const currentEmail = session?.user.email || "";
      setEmail(currentEmail);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "name, bio, avatar_url, preferred_language, secondary_language, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website, social_seapeople",
        )
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

      await loadNewsletterState(userId, currentEmail);

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
          (storySubs as StorySubscriptionRow[])
            .filter((subscription) => Boolean(subscription.stories))
            .map((subscription) => ({
              id: subscription.id,
              story_id: subscription.story_id,
              story: subscription.stories as StorySubscriptionRow["stories"] & {
                title_it: string;
                title_en: string;
                slug: string;
              },
            })),
        );
      }
    } finally {
      setProfileLoaded(true);
    }
  }, [loadNewsletterState, navigate, session]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate("/login", { state: { from: "/profile" }, replace: true });
      return;
    }
    void loadProfile();
  }, [authLoading, loadProfile, navigate, session]);

  useEffect(() => {
    return () => {
      if (pendingAvatarUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pendingAvatarUrl);
      }
    };
  }, [pendingAvatarUrl]);

  const resetPendingAvatar = () => {
    setPendingAvatarUrl(null);
    setAvatarCropOpen(false);
  };

  const handleAvatarSelected = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(copy.actions.invalidImage);
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
      toast.success(copy.actions.avatarReady);
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error(copy.actions.avatarError);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLanguageChange = (language: ExtendedLanguage) => {
    setPreferredLanguage(language);
    if (SITE_LANGUAGES.includes(language as "it" | "en")) {
      setSecondaryLanguage(null);
    } else if (!secondaryLanguage || !SITE_LANGUAGES.includes(secondaryLanguage as "it" | "en")) {
      setSecondaryLanguage("it");
    }
  };

  const handleStoryUnsubscribe = async (subscriptionId: string) => {
    setRemovingStoryId(subscriptionId);
    try {
      const { error } = await supabase.from("story_subscriptions").delete().eq("id", subscriptionId);
      if (error) throw error;
      setStorySubscriptions((current) => current.filter((subscription) => subscription.id !== subscriptionId));
      toast.success(copy.subscription.removed);
    } catch (error) {
      console.error("Story unsubscribe error:", error);
      toast.error(copy.subscription.removeError);
    } finally {
      setRemovingStoryId(null);
    }
  };

  const saveProfile = async () => {
    if (!session) return;
    setSaving(true);
    const userId = session.user.id;
    const currentEmail = (session.user.email || email).trim().toLowerCase();
    let profileSaved = false;
    let newsletterSaved = false;

    try {
      const { error: directProfileError } = await supabase
        .from("profiles")
        .update({
          name,
          bio,
          avatar_url: avatarUrl,
          preferred_language: preferredLanguage,
          secondary_language: isSiteNative ? null : secondaryLanguage,
          ...socials,
        })
        .eq("id", userId);

      if (directProfileError) {
        console.error("Direct profile update failed, trying edge function fallback:", directProfileError);

        const { error: functionError } = await supabase.functions.invoke("update-my-profile", {
          body: {
            name,
            bio,
            avatar_url: avatarUrl,
            preferred_language: preferredLanguage,
            secondary_language: isSiteNative ? null : secondaryLanguage,
            newsletter_subscribed: newsletterSubscribed,
            ...socials,
          },
        });

        if (functionError) {
          console.error("Profile save fallback failed:", functionError);
        } else {
          profileSaved = true;
          newsletterSaved = true;
        }
      } else {
        profileSaved = true;
      }

      if (!newsletterSaved) {
        try {
          await syncNewsletterPreference(userId, currentEmail, newsletterSubscribed);
          newsletterSaved = true;
        } catch (newsletterError) {
          console.error("Newsletter sync error:", newsletterError);
        }
      }

      if (profileSaved && newsletterSaved) {
        toast.success(copy.actions.saveSuccess);
        return;
      }

      if (!profileSaved && newsletterSaved) {
        toast.error(
          lang === "en"
            ? "Newsletter updated, but the profile could not be saved."
            : "Newsletter aggiornata, ma il profilo non è stato salvato.",
        );
        return;
      }

      if (profileSaved && !newsletterSaved) {
        toast.error(
          lang === "en"
            ? "Profile saved, but the newsletter subscription could not be updated."
            : "Profilo salvato, ma l'iscrizione newsletter non è stata aggiornata.",
        );
        return;
      }
    } catch (error) {
      console.error("Profile save error:", error);
    } finally {
      setSaving(false);
    }

    toast.error(copy.actions.saveError);
  };

  if (authLoading || (!profileLoaded && session)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen pt-24 pb-20 px-6 md:px-12">
      <div className="max-w-6xl mx-auto space-y-6 md:space-y-8">
        <section className="relative overflow-hidden rounded-[38px] border border-white/55 bg-[linear-gradient(145deg,rgba(255,255,255,0.85),rgba(247,245,239,0.74))] shadow-[0_28px_90px_rgba(15,23,42,0.10)]">
          <div className="absolute -top-20 right-8 h-64 w-64 rounded-full bg-accent/12 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-primary/8 blur-3xl" />

          <div className="relative grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 p-6 md:p-8 lg:p-10">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-3 max-w-2xl">
                  <h1 className="editorial-heading text-4xl md:text-5xl lg:text-6xl leading-none">{copy.title}</h1>
                  <p className="editorial-body text-sm md:text-base leading-relaxed text-foreground/75">
                    {copy.subtitle}
                  </p>
                </div>
              </div>

              <div className="rounded-[30px] border border-stone-200/85 bg-white/72 p-5 md:p-6 shadow-[0_16px_36px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.45)]">
                <div className="flex flex-col gap-5 md:flex-row md:items-center">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="group relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-[30px] border border-white/70 bg-muted shadow-[0_14px_45px_rgba(15,23,42,0.12)]"
                  >
                    <ProfileAvatar
                      name={name || "Avatar"}
                      avatarUrl={avatarUrl}
                      imgClassName="img-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      fallback={<Camera className="h-full w-full p-8 text-muted-foreground" />}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/42 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera className="text-primary-foreground" size={18} />
                    </div>
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/78 text-[11px] font-sans uppercase tracking-[0.2em] text-foreground backdrop-blur-sm">
                        {copy.actions.upload}
                      </div>
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground">
                        {copy.previewTitle}
                      </p>
                      <p className="editorial-heading text-2xl md:text-3xl leading-none">
                        {name.trim() || email || copy.title}
                      </p>
                      <p className="text-sm font-sans text-muted-foreground">{email}</p>
                    </div>
                    <p className="editorial-body text-sm leading-relaxed text-foreground/70 max-w-xl">
                      {copy.previewText}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-white/70 bg-white/70 hover:bg-white/90"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <Camera size={14} />
                        {copy.changePhoto}
                      </Button>
                      <Button
                        asChild
                        type="button"
                        variant="ghost"
                        className="rounded-full text-foreground hover:bg-white/60"
                      >
                        <Link to={`/profile/${session.user.id}`}>
                          {copy.viewPublicProfile}
                          <ArrowUpRight size={14} />
                        </Link>
                      </Button>
                    </div>
                    <p className="text-xs font-sans text-muted-foreground">{copy.photoHint}</p>
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleAvatarSelected(file);
                    event.target.value = "";
                  }}
                />
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
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/75">
                      <Icon size={16} className="text-accent" />
                    </div>
                    <p className="editorial-heading text-2xl md:text-4xl leading-none mb-2 break-words">
                      {item.value}
                    </p>
                    <p className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      {item.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-6">
          <div className="space-y-6">
            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.identityEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.identityTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.identityText}
              </p>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.name}
                  </label>
                  <div className="glass-input rounded-[22px] px-4">
                    <Input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="h-14 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.email}
                  </label>
                  <div className="flex items-center gap-3 rounded-[22px] border border-white/60 bg-white/58 px-4 py-4 text-sm font-sans text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]">
                    <Mail size={16} className="text-accent" />
                    <span className="truncate">{email}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.bio}
                  </label>
                  <div className="glass-input rounded-[24px] px-4 py-1">
                    <Textarea
                      value={bio}
                      onChange={(event) => setBio(event.target.value)}
                      rows={6}
                      placeholder={copy.fields.bioPlaceholder}
                      className="min-h-[168px] border-0 bg-transparent px-0 py-3 text-sm leading-relaxed shadow-none focus-visible:ring-0 resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.socialsEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.socialsTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.socialsText}
              </p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {socialFields.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-[24px] border border-white/60 bg-white/68 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-background/75">
                        {field.icon}
                      </div>
                      <label className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        {field.label}
                      </label>
                    </div>
                    <Input
                      type="text"
                      value={socials[field.key]}
                      onChange={(event) =>
                        setSocials((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      className="h-11 rounded-2xl border-white/65 bg-white/72 shadow-none focus-visible:ring-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.preferencesEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.preferencesTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.preferencesText}
              </p>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.preferredLanguage}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_LANGUAGES.map((language) => (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => handleLanguageChange(language.code)}
                        className={cn(
                          "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                          preferredLanguage === language.code
                            ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                            : "border-white/70 bg-white/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                        )}
                      >
                        {language.label}
                      </button>
                    ))}
                  </div>
                </div>

                {!isSiteNative && (
                  <div className="space-y-3 rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                    <div className="space-y-2">
                      <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                        {copy.fields.secondaryLanguage}
                      </label>
                      <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                        {copy.fields.secondaryHint}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {SITE_LANGUAGES.map((code) => {
                        const label = ALL_LANGUAGES.find((language) => language.code === code)?.label || code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setSecondaryLanguage(code)}
                            className={cn(
                              "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                              secondaryLanguage === code
                                ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                                : "border-white/70 bg-white/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                        {copy.fields.newsletterTitle}
                      </p>
                      <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                        {copy.fields.newsletterHint}
                      </p>
                    </div>
                    <Switch checked={newsletterSubscribed} onCheckedChange={setNewsletterSubscribed} />
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/75">
                      <UserRound size={16} className="text-accent" />
                    </div>
                    <div>
                      <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                        {copy.fields.preferredLanguage}
                      </p>
                      <p className="font-sans text-sm text-foreground mt-1">
                        {preferredLanguageLabel}
                        {!isSiteNative && (
                          <span className="text-muted-foreground"> · {secondaryLanguageLabel}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.subscriptionsEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.subscriptionsTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.subscriptionsText}
              </p>

              {storySubscriptions.length > 0 ? (
                <div className="space-y-3">
                  {storySubscriptions.map((subscription) => (
                    <div
                      key={subscription.id}
                      className="flex items-center justify-between gap-3 rounded-[24px] border border-white/60 bg-white/68 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                    >
                      <Link
                        to={`/stories/${subscription.story.slug}`}
                        className="min-w-0 flex-1 hover:text-accent transition-colors"
                      >
                        <p className="font-sans text-sm font-medium text-foreground truncate">
                          {lang === "en" ? subscription.story.title_en : subscription.story.title_it}
                        </p>
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={removingStoryId === subscription.id}
                        className="h-10 w-10 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleStoryUnsubscribe(subscription.id)}
                        title={copy.subscription.remove}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/70 bg-white/52 px-5 py-8 text-sm font-sans text-muted-foreground">
                  {copy.subscription.empty}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2 max-w-2xl">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground">
                {copy.sections.saveEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl">{copy.sections.saveTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed">{copy.sections.saveText}</p>
            </div>

            <Button
              type="button"
              onClick={saveProfile}
              disabled={saving || uploadingAvatar}
              className="h-12 rounded-full px-6 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
            >
              <Save size={15} />
              {saving ? copy.actions.saving : copy.actions.save}
            </Button>
          </div>
        </section>
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
