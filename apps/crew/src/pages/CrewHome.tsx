import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Anchor, Lock, Radio, Ship, Sparkles, Vote, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import { CommunityPost, CommunitySubscription, MembershipTier, excerptFor, formatCurrency, formatDateTime, loadMembership, titleFor } from "@/lib/community";
import { toast } from "sonner";

const CrewHome = () => {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);

  const activeTierName = subscription?.membership_tiers?.name ?? null;
  const hasMembership = Boolean(subscription && ["trialing", "active"].includes(subscription.status));

  const sortedTiers = useMemo(() => [...tiers].sort((a, b) => a.tier_order - b.tier_order), [tiers]);

  const load = async () => {
    setLoading(true);
    const [membership, tierRes, postRes] = await Promise.all([
      loadMembership(),
      supabase.from("membership_tiers").select("*").eq("is_active", true).order("tier_order", { ascending: true }),
      supabase
        .from("community_posts")
        .select("*, profiles:public_profiles(name, avatar_url), membership_tiers(name, slug, tier_order)")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(30),
    ]);
    setSubscription(membership.subscription);
    setIsAdmin(membership.isAdmin);
    setTiers((tierRes.data ?? []) as MembershipTier[]);
    setPosts((postRes.data ?? []) as CommunityPost[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("community-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const requestMembership = async (tierId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      redirectToLogin();
      return;
    }
    setPaymentBusy(tierId);
    try {
      const response = await fetch("/api/payments/bunq/membership/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tierId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "membership_payment_failed");
      if (body.alreadyActive) {
        toast.success("Crew Pass già attivo.");
        await load();
        return;
      }
      if (body.shareUrl) window.location.href = body.shareUrl;
    } catch (error) {
      console.error(error);
      toast.error("Pagamento membership non avviato.");
    } finally {
      setPaymentBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <section className="grid gap-6 py-8 md:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] md:py-12">
        <div className="flex min-h-[26rem] flex-col justify-end rounded-[2rem] bg-slate-950 p-7 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)] md:p-10">
          <div className="mb-auto inline-flex w-fit items-center gap-2 rounded-full border border-white/18 bg-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/80">
            <Radio size={13} />
            Community privata in costruzione
          </div>
          <h1 className="mt-12 max-w-3xl font-serif text-5xl leading-none tracking-normal md:text-7xl">
            BITE Crew
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/76">
            Feed riservato, aggiornamenti live dalla barca e conversazioni dirette con i membri. La community resta isolata dal sito principale finché non sarà pronta.
          </p>
        </div>

        <aside className="crew-panel rounded-[2rem] p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--teal)/0.14)] text-[hsl(var(--teal))]">
              <Anchor size={20} />
            </span>
            <div>
              <h2 className="font-serif text-2xl text-slate-950">Crew Pass</h2>
              <p className="text-sm text-slate-600">{hasMembership ? `Attivo: ${activeTierName}` : "Scegli un tier per accedere al feed completo."}</p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {sortedTiers.map((tier) => (
              <div key={tier.id} className="rounded-3xl border border-slate-200/80 bg-white/72 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-xl text-slate-950">{tier.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{tier.description}</p>
                  </div>
                  <p className="whitespace-nowrap text-sm font-semibold text-slate-950">{formatCurrency(tier.price_cents, tier.currency)}/mese</p>
                </div>
                <button
                  type="button"
                  onClick={() => void requestMembership(tier.id)}
                  disabled={paymentBusy === tier.id}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {paymentBusy === tier.id ? "Avvio..." : "Attiva con Bunq"}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { icon: Sparkles, title: "Dietro le quinte", text: "Post lunghi e brevi costruiti con lo stesso editor degli articoli." },
          { icon: Waves, title: "Live thread", text: "Aggiornamenti guidati durante navigazioni, lavori e Q&A con messaggi realtime.", href: "/live" },
          { icon: Vote, title: "Polls", text: "Scelte rapide per temi, rotte, priorità e feedback dei membri.", href: "/polls" },
        ].map((item) => (
          <Link key={item.title} to={item.href ?? "/"} className="crew-panel rounded-3xl p-5 transition-transform hover:-translate-y-0.5">
            <item.icon className="text-[hsl(var(--teal))]" size={20} />
            <h2 className="mt-4 font-serif text-2xl text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
          </Link>
        ))}
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          { icon: Radio, title: "Tempo reale", text: "Feed, commenti, live e poll ascoltano gli aggiornamenti Supabase Realtime." },
          { icon: Ship, title: "Viaggi", text: "I benefit viaggio restano separati e saranno attivati solo quando verificati." },
        ].map((item) => (
          <div key={item.title} className="crew-panel rounded-3xl p-5">
            <item.icon className="text-[hsl(var(--teal))]" size={20} />
            <h2 className="mt-4 font-serif text-2xl text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl text-slate-950">Feed</h2>
            <p className="mt-1 text-sm text-slate-600">Contenuti pubblicati nella community.</p>
          </div>
          {isAdmin && (
            <Link to="/studio" className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white">
              Nuovo post
            </Link>
          )}
        </div>

        {loading ? (
          <p className="mt-8 text-sm text-slate-500">Caricamento feed...</p>
        ) : posts.length ? (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {posts.map((post) => (
              <Link key={post.id} to={`/post/${post.slug}`} className="crew-panel group overflow-hidden rounded-[2rem] transition-transform hover:-translate-y-0.5">
                {post.cover_image && <img src={post.cover_image} alt="" className="h-56 w-full object-cover" loading="lazy" />}
                <div className="p-6">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {post.visibility !== "public" && <Lock size={12} />}
                    <span>{post.visibility === "public" ? "Pubblico" : post.visibility === "tier" ? post.membership_tiers?.name : "Membri"}</span>
                    {post.published_at && <span>{formatDateTime(post.published_at)}</span>}
                  </div>
                  <h3 className="mt-3 font-serif text-3xl leading-tight text-slate-950">{titleFor(post)}</h3>
                  {excerptFor(post) && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{excerptFor(post)}</p>}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="crew-panel mt-6 rounded-3xl p-5 text-sm text-slate-600">
            Nessun post leggibile. Pubblica il primo dallo studio, oppure attiva una subscription di test.
          </p>
        )}
      </section>
    </div>
  );
};

export default CrewHome;
