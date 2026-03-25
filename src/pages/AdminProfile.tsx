import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Save, Camera, Globe } from "lucide-react";
import { ALL_LANGUAGES, SITE_LANGUAGES, type ExtendedLanguage } from "@/lib/i18n";

const AdminProfile = () => {
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState<ExtendedLanguage>("it");
  const [secondaryLanguage, setSecondaryLanguage] = useState<string | null>(null);

  const isSiteNative = SITE_LANGUAGES.includes(preferredLanguage as any);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate("/admin/login"); return; }
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    if (data) {
      setName(data.name || "");
      setBio(data.bio || "");
      setEmail(data.email || session.user.email || "");
      setAvatarUrl(data.avatar_url || "");
      if ((data as any).preferred_language) setPreferredLanguage((data as any).preferred_language);
      if ((data as any).secondary_language) setSecondaryLanguage((data as any).secondary_language);
    }
    const { data: sub } = await supabase.from("newsletter_subscribers").select("*").eq("profile_id", session.user.id).maybeSingle();
    if (sub) setNewsletterSubscribed(sub.subscribed);
  };

  const handleAvatarUpload = async (file: File) => {
    const ext = file.name.split(".").pop();
    const path = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file);
    if (error) { console.error("Avatar upload error:", error); return; }
    const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
    setAvatarUrl(urlData.publicUrl);
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
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("profiles").update({
      name,
      bio,
      avatar_url: avatarUrl,
      preferred_language: preferredLanguage,
      secondary_language: isSiteNative ? null : secondaryLanguage,
    } as any).eq("id", session.user.id);

    const { data: existingSub } = await supabase.from("newsletter_subscribers").select("id").eq("profile_id", session.user.id).maybeSingle();
    if (existingSub) {
      await supabase.from("newsletter_subscribers").update({ subscribed: newsletterSubscribed, email }).eq("profile_id", session.user.id);
    } else {
      await supabase.from("newsletter_subscribers").insert({ profile_id: session.user.id, email, subscribed: newsletterSubscribed });
    }

    setSaving(false);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="editorial-heading text-3xl mb-8">Il mio profilo</h1>

        {/* Avatar */}
        <div className="flex items-center gap-6 mb-8">
          <div className="relative w-24 h-24 rounded-full overflow-hidden bg-muted flex items-center justify-center group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="img-cover" />
            ) : (
              <Camera className="text-muted-foreground" size={32} />
            )}
            <div className="absolute inset-0 bg-primary/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="text-primary-foreground" size={20} />
            </div>
          </div>
          <div>
            <p className="font-sans font-medium">{name || "Il tuo nome"}</p>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ""; }} />
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

          <button onClick={saveProfile} disabled={saving} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50">
            <Save size={14} /> {saving ? "Salvataggio..." : "Salva profilo"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;
