import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Check, Lock, Vote } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunityPoll,
  CommunityPollOption,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  type CommunitySubscription,
} from "@/lib/community";

type PollStat = {
  option_id: string;
  votes_count: number;
};

const CrewPollsPage = () => {
  const [polls, setPolls] = useState<CommunityPoll[]>([]);
  const [options, setOptions] = useState<Record<string, CommunityPollOption[]>>({});
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPoll, setBusyPoll] = useState<string | null>(null);

  const canVote = isAdmin || isActiveSubscription(subscription);

  const load = async () => {
    setLoading(true);
    const membership = await loadMembership();
    setSubscription(membership.subscription);
    setIsAdmin(membership.isAdmin);
    setUserId(membership.session?.user.id ?? null);

    const [pollRes] = await Promise.all([
      supabase
        .from("community_polls")
        .select("*, membership_tiers(name, slug, tier_order)")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const nextPolls = (pollRes.data ?? []) as CommunityPoll[];
    setPolls(nextPolls);

    const pollIds = nextPolls.map((poll) => poll.id);
    if (!pollIds.length) {
      setOptions({});
      setLoading(false);
      return;
    }

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

    const statsByOption = new Map(((statsRes.data ?? []) as PollStat[]).map((stat) => [stat.option_id, stat]));
    const mine = new Set(((mineRes.data ?? []) as { option_id: string }[]).map((vote) => vote.option_id));
    Object.entries(grouped).forEach(([pollId, pollOptions]) => {
      grouped[pollId] = pollOptions.map((option) => ({
        ...option,
        votes_count: Number(statsByOption.get(option.id)?.votes_count ?? 0),
        voted_by_me: mine.has(option.id),
      }));
    });

    setOptions(grouped);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("community-polls")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_polls" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_poll_options" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_poll_option_stats" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_poll_votes" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const voteOption = async (poll: CommunityPoll, option: CommunityPollOption) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      redirectToLogin();
      return;
    }
    if (!canVote) {
      toast.error("Serve un Crew Pass attivo per votare.");
      return;
    }

    setBusyPoll(poll.id);
    if (option.voted_by_me) {
      await supabase.from("community_poll_votes").delete().eq("option_id", option.id).eq("profile_id", session.user.id);
      setBusyPoll(null);
      await load();
      return;
    }

    if (!poll.allow_multiple) {
      await supabase.from("community_poll_votes").delete().eq("poll_id", poll.id).eq("profile_id", session.user.id);
    }

    const { error } = await supabase.from("community_poll_votes").insert({
      poll_id: poll.id,
      option_id: option.id,
      profile_id: session.user.id,
    });
    setBusyPoll(null);
    if (error) {
      toast.error(error.message.includes("single") ? "Questo poll consente una sola opzione." : "Voto non registrato.");
      return;
    }
    await load();
  };

  const hidePoll = async (pollId: string) => {
    const { error } = await supabase.from("community_polls").update({ is_published: false }).eq("id", pollId);
    if (error) toast.error("Poll non archiviato.");
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-slate-500">Caricamento poll...</div>;
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-16 pt-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--teal))]">Member input</p>
            <h1 className="mt-2 font-serif text-5xl text-slate-950">Polls</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Domande rapide per scegliere contenuti, priorità, Q&A e idee di bordo.</p>
          </div>
          {!userId && (
            <button type="button" onClick={() => redirectToLogin()} className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
              Accedi per votare
            </button>
          )}
        </div>

        <div className="mt-6 space-y-5">
          {polls.map((poll) => {
            const pollOptions = options[poll.id] ?? [];
            const total = pollOptions.reduce((sum, option) => sum + (option.votes_count ?? 0), 0);
            const closed = Boolean(poll.closes_at && new Date(poll.closes_at).getTime() <= Date.now());
            return (
              <article key={poll.id} className="crew-panel rounded-[2rem] p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {poll.visibility !== "public" && <Lock size={12} />}
                      <span>{poll.visibility === "tier" ? poll.membership_tiers?.name : poll.visibility}</span>
                      {poll.closes_at && <span>chiude {formatDateTime(poll.closes_at)}</span>}
                    </div>
                    <h2 className="mt-3 font-serif text-3xl text-slate-950">{poll.question}</h2>
                    {poll.description && <p className="mt-2 text-sm leading-6 text-slate-600">{poll.description}</p>}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    <BarChart3 size={13} />
                    {total} voti
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {pollOptions.map((option) => {
                    const share = total ? Math.round(((option.votes_count ?? 0) / total) * 100) : 0;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={busyPoll === poll.id || closed || !canVote}
                        onClick={() => void voteOption(poll, option)}
                        className="group w-full rounded-3xl border border-slate-200/80 bg-white/68 p-4 text-left transition-colors hover:border-slate-950 disabled:cursor-not-allowed disabled:opacity-75"
                      >
                        <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-950">
                          <span className="inline-flex items-center gap-2">
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${option.voted_by_me ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300"}`}>
                              {option.voted_by_me && <Check size={12} />}
                            </span>
                            {option.label}
                          </span>
                          <span>{share}%</span>
                        </span>
                        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-[hsl(var(--teal))]" style={{ width: `${share}%` }} />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{poll.allow_multiple ? "Scelta multipla" : "Scelta singola"}{closed ? " · chiuso" : ""}</span>
                  {isAdmin && (
                    <button type="button" onClick={() => void hidePoll(poll.id)} className="font-medium text-slate-700 hover:text-slate-950">
                      Archivia
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {!polls.length && <p className="crew-panel rounded-3xl p-5 text-sm text-slate-600">Nessun poll pubblicato.</p>}
        </div>
      </section>

      <aside>
        <div className="crew-panel rounded-[2rem] p-5">
          <div className="flex items-center gap-3">
            <Vote size={20} className="text-[hsl(var(--teal))]" />
            <h2 className="font-serif text-2xl text-slate-950">Crea dal feed</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            I poll si creano dal riquadro in cima al feed, così ogni contenuto parte dallo stesso punto e resta agganciato al canale corretto.
          </p>
          <Link to="/feed" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
            Apri composer
          </Link>
        </div>
      </aside>
    </div>
  );
};

export default CrewPollsPage;
