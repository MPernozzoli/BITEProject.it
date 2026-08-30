import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ProfileAvatar from "@/components/ProfileAvatar";
import AvatarCropDialog from "@/components/admin/AvatarCropDialog";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { isProfileComplete } from "@/lib/profile-completeness";
import { toast } from "sonner";

const TRUSTED_BITE_HOST_RE = /(^|\.)biteproject\.it$/i;

const normalizeTrustedRedirect = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return "";
    if (parsed.pathname === "/login" || parsed.pathname === "/signup" || parsed.pathname === "/complete-profile") return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
};

const normalizeTrustedReturnUrl = (value: string | null | undefined) => {
  if (!value) return "";

  const internal = normalizeTrustedRedirect(value);
  if (internal) return internal;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !TRUSTED_BITE_HOST_RE.test(parsed.hostname)) return "";
    if (
      parsed.hostname === "login.biteproject.it" &&
      (parsed.pathname === "/login" || parsed.pathname === "/signup" || parsed.pathname === "/complete-profile")
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

const goToTrustedRedirect = (navigate: ReturnType<typeof useNavigate>, redirectTo: string) => {
  if (/^https:\/\//i.test(redirectTo)) {
    window.location.assign(redirectTo);
    return;
  }

  if (window.location.hostname === "login.biteproject.it") {
    window.location.assign(new URL(redirectTo, "https://biteproject.it").toString());
    return;
  }

  navigate(redirectTo, { replace: true });
};

const COPY = {
  it: {
    badge: "Ultimo passo",
    title: "Completa il tuo profilo.",
    description:
      "Nome e bio compaiono nei commenti e nella tua scheda pubblica: bastano due righe per farti riconoscere dalla community.",
    changePhoto: "Aggiungi foto",
    photoHint: "Facoltativa. PNG o JPG, puoi ritagliarla prima di salvarla.",
    nameLabel: "Nome visibile",
    namePlaceholder: "Come vuoi farti chiamare?",
    bioLabel: "Bio",
    bioPlaceholder: "Racconta chi sei, cosa fai e cosa porti a bordo.",
    save: "Salva e continua",
    saving: "Salvataggio...",
    later: "Lo farò più tardi",
    error: "Impossibile salvare il profilo. Riprova.",
    invalidImage: "Seleziona un file immagine valido.",
    avatarError: "Impossibile caricare la foto profilo.",
  },
  en: {
    badge: "Last step",
    title: "Complete your profile.",
    description:
      "Your name and bio show up in comments and on your public profile card: a couple of lines are enough for the community to recognize you.",
    changePhoto: "Add a photo",
    photoHint: "Optional. PNG or JPG, you can crop it before saving.",
    nameLabel: "Display name",
    namePlaceholder: "What should we call you?",
    bioLabel: "Bio",
    bioPlaceholder: "Tell people who you are, what you do, and what you bring aboard.",
    save: "Save and continue",
    saving: "Saving...",
    later: "I'll do it later",
    error: "Unable to save the profile. Please try again.",
    invalidImage: "Select a valid image file.",
    avatarError: "Unable to upload the profile photo.",
  },
} as const;

const CompleteProfile = () => {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useI18n();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const copy = COPY[lang === "en" ? "en" : "it"];
  const homeRedirect = lang === "en" ? "/en" : "/it";
  const redirectTo = normalizeTrustedReturnUrl((location.state as { from?: string } | null)?.from) || homeRedirect;

  useEffect(() => {
    if (authLoading) return;

    if (!session?.user) {
      navigate("/login", { state: { from: redirectTo }, replace: true });
      return;
    }

    let cancelled = false;
    const userId = session.user.id;

    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("name, bio, avatar_url")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Failed to load profile for completion step:", error);
      }

      if (data && isProfileComplete(data)) {
        goToTrustedRedirect(navigate, redirectTo);
        return;
      }

      setName(data?.name || "");
      setBio(data?.bio || "");
      setAvatarUrl(data?.avatar_url || "");
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
    // redirectTo intentionally excluded: it is derived from immutable initial navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session, navigate]);

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
      toast.error(copy.invalidImage);
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
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error(copy.avatarError);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const goToRedirect = useCallback(() => {
    goToTrustedRedirect(navigate, redirectTo);
  }, [navigate, redirectTo]);

  const handleSave = async () => {
    if (!session?.user) return;
    setSaving(true);

    try {
      const { error } = await supabase.from("profiles").upsert(
        {
          id: session.user.id,
          email: (session.user.email || "").trim().toLowerCase(),
          name: name.trim(),
          bio: bio.trim() || null,
          avatar_url: avatarUrl || null,
        },
        { onConflict: "id" },
      );

      if (error) throw error;

      goToRedirect();
    } catch (error) {
      console.error("Failed to save profile completion step:", error);
      toast.error(copy.error);
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && bio.trim().length > 0 && !saving;

  if (authLoading || checking) {
    return <div className="min-h-screen" aria-hidden="true" />;
  }

  return (
    <div className="relative isolate overflow-hidden px-6 pb-24 pt-24 sm:px-8 lg:px-12">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,_hsl(var(--salt))_0%,_hsl(var(--salt-warm))_28%,_hsl(var(--secondary))_58%,_hsl(var(--background))_100%)]" />

      <div className="mx-auto max-w-xl">
        <div className="rounded-[2rem] border border-glass-edge/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.86)_0%,_rgba(255,255,255,0.72)_100%)] dark:bg-[linear-gradient(180deg,_rgba(26,37,55,0.86)_0%,_rgba(21,31,47,0.72)_100%)] p-6 shadow-[0_36px_90px_-48px_hsl(var(--navy)/0.55)] backdrop-blur md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{copy.badge}</p>
          <h1 className="editorial-heading mt-3 text-4xl leading-tight text-foreground">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.description}</p>

          <div className="mt-8 flex items-center gap-5">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-[24px] border border-glass-edge/70 bg-muted shadow-[0_14px_45px_rgba(15,23,42,0.12)]"
            >
              <ProfileAvatar
                name={name || "Avatar"}
                avatarUrl={avatarUrl}
                imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                fallback={<Camera className="h-full w-full p-6 text-muted-foreground" />}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-primary/42 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="text-primary-foreground" size={16} />
              </div>
              {uploadingAvatar && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/78 backdrop-blur-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                </div>
              )}
            </button>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{copy.changePhoto}</p>
              <p className="text-xs leading-5 text-muted-foreground">{copy.photoHint}</p>
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

          <div className="mt-8 space-y-5">
            <div className="space-y-2">
              <label htmlFor="complete-profile-name" className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.nameLabel}
              </label>
              <Input
                id="complete-profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={copy.namePlaceholder}
                className="h-12 rounded-2xl border-glass-edge/80 bg-glass/72 px-4 text-sm shadow-[0_20px_44px_-32px_hsl(var(--navy)/0.45)] focus-visible:ring-accent focus-visible:ring-offset-0"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="complete-profile-bio" className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.bioLabel}
              </label>
              <Textarea
                id="complete-profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={copy.bioPlaceholder}
                rows={4}
                className="rounded-2xl border-glass-edge/80 bg-glass/72 px-4 py-3 text-sm shadow-[0_20px_44px_-32px_hsl(var(--navy)/0.45)] focus-visible:ring-accent focus-visible:ring-offset-0"
              />
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="h-12 flex-1 rounded-full bg-primary px-6 text-sm font-semibold uppercase tracking-[0.18em] shadow-[0_24px_48px_-28px_hsl(var(--navy)/0.7)] hover:bg-navy-light"
            >
              {saving ? copy.saving : copy.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={goToRedirect}
              disabled={saving}
              className="h-12 flex-1 rounded-full border-glass-edge/85 bg-glass/72 px-6 text-sm font-semibold shadow-[0_20px_44px_-34px_hsl(var(--navy)/0.4)] hover:bg-glass"
            >
              {copy.later}
            </Button>
          </div>
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

export default CompleteProfile;
