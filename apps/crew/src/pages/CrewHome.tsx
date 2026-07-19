import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Anchor, Lock, Radio, Ship, Sparkles, Vote, Waves } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  CommunitySubscription,
  MembershipTier,
  billingIntervalLabel,
  formatCurrency,
  isActiveSubscription,
  loadMembership,
} from "@/lib/community";

const CrewHome = () => {
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [tierChoices, setTierChoices] = useState<Record<string, { tierId: string; quantity: number }>>({});

  const hasMembership = isActiveSubscription(subscription);
  const sortedTiers = useMemo(() => [...tiers].sort((a, b) => a.tier_order - b.tier_order), [tiers]);
  const tierFamilies = useMemo(() => {
    const groups = new Map<string, MembershipTier[]>();
    sortedTiers.forEach((tier) => {
      const key = tier.tier_family || tier.slug;
      groups.set(key, [...(groups.get(key) ?? []), tier]);
    });
    return [...groups.entries()].map(([key, rows]) => ({ key, tiers: rows }));
  }, [sortedTiers]);

  const load = async () => {
    setLoading(true);
    const [membership, tierRes] = await Promise.all([
      loadMembership(),
      supabase.from("membership_tiers").select("*").eq("is_active", true).order("tier_order", { ascending: true }),
    ]);
    setSubscription(membership.subscription);
    setTiers((tierRes.data ?? []) as MembershipTier[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const requestMembership = async (tierId: string, quantity = 1) => {
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
        body: JSON.stringify({ tierId, quantity }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "membership_payment_failed");
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
        <div className="flex min-h-[28rem] flex-col justify-end rounded-[2rem] bg-slate-950 p-7 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)] md:p-10">
          <div className="mb-auto inline-flex w-fit items-center gap-2 rounded-full border border-white/18 bg-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/80">
            <Radio size={13} />
            Community privata
          </div>
          <h1 className="mt-12 max-w-3xl font-serif text-5xl leading-none tracking-normal md:text-7xl">
            BITE Crew
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/76">
            La parte più vicina al progetto: feed riservato, canali tematici, live, poll e conversazioni dirette con chi segue davvero la barca.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/feed" className="inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-medium text-slate-950">
              Entra nel feed
            </Link>
            {!hasMembership && (
              <a href="#crew-pass" className="inline-flex min-h-11 items-center rounded-full border border-white/24 px-5 text-sm font-medium text-white">
                Vedi Crew Pass
              </a>
            )}
          </div>
        </div>

        <aside id="crew-pass" className="crew-panel rounded-[2rem] p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--teal)/0.14)] text-[hsl(var(--teal))]">
              <Anchor size={20} />
            </span>
            <div>
              <h2 className="font-serif text-2xl text-slate-950">Crew Pass</h2>
              <p className="text-sm text-slate-600">
                {hasMembership ? `Attivo: ${subscription?.membership_tiers?.name}` : "Attivalo per sbloccare il feed."}
              </p>
            </div>
          </div>
          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Caricamento tier...</p>
          ) : (
            <div className="mt-6 space-y-3">
              {tierFamilies.map((family) => {
                const selected = tierChoices[family.key];
                const currentTier = family.tiers.find((tier) => tier.id === selected?.tierId) ?? family.tiers[0];
                const quantity = selected?.quantity ?? 1;
                return (
                  <div key={family.key} className="rounded-3xl border border-slate-200/80 bg-white/72 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-serif text-xl text-slate-950">{currentTier.sort_label || currentTier.name}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{currentTier.description}</p>
                      </div>
                      <p className="whitespace-nowrap text-sm font-semibold text-slate-950">
                        {formatCurrency(currentTier.price_cents * quantity, currentTier.currency)}
                      </p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {family.tiers.map((tier) => (
                        <button
                          key={tier.id}
                          type="button"
                          onClick={() => setTierChoices((current) => ({ ...current, [family.key]: { tierId: tier.id, quantity } }))}
                          className={`rounded-full px-3 py-2 text-xs font-medium ${currentTier.id === tier.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}
                        >
                          {formatCurrency(tier.price_cents, tier.currency)}/{billingIntervalLabel(tier.billing_interval)}
                        </button>
                      ))}
                    </div>
                    <select
                      className="crew-field mt-3 min-h-10 py-2 text-sm"
                      value={quantity}
                      onChange={(event) => setTierChoices((current) => ({ ...current, [family.key]: { tierId: currentTier.id, quantity: Number(event.target.value) } }))}
                    >
                      {[1, 2, 3].map((count) => (
                        <option key={count} value={count}>{billingIntervalLabel(currentTier.billing_interval, count)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void requestMembership(currentTier.id, quantity)}
                      disabled={paymentBusy === currentTier.id}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {paymentBusy === currentTier.id ? "Avvio..." : "Attiva o rinnova"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Nessun rinnovo automatico: ricevi un promemoria e scegli tu se rinnovare.
          </p>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { icon: Sparkles, title: "Feed in stile community", text: "Post recenti in alto, conversazioni sotto e canali tematici per non mescolare tutto." },
          { icon: Waves, title: "Live e Q&A", text: "Thread realtime e room LiveKit quando siamo in navigazione o facciamo briefing.", href: "/live" },
          { icon: Vote, title: "Polls", text: "Decisioni leggere su temi, rotte, priorità e contenuti futuri.", href: "/polls" },
        ].map((item) => (
          <Link key={item.title} to={item.href ?? "/feed"} className="crew-panel rounded-3xl p-5 transition-transform hover:-translate-y-0.5">
            <item.icon className="text-[hsl(var(--teal))]" size={20} />
            <h2 className="mt-4 font-serif text-2xl text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
          </Link>
        ))}
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="crew-panel rounded-3xl p-5">
          <Lock className="text-[hsl(var(--teal))]" size={20} />
          <h2 className="mt-4 font-serif text-2xl text-slate-950">Accesso riservato</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            La home resta vetrina; il feed vero vive in `/feed` ed è disponibile solo con account e membership attiva.
          </p>
        </div>
        <div className="crew-panel rounded-3xl p-5">
          <Ship className="text-[hsl(var(--teal))]" size={20} />
          <h2 className="mt-4 font-serif text-2xl text-slate-950">Profilo unico</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Nome, avatar, bio e link social sono quelli del profilo principale BITE, riusati anche nei post e nei commenti.
          </p>
        </div>
      </section>
    </div>
  );
};

export default CrewHome;
