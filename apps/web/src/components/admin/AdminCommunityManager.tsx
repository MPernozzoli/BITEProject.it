import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Crown,
  Euro,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  UsersRound,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TierRow = Database["public"]["Tables"]["membership_tiers"]["Row"];
type TierUpdate = Database["public"]["Tables"]["membership_tiers"]["Update"];
type LiveEventRow = Database["public"]["Tables"]["community_live_events"]["Row"];
type ChannelRow = Database["public"]["Tables"]["community_channels"]["Row"];
type LiveEventUpdate = Database["public"]["Tables"]["community_live_events"]["Update"];

type SubscriptionRow = {
  id: string;
  profile_id: string;
  status: string;
  current_period_end: string | null;
  profiles?: { name: string | null; email: string | null } | null;
  membership_tiers?: { name: string | null; slug: string | null } | null;
};

type PaymentRow = {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  period_count: number;
  created_at: string;
  paid_at: string | null;
  profiles?: { name: string | null; email: string | null } | null;
  membership_tiers?: { name: string | null; slug: string | null; billing_interval: string | null } | null;
};

type CommunityRoleRow = {
  profile_id: string;
  name: string | null;
  email: string | null;
  is_admin: boolean;
  is_moderator: boolean;
  active_subscription_id: string | null;
  active_tier_name: string | null;
  active_period_end: string | null;
};

type TierForm = {
  name: string;
  description: string;
  price: string;
  isActive: boolean;
};

const adminSupabase = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

const currencyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});

const formatMoney = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
  }).format(cents / 100);

