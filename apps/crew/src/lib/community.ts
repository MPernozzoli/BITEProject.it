import { supabase } from "@/integrations/supabase/client";

export type MembershipTier = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: string;
  tier_order: number;
  benefits: Record<string, unknown>;
};

export type CommunityPost = {
  id: string;
  author_profile_id: string;
  title_it: string;
  title_en: string;
  slug: string;
  excerpt_it: string;
  excerpt_en: string;
  content_it: Record<string, unknown>;
  content_en: Record<string, unknown>;
  cover_image: string | null;
  status: "draft" | "published" | "archived";
  visibility: "public" | "members" | "tier";
  min_tier_id: string | null;
  published_at: string | null;
  live_starts_at: string | null;
  live_ends_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { name: string | null; avatar_url: string | null } | null;
  membership_tiers?: { name: string; slug: string; tier_order: number } | null;
};

export type CommunitySubscription = {
  id: string;
  profile_id: string;
  tier_id: string;
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  membership_tiers?: MembershipTier | null;
};

export type MembershipPayment = {
  id: string;
  tier_id: string;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "cancelled" | "failed" | "refunded";
  share_url: string | null;
  reference: string;
  period_start: string;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
  membership_tiers?: Pick<MembershipTier, "name" | "slug"> | null;
};

export type MembershipBenefitEvent = {
  id: string;
  benefit_key: string;
  target_type: string;
  target_id: string | null;
  value: Record<string, unknown>;
  created_at: string;
};

export type CommunityLiveEvent = {
  id: string;
  post_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  visibility: "public" | "members" | "tier";
  min_tier_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  membership_tiers?: { name: string; slug: string; tier_order: number } | null;
};

export type CommunityLiveMessage = {
  id: string;
  live_event_id: string;
  profile_id: string;
  content: string;
  status: "visible" | "hidden" | "deleted";
  created_at: string;
  updated_at: string;
  profiles?: { name: string | null; avatar_url: string | null } | null;
};

export type CommunityPoll = {
  id: string;
  post_id: string | null;
  created_by: string;
  question: string;
  description: string;
  visibility: "public" | "members" | "tier";
  min_tier_id: string | null;
  allow_multiple: boolean;
  closes_at: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  membership_tiers?: { name: string; slug: string; tier_order: number } | null;
};

export type CommunityPollOption = {
  id: string;
  poll_id: string;
  label: string;
  option_order: number;
  created_at: string;
  votes_count?: number;
  voted_by_me?: boolean;
};

export const isActiveSubscription = (subscription: CommunitySubscription | null | undefined) =>
  Boolean(
    subscription
      && ["trialing", "active"].includes(subscription.status)
      && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > Date.now()),
  );

export const benefitLabel = (key: string) => {
  const labels: Record<string, string> = {
    community_feed: "Feed riservato",
    live_chat: "Live chat",
    private_briefings: "Briefing privati",
    early_access_hours: "Accesso anticipato",
    waive_fixed_minimum_cents: "Riduzione quota fissa",
  };
  return labels[key] ?? key.replace(/_/g, " ");
};

export const benefitValue = (key: string, value: unknown) => {
  if (typeof value === "boolean") return value ? "Incluso" : "Non incluso";
  if (key === "early_access_hours" && typeof value === "number") return `${value} ore`;
  if (key === "waive_fixed_minimum_cents" && typeof value === "number") return formatCurrency(value);
  return String(value);
};

export const formatCurrency = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

export const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
};

export const titleFor = (post: Pick<CommunityPost, "title_it" | "title_en">) =>
  post.title_it?.trim() || post.title_en?.trim() || "Untitled";

export const excerptFor = (post: Pick<CommunityPost, "excerpt_it" | "excerpt_en">) =>
  post.excerpt_it?.trim() || post.excerpt_en?.trim() || "";

export const emptyDoc = () => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const slugify = (input: string) =>
  input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);

export async function loadMembership() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { session: null, subscription: null, isAdmin: false };

  const [subscriptionRes, adminRes] = await Promise.all([
    supabase
      .from("membership_subscriptions")
      .select("*, membership_tiers(*)")
      .eq("profile_id", session.user.id)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" }),
  ]);

  return {
    session,
    subscription: (subscriptionRes.data as CommunitySubscription | null) ?? null,
    isAdmin: Boolean(adminRes.data),
  };
}
