import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Save, Send, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { CommunityPost, MembershipTier, emptyDoc, slugify } from "@/lib/community";
import { redirectToLogin } from "@/lib/auth-redirect";
import { toast } from "sonner";

const CrewEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [titleIt, setTitleIt] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [slug, setSlug] = useState("");
  const [excerptIt, setExcerptIt] = useState("");
  const [excerptEn, setExcerptEn] = useState("");
  const [contentIt, setContentIt] = useState<Record<string, unknown>>(emptyDoc());
  const [contentEn, setContentEn] = useState<Record<string, unknown>>(emptyDoc());
  const [coverImage, setCoverImage] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "archived">("draft");
  const [visibility, setVisibility] = useState<"public" | "members" | "tier">("members");
  const [minTierId, setMinTierId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"it" | "en">("it");
  const [authorId, setAuthorId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        redirectToLogin();
        return;
      }
      const { data: admin } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
      if (!admin) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setAuthorId(session.user.id);
      setIsAdmin(true);
      const tierRes = await supabase.from("membership_tiers").select("*").order("tier_order", { ascending: true });
      setTiers((tierRes.data ?? []) as MembershipTier[]);
      if (id) {
        const { data } = await supabase.from("community_posts").select("*").eq("id", id).maybeSingle();
        const post = data as CommunityPost | null;
        if (post) {
          setTitleIt(post.title_it ?? "");
          setTitleEn(post.title_en ?? "");
          setSlug(post.slug ?? "");
          setExcerptIt(post.excerpt_it ?? "");
          setExcerptEn(post.excerpt_en ?? "");
          setContentIt((post.content_it as Record<string, unknown>) ?? emptyDoc());
          setContentEn((post.content_en as Record<string, unknown>) ?? emptyDoc());
          setCoverImage(post.cover_image ?? "");
          setStatus(post.status);
          setVisibility(post.visibility);
          setMinTierId(post.min_tier_id ?? "");
        }
      }
      setLoading(false);
    };
    void load();
  }, [id]);

  const uploadCover = async (file: File) => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `community/covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("logbook-media").upload(path, file);
    if (error) {
      toast.error("Upload non riuscito.");
      return;
    }
    const { data } = supabase.storage.from("logbook-media").getPublicUrl(path);
    setCoverImage(data.publicUrl);
  };

  const save = async (nextStatus = status) => {
    if (!authorId) return;
    const cleanSlug = slugify(slug || titleIt || titleEn);
    if (!cleanSlug) {
      toast.error("Serve un titolo o uno slug.");
      return;
    }
    if (visibility === "tier" && !minTierId) {
      toast.error("Scegli il tier minimo.");
      return;
    }
    setSaving(true);
    const payload = {
      author_profile_id: authorId,
      title_it: titleIt,
      title_en: titleEn,
      slug: cleanSlug,
      excerpt_it: excerptIt,
      excerpt_en: excerptEn,
      content_it: contentIt,
      content_en: contentEn,
      cover_image: coverImage || null,
      status: nextStatus,
      visibility,
      min_tier_id: visibility === "tier" ? minTierId : null,
      published_at: nextStatus === "published" ? new Date().toISOString() : null,
    };
    const result = isNew
      ? await supabase.from("community_posts").insert(payload).select("id, slug").single()
      : await supabase.from("community_posts").update(payload).eq("id", id).select("id, slug").single();
    setSaving(false);
    if (result.error) {
      toast.error(result.error.code === "23505" ? "Slug già usato." : "Salvataggio non riuscito.");
      return;
    }
    toast.success(nextStatus === "published" ? "Post pubblicato." : "Bozza salvata.");
    navigate(`/studio/${result.data.id}`, { replace: true });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(status);
  };

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">Caricamento...</div>;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="crew-panel rounded-[2rem] p-8">
          <h1 className="font-serif text-4xl text-slate-950">Accesso riservato</h1>
          <p className="mt-3 text-slate-600">Lo studio BITE Crew è disponibile solo agli admin.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="mx-auto max-w-6xl px-4 pb-16 pt-8" onSubmit={onSubmit}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950">
          <ArrowLeft size={15} />
          Feed
        </Link>
        <div className="flex flex-wrap gap-2">
          {!isNew && slug && (
            <Link to={`/post/${slug}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-5 text-sm font-medium text-slate-950">
              <Eye size={15} />
              Anteprima
            </Link>
          )}
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-5 text-sm font-medium text-slate-950 disabled:opacity-50">
            <Save size={15} />
            Salva
          </button>
          <button type="button" disabled={saving} onClick={() => void save("published")} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white disabled:opacity-50">
            <Send size={15} />
            Pubblica
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="crew-panel rounded-[2rem] p-5 md:p-7">
          <div className="flex gap-2 border-b border-slate-200 pb-4">
            <button type="button" onClick={() => setActiveTab("it")} className={`rounded-full px-4 py-2 text-sm ${activeTab === "it" ? "bg-slate-950 text-white" : "bg-white/70 text-slate-700"}`}>IT</button>
            <button type="button" onClick={() => setActiveTab("en")} className={`rounded-full px-4 py-2 text-sm ${activeTab === "en" ? "bg-slate-950 text-white" : "bg-white/70 text-slate-700"}`}>EN</button>
          </div>

          {activeTab === "it" ? (
            <div className="mt-6 space-y-5">
              <label className="space-y-2">
                <span className="crew-label">Titolo italiano</span>
                <input name="title_it" value={titleIt} onChange={(event) => { setTitleIt(event.target.value); if (!slug) setSlug(slugify(event.target.value)); }} className="crew-field" required />
              </label>
              <label className="space-y-2">
                <span className="crew-label">Estratto italiano</span>
                <textarea name="excerpt_it" value={excerptIt} onChange={(event) => setExcerptIt(event.target.value)} className="crew-field min-h-24" />
              </label>
              <RichTextEditor content={contentIt} onChange={(value) => setContentIt(value as Record<string, unknown>)} placeholder="Scrivi il post per la Crew..." />
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              <label className="space-y-2">
                <span className="crew-label">English title</span>
                <input name="title_en" value={titleEn} onChange={(event) => { setTitleEn(event.target.value); if (!slug) setSlug(slugify(event.target.value)); }} className="crew-field" />
              </label>
              <label className="space-y-2">
                <span className="crew-label">English excerpt</span>
                <textarea name="excerpt_en" value={excerptEn} onChange={(event) => setExcerptEn(event.target.value)} className="crew-field min-h-24" />
              </label>
              <RichTextEditor content={contentEn} onChange={(value) => setContentEn(value as Record<string, unknown>)} placeholder="Write the Crew post..." />
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <div className="crew-panel rounded-[2rem] p-5">
            <h2 className="font-serif text-2xl text-slate-950">Pubblicazione</h2>
            <div className="mt-4 space-y-4">
              <label className="space-y-2">
                <span className="crew-label">Slug</span>
                <input name="slug" value={slug} onChange={(event) => setSlug(slugify(event.target.value))} className="crew-field" required />
              </label>
              <label className="space-y-2">
                <span className="crew-label">Stato</span>
                <select name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="crew-field">
                  <option value="draft">Bozza</option>
                  <option value="published">Pubblicato</option>
                  <option value="archived">Archiviato</option>
                </select>
              </label>
              <fieldset className="space-y-2">
                <legend className="crew-label">Visibilità</legend>
                {[
                  ["public", "Pubblico"],
                  ["members", "Membri"],
                  ["tier", "Tier specifico"],
                ].map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-3 rounded-2xl bg-white/62 px-3 text-sm text-slate-800">
                    <input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value as typeof visibility)} />
                    {label}
                  </label>
                ))}
              </fieldset>
              {visibility === "tier" && (
                <label className="space-y-2">
                  <span className="crew-label">Tier minimo</span>
                  <select name="min_tier_id" value={minTierId} onChange={(event) => setMinTierId(event.target.value)} className="crew-field" required>
                    <option value="">Scegli tier</option>
                    {tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className="crew-panel rounded-[2rem] p-5">
            <h2 className="font-serif text-2xl text-slate-950">Cover</h2>
            {coverImage && <img src={coverImage} alt="" className="mt-4 aspect-video w-full rounded-2xl object-cover" />}
            <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-5 text-sm font-medium text-slate-950">
              <Upload size={15} />
              Carica immagine
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file); }} />
            </label>
          </div>
        </aside>
      </div>
    </form>
  );
};

export default CrewEditor;