const formatDateTime = (value: string | null) => {
  if (!value) return "Non impostata";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const datetimeLocalValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const liveStatusForAdmin = (event: Pick<LiveEventRow, "starts_at" | "ends_at">) => {
  const now = Date.now();
  const startsAt = new Date(event.starts_at).getTime();
  const endsAt = event.ends_at ? new Date(event.ends_at).getTime() : startsAt + 2 * 60 * 60 * 1000;
  if (now < startsAt) return "programmata";
  if (now <= endsAt) return "in corso";
  return "terminata";
};

const intervalLabel = (interval: string) => (interval === "year" ? "annuale" : "mensile");

const tierFormFromRow = (tier: TierRow): TierForm => ({
  name: tier.name,
  description: tier.description || "",
  price: (tier.price_cents / 100).toFixed(2),
  isActive: tier.is_active,
});

const parsePriceCents = (value: string) => {
  const normalized = value.replace(",", ".").trim();
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
};

const escapeSupabaseLike = (value: string) => value.replace(/[%_]/g, (match) => `\\${match}`);

const AdminCommunityManager = () => {
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [tierForms, setTierForms] = useState<Record<string, TierForm>>({});
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEventRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [roles, setRoles] = useState<CommunityRoleRow[]>([]);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileMatches, setProfileMatches] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState({
    slug: "",
    name: "",
    description: "",
    visibility: "members",
    minTierId: "none",
  });

  const load = useCallback(async () => {
    setRefreshing(true);
    const [tiersRes, subscriptionsRes, paymentsRes, liveRes, channelsRes, rolesRes] = await Promise.all([
      adminSupabase.from("membership_tiers").select("*").order("tier_order", { ascending: true }),
      adminSupabase
        .from("membership_subscriptions")
        .select("id,profile_id,status,current_period_end,profiles(name,email),membership_tiers(name,slug)")
        .order("updated_at", { ascending: false })
        .limit(16),
      adminSupabase
        .from("membership_payments")
        .select("id,amount_cents,currency,status,period_count,created_at,paid_at,profiles(name,email),membership_tiers(name,slug,billing_interval)")
        .order("created_at", { ascending: false })
        .limit(10),
      adminSupabase.from("community_live_events").select("*").order("starts_at", { ascending: false }).limit(8),
      adminSupabase.from("community_channels").select("*").order("channel_order", { ascending: true }),
      adminSupabase.rpc("admin_list_community_roles"),
    ]);

    const firstError = tiersRes.error || subscriptionsRes.error || paymentsRes.error || liveRes.error || channelsRes.error || rolesRes.error;
    if (firstError) {
      toast.error(firstError.message || "Impossibile caricare la community admin.");
    } else {
      const loadedTiers = (tiersRes.data || []) as TierRow[];
      setTiers(loadedTiers);
      setTierForms(Object.fromEntries(loadedTiers.map((tier) => [tier.id, tierFormFromRow(tier)])));
      setSubscriptions((subscriptionsRes.data || []) as SubscriptionRow[]);
      setPayments((paymentsRes.data || []) as PaymentRow[]);
      setLiveEvents((liveRes.data || []) as LiveEventRow[]);
      setChannels((channelsRes.data || []) as ChannelRow[]);
      setRoles((rolesRes.data || []) as CommunityRoleRow[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = profileSearch.trim();
    if (query.length < 2) {
      setProfileMatches([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await adminSupabase
          .from("profiles")
          .select("id,name,email")
          .or(`name.ilike.%${escapeSupabaseLike(query)}%,email.ilike.%${escapeSupabaseLike(query)}%`)
          .order("name", { ascending: true })
          .limit(8);

        if (cancelled) return;
        if (error) {
          setProfileMatches([]);
          return;
        }
        setProfileMatches((data || []) as { id: string; name: string | null; email: string | null }[]);
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [profileSearch]);

  const tierFamilies = useMemo(() => {
    const groups = new Map<string, TierRow[]>();
    for (const tier of tiers) {
      const key = tier.tier_family || tier.slug;
      groups.set(key, [...(groups.get(key) || []), tier]);
    }
    return [...groups.entries()].map(([family, rows]) => ({
      family,
      label: rows[0]?.sort_label || rows[0]?.name || family,
      rows: rows.sort((a, b) => a.tier_order - b.tier_order),
    }));
  }, [tiers]);

  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active").length;
  const paidRevenueCents = payments
    .filter((payment) => payment.status === "paid")
    .reduce((total, payment) => total + payment.amount_cents, 0);
  const moderatorCount = roles.filter((role) => role.is_moderator).length;
  const upcomingLives = liveEvents.filter((event) => new Date(event.starts_at).getTime() >= Date.now()).length;

  const updateTierForm = (tierId: string, patch: Partial<TierForm>) => {
    setTierForms((current) => ({
      ...current,
      [tierId]: { ...current[tierId], ...patch },
    }));
  };

  const saveTier = async (tier: TierRow) => {
    const form = tierForms[tier.id];
    if (!form) return;
    const priceCents = parsePriceCents(form.price);
    if (priceCents === null) {
      toast.error("Prezzo non valido.");
      return;
    }

    setSavingTierId(tier.id);
    const patch: TierUpdate = {
      name: form.name.trim() || tier.name,
      description: form.description.trim() || null,
      price_cents: priceCents,
      is_active: form.isActive,
      renewal_policy: "manual",
    };

    const { error } = await supabase.from("membership_tiers").update(patch).eq("id", tier.id);
    if (error) {
      toast.error(error.message || "Salvataggio tier non riuscito.");
    } else {
      toast.success("Tier aggiornato.");
      await load();
    }
    setSavingTierId(null);
  };

  const setModerator = async (profileId: string, enabled: boolean) => {
    setRoleBusyId(profileId);
    const { error } = await adminSupabase.rpc("admin_set_community_moderator", {
      _profile_id: profileId,
      _enabled: enabled,
    });
    if (error) {
      toast.error(error.message || "Aggiornamento ruolo non riuscito.");
    } else {
      toast.success(enabled ? "Moderator aggiunto." : "Moderator rimosso.");
      setProfileSearch("");
      setProfileMatches([]);
      await load();
    }
    setRoleBusyId(null);
  };

  const saveChannel = async (channel: ChannelRow, patch: Partial<ChannelRow>) => {
    const nextVisibility = patch.visibility ?? channel.visibility;
    const payload = {
      ...patch,
      min_tier_id:
        nextVisibility === "tier"
          ? (patch.min_tier_id ?? channel.min_tier_id ?? tiers[0]?.id ?? null)
          : null,
    };
    const { error } = await adminSupabase
      .from("community_channels")
      .update(payload)
      .eq("id", channel.id);
    if (error) {
      toast.error(error.message || "Canale non aggiornato.");
    } else {
      toast.success("Canale aggiornato.");
      await load();
    }
  };

  const saveLiveEvent = async (event: LiveEventRow, patch: LiveEventUpdate) => {
    const nextVisibility = patch.visibility ?? event.visibility;
    const payload: LiveEventUpdate = {
      ...patch,
      min_tier_id:
        nextVisibility === "tier"
          ? (patch.min_tier_id ?? event.min_tier_id ?? tiers[0]?.id ?? null)
          : null,
    };
    const { error } = await adminSupabase
      .from("community_live_events")
      .update(payload)
      .eq("id", event.id);
    if (error) {
      toast.error(error.message || "Live non aggiornata.");
    } else {
      toast.success("Live aggiornata.");
      await load();
    }
  };

  const createChannel = async () => {
    const slug = channelDraft.slug.trim().toLowerCase();
    const name = channelDraft.name.trim();
    if (!slug || !name) {
      toast.error("Slug e nome sono obbligatori.");
      return;
    }
    if (channelDraft.visibility === "tier" && channelDraft.minTierId === "none") {
      toast.error("Seleziona il tier minimo per il canale.");
      return;
    }
    const { error } = await adminSupabase.from("community_channels").insert({
      slug,
      name,
      description: channelDraft.description.trim(),
      visibility: channelDraft.visibility,
      min_tier_id: channelDraft.visibility === "tier" ? channelDraft.minTierId : null,
      channel_order: (channels.at(-1)?.channel_order ?? 0) + 10,
      is_active: true,
    });
    if (error) {
      toast.error(error.message || "Canale non creato.");
    } else {
      setChannelDraft({ slug: "", name: "", description: "", visibility: "members", minTierId: "none" });
      toast.success("Canale creato.");
      await load();
    }
  };

  if (loading) {
    return (
      <div className="glass-panel-soft rounded-[28px] p-8 text-muted-foreground">
        <span className="inline-flex items-center gap-3 text-sm font-sans">
          <Loader2 size={18} className="animate-spin" />
          Carico la gestione community...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-sans text-muted-foreground">
            Gli admin globali hanno accesso completo alla community; i moderator gestiscono solo moderazione e live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent disabled:opacity-60"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          Aggiorna
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Attive", value: activeSubscriptions, icon: UsersRound },
          { label: "Incassato recente", value: currencyFormatter.format(paidRevenueCents / 100), icon: Euro },
          { label: "Moderator", value: moderatorCount, icon: Shield },
          { label: "Live future", value: upcomingLives, icon: Video },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="glass-panel-soft rounded-[24px] p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">{metric.label}</p>
                <Icon size={15} className="text-muted-foreground" />
              </div>
              <p className="font-sans text-2xl font-semibold leading-none text-foreground tabular-nums">{metric.value}</p>
            </div>
          );
        })}
      </div>

      <section className="glass-panel-soft rounded-[28px] p-6">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Membership</p>
            <h3 className="editorial-heading text-2xl">Prezzi e tier</h3>
          </div>
          <p className="max-w-xl text-xs font-sans text-muted-foreground">
            Il rinnovo resta manuale: questi prezzi alimentano le richieste Bunq mensili e annuali con pagamento fino a 3 periodi.
          </p>
        </div>

        <div className="space-y-4">
          {tierFamilies.map((group) => (
            <div key={group.family} className="rounded-[24px] border border-stone-200/80 bg-white/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Crown size={16} className="text-accent" />
                <h4 className="font-sans text-sm font-semibold text-foreground">{group.label}</h4>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {group.rows.map((tier) => {
                  const form = tierForms[tier.id] || tierFormFromRow(tier);
                  return (
                    <div key={tier.id} className="rounded-[20px] border border-white/80 bg-background/70 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="glass-chip px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                          {intervalLabel(tier.billing_interval)}
                        </span>
                        <label className="inline-flex items-center gap-2 text-xs font-sans text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={form.isActive}
                            onChange={(event) => updateTierForm(tier.id, { isActive: event.target.checked })}
                          />
                          Attivo
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7.5rem]">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Nome</span>
                          <input
                            value={form.name}
                            onChange={(event) => updateTierForm(tier.id, { name: event.target.value })}
                            className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Prezzo</span>
                          <input
                            inputMode="decimal"
                            value={form.price}
                            onChange={(event) => updateTierForm(tier.id, { price: event.target.value })}
                            className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans tabular-nums"
                          />
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Descrizione</span>
                        <textarea
                          value={form.description}
                          onChange={(event) => updateTierForm(tier.id, { description: event.target.value })}
                          rows={2}
                          className="w-full resize-none rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                        />
                      </label>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-sans text-muted-foreground">
                          Attuale: {formatMoney(tier.price_cents, tier.currency)} · {tier.slug}
                        </span>
                        <button
                          type="button"
                          onClick={() => void saveTier(tier)}
                          disabled={savingTierId === tier.id}
                          className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-sans text-primary-foreground disabled:opacity-60"
                        >
                          {savingTierId === tier.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salva
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-panel-soft rounded-[28px] p-6">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Subfeed</p>
            <h3 className="editorial-heading text-2xl">Canali community</h3>
          </div>
          <p className="max-w-xl text-xs font-sans text-muted-foreground">
            I canali separano il feed principale per argomento e possono richiedere tier specifici.
          </p>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-3">
            {channels.map((channel) => (
              <div key={channel.id} className="rounded-[20px] border border-stone-200/80 bg-white/60 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem]">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Nome</span>
                    <input
                      defaultValue={channel.name}
                      onBlur={(event) => {
                        if (event.target.value !== channel.name) void saveChannel(channel, { name: event.target.value });
                      }}
                      className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Accesso</span>
                    <select
                      value={channel.visibility}
                      onChange={(event) => void saveChannel(channel, { visibility: event.target.value as ChannelRow["visibility"] })}
                      className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                    >
                      <option value="public">Pubblico</option>
                      <option value="members">Membri</option>
                      <option value="tier">Tier</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-xs font-sans text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={channel.is_active}
                      onChange={(event) => void saveChannel(channel, { is_active: event.target.checked })}
                    />
                    Attivo
                  </label>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                  <input
                    defaultValue={channel.description}
                    onBlur={(event) => {
                      if (event.target.value !== channel.description) void saveChannel(channel, { description: event.target.value });
                    }}
                    placeholder="Descrizione"
                    className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                  />
                  <select
                    value={channel.min_tier_id || "none"}
                    disabled={channel.visibility !== "tier"}
                    onChange={(event) => void saveChannel(channel, { min_tier_id: event.target.value === "none" ? null : event.target.value })}
                    className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans disabled:opacity-50"
                  >
                    <option value="none">Nessun tier</option>
                    {tiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>{tier.name}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-[11px] font-sans text-muted-foreground">/{channel.slug}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[20px] border border-stone-200/80 bg-white/60 p-4">
            <p className="mb-3 text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">Nuovo canale</p>
            <div className="space-y-3">
              <input
                value={channelDraft.name}
                onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Nome"
                className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
              />
              <input
                value={channelDraft.slug}
                onChange={(event) => setChannelDraft((current) => ({ ...current, slug: event.target.value }))}
                placeholder="slug-canale"
                className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
              />
              <textarea
                value={channelDraft.description}
                onChange={(event) => setChannelDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Descrizione"
                rows={3}
                className="w-full resize-none rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={channelDraft.visibility}
                  onChange={(event) => setChannelDraft((current) => ({ ...current, visibility: event.target.value }))}
                  className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                >
                  <option value="members">Membri</option>
                  <option value="tier">Tier</option>
                  <option value="public">Pubblico</option>
                </select>
                <select
                  value={channelDraft.minTierId}
                  disabled={channelDraft.visibility !== "tier"}
                  onChange={(event) => setChannelDraft((current) => ({ ...current, minTierId: event.target.value }))}
                  className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans disabled:opacity-50"
                >
                  <option value="none">Tier</option>
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>{tier.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void createChannel()}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-sans text-primary-foreground"
              >
                Crea canale
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="glass-panel-soft rounded-[28px] p-6">
          <div className="mb-4">
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Governance</p>
            <h3 className="editorial-heading text-2xl">Ruoli community</h3>
          </div>

          <label className="mb-4 block">
            <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Aggiungi moderator</span>
            <input
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              placeholder="Cerca nome o email"
              className="w-full rounded-[18px] border border-border/70 bg-white/80 px-4 py-2.5 text-sm font-sans"
            />
          </label>

          {profileMatches.length > 0 && (
            <div className="mb-4 space-y-2">
              {profileMatches.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => void setModerator(profile.id, true)}
                  disabled={roleBusyId === profile.id}
                  className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-white/80 bg-white/70 px-4 py-3 text-left text-sm font-sans hover:border-accent/50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{profile.name || profile.email || profile.id}</span>
                    <span className="block truncate text-xs text-muted-foreground">{profile.email || profile.id}</span>
                  </span>
                  <Shield size={15} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {roles.length === 0 ? (
              <p className="text-sm font-sans text-muted-foreground">Nessun ruolo community o membro attivo da mostrare.</p>
            ) : (
              roles.map((role) => (
                <article key={role.profile_id} className="rounded-[20px] border border-stone-200/80 bg-white/60 px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-sans font-medium text-foreground">{role.name || role.email || role.profile_id}</p>
                      <p className="truncate text-xs font-sans text-muted-foreground">
                        {role.email || role.profile_id}
                        {role.active_tier_name ? ` · ${role.active_tier_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {role.is_admin && (
                        <span className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.16em] text-accent">
                          <Crown size={13} />
                          Admin
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void setModerator(role.profile_id, !role.is_moderator)}
                        disabled={roleBusyId === role.profile_id}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.16em] transition-colors disabled:opacity-60 ${
                          role.is_moderator
                            ? "bg-accent text-accent-foreground"
                            : "border border-border/70 bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {role.is_moderator ? <Check size={13} /> : <Shield size={13} />}
                        Moderator
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="glass-panel-soft rounded-[28px] p-6">
          <div className="mb-4">
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">LiveKit</p>
            <h3 className="editorial-heading text-2xl">Live programmate</h3>
          </div>

          <div className="space-y-3">
            {liveEvents.length === 0 ? (
              <p className="text-sm font-sans text-muted-foreground">Nessuna live creata.</p>
            ) : (
              liveEvents.map((event) => (
                <article key={event.id} className="rounded-[20px] border border-stone-200/80 bg-white/60 px-4 py-4">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <span className="glass-chip px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                      {liveStatusForAdmin(event)}
                    </span>
                    <CalendarClock size={16} className="shrink-0 text-muted-foreground" />
                  </div>
                  <div className="grid gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Titolo</span>
                      <input
                        defaultValue={event.title}
                        onBlur={(inputEvent) => {
                          const title = inputEvent.target.value.trim();
                          if (title && title !== event.title) void saveLiveEvent(event, { title });
                        }}
                        className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Inizio</span>
                        <input
                          type="datetime-local"
                          defaultValue={datetimeLocalValue(event.starts_at)}
                          onBlur={(inputEvent) => {
                            const value = inputEvent.target.value;
                            const nextDate = value ? new Date(value) : null;
                            if (nextDate && !Number.isNaN(nextDate.getTime()) && nextDate.toISOString() !== event.starts_at) {
                              void saveLiveEvent(event, { starts_at: nextDate.toISOString() });
                            }
                          }}
                          className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Fine</span>
                        <input
                          type="datetime-local"
                          defaultValue={datetimeLocalValue(event.ends_at)}
                          onBlur={(inputEvent) => {
                            const value = inputEvent.target.value;
                            const nextValue = value ? new Date(value).toISOString() : null;
                            if (nextValue !== event.ends_at) void saveLiveEvent(event, { ends_at: nextValue });
                          }}
                          className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select
                        value={event.visibility}
                        onChange={(selectEvent) => void saveLiveEvent(event, { visibility: selectEvent.target.value as LiveEventRow["visibility"] })}
                        className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                      >
                        <option value="public">Pubblica</option>
                        <option value="members">Membri</option>
                        <option value="tier">Tier</option>
                      </select>
                      <select
                        value={event.min_tier_id || "none"}
                        disabled={event.visibility !== "tier"}
                        onChange={(selectEvent) => void saveLiveEvent(event, { min_tier_id: selectEvent.target.value === "none" ? null : selectEvent.target.value })}
                        className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans disabled:opacity-50"
                      >
                        <option value="none">Nessun tier</option>
                        {tiers.map((tier) => (
                          <option key={tier.id} value={tier.id}>{tier.name}</option>
                        ))}
                      </select>
                      <select
                        value={event.livekit_mode}
                        onChange={(selectEvent) => void saveLiveEvent(event, { livekit_mode: selectEvent.target.value as LiveEventRow["livekit_mode"] })}
                        className="w-full rounded-[16px] border border-border/70 bg-white/80 px-3 py-2 text-sm font-sans"
                      >
                        <option value="video">Video</option>
                        <option value="audio">Audio</option>
                        <option value="stage">Stage</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="truncate text-[11px] font-sans text-muted-foreground">
                        {event.livekit_room_name || `post ${event.post_id || "non collegato"}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => void saveLiveEvent(event, { ends_at: new Date().toISOString() })}
                        className="rounded-full border border-border/70 bg-background px-3 py-2 text-xs font-sans text-muted-foreground hover:text-foreground"
                      >
                        Archivia
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="glass-panel-soft rounded-[28px] p-6">
        <div className="mb-4">
          <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Pagamenti e rinnovi</p>
          <h3 className="editorial-heading text-2xl">Attivita recente</h3>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">Iscrizioni</p>
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="rounded-[18px] border border-white/80 bg-white/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-sans font-medium text-foreground">
                      {subscription.profiles?.name || subscription.profiles?.email || subscription.profile_id}
                    </span>
                    <span className="block truncate text-xs font-sans text-muted-foreground">
                      {subscription.membership_tiers?.name || "Tier sconosciuto"} · scade {formatDateTime(subscription.current_period_end)}
                    </span>
                  </span>
                  <span className="glass-chip px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    {subscription.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">Pagamenti</p>
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-[18px] border border-white/80 bg-white/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-sans font-medium text-foreground">
                      {payment.profiles?.name || payment.profiles?.email || "Profilo"}
                    </span>
                    <span className="block truncate text-xs font-sans text-muted-foreground">
                      {payment.membership_tiers?.name || "Tier"} · {payment.period_count}x {intervalLabel(payment.membership_tiers?.billing_interval || "month")}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-sans font-semibold text-foreground">{formatMoney(payment.amount_cents, payment.currency)}</span>
                    <span className="block text-[11px] font-sans uppercase tracking-[0.16em] text-muted-foreground">{payment.status}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdminCommunityManager;
