import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Image, Link as LinkIcon, Loader2, Lock, Mic, PlayCircle, Send, Vote } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunityChannel,
  CommunityPost,
  excerptFor,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  slugify,
  titleFor,
} from "@/lib/community";

const postSelect = "*, profiles:public_profiles(name, avatar_url), membership_tiers(name, slug, tier_order), community_channels(*)";

const channelIcon = (icon: string) => {
  if (icon === "anchor") return "⚓";
  if (icon === "pot") return "🍳";
  return "#";
};

const CrewFeedPage = () => {
  const { channelSlug } = useParams();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [body, setBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [postType, setPostType] = useState<"text" | "link">("text");

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.slug === channelSlug) ?? channels.find((channel) => channel.slug === "main") ?? null,
    [channelSlug, channels],
  );

  const load = async () => {
    setLoading(true);
    const membership = await loadMembership();
    if (!membership.session) {
      redirectToLogin(window.location.href);
      return;
    }
    if (!isActiveSubscription(membership.subscription) && !membership.isAdmin) {
      setProfileId(membership.session.user.id);
      setIsAdmin(membership.isAdmin);
      setPosts([]);
      setChannels([]);
      setLoading(false);
      return;
    }

    const channelsRes = await supabase
      .from("community_channels")
      .select("*, membership_tiers(name, slug, tier_order)")
      .eq("is_active", true)
      .order("channel_order", { ascending: true });

    const loadedChannels = (channelsRes.data ?? []) as CommunityChannel[];
    const currentChannel = loadedChannels.find((channel) => channel.slug === channelSlug) ?? loadedChannels.find((channel) => channel.slug === "main") ?? null;
    let postQuery = supabase
      .from("community_posts")
      .select(postSelect)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(60);

    if (currentChannel?.slug && currentChannel.slug !== "main") {
      postQuery = postQuery.eq("channel_id", currentChannel.id);
    }

    const postRes = await postQuery;
    if (channelsRes.error || postRes.error) {
      toast.error(channelsRes.error?.message || postRes.error?.message || "Feed non disponibile.");
    }

    setProfileId(membership.session.user.id);
    setIsAdmin(membership.isAdmin);
    setChannels(loadedChannels);
    setPosts((postRes.data ?? []) as CommunityPost[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("community-feed-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_channels" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelSlug]);

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileId || !selectedChannel) return;
    const text = body.trim();
    const url = externalUrl.trim();
    if (!text && !url) return;

    setPosting(true);
    const title = text.split(/\n+/)[0]?.slice(0, 90) || url;
    const slug = `${slugify(title).slice(0, 72)}-${Date.now().toString(36)}`;
    const content = {
      type: "doc",
      content: text
        ? text.split(/\n{2,}/).map((paragraph) => ({
            type: "paragraph",
            content: [{ type: "text", text: paragraph }],
          }))
        : [{ type: "paragraph", content: [{ type: "text", text: url }] }],
    };

    const { error } = await supabase.from("community_posts").insert({
      author_profile_id: profileId,
      channel_id: selectedChannel.id,
      post_type: postType,
      external_url: postType === "link" ? url : null,
      title_it: title,
      title_en: title,
      slug,
      excerpt_it: text.slice(0, 220),
      excerpt_en: text.slice(0, 220),
      content_it: content,
      content_en: content,
      status: "published",
      visibility: selectedChannel.visibility === "tier" ? "tier" : "members",
      min_tier_id: selectedChannel.min_tier_id,
      published_at: new Date().toISOString(),
    });

    if (error) {
      toast.error(error.message || "Post non pubblicato.");
    } else {
      setBody("");
      setExternalUrl("");
      setPostType("text");
      toast.success("Post pubblicato nel feed.");
      await load();
    }
    setPosting(false);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Caricamento feed...
        </span>
      </div>
    );
  }

  if (!profileId || (!isAdmin && channels.length === 0)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <section className="crew-panel rounded-[2rem] p-8 text-center">
          <Lock className="mx-auto text-[hsl(var(--teal))]" size={26} />
          <h1 className="mt-4 font-serif text-4xl text-slate-950">Feed riservato ai membri</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Serve un account con Crew Pass attivo. La vetrina resta pubblica, ma il feed completo vive qui.
          </p>
          <Link to="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
            Vedi i tier
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-16 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      <aside className="hidden lg:block">
        <div className="crew-panel sticky top-28 rounded-[2rem] p-4">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Canali</p>
          <nav className="mt-3 space-y-1">
            {channels.map((channel) => (
              <Link
                key={channel.id}
                to={channel.slug === "main" ? "/feed" : `/feed/${channel.slug}`}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors ${
                  selectedChannel?.id === channel.id ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-white/70 hover:text-slate-950"
                }`}
              >
                <span className="w-5 text-center">{channelIcon(channel.icon)}</span>
                <span className="truncate">{channel.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <main className="min-w-0 space-y-4">
        <section className="crew-panel rounded-[2rem] p-5">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--teal))]">
              {selectedChannel?.name || "Feed"}
            </p>
            <h1 className="mt-2 font-serif text-4xl text-slate-950">Feed</h1>
            {selectedChannel?.description && <p className="mt-1 text-sm text-slate-600">{selectedChannel.description}</p>}
          </div>
          <form onSubmit={submitPost} className="rounded-3xl border border-slate-200/80 bg-white/70 p-4">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Scrivi qualcosa per la crew..."
              rows={3}
              className="min-h-24 w-full resize-none bg-transparent text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400"
            />
            {postType === "link" && (
              <input
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="https://..."
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
              />
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setPostType("text")} className={`rounded-full px-3 py-2 text-xs ${postType === "text" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>Testo</button>
                <button type="button" onClick={() => setPostType("link")} className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs ${postType === "link" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}><LinkIcon size={13} />Link</button>
                <Link to="/polls" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700"><Vote size={13} />Poll</Link>
                <Link to="/live" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700"><PlayCircle size={13} />Live</Link>
                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-500" title="Upload media dedicato in arrivo"><Image size={13} />Media</button>
                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-500" title="Audio post dedicati in arrivo"><Mic size={13} />Audio</button>
              </div>
              <button
                type="submit"
                disabled={posting || (!body.trim() && !externalUrl.trim())}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white disabled:opacity-45"
              >
                {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Pubblica
              </button>
            </div>
          </form>
        </section>

        {posts.length ? (
          posts.map((post) => (
            <article key={post.id} className="crew-panel overflow-hidden rounded-[2rem]">
              {post.cover_image && <img src={post.cover_image} alt="" className="h-72 w-full object-cover" loading="lazy" />}
              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{post.profiles?.name || "BITE Crew"}</span>
                  {post.community_channels?.name && <span>#{post.community_channels.name}</span>}
                  {post.published_at && <span>{formatDateTime(post.published_at)}</span>}
                </div>
                <Link to={`/post/${post.slug}`} className="group mt-3 block">
                  <h2 className="font-serif text-3xl leading-tight text-slate-950 group-hover:text-slate-700">{titleFor(post)}</h2>
                  {excerptFor(post) && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{excerptFor(post)}</p>}
                  {post.external_url && (
                    <p className="mt-3 truncate rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
                      {post.external_url}
                    </p>
                  )}
                </Link>
              </div>
            </article>
          ))
        ) : (
          <p className="crew-panel rounded-[2rem] p-6 text-sm text-slate-600">Nessun post in questo canale.</p>
        )}
      </main>

      <aside className="hidden xl:block">
        <div className="crew-panel sticky top-28 rounded-[2rem] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Subfeed</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            I canali tengono separati consigli, ricette, media e discussioni specifiche. Gli accessi per tier vengono gestiti da admin.
          </p>
          {isAdmin && (
            <a href="https://admin.biteproject.it/admin?section=community" className="mt-4 inline-flex text-sm font-medium text-slate-950">
              Gestisci in admin
            </a>
          )}
        </div>
      </aside>
    </div>
  );
};

export default CrewFeedPage;
