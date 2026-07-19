import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, ExternalLink, RefreshCw, ShieldCheck, TicketCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { redirectToLogin } from "@/lib/auth-redirect";
import {
  MembershipBenefitEvent,
  MembershipPayment,
  MembershipTier,
  benefitLabel,
  benefitValue,
  billingIntervalLabel,
  formatCurrency,
  formatDateTime,
  isActiveSubscription,
  loadMembership,
  type CommunitySubscription,
} from "@/lib/community";

const CrewAccountPage = () => {
  const [subscription, setSubscription] = useState<CommunitySubscription | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [payments, setPayments] = useState<MembershipPayment[]>([]);
  const [benefitEvents, setBenefitEvents] = useState<MembershipBenefitEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [tierChoices, setTierChoices] = useState<Record<string, { tierId: string; quantity: number }>>({});

  const active = isActiveSubscription(subscription);
  const currentBenefits = useMemo(() => subscription?.membership_tiers?.benefits ?? {}, [subscription]);
  const tierFamilies = useMemo(() => {
    const groups = new Map<string, MembershipTier[]>();
    tiers.forEach((tier) => {
      const key = tier.tier_family || tier.slug;
      groups.set(key, [...(groups.get(key) ?? []), tier]);
    });
    return [...groups.entries()].map(([key, rows]) => ({
      key,
      tiers: rows.sort((a, b) => a.tier_order - b.tier_order),
    }));
  }, [tiers]);

  const load = async () => {
    setLoading(true);
    const membership = await loadMembership();
    if (!membership.session) {
      redirectToLogin();
      return;
    }

    const [tierRes, paymentRes, benefitRes] = await Promise.all([
      supabase.from("membership_tiers").select("*").eq("is_active", true).order("tier_order", { ascending: true }),
      supabase
        .from("membership_payments")
        .select("*, membership_tiers(name, slug)")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("membership_benefit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    setSubscription(membership.subscription);
    setTiers((tierRes.data ?? []) as MembershipTier[]);
    setPayments((paymentRes.data ?? []) as MembershipPayment[]);
    setBenefitEvents((benefitRes.data ?? []) as MembershipBenefitEvent[]);
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

    setBusyTier(tierId);
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
      setBusyTier(null);
    }
  };

  const checkPaymentStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      redirectToLogin();
      return;
    }

    setCheckingStatus(true);
    try {
      const response = await fetch("/api/payments/bunq/membership/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "membership_status_failed");
      if (body.status === "paid") toast.success("Crew Pass aggiornato.");
      await load();
    } catch (error) {
      console.error(error);
      toast.error("Stato pagamento non aggiornato.");
    } finally {
      setCheckingStatus(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">Caricamento account...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="crew-panel rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--teal))]">Crew Pass</p>
              <h1 className="mt-3 font-serif text-5xl leading-none text-slate-950">
                {active ? subscription?.membership_tiers?.name : "Nessun pass attivo"}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
                Gestisci accesso, benefit e pagamenti della community. I benefit viaggio sono tracciati qui, ma vengono applicati al booking solo quando il flusso principale sarà pronto.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void checkPaymentStatus()}
              disabled={checkingStatus}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/72 px-5 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              <RefreshCw size={15} />
              Aggiorna stato
            </button>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
              <ShieldCheck size={19} className="text-[hsl(var(--teal))]" />
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">Stato</p>
              <p className="mt-1 font-serif text-2xl text-slate-950">{subscription?.status ?? "free"}</p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
              <TicketCheck size={19} className="text-[hsl(var(--teal))]" />
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">Rinnovo</p>
              <p className="mt-1 font-serif text-2xl text-slate-950">{formatDateTime(subscription?.current_period_end) || "manuale"}</p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
              <CreditCard size={19} className="text-[hsl(var(--teal))]" />
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">Ultimo pagamento</p>
              <p className="mt-1 font-serif text-2xl text-slate-950">{payments[0] ? formatCurrency(payments[0].amount_cents, payments[0].currency) : "-"}</p>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="font-serif text-3xl text-slate-950">Benefit attivi</h2>
            {Object.keys(currentBenefits).length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Object.entries(currentBenefits).map(([key, value]) => (
                  <div key={key} className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
                    <p className="text-sm font-medium text-slate-950">{benefitLabel(key)}</p>
                    <p className="mt-1 text-sm text-slate-600">{benefitValue(key, value)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Attiva un tier per vedere i benefit.</p>
            )}
          </div>

          <div className="mt-8">
            <h2 className="font-serif text-3xl text-slate-950">Storico benefit</h2>
            {benefitEvents.length ? (
              <div className="mt-4 divide-y divide-slate-200/80 rounded-3xl border border-slate-200/80 bg-white/62">
                {benefitEvents.map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                    <div>
                      <p className="font-medium text-slate-950">{benefitLabel(event.benefit_key)}</p>
                      <p className="text-slate-500">{event.target_type}</p>
                    </div>
                    <p className="text-slate-500">{formatDateTime(event.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Nessun benefit viaggio applicato finora.</p>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <div className="crew-panel rounded-[2rem] p-5">
            <h2 className="font-serif text-2xl text-slate-950">Cambia tier</h2>
            <div className="mt-4 space-y-3">
              {tierFamilies.map((family) => {
                const selected = tierChoices[family.key];
                const currentTier = family.tiers.find((tier) => tier.id === selected?.tierId) ?? family.tiers[0];
                const quantity = selected?.quantity ?? 1;
                return (
                <div key={family.key} className="rounded-3xl border border-slate-200/80 bg-white/68 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-xl text-slate-950">{currentTier.sort_label || currentTier.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{currentTier.description}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-950">{formatCurrency(currentTier.price_cents * quantity, currentTier.currency)}</p>
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
                  <label className="mt-3 block">
                    <span className="crew-label">Copertura</span>
                    <select
                      className="crew-field mt-1 min-h-10 py-2 text-sm"
                      value={quantity}
                      onChange={(event) => setTierChoices((current) => ({ ...current, [family.key]: { tierId: currentTier.id, quantity: Number(event.target.value) } }))}
                    >
                      {[1, 2, 3].map((count) => (
                        <option key={count} value={count}>{billingIntervalLabel(currentTier.billing_interval, count)}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void requestMembership(currentTier.id, quantity)}
                    disabled={busyTier === currentTier.id}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white disabled:opacity-45"
                  >
                    {busyTier === currentTier.id ? "Avvio..." : subscription?.tier_id === currentTier.id ? "Rinnova" : "Attiva"}
                  </button>
                </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Rinnovo manuale: niente addebiti automatici. Puoi coprire fino a 3 mesi o 3 anni alla volta.
            </p>
          </div>

          <div className="crew-panel rounded-[2rem] p-5">
            <h2 className="font-serif text-2xl text-slate-950">Pagamenti</h2>
            {payments.length ? (
              <div className="mt-4 space-y-3">
                {payments.map((payment) => (
                  <div key={payment.id} className="rounded-3xl border border-slate-200/80 bg-white/68 p-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-950">{payment.membership_tiers?.name ?? "Crew Pass"}</p>
                        <p className="text-slate-500">{payment.reference}</p>
                      </div>
                      <p className="font-semibold text-slate-950">{formatCurrency(payment.amount_cents, payment.currency)}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{payment.status}</span>
                      {payment.share_url && payment.status === "pending" && (
                        <a className="inline-flex items-center gap-1 text-xs font-medium text-slate-950" href={payment.share_url}>
                          Paga
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Nessun pagamento registrato.</p>
            )}
          </div>
        </aside>
      </div>

      <div className="mt-6">
        <Link to="/" className="text-sm font-medium text-slate-700 hover:text-slate-950">Torna al feed</Link>
      </div>
    </div>
  );
};

export default CrewAccountPage;
