import { useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type MembershipTier = Database["public"]["Tables"]["membership_tiers"]["Row"];
type MembershipSubscription = Database["public"]["Tables"]["membership_subscriptions"]["Row"] & {
  membership_tiers?: MembershipTier | null;
};
type MembershipPayment = Database["public"]["Tables"]["membership_payments"]["Row"] & {
  membership_tiers?: Pick<MembershipTier, "name" | "slug"> | null;
};

const formatCurrency = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
};

const billingIntervalLabel = (interval: string, quantity = 1) => {
  if (interval === "year") return quantity === 1 ? "anno" : `${quantity} anni`;
  if (interval === "month") return quantity === 1 ? "mese" : `${quantity} mesi`;
  return interval;
};

const isActiveSubscription = (subscription: MembershipSubscription | null) =>
  Boolean(
    subscription
      && ["trialing", "active"].includes(subscription.status)
      && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > Date.now()),
  );

export function ProfileCrewPassPanel() {
  const [subscription, setSubscription] = useState<MembershipSubscription | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [payments, setPayments] = useState<MembershipPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [tierChoices, setTierChoices] = useState<Record<string, { tierId: string; quantity: number }>>({});

  const active = isActiveSubscription(subscription);
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }

    const [subscriptionRes, tierRes, paymentRes] = await Promise.all([
      supabase
        .from("membership_subscriptions")
        .select("*, membership_tiers(*)")
        .eq("profile_id", session.user.id)
        .in("status", ["trialing", "active", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("membership_tiers").select("*").eq("is_active", true).order("tier_order", { ascending: true }),
      supabase
        .from("membership_payments")
        .select("*, membership_tiers(name, slug)")
        .eq("profile_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    if (subscriptionRes.error || tierRes.error || paymentRes.error) {
      toast.error(subscriptionRes.error?.message || tierRes.error?.message || paymentRes.error?.message || "Crew Pass non caricato.");
    }

    setSubscription((subscriptionRes.data as MembershipSubscription | null) ?? null);
    setTiers((tierRes.data ?? []) as MembershipTier[]);
    setPayments((paymentRes.data ?? []) as MembershipPayment[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const requestMembership = async (tierId: string, quantity = 1) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

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
      if (body.shareUrl) window.location.href = body.shareUrl;
    } catch (error) {
      console.error(error);
      toast.error("Pagamento Crew Pass non avviato.");
    } finally {
      setBusyTier(null);
    }
  };

  const checkPaymentStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

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
      toast.error("Stato Crew Pass non aggiornato.");
    } finally {
      setCheckingStatus(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Caricamento Crew Pass...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[24px] border border-white/55 bg-white/45 p-4">
          <ShieldCheck size={18} className="text-accent" />
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Stato</p>
          <p className="mt-1 font-serif text-2xl text-foreground">{active ? "Attivo" : "Free"}</p>
        </div>
        <div className="rounded-[24px] border border-white/55 bg-white/45 p-4">
          <UsersRound size={18} className="text-accent" />
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Tier</p>
          <p className="mt-1 font-serif text-2xl text-foreground">{subscription?.membership_tiers?.name ?? "-"}</p>
        </div>
        <div className="rounded-[24px] border border-white/55 bg-white/45 p-4">
          <CreditCard size={18} className="text-accent" />
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Scadenza</p>
          <p className="mt-1 font-serif text-2xl text-foreground">{formatDateTime(subscription?.current_period_end) || "manuale"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/Crew/feed" : "https://crew.biteproject.it/feed"}
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Apri BITE Crew
        </a>
        <button
          type="button"
          onClick={() => void checkPaymentStatus()}
          disabled={checkingStatus}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white/70 px-5 text-sm font-medium text-foreground disabled:opacity-50"
        >
          <RefreshCw size={15} className={checkingStatus ? "animate-spin" : ""} />
          Aggiorna pagamento
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {tierFamilies.map((family) => {
          const selected = tierChoices[family.key];
          const currentTier = family.tiers.find((tier) => tier.id === selected?.tierId) ?? family.tiers[0];
          const quantity = selected?.quantity ?? 1;
          return (
            <div key={family.key} className="rounded-[26px] border border-white/55 bg-white/45 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-xl text-foreground">{currentTier.sort_label || currentTier.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{currentTier.description}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold text-foreground">
                  {formatCurrency(currentTier.price_cents * quantity, currentTier.currency)}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {family.tiers.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setTierChoices((current) => ({ ...current, [family.key]: { tierId: tier.id, quantity } }))}
                    className={`rounded-full px-3 py-2 text-xs font-medium ${currentTier.id === tier.id ? "bg-primary text-primary-foreground" : "bg-white/70 text-muted-foreground"}`}
                  >
                    {formatCurrency(tier.price_cents, tier.currency)}/{billingIntervalLabel(tier.billing_interval)}
                  </button>
                ))}
              </div>
              <select
                className="mt-3 min-h-10 w-full rounded-[18px] border border-border/70 bg-white/80 px-3 py-2 text-sm"
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
                disabled={busyTier === currentTier.id}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busyTier === currentTier.id ? "Avvio..." : subscription?.tier_id === currentTier.id ? "Rinnova" : "Attiva"}
              </button>
            </div>
          );
        })}
      </div>

      {payments.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[26px] border border-white/55 bg-white/45">
          {payments.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-foreground">{payment.membership_tiers?.name ?? "Crew Pass"}</p>
                <p className="text-muted-foreground">{payment.reference}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-foreground">{formatCurrency(payment.amount_cents, payment.currency)}</span>
                {payment.share_url && payment.status === "pending" && (
                  <a className="inline-flex items-center gap-1 text-xs font-medium text-foreground" href={payment.share_url}>
                    Paga
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
