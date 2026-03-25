import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Save, Camera, Mail } from "lucide-react";
import { useRef } from "react";

const AdminProfile = () => {
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);

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
    }
    // Load newsletter subscription
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

  const saveProfile = async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("profiles").update({ name, bio, avatar_url: avatarUrl }).eq("id", session.user.id);

    // Save newsletter preference
    const { data: existingSub } = await supabase.from("newsletter_subscribers").select("id").eq("profile_id", session.user.id).maybeSingle();
    if (existingSub) {
      await supabase.from("newsletter_subscribers").update({ subscribed: newsletterSubscribed, email: email }).eq("profile_id", session.user.id);
    } else {
      await supabase.from("newsletter_subscribers").insert({ profile_id: session.user.id, email: email, subscribed: newsletterSubscribed });
    }

    setSaving(false);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-6 md:px-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="editorial-heading text-3xl mb-8">My Profile</h1>

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
            <p className="font-sans font-medium">{name || "Your name"}</p>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ""; }} />
        </div>

        {/* Fields */}
        <div className="space-y-6">
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent border border-border px-4 py-3 font-sans focus:outline-none focus:border-accent transition-colors" />
          </div>
          <div>
            <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">Bio</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className="w-full bg-transparent border border-border px-4 py-3 font-sans focus:outline-none focus:border-accent transition-colors resize-none" placeholder="Tell something about yourself..." />
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
            <Save size={14} /> {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;
