import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock, PenLine } from "lucide-react";
import { toast } from "sonner";
import { CommunityReferenceCards } from "@/components/CommunityReferences";
import CommunityPostSurface from "@/components/CommunityPostSurface";
import { supabase } from "@/integrations/supabase/client";
import CommunityComments from "@/components/CommunityComments";
import TiptapRenderer from "@/components/TiptapRenderer";
import {
  CommunityLiveEvent,
  CommunityPoll,
  CommunityPollOption,
  CommunityPost,
  CommunitySubscription,
  excerptFor,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  titleFor,
} from "@/lib/community";

const CrewPostPage = () => {
  const { slug } = useParams();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [poll, setPoll] = useState<CommunityPoll | null>(null);
  const [pollOptions, setPollOptions] = useState<CommunityPollOption[]>([]);
  const [liveEvent, setLiveEvent] = useState<CommunityLiveEvent | null>(null);
  const [busyPoll, setBusyPoll] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const membership = await loadMembership();
    setSubscription(membership.subscription);
    setIsAdmin(membership.isAdmin);
    setIsModerator(membership.isModerator);
    setProfileId(membership.session?.user.id ?? null);
    const { data } = await supabase
      .from("community_posts")
      .select("*, profiles:public_profiles(name, avatar_url), membership_tiers(name, slug, tier_order), community_channels(*)")
      .eq("slug", slug)
      .maybeSingle();
    const nextPost = (data as CommunityPost | null) ?? null;
    setPost(nextPost);

    if (nextPost?.id) {
      const [pollRes, liveRes] = await Promise.all([
        supabase.from("community_polls").select("*, membership_tiers(name, slug, tier_order)").eq("post_id", nextPost.id).maybeSingle(),
        supabase.from("community_live_events").select("*, membership_tiers(name, slug, tier_order)").eq("post_id", nextPost.id).maybeSingle(),
      ]);
      const nextPoll = (pollRes.data as CommunityPoll | null) ?? null;
      setPoll(nextPoll);
      setLiveEvent((liveRes.data as CommunityLiveEvent | null) ?? null);

      if (nextPoll?.id) {
        const optionRes = await supabase
          .from("community_poll_options")
          .select("*")
          .eq("poll_id", nextPoll.id)
          .order("option_order", { ascending: true });
        const options = (optionRes.data ?? []) as CommunityPollOption[];
        const optionIds = options.map((option) => option.id);
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
        setPollOptions(options.map((option) => ({
          ...option,
          votes_count: Number(statsByOption.get(option.id)?.votes_count ?? 0),
          voted_by_me: mine.has(option.id),
        })));
      } else {
        setPollOptions([]);
      }
    } else {
      setPoll(null);
      setPollOptions([]);
      setLiveEvent(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [slug]);

  const canComment = Boolean(subscription && ["trialing", "active"].includes(subscription.status));

  const voteOption = async (currentPoll: CommunityPoll, option: CommunityPollOption) => {
    if (!profileId) return;

    setBusyPoll(currentPoll.id);
    if (option.voted_by_me) {
      await supabase.from("community_poll_votes").delete().eq("option_id", option.id).eq("profile_id", profileId);
      setBusyPoll(null);
      await load();
      return;
    }

    if (!currentPoll.allow_multiple) {
      await supabase.from("community_poll_votes").delete().eq("poll_id", currentPoll.id).eq("profile_id", profileId);
    }

    const { error } = await supabase.from("community_poll_votes").insert({
      poll_id: currentPoll.id,
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
    return <div className="mx-auto max-w-3xl px-4 py-16 text-sm text-slate-500">Caricamento...</div>;
  }

  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="crew-panel rounded-[2rem] p-8">
          <h1 className="font-serif text-4xl text-slate-950">Post non disponibile</h1>
          <p className="mt-3 text-slate-600">Potrebbe richiedere un Crew Pass attivo o essere ancora in bozza.</p>
          <Link to="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">Torna al feed</Link>
        </div>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-4xl px-4 pb-16 pt-8">
      {post.cover_image && <img src={post.cover_image} alt="" className="mb-8 max-h-[32rem] w-full rounded-[2rem] object-cover shadow-[0_24px_80px_rgba(15,23,42,0.14)]" />}
      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500">
        {post.visibility !== "public" && <Lock size={13} />}
        <span>{post.visibility === "public" ? "Pubblico" : post.visibility === "members" ? "Membri" : post.membership_tiers?.name}</span>
        {post.published_at && <span>{formatDateTime(post.published_at)}</span>}
      </div>
      <h1 className="mt-4 font-serif text-5xl leading-none text-slate-950 md:text-7xl">{titleFor(post)}</h1>
      {excerptFor(post) && <p className="mt-5 text-xl leading-9 text-slate-650">{excerptFor(post)}</p>}
      {isAdmin && (
        <Link to={`/studio/${post.id}`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-5 text-sm font-medium text-slate-950">
          <PenLine size={15} />
          Modifica
        </Link>
      )}
      <div className="crew-panel mt-8 rounded-[2rem] p-6 md:p-8">
        <TiptapRenderer content={(post.content_it && Object.keys(post.content_it).length ? post.content_it : post.content_en) as Record<string, unknown>} />
        <CommunityPostSurface
          post={post}
          poll={poll}
          pollOptions={pollOptions}
          liveEvent={liveEvent}
          canVote={isAdmin || isActiveSubscription(subscription)}
          busyPollId={busyPoll}
          onVote={voteOption}
        />
        <CommunityReferenceCards resources={post.linked_resources} />
      </div>
      <CommunityComments postId={post.id} canComment={canComment} isAdmin={isAdmin || isModerator} />
    </article>
  );
};

export default CrewPostPage;
