import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Image, Link as LinkIcon, Loader2, Lock, Mic, PlayCircle, Send, Vote } from "lucide-react";
import { toast } from "sonner";

import { CommunityReferenceCards, CommunityReferencePicker } from "@/components/CommunityReferences";
import CommunityPostSurface from "@/components/CommunityPostSurface";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunityChannel,
  CommunityLiveEvent,
  CommunityLinkedResource,
  CommunityPoll,
  CommunityPollOption,
  CommunityPost,
  excerptFor,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  slugify,
  titleFor,
} from "@/lib/community";

const postSelect = "*, profiles:public_profiles(name, avatar_url), membership_tiers(name, slug, tier_order), community_channels(*)";

const datetimeLocalValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const defaultLiveStartsAt = () => datetimeLocalValue(new Date(Date.now() + 15 * 60 * 1000));

const channelIcon = (icon: string) => {
  if (icon === "anchor") return "⚓";
  if (icon === "pot") return "🍳";
  return "#";
};

const CrewFeedPage = () => {
  const { channelSlug } = useParams();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [pollsByPost, setPollsByPost] = useState<Record<string, CommunityPoll>>({});
  const [pollOptionsByPoll, setPollOptionsByPoll] = useState<Record<string, CommunityPollOption[]>>({});
  const [liveEventsByPost, setLiveEventsByPost] = useState<Record<string, CommunityLiveEvent>>({});
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [busyPoll, setBusyPoll] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [postType, setPostType] = useState<"text" | "link" | "media" | "poll" | "live">("text");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [linkedResources, setLinkedResources] = useState<CommunityLinkedResource[]>([]);
  const [liveTitle, setLiveTitle] = useState("");
  const [liveMode, setLiveMode] = useState<"video" | "audio" | "stage">("video");
  const [liveStartsAt, setLiveStartsAt] = useState(defaultLiveStartsAt);

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
      setPollsByPost({});
      setPollOptionsByPoll({});
      setLiveEventsByPost({});
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
    const nextPosts = (postRes.data ?? []) as CommunityPost[];
    setPosts(nextPosts);

    const postIds = nextPosts.map((post) => post.id);
    if (postIds.length) {
      const [pollRes, liveRes] = await Promise.all([
        supabase.from("community_polls").select("*, membership_tiers(name, slug, tier_order)").in("post_id", postIds),
        supabase.from("community_live_events").select("*, membership_tiers(name, slug, tier_order)").in("post_id", postIds),
      ]);

      const nextPolls = (pollRes.data ?? []) as CommunityPoll[];
      setPollsByPost(Object.fromEntries(nextPolls.filter((poll) => poll.post_id).map((poll) => [poll.post_id as string, poll])));
      setLiveEventsByPost(Object.fromEntries(((liveRes.data ?? []) as CommunityLiveEvent[]).filter((event) => event.post_id).map((event) => [event.post_id as string, event])));

      const pollIds = nextPolls.map((poll) => poll.id);
      if (pollIds.length) {
        const optionRes = await supabase
          .from("community_poll_options")
          .select("*")
          .in("poll_id", pollIds)
          .order("option_order", { ascending: true });
        const grouped: Record<string, CommunityPollOption[]> = {};
        ((optionRes.data ?? []) as CommunityPollOption[]).forEach((option) => {
          grouped[option.poll_id] = [...(grouped[option.poll_id] ?? []), option];
        });

        const optionIds = Object.values(grouped).flat().map((option) => option.id);
        const [statsRes, mineRes] = await Promise.all([
          optionIds.length
            ? supabase.from("community_poll_option_stats").select("option_id, votes_count").in("option_id", optionIds)
            : Promise.resolve({ data: [] }),
          membership.session && optionIds.length
            ? supabase.from("community_poll_votes").select("option_id").eq("profile_id", membership.session.user.id).in("option_id", optionIds)
            : Promise.resolve({ data: [] }),
        ]);

        const statsByOption = new Map(((statsRes.data ?? []) as { option_id: string; votes_count: number }[]).map((stat) => [stat.option_id, stat]));
        const mine = new Set(((mineRes.data ?? []) as { option_id: string }[]).map((vote) => vote.option_id));
        Object.entries(grouped).forEach(([pollId, options]) => {
          grouped[pollId] = options.map((option) => ({
            ...option,
            votes_count: Number(statsByOption.get(option.id)?.votes_count ?? 0),
            voted_by_me: mine.has(option.id),
          }));
        });
        setPollOptionsByPoll(grouped);
      } else {
        setPollOptionsByPoll({});
      }
    } else {
      setPollsByPost({});
      setPollOptionsByPoll({});
      setLiveEventsByPost({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("community-feed-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_channels" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_polls" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_poll_option_stats" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_live_events" }, () => void load())
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
    const cleanMediaUrl = mediaUrl.trim();
    const cleanPollOptions = pollOptions.map((option) => option.trim()).filter(Boolean);
    const cleanPollQuestion = pollQuestion.trim();
    const cleanLiveTitle = liveTitle.trim();
    const liveStartDate = new Date(liveStartsAt);
    if (postType === "text" && !text) return;
    if (postType === "link" && !url) return;
    if (postType === "media" && !cleanMediaUrl) {
      toast.error("Inserisci un URL media.");
      return;
    }
    if (postType === "poll" && (!cleanPollQuestion || cleanPollOptions.length < 2)) {
      toast.error("Inserisci una domanda e almeno due opzioni.");
      return;
    }
    if (postType === "live" && !cleanLiveTitle) {
      toast.error("Dai un titolo alla live.");
      return;
    }
    if (postType === "live" && (!liveStartsAt || Number.isNaN(liveStartDate.getTime()))) {
      toast.error("Scegli data e ora della live.");
      return;
    }
    if (postType === "live" && liveStartDate.getTime() < Date.now() - 60 * 1000) {
      toast.error("Programma la live nel futuro.");
      return;
    }

    setPosting(true);
    const title =
      postType === "poll"
        ? cleanPollQuestion
        : postType === "live"
          ? cleanLiveTitle
          : text.split(/\n+/)[0]?.slice(0, 90) || url || "Media";
    const slug = `${slugify(title).slice(0, 72)}-${Date.now().toString(36)}`;
    const content = {
      type: "doc",
      content: text
        ? text.split(/\n{2,}/).map((paragraph) => ({
            type: "paragraph",
            content: [{ type: "text", text: paragraph }],
          }))
        : [{ type: "paragraph", content: [{ type: "text", text: url || cleanMediaUrl }] }],
    };

    const visibility = selectedChannel.visibility === "tier" ? "tier" : "members";
    const minTierId = selectedChannel.min_tier_id;
    const postRes = await supabase.from("community_posts").insert({
      author_profile_id: profileId,
      channel_id: selectedChannel.id,
      post_type: postType,
      external_url: postType === "link" ? url : null,
      media_urls: postType === "media" ? [cleanMediaUrl] : [],
      linked_resources: linkedResources,
      title_it: title,
      title_en: title,
      slug,
      excerpt_it: text.slice(0, 220),
      excerpt_en: text.slice(0, 220),
      content_it: content,
      content_en: content,
      status: "published",
      visibility,
      min_tier_id: minTierId,
      published_at: new Date().toISOString(),
      live_starts_at: postType === "live" ? liveStartDate.toISOString() : null,
    }).select("id").single();

    if (postRes.error || !postRes.data?.id) {
      toast.error(postRes.error?.message || "Post non pubblicato.");
      setPosting(false);
      return;
    }

    const postId = postRes.data.id;
    let surfaceError: { message?: string } | null = null;

    if (postType === "poll") {
      const pollRes = await supabase.from("community_polls").insert({
        post_id: postId,
        created_by: profileId,
        question: cleanPollQuestion,
        description: text,
        visibility,
        min_tier_id: minTierId,
        allow_multiple: pollAllowMultiple,
        is_published: true,
      }).select("id").single();

      if (pollRes.error || !pollRes.data?.id) {
        surfaceError = pollRes.error || { message: "Poll non creato." };
      } else {
        const optionsRes = await supabase.from("community_poll_options").insert(
          cleanPollOptions.map((label, index) => ({
            poll_id: pollRes.data.id,
            label,
            option_order: index,
          })),
        );
        if (optionsRes.error) surfaceError = optionsRes.error;
      }
    }

    if (postType === "live") {
      const liveRes = await supabase.from("community_live_events").insert({
        post_id: postId,
        created_by: profileId,
        title: cleanLiveTitle,
        starts_at: liveStartDate.toISOString(),
        visibility,
        min_tier_id: minTierId,
        livekit_mode: liveMode,
      });
      if (liveRes.error) surfaceError = liveRes.error;
    }

    if (surfaceError) {
      await supabase.from("community_posts").delete().eq("id", postId);
      toast.error(surfaceError.message || "Contenuto collegato non creato.");
    } else {
      setBody("");
      setExternalUrl("");
      setMediaUrl("");
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollAllowMultiple(false);
      setLinkedResources([]);
      setLiveTitle("");
      setLiveMode("video");
      setLiveStartsAt(defaultLiveStartsAt());
      setPostType("text");
      toast.success("Post pubblicato nel feed.");
      await load();
    }
    setPosting(false);
  };

  const voteOption = async (poll: CommunityPoll, option: CommunityPollOption) => {
    if (!profileId) {
      redirectToLogin();
      return;
    }
    setBusyPoll(poll.id);
    if (option.voted_by_me) {
      await supabase.from("community_poll_votes").delete().eq("option_id", option.id).eq("profile_id", profileId);
      setBusyPoll(null);
      await load();
      return;
    }

    if (!poll.allow_multiple) {
      await supabase.from("community_poll_votes").delete().eq("poll_id", poll.id).eq("profile_id", profileId);
    }

    const { error } = await supabase.from("community_poll_votes").insert({
      poll_id: poll.id,
      option_id: option.id,
      profile_id: profileId,
    });
    setBusyPoll(null);
    if (error) {
      toast.error(error.message.includes("single") ? "Questo poll consente una sola opzione." : "Voto non registrato.");
      return;
    }
    await load();
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
            {postType === "media" && (
              <input
                value={mediaUrl}
                onChange={(event) => setMediaUrl(event.target.value)}
                placeholder="URL foto, video o audio"
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
              />
            )}
            {postType === "poll" && (
              <div className="mt-3 space-y-3 rounded-3xl border border-slate-200 bg-white/78 p-3">
                <input
                  value={pollQuestion}
                  onChange={(event) => setPollQuestion(event.target.value)}
                  placeholder="Domanda del poll"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                />
                <div className="space-y-2">
                  {pollOptions.map((option, index) => (
                    <input
                      key={index}
                      value={option}
                      onChange={(event) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                      placeholder={`Opzione ${index + 1}`}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPollOptions((current) => [...current, ""].slice(0, 6))}
                    disabled={pollOptions.length >= 6}
                    className="rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700 disabled:opacity-45"
                  >
                    Aggiungi opzione
                  </button>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={pollAllowMultiple}
                      onChange={(event) => setPollAllowMultiple(event.target.checked)}
                    />
                    Scelta multipla
                  </label>
                </div>
              </div>
            )}
            {postType === "live" && (
              <div className="mt-3 grid gap-3 rounded-3xl border border-slate-200 bg-white/78 p-3 md:grid-cols-[minmax(0,1fr)_13rem_10rem]">
                <input
                  value={liveTitle}
                  onChange={(event) => setLiveTitle(event.target.value)}
                  placeholder="Titolo live"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                />
                <input
                  type="datetime-local"
                  value={liveStartsAt}
                  onChange={(event) => setLiveStartsAt(event.target.value)}
                  min={datetimeLocalValue(new Date())}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                />
                <select
                  value={liveMode}
                  onChange={(event) => setLiveMode(event.target.value as "video" | "audio" | "stage")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                  <option value="stage">Stage</option>
                </select>
              </div>
            )}
            <CommunityReferencePicker value={linkedResources} onChange={setLinkedResources} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setPostType("text")} className={`rounded-full px-3 py-2 text-xs ${postType === "text" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>Testo</button>
                <button type="button" onClick={() => setPostType("link")} className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs ${postType === "link" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}><LinkIcon size={13} />Link</button>
                <button type="button" onClick={() => setPostType("media")} className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs ${postType === "media" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}><Image size={13} />Media</button>
                <button type="button" onClick={() => setPostType("poll")} className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs ${postType === "poll" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}><Vote size={13} />Poll</button>
                <button type="button" onClick={() => setPostType("live")} className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs ${postType === "live" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}><PlayCircle size={13} />Live</button>
                <button type="button" onClick={() => setPostType("media")} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-700"><Mic size={13} />Audio</button>
              </div>
              <button
                type="submit"
                disabled={posting}
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
                </Link>
                <CommunityPostSurface
                  post={post}
                  poll={pollsByPost[post.id]}
                  pollOptions={pollsByPost[post.id] ? pollOptionsByPoll[pollsByPost[post.id].id] : []}
                  liveEvent={liveEventsByPost[post.id]}
                  canVote={Boolean(profileId)}
                  busyPollId={busyPoll}
                  onVote={voteOption}
                />
                <CommunityReferenceCards resources={post.linked_resources} />
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
