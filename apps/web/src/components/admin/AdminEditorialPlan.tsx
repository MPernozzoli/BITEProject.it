import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, eachDayOfInterval, endOfWeek, format, formatDistanceToNow, isSameMonth, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { BarChart3, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Dog, Eye, Globe, Instagram, MessageSquare, Music2, Plus, RefreshCw, Settings2, TrendingUp, Youtube } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { isAuthFailureError } from "@/lib/supabase-auth";
import {
  EDITORIAL_CHANNEL_IDS,
  EDITORIAL_CHANNEL_LABELS,
  EDITORIAL_CHANNEL_ORDER,
  EDITORIAL_TYPE_LABELS,
  computeSocialTypeDistribution,
  computeTypeDistribution,
  ensureSlotsForHorizon,
  recomputeOpenSlotSuggestions,
  effectiveSlotType,
  type ArticleForPlan,
  type EditorialArticleType,
  type EditorialChannelCode,
  type EditorialMix,
  type NewSlotRow,
  type PublishTargetForMix,
  type SlotForPlan,
  type WeeklyTemplate,
} from "@/lib/editorial-plan";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import AdminEditorialPlanSettingsDialog from "./AdminEditorialPlanSettingsDialog";
import AdminEditorialPlanSlotDialog from "./AdminEditorialPlanSlotDialog";
import {
  formatCount,
  formatDwell,
  langLabel,
  type ArticleViewInsightRow,
} from "@/lib/article-insights";

type ArticleLite = ArticleForPlan & { title_en: string; title_it: string };
type ChannelRow = Database["public"]["Tables"]["editorial_plan_channels"]["Row"];

type TargetRow = {
  id: string;
  channel_id: string;
  editorial_plan_slot_id: string | null;
  status: string;
  content_format: string;
  caption: string | null;
  platform_post_id: string | null;
  platform_permalink: string | null;
  published_at: string | null;
  metrics_synced_at: string | null;
  editorial_media_assets: { title: string; editorial_type: EditorialArticleType | null } | null;
};

type InsightLite = {
  target_id: string;
  source: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  impressions: number;
  captured_at: string;
};

type OAuthStatus = {
  channel_id: string;
  provider: string;
  account_label: string | null;
  access_token_expires_at: string | null;
  updated_at: string;
  has_token: boolean;
};

type ChannelMetrics = {
  channel_id: string;
  channel_code: EditorialChannelCode;
  followers: number | null;
  following: number | null;
  media_count: number | null;
  avg_engagement_rate: number | null;
  sample_post_count: number | null;
  captured_at: string;
  // Aggregated post metrics (computed from editorial_post_insights)
  total_reach: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_saves: number;
  total_shares: number;
  total_impressions: number;
  total_posts: number;
};

function EditorialChannelLogo({ code, className }: { code: EditorialChannelCode; className?: string }) {
  const ic = cn("size-3.5 shrink-0 text-foreground/90", className);
  switch (code) {
    case "site":
      return <BookOpen className={ic} aria-hidden />;
    case "youtube":
      return <Youtube className={ic} aria-hidden />;
    case "tiktok":
      return <Music2 className={ic} aria-hidden />;
    case "instagram_bite":
      return <Instagram className={ic} aria-hidden />;
    case "instagram_dogs":
      return <Dog className={ic} aria-hidden />;
    default:
      return <BookOpen className={ic} aria-hidden />;
  }
}

export default function AdminEditorialPlan() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cursorMonth, setCursorMonth] = useState(() => startOfMonth(new Date()));
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  /** Canale i cui KPI sono mostrati nel pannello (default: sito). */
  const [kpiChannelCode, setKpiChannelCode] = useState<EditorialChannelCode>("site");
  /** Filtro calendario: "all" mostra tutti, un codice canale mostra solo quello. */
  const [calendarChannelFilter, setCalendarChannelFilter] = useState<EditorialChannelCode | "all">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotForPlan | null>(null);

  const [slots, setSlots] = useState<SlotForPlan[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [targetsBySlotId, setTargetsBySlotId] = useState<Record<string, TargetRow[]>>({});
  const [insightsBySlotId, setInsightsBySlotId] = useState<Record<string, InsightLite[]>>({});
  const [oauthByChannelId, setOauthByChannelId] = useState<Record<string, OAuthStatus>>({});

  /** Channel metrics from editorial_channel_metrics + aggregated post insights. */
  const [channelMetrics, setChannelMetrics] = useState<Record<string, ChannelMetrics>>({});
  /** Article view insights for the performance preview. */
  const [articleInsights, setArticleInsights] = useState<ArticleViewInsightRow[]>([]);
  /** Whether a background metrics sync is in progress. */
  const [metricsSyncing, setMetricsSyncing] = useState(false);
  /** Fields that just got new values (for flash animation). */
  const [flashFields, setFlashFields] = useState<Set<string>>(new Set());
  /** Timestamp of last known metrics per channel (for polling). */
  const lastKnownCaptureRef = useRef<Record<string, string>>({});
  /** Timestamp of last sync trigger per channel (for 20min cooldown). */
  const lastSyncTriggerRef = useRef<Record<string, number>>({});
  /** Poll interval ref for cleanup. */
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const channelIdToCode = useMemo(() => {
    const m = new Map<string, EditorialChannelCode>();
    for (const c of channels) {
      m.set(c.id, c.code as EditorialChannelCode);
    }
    return m;
  }, [channels]);

  const slotChannelCode = useCallback(
    (slot: SlotForPlan): EditorialChannelCode => channelIdToCode.get(slot.channel_id) ?? "site",
    [channelIdToCode]
  );

  const loadData = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    const today = startOfDay(new Date());
    const fromStr = format(addDays(today, -7), "yyyy-MM-dd");

    const channelsRes = await supabase.from("editorial_plan_channels").select("*").order("code", { ascending: true });
    if (channelsRes.error && isAuthFailureError(channelsRes.error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }
    if (channelsRes.error) {
      toast.error(channelsRes.error.message);
      setLoading(false);
      return;
    }

    const chRows = (channelsRes.data ?? []) as ChannelRow[];
    setChannels(chRows);

    const maxHorizon = Math.max(8, ...chRows.map((c) => c.horizon_weeks));
    const toStr = format(addDays(today, maxHorizon * 7), "yyyy-MM-dd");
    const channelIds = chRows.map((c) => c.id);

    if (channelIds.length === 0) {
      setSlots([]);
      setArticles([]);
      setTargetsBySlotId({});
      setInsightsBySlotId({});
      setOauthByChannelId({});
      setLoading(false);
      return;
    }

    const [weeklyAllRes, slotsAllRes, articlesRes, oauthRes] = await Promise.all([
      supabase
        .from("editorial_plan_weekly_slots")
        .select("*")
        .in("channel_id", channelIds)
        .order("sort_order", { ascending: true }),
      supabase
        .from("editorial_plan_slots")
        .select("*")
        .in("channel_id", channelIds)
        .gte("slot_date", fromStr)
        .lte("slot_date", toStr)
        .order("slot_date", { ascending: true })
        .order("slot_time", { ascending: true }),
      supabase.from("logbook_articles").select("id, title_en, title_it, status, editorial_type"),
      supabase
        .from("social_oauth_connections")
        .select("channel_id, provider, account_label, access_token_expires_at, updated_at, refresh_token_encrypted")
        .in("channel_id", channelIds),
    ]);

    const err = weeklyAllRes.error || slotsAllRes.error || articlesRes.error || oauthRes.error;
    if (err && isAuthFailureError(err)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }
    if (err) {
      toast.error(err.message);
      setLoading(false);
      return;
    }

    const weeklyByChannel = new Map<string, WeeklyTemplate[]>();
    for (const row of (weeklyAllRes.data ?? []) as WeeklyTemplate[]) {
      const list = weeklyByChannel.get(row.channel_id) ?? [];
      list.push(row);
      weeklyByChannel.set(row.channel_id, list);
    }
    for (const [cid, list] of weeklyByChannel) {
      list.sort((a, b) => a.sort_order - b.sort_order);
      weeklyByChannel.set(cid, list);
    }

    let allSlots = (slotsAllRes.data ?? []) as SlotForPlan[];
    const arts = (articlesRes.data ?? []) as unknown as ArticleLite[];
    const oauthMap: Record<string, OAuthStatus> = {};
    for (const row of (oauthRes.data ?? []) as Array<{
      channel_id: string;
      provider: string;
      account_label: string | null;
      access_token_expires_at: string | null;
      updated_at: string;
      refresh_token_encrypted?: string | null;
    }>) {
      oauthMap[row.channel_id] = {
        channel_id: row.channel_id,
        provider: row.provider,
        account_label: row.account_label,
        access_token_expires_at: row.access_token_expires_at,
        updated_at: row.updated_at,
        has_token: Boolean(row.refresh_token_encrypted),
      };
    }
    setOauthByChannelId(oauthMap);

    const inserts: NewSlotRow[] = [];
    for (const ch of chRows) {
      const tmpl = weeklyByChannel.get(ch.id) ?? [];
      const channelSlots = allSlots.filter((s) => s.channel_id === ch.id);
      const mixCh: EditorialMix = {
        mix_pillar: Number(ch.mix_pillar),
        mix_support: Number(ch.mix_support),
        mix_utility: Number(ch.mix_utility),
      };
      const newRows = ensureSlotsForHorizon(today, ch.horizon_weeks, tmpl, channelSlots, arts, mixCh, ch.id);
      inserts.push(...newRows);
    }

    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from("editorial_plan_slots").insert(inserts);
      if (insErr) {
        console.error(insErr);
        toast.error("Impossibile generare alcuni slot.");
      } else {
        const { data: refetched } = await supabase
          .from("editorial_plan_slots")
          .select("*")
          .in("channel_id", channelIds)
          .gte("slot_date", fromStr)
          .lte("slot_date", toStr)
          .order("slot_date", { ascending: true })
          .order("slot_time", { ascending: true });
        if (refetched) allSlots = refetched as SlotForPlan[];
      }
    }

    const siteChannel = chRows.find((c) => c.code === "site");
    if (siteChannel) {
      const siteSlots = allSlots.filter((s) => s.channel_id === siteChannel.id);
      const siteMix: EditorialMix = {
        mix_pillar: Number(siteChannel.mix_pillar),
        mix_support: Number(siteChannel.mix_support),
        mix_utility: Number(siteChannel.mix_utility),
      };
      const updates = recomputeOpenSlotSuggestions(siteSlots, arts, siteMix);
      const toPatch = updates.filter((u) => {
        const row = allSlots.find((r) => r.id === u.id);
        return row && row.suggested_type !== u.suggested_type;
      });
      if (toPatch.length > 0) {
        await Promise.all(
          toPatch.map((u) =>
            supabase
              .from("editorial_plan_slots")
              .update({ suggested_type: u.suggested_type, updated_at: new Date().toISOString() })
              .eq("id", u.id)
          )
        );
        const { data: again } = await supabase
          .from("editorial_plan_slots")
          .select("*")
          .in("channel_id", channelIds)
          .gte("slot_date", fromStr)
          .lte("slot_date", toStr)
          .order("slot_date", { ascending: true })
          .order("slot_time", { ascending: true });
        if (again) allSlots = again as SlotForPlan[];
      }
    }

    setSlots(allSlots);
    setArticles(arts);

    const slotIds = allSlots.map((s) => s.id);
    if (slotIds.length > 0) {
      const { data: tdata, error: terr } = await supabase
        .from("editorial_publish_targets")
        .select(
          "id, channel_id, editorial_plan_slot_id, status, content_format, caption, platform_post_id, platform_permalink, published_at, metrics_synced_at, editorial_media_assets(title, editorial_type)"
        )
        .in("editorial_plan_slot_id", slotIds);
      if (!terr && tdata) {
        const map: Record<string, TargetRow[]> = {};
        for (const row of tdata as unknown as TargetRow[]) {
          const sid = row.editorial_plan_slot_id;
          if (!sid) continue;
          if (!map[sid]) map[sid] = [];
          map[sid].push(row);
        }
        setTargetsBySlotId(map);
        const targetToSlot = new Map<string, string>();
        for (const row of tdata as unknown as TargetRow[]) {
          if (row.editorial_plan_slot_id) targetToSlot.set(row.id, row.editorial_plan_slot_id);
        }
        const targetIds = Array.from(targetToSlot.keys());
        if (targetIds.length > 0) {
          const { data: insightData, error: insightErr } = await supabase
            .from("editorial_post_insights")
            .select("target_id, source, reach, views, likes, comments, shares, saves, impressions, captured_at")
            .in("target_id", targetIds)
            .order("captured_at", { ascending: false });
          if (!insightErr && insightData) {
            const insightMap: Record<string, InsightLite[]> = {};
            for (const insight of insightData as InsightLite[]) {
              const sid = targetToSlot.get(insight.target_id);
              if (!sid) continue;
              if (!insightMap[sid]) insightMap[sid] = [];
              insightMap[sid].push(insight);
            }
            setInsightsBySlotId(insightMap);
          } else {
            setInsightsBySlotId({});
          }
        } else {
          setInsightsBySlotId({});
        }
      } else {
        setTargetsBySlotId({});
        setInsightsBySlotId({});
      }
    } else {
      setTargetsBySlotId({});
      setInsightsBySlotId({});
    }

    // Fetch article view insights for the performance preview
    const { data: artInsights } = await supabase.rpc("admin_article_view_insights");
    setArticleInsights((artInsights ?? []) as unknown as ArticleViewInsightRow[]);

    setLoading(false);
  }, [session?.user, navigate]);

/** Load channel metrics (profile snapshots + aggregated post insights). */
  const loadChannelMetrics = useCallback(async () => {
    if (!session?.user || channels.length === 0) return;

    const socialChannels = channels.filter((c) => c.code !== "site");
    if (socialChannels.length === 0 && kpiChannelCode !== "site") return;

    // When a specific channel is selected, only load that channel's metrics
    const visibleChannels = kpiChannelCode === "all"
      ? socialChannels
      : socialChannels.filter((c) => c.code === kpiChannelCode);
    if (visibleChannels.length === 0 && kpiChannelCode !== "site") return;

    const channelIds = visibleChannels.map((c) => c.id);
    const monthFromStr = format(startOfMonth(cursorMonth), "yyyy-MM-dd");
    const monthToStr = format(
      new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 0),
      "yyyy-MM-dd"
    );

    // --- Site metrics (when site is visible) ---
    let siteMetrics: {
      total_subscribers: number;
      new_subscribers_7d: number;
      total_profiles: number;
      new_profiles_7d: number;
      total_articles: number;
      published_articles: number;
    } | null = null;

    const showSite = kpiChannelCode === "all" || kpiChannelCode === "site";
    if (showSite) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: totalSubs },
        { count: newSubs7d },
        { count: totalProfiles },
        { count: newProfiles7d },
        { count: totalArticles },
        { count: publishedArticles },
      ] = await Promise.all([
        supabase.from("newsletter_subscribers").select("*", { count: "exact", head: true }),
        supabase
          .from("newsletter_subscribers")
          .select("*", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
        supabase.from("articles").select("*", { count: "exact", head: true }),
        supabase
          .from("articles")
          .select("*", { count: "exact", head: true })
          .eq("status", "published"),
      ]);

      siteMetrics = {
        total_subscribers: totalSubs ?? 0,
        new_subscribers_7d: newSubs7d ?? 0,
        total_profiles: totalProfiles ?? 0,
        new_profiles_7d: newProfiles7d ?? 0,
        total_articles: totalArticles ?? 0,
        published_articles: publishedArticles ?? 0,
      };
    }

    // 1. Fetch latest profile snapshot per channel
    const { data: profileSnapshots } = channelIds.length > 0
      ? await supabase
          .from("editorial_channel_metrics")
          .select("channel_id, followers, following, media_count, avg_engagement_rate, sample_post_count, captured_at")
          .in("channel_id", channelIds)
          .order("captured_at", { ascending: false })
      : { data: null };

    // Deduplicate: keep only latest per channel
    const latestProfile = new Map<string, typeof profileSnapshots extends (infer T)[] | null ? T : never>();
    for (const row of profileSnapshots ?? []) {
      if (!latestProfile.has(row.channel_id)) latestProfile.set(row.channel_id, row);
    }

    // 2. Fetch aggregated post insights for current month
    const { data: targets } = channelIds.length > 0
      ? await supabase
          .from("editorial_publish_targets")
          .select("id, channel_id")
          .eq("status", "published")
          .in("channel_id", channelIds)
      : { data: null };

    const targetIdsByChannel = new Map<string, string[]>();
    for (const t of targets ?? []) {
      const list = targetIdsByChannel.get(t.channel_id) ?? [];
      list.push(t.id);
      targetIdsByChannel.set(t.channel_id, list);
    }

    const aggregatedByChannel = new Map<string, {
      total_reach: number; total_views: number; total_likes: number;
      total_comments: number; total_saves: number; total_shares: number;
      total_impressions: number; total_posts: number;
    }>();

    for (const [chId, tIds] of targetIdsByChannel) {
      if (tIds.length === 0) continue;
      const { data: insights } = await supabase
        .from("editorial_post_insights")
        .select("target_id, reach, views, likes, comments, shares, saves, impressions, captured_at")
        .in("target_id", tIds)
        .gte("captured_at", monthFromStr)
        .lte("captured_at", monthToStr + "T23:59:59");

      // Deduplicate by target_id keeping latest
      const latestByTarget = new Map<string, typeof insights extends (infer T)[] | null ? T : never>();
      for (const ins of insights ?? []) {
        const cur = latestByTarget.get(ins.target_id);
        if (!cur || ins.captured_at > cur.captured_at) latestByTarget.set(ins.target_id, ins);
      }

      const latest = Array.from(latestByTarget.values());
      aggregatedByChannel.set(chId, {
        total_reach: latest.reduce((s, i) => s + (i.reach ?? 0), 0),
        total_views: latest.reduce((s, i) => s + (i.views ?? 0), 0),
        total_likes: latest.reduce((s, i) => s + (i.likes ?? 0), 0),
        total_comments: latest.reduce((s, i) => s + (i.comments ?? 0), 0),
        total_saves: latest.reduce((s, i) => s + (i.saves ?? 0), 0),
        total_shares: latest.reduce((s, i) => s + (i.shares ?? 0), 0),
        total_impressions: latest.reduce((s, i) => s + (i.impressions ?? 0), 0),
        total_posts: latest.length,
      });
    }

    // 3. Merge into channelMetrics
    const newMetrics: Record<string, ChannelMetrics> = {};
    const newFlash = new Set<string>();

    // Add site metrics first
    if (siteMetrics) {
      const prev = channelMetrics["site"];
      const metrics: ChannelMetrics = {
        channel_id: "site",
        channel_code: "site",
        followers: siteMetrics.total_subscribers,
        following: null,
        media_count: siteMetrics.published_articles,
        avg_engagement_rate: null,
        sample_post_count: null,
        captured_at: new Date().toISOString(),
        total_reach: 0,
        total_views: 0,
        total_likes: 0,
        total_comments: 0,
        total_saves: 0,
        total_shares: 0,
        total_impressions: 0,
        total_posts: siteMetrics.published_articles,
      };
      newMetrics["site"] = metrics;

      if (prev) {
        const fields = ["followers", "media_count"] as const;
        for (const f of fields) {
          if (metrics[f] !== prev[f] && metrics[f] !== null && metrics[f] !== 0) {
            newFlash.add(`site-${f}`);
          }
        }
      }
    }

    // Add social channels
    for (const ch of visibleChannels) {
      const profile = latestProfile.get(ch.id);
      const agg = aggregatedByChannel.get(ch.id) ?? {
        total_reach: 0, total_views: 0, total_likes: 0, total_comments: 0,
        total_saves: 0, total_shares: 0, total_impressions: 0, total_posts: 0,
      };

      const prev = channelMetrics[ch.id];
      const metrics: ChannelMetrics = {
        channel_id: ch.id,
        channel_code: ch.code as EditorialChannelCode,
        followers: profile?.followers ?? null,
        following: profile?.following ?? null,
        media_count: profile?.media_count ?? null,
        avg_engagement_rate: profile?.avg_engagement_rate ?? null,
        sample_post_count: profile?.sample_post_count ?? null,
        captured_at: profile?.captured_at ?? "",
        ...agg,
      };

      newMetrics[ch.id] = metrics;

      // Detect changes for flash animation
      if (prev) {
        const fields = ["followers", "total_reach", "total_views", "total_likes", "total_comments"] as const;
        for (const f of fields) {
          if (metrics[f] !== prev[f] && metrics[f] !== null && metrics[f] !== 0) {
            newFlash.add(`${ch.id}-${f}`);
          }
        }
      }
    }

    setChannelMetrics(newMetrics);
    if (newFlash.size > 0) {
      setFlashFields(newFlash);
      setTimeout(() => setFlashFields(new Set()), 1200);
    }
  }, [session?.user, channels, cursorMonth, kpiChannelCode]);

  /** Trigger background metrics sync (fire-and-forget with 20min cooldown). */
  const triggerMetricsSync = useCallback(async (channelId?: string) => {
    const now = Date.now();
    const COOLDOWN_MS = 20 * 60 * 1000;

    if (channelId) {
      const last = lastSyncTriggerRef.current[channelId] ?? 0;
      if (now - last < COOLDOWN_MS) return;
    }

    lastSyncTriggerRef.current[channelId ?? "all"] = now;
    setMetricsSyncing(true);

    try {
      await supabase.functions.invoke("sync-social-metrics", {
        body: { channel_id: channelId ?? undefined, force: true },
      });
    } catch {
      // Non-fatal: sync is best-effort
    }

    // Start polling for updated data
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    let attempts = 0;
    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      await loadChannelMetrics();
      if (attempts >= 10 || !metricsSyncing) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setMetricsSyncing(false);
      }
    }, 3000);

    // Safety timeout: stop polling after 30s
    setTimeout(() => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setMetricsSyncing(false);
    }, 30000);
  }, [loadChannelMetrics]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadData();
  }, [authLoading, session?.user, loadData]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadChannelMetrics();
  }, [authLoading, session?.user, loadChannelMetrics]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const maxHorizonWeeks = useMemo(() => Math.max(8, ...channels.map((c) => c.horizon_weeks)), [channels]);

  const kpiMix = useMemo((): EditorialMix => {
    const c = channels.find((x) => x.code === kpiChannelCode);
    if (!c) return { mix_pillar: 15, mix_support: 55, mix_utility: 30 };
    return {
      mix_pillar: Number(c.mix_pillar),
      mix_support: Number(c.mix_support),
      mix_utility: Number(c.mix_utility),
    };
  }, [channels, kpiChannelCode]);

  const kpiChannelId = useMemo(
    () => channels.find((c) => c.code === kpiChannelCode)?.id ?? EDITORIAL_CHANNEL_IDS.site,
    [channels, kpiChannelCode]
  );

  const monthStart = useMemo(() => startOfMonth(cursorMonth), [cursorMonth]);
  const monthEnd = useMemo(() => {
    const sm = startOfMonth(cursorMonth);
    return new Date(sm.getFullYear(), sm.getMonth() + 1, 0);
  }, [cursorMonth]);

  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const gridEnd = useMemo(() => endOfWeek(monthEnd, { weekStartsOn: 1 }), [monthEnd]);
  const gridDays = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  const monthFrom = format(monthStart, "yyyy-MM-dd");
  const monthTo = format(monthEnd, "yyyy-MM-dd");

  const slotsInMonth = useMemo(
    () => slots.filter((s) => s.slot_date >= monthFrom && s.slot_date <= monthTo),
    [slots, monthFrom, monthTo]
  );

  const channelOrderIdx = useCallback(
    (channelId: string) => {
      const code = channelIdToCode.get(channelId);
      return code !== undefined ? EDITORIAL_CHANNEL_ORDER.indexOf(code) : 99;
    },
    [channelIdToCode]
  );

  const slotsByDate = useMemo(() => {
    const m = new Map<string, SlotForPlan[]>();
    const filtered = calendarChannelFilter === "all"
      ? slotsInMonth
      : slotsInMonth.filter((s) => s.channel_id === (channels.find((c) => c.code === calendarChannelFilter)?.id ?? ""));
    for (const s of filtered) {
      const list = m.get(s.slot_date) ?? [];
      list.push(s);
      m.set(s.slot_date, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => {
        const tc = normalizeSlotTime(a.slot_time).localeCompare(normalizeSlotTime(b.slot_time));
        if (tc !== 0) return tc;
        return channelOrderIdx(a.channel_id) - channelOrderIdx(b.channel_id);
      });
    }
    return m;
  }, [slotsInMonth, channelOrderIdx, calendarChannelFilter, channels]);

  const slotsById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  const distribution = useMemo(() => {
    if (kpiChannelCode === "site") {
      return computeTypeDistribution(
        articles,
        slots.filter((s) => s.channel_id === EDITORIAL_CHANNEL_IDS.site)
      );
    }
    const targetsForMix: PublishTargetForMix[] = [];
    for (const list of Object.values(targetsBySlotId)) {
      for (const t of list) {
        if (t.channel_id !== kpiChannelId) continue;
        targetsForMix.push({
          id: t.id,
          status: t.status,
          editorial_plan_slot_id: t.editorial_plan_slot_id,
          editorial_type: (t.editorial_media_assets?.editorial_type as EditorialArticleType | null) ?? null,
        });
      }
    }
    return computeSocialTypeDistribution(targetsForMix, slotsById);
  }, [articles, slots, kpiChannelCode, kpiChannelId, targetsBySlotId, slotsById]);

  const distTotal = distribution.pillar + distribution.support + distribution.utility_reflection || 1;

  const connectedSocialChannelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of channels) {
      if (c.code === "site") continue;
      const oauth = oauthByChannelId[c.id];
      if (oauth?.has_token) ids.add(c.id);
    }
    return ids;
  }, [channels, oauthByChannelId]);

  const socialSummary = useMemo(() => {
    const connectedSocialSlots = slotsInMonth.filter((s) => connectedSocialChannelIds.has(s.channel_id));
    const socialTargets = connectedSocialSlots.flatMap((slot) => targetsBySlotId[slot.id] ?? []);
    const published = socialTargets.filter((target) => target.status === "published").length;
    const pending = socialTargets.filter((target) => target.status === "pending" || target.status === "publishing").length;
    const failed = socialTargets.filter((target) => target.status === "failed").length;
    const measuredPosts = socialTargets.filter((target) => target.platform_post_id).length;
    const insights = Object.entries(insightsBySlotId)
      .filter(([slotId]) => {
        const slot = slotsById.get(slotId);
        return slot ? connectedSocialChannelIds.has(slot.channel_id) : false;
      })
      .flatMap(([, list]) => list);
    const latestByTarget = new Map<string, InsightLite>();
    for (const insight of insights) {
      const current = latestByTarget.get(insight.target_id);
      if (!current || insight.captured_at > current.captured_at) latestByTarget.set(insight.target_id, insight);
    }
    const latest = Array.from(latestByTarget.values());
    const reach = latest.reduce((sum, insight) => sum + insight.reach, 0);
    const views = latest.reduce((sum, insight) => sum + insight.views, 0);
    const engagement = latest.reduce(
      (sum, insight) => sum + insight.likes + insight.comments + insight.shares + insight.saves,
      0
    );
    return {
      connectedAccounts: connectedSocialChannelIds.size,
      slots: connectedSocialSlots.length,
      targets: socialTargets.length,
      published,
      pending,
      failed,
      measuredPosts,
      insightSnapshots: insights.length,
      reach,
      views,
      engagement,
    };
  }, [connectedSocialChannelIds, insightsBySlotId, slotsById, slotsInMonth, targetsBySlotId]);

  const selectedKpiAccount = oauthByChannelId[kpiChannelId] ?? null;
  const selectedKpiChannelLabel = EDITORIAL_CHANNEL_LABELS[kpiChannelCode];

  const openSlot = (s: SlotForPlan) => {
    setSelectedSlot(s);
    setSlotDialogOpen(true);
  };

  const goTodayMonth = () => setCursorMonth(startOfMonth(new Date()));

  const selectedSlotCode = selectedSlot ? slotChannelCode(selectedSlot) : "site";
  const selectedSlotChannelId = selectedSlot?.channel_id ?? EDITORIAL_CHANNEL_IDS.site;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Piano editoriale</p>
          <h2 className="editorial-heading text-3xl md:text-4xl">Calendario</h2>
          <p className="text-xs text-muted-foreground font-sans mt-1 max-w-xl">
            Un solo calendario: tutti i canali insieme. I KPI social usano solo account OAuth collegati e post misurabili.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} />
            Impostazioni
          </Button>
          <Link
            to="/admin/article/new"
            className="glass-chip inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans text-foreground hover:text-accent transition-colors"
          >
            <Plus size={16} />
            Nuovo articolo
          </Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel-soft rounded-[26px] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground shrink-0">
              KPI canale / account
            </p>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:min-w-[220px]">
              <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                Canale KPI
              </span>
              <Select value={kpiChannelCode} onValueChange={(v) => setKpiChannelCode(v as EditorialChannelCode)}>
                <SelectTrigger className="h-9 rounded-[14px] text-xs font-sans w-full sm:w-[min(100%,280px)]">
                  <SelectValue placeholder="Seleziona canale..." />
                </SelectTrigger>
                <SelectContent>
                  {EDITORIAL_CHANNEL_ORDER.map((code) => (
                    <SelectItem key={code} value={code} className="text-xs">
                      <span className="flex items-center gap-2">
                        <EditorialChannelLogo code={code} />
                        {EDITORIAL_CHANNEL_LABELS[code]}
                        {code !== "site" && (
                          <span className="text-[10px] text-muted-foreground">
                            {oauthByChannelId[EDITORIAL_CHANNEL_IDS[code]]?.has_token ? "collegato" : "non collegato"}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-[16px] border border-border/70 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
            {kpiChannelCode === "site" ? (
              <span>Fonte KPI: articoli del sito e slot editoriali assegnati.</span>
            ) : selectedKpiAccount?.has_token ? (
              <span>
                Fonte KPI: {selectedKpiChannelLabel} · {selectedKpiAccount.account_label || selectedKpiAccount.provider} · ultimo sync{" "}
                {selectedKpiAccount.updated_at ? new Date(selectedKpiAccount.updated_at).toLocaleDateString("it-IT") : "n/d"}.
              </span>
            ) : (
              <span>
                {selectedKpiChannelLabel} non ha un token OAuth attivo: il mix mostra il piano, ma le metriche account non sono disponibili.
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(
              [
                ["pillar", kpiMix.mix_pillar, distribution.pillar],
                ["support", kpiMix.mix_support, distribution.support],
                ["utility_reflection", kpiMix.mix_utility, distribution.utility_reflection],
              ] as const
            ).map(([key, target, count]) => {
              const t = key as EditorialArticleType;
              const curPct = (count / distTotal) * 100;
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs font-sans mb-1">
                    <span>{EDITORIAL_TYPE_LABELS[t]}</span>
                    <span className="text-muted-foreground">
                      {curPct.toFixed(0)}% / {target}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-accent/80 transition-all" style={{ width: `${Math.min(100, curPct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-panel-soft rounded-[26px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Social cockpit</p>
              <p className="mt-1 text-xs text-muted-foreground">Metriche native per piattaforma · aggiornamento automatico giornaliero.</p>
            </div>
            <BarChart3 className="size-5 text-accent" aria-hidden />
          </div>

          {/* Sync trigger */}
          <div className="mb-4 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={metricsSyncing}
              onClick={() => triggerMetricsSync()}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${metricsSyncing ? "animate-spin" : ""}`} aria-hidden />
              {metricsSyncing ? "Sincronizzazione…" : "Aggiorna metriche"}
            </Button>
            {metricsSyncing && (
              <Progress value={40} className="h-1 w-16 animate-pulse" />
            )}
          </div>

          {/* Site KPIs when site channel is selected or all */}
          {(kpiChannelCode === "all" || kpiChannelCode === "site") && (
            <div className="space-y-3">
              {(() => {
                const m = channelMetrics["site"];
                if (!m) return null;
                return (
                  <div key="site" className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="text-accent size-4" />
                      <span className="text-xs font-sans font-medium">Sito / Newsletter</span>
                      {m?.captured_at && (
                        <span className="ml-auto text-[9px] text-muted-foreground">
                          {formatDistanceToNow(new Date(m.captured_at), { addSuffix: true, locale: it })}
                        </span>
                      )}
                    </div>

                    {/* Profile metrics row */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <MetricCard label="Iscritti totali" value={m.followers ?? 0} flash={flashFields.has("site-followers")} />
                      <MetricCard label="Nuovi (7gg)" value={m.total_views ?? 0} />
                      <MetricCard label="Profili totali" value={m.total_impressions ?? 0} />
                    </div>

                    {/* Post metrics row */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <MetricCard label="Articoli" value={m.total_posts ?? 0} small />
                      <MetricCard label="Pubblicati" value={m.media_count ?? 0} small />
                      <MetricCard label="Nuovi profili (7gg)" value={m.total_likes ?? 0} small />
                      <MetricCard label="Engagement" value={m.avg_engagement_rate != null ? `${(m.avg_engagement_rate * 100).toFixed(1)}%` : "–"} small />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Per-channel native metrics cards */}
          <div className="space-y-3">
            {channels
              .filter((ch) => ch.code !== "site")
              .filter((ch) => kpiChannelCode === "all" || ch.code === kpiChannelCode)
              .map((ch) => {
                const m = channelMetrics[ch.id];
                const isIG = ch.code === "instagram_bite" || ch.code === "instagram_dogs";
                const isYT = ch.code === "youtube";
                const isTK = ch.code === "tiktok";

                return (
                  <div key={ch.id} className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <EditorialChannelLogo code={ch.code as EditorialChannelCode} className="text-accent" />
                      <span className="text-xs font-sans font-medium">{ch.label}</span>
                      {m?.captured_at && (
                        <span className="ml-auto text-[9px] text-muted-foreground">
                          {formatDistanceToNow(new Date(m.captured_at), { addSuffix: true, locale: it })}
                        </span>
                      )}
                    </div>

                    {/* Profile metrics row */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <MetricCard
                        label={isYT ? "Iscrizioni" : "Follower"}
                        value={m?.followers ?? 0}
                        flash={flashFields.has(`${ch.id}-followers`)}
                      />
                      {isIG && (
                        <>
                          <MetricCard label="Post" value={m?.media_count ?? 0} />
                          <MetricCard label="Media" value={m?.avg_engagement_rate != null ? `${(m.avg_engagement_rate * 100).toFixed(1)}%` : "–"} />
                        </>
                      )}
                      {isYT && (
                        <>
                          <MetricCard label="Video" value={m?.media_count ?? 0} />
                          <MetricCard label="Avg Eng" value={m?.avg_engagement_rate != null ? `${(m.avg_engagement_rate * 100).toFixed(1)}%` : "–"} />
                        </>
                      )}
                      {isTK && (
                        <>
                          <MetricCard label="Post" value={m?.media_count ?? 0} />
                          <MetricCard label="Avg Eng" value={m?.avg_engagement_rate != null ? `${(m.avg_engagement_rate * 100).toFixed(1)}%` : "–"} />
                        </>
                      )}
                    </div>

                    {/* Post insights row (monthly aggregates) */}
                    <div className="grid grid-cols-5 gap-1.5">
                      {isIG && (
                        <>
                          <MetricCard label="Reach" value={m?.total_reach ?? 0} flash={flashFields.has(`${ch.id}-total_reach`)} small />
                          <MetricCard label="Views" value={m?.total_views ?? 0} flash={flashFields.has(`${ch.id}-total_views`)} small />
                          <MetricCard label="Likes" value={m?.total_likes ?? 0} flash={flashFields.has(`${ch.id}-total_likes`)} small />
                          <MetricCard label="Commenti" value={m?.total_comments ?? 0} flash={flashFields.has(`${ch.id}-total_comments`)} small />
                          <MetricCard label="Salvataggi" value={m?.total_saves ?? 0} small />
                        </>
                      )}
                      {isYT && (
                        <>
                          <MetricCard label="Views" value={m?.total_views ?? 0} flash={flashFields.has(`${ch.id}-total_views`)} small />
                          <MetricCard label="Likes" value={m?.total_likes ?? 0} flash={flashFields.has(`${ch.id}-total_likes`)} small />
                          <MetricCard label="Commenti" value={m?.total_comments ?? 0} flash={flashFields.has(`${ch.id}-total_comments`)} small />
                          <MetricCard label="Saves" value={m?.total_saves ?? 0} small />
                          <MetricCard label="Shares" value={m?.total_shares ?? 0} small />
                        </>
                      )}
                      {isTK && (
                        <>
                          <MetricCard label="Views" value={m?.total_views ?? 0} flash={flashFields.has(`${ch.id}-total_views`)} small />
                          <MetricCard label="Likes" value={m?.total_likes ?? 0} flash={flashFields.has(`${ch.id}-total_likes`)} small />
                          <MetricCard label="Commenti" value={m?.total_comments ?? 0} flash={flashFields.has(`${ch.id}-total_comments`)} small />
                          <MetricCard label="Shares" value={m?.total_shares ?? 0} small />
                          <MetricCard label="Saves" value={m?.total_saves ?? 0} small />
                        </>
                      )}
                    </div>

                    {m?.total_posts != null && m.total_posts > 0 && (
                      <p className="mt-1.5 text-[9px] text-muted-foreground">
                        {m.total_posts} post misurati questo mese
                      </p>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Link to comments page */}
          <div className="mt-4">
            <Link
              to="/admin/comments"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
            >
              <MessageSquare className="size-3.5" aria-hidden />
              Gestione commenti →
            </Link>
          </div>

          {/* Legacy aggregated summary */}
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.connectedAccounts} account collegati</span>
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.targets} target</span>
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.reach.toLocaleString("it-IT")} reach</span>
            {socialSummary.failed > 0 && (
              <span className="rounded-full bg-destructive/10 px-3 py-1 text-destructive">{socialSummary.failed} errori</span>
            )}
          </div>
        </div>
      </div>

      {/* Article insights preview */}
      <div className="glass-panel-soft rounded-[26px] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Performance articoli</p>
          <Link
            to="/admin/performance"
            className="inline-flex items-center gap-1.5 text-xs font-sans text-accent hover:text-accent/80 transition-colors"
          >
            Vedi tutto
            <ChevronRight size={12} />
          </Link>
        </div>
        {(() => {
          if (articleInsights.length === 0) {
            return (
              <p className="text-sm font-sans text-muted-foreground text-center py-4">
                Nessun articolo pubblicato con metriche.
              </p>
            );
          }
          const totalViews = articleInsights.reduce((sum, r) => sum + (r.view_count || 0), 0);
          const totalTracked = articleInsights.reduce((sum, r) => sum + (r.tracked_views || 0), 0);
          const avgDwellMs = articleInsights.reduce((sum, r) => sum + ((r.avg_dwell_ms || 0) * (r.measured_dwell_count || 0)), 0);
          const dwellCount = articleInsights.reduce((sum, r) => sum + (r.measured_dwell_count || 0), 0);
          const totalLikes = articleInsights.reduce((sum, r) => sum + (r.like_count || 0), 0);
          const topLang = articleInsights.reduce((sum, r) => sum + (r.views_it || 0), 0) >=
            articleInsights.reduce((sum, r) => sum + (r.views_en || 0), 0) ? "it" : "en";
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Viste totali</p>
                <p className="text-xl font-sans font-semibold tabular-nums text-foreground">{formatCount(totalViews)}</p>
              </div>
              <div className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Dwell medio</p>
                <p className="text-xl font-sans font-semibold tabular-nums text-foreground">
                  {formatDwell(dwellCount ? avgDwellMs / dwellCount : 0)}
                </p>
              </div>
              <div className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Top lingua</p>
                <p className="text-xl font-sans font-semibold tabular-nums text-foreground">{langLabel(topLang)}</p>
              </div>
              <div className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">Mi piace</p>
                <p className="text-xl font-sans font-semibold tabular-nums text-foreground">{formatCount(totalLikes)}</p>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCursorMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            aria-label="Mese precedente"
          >
            <ChevronLeft size={18} />
          </Button>
          <span className="text-sm font-sans text-foreground min-w-[10rem] text-center capitalize">
            {format(cursorMonth, "MMMM yyyy", { locale: it })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCursorMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            aria-label="Mese successivo"
          >
            <ChevronRight size={18} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={goTodayMonth}>
            Oggi
          </Button>
        </div>
        <p className="text-xs text-muted-foreground font-sans">
          Orizzonte max generazione: {maxHorizonWeeks} sett. (per canale)
        </p>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="glass-panel-soft rounded-[24px] h-20" />
          <div className="glass-panel-soft rounded-[24px] h-20" />
        </div>
      ) : (
        <div className="glass-panel-soft rounded-[28px] p-4 md:p-5 overflow-x-auto">
          {/* Channel filter bar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground mr-1">Canale:</span>
            <button
              className={`px-3 py-1 rounded-full text-xs font-sans transition-all ${
                calendarChannelFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-background/60 text-foreground hover:bg-background/80"
              }`}
              onClick={() => setCalendarChannelFilter("all")}
            >
              Tutti
            </button>
            {channels.map((ch) => (
              <button
                key={ch.id}
                className={`px-3 py-1 rounded-full text-xs font-sans transition-all ${
                  calendarChannelFilter === ch.code
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-background/60 text-foreground hover:bg-background/80"
                }`}
                onClick={() => setCalendarChannelFilter(ch.code as EditorialChannelCode)}
              >
                {EDITORIAL_CHANNEL_LABELS[ch.code as EditorialChannelCode] ?? ch.code}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 min-w-[640px] text-[10px] font-sans uppercase tracking-wider text-muted-foreground mb-2">
            {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => (
              <div key={d} className="text-center py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 min-w-[640px]">
            {gridDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, cursorMonth);
              const daySlots = slotsByDate.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`min-h-[88px] rounded-[14px] border p-1.5 flex flex-col gap-1 ${
                    inMonth ? "border-border/80 bg-background/40" : "border-transparent bg-muted/20 opacity-60"
                  }`}
                >
                  <span className={`text-xs font-sans ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                    {format(day, "d")}
                  </span>
                  <div className="flex flex-col gap-1 overflow-hidden">
                    {daySlots.map((s) => {
                      const chCode = slotChannelCode(s);
                      const art = articles.find((a) => a.id === s.assigned_article_id);
                      const eff = effectiveSlotType(s, art);
                      const label = eff ? EDITORIAL_TYPE_LABELS[eff] : "—";
                      const tlist = targetsBySlotId[s.id];
                      const insightList = insightsBySlotId[s.id] ?? [];
                      const latestInsight = insightList[0];
                      const socialHint = tlist?.length
                        ? `${tlist.length} uscit${tlist.length === 1 ? "a" : "e"}`
                        : null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSlot(s)}
                          className="text-left rounded-[10px] bg-muted/50 hover:bg-muted px-1.5 py-1 border border-transparent hover:border-accent/30 transition-colors"
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <EditorialChannelLogo code={chCode} className="text-accent" />
                            <span className="text-[10px] text-muted-foreground truncate">
                              {String(s.slot_time).slice(0, 5)}
                            </span>
                          </div>
                          <div className="text-[10px] font-medium truncate pl-[1.125rem]">{label}</div>
                          {s.content_format && (
                            <div className="text-[9px] text-muted-foreground truncate pl-[1.125rem]">{s.content_format}</div>
                          )}
                          {socialHint && (
                            <div className="flex items-center gap-1 pl-[1.125rem] text-[9px] text-accent">
                              <span className="truncate">{socialHint}</span>
                              {latestInsight && (
                                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[8px] tabular-nums">
                                  {latestInsight.reach.toLocaleString("it-IT")} reach
                                </span>
                              )}
                            </div>
                          )}
                          {chCode === "site" && s.status === "assigned" && art && (
                            <div className="text-[9px] text-foreground truncate pl-[1.125rem]">
                              {art.title_it || art.title_en}
                            </div>
                          )}
                          {chCode !== "site" && tlist?.[0]?.editorial_media_assets?.title && (
                            <div className="text-[9px] text-foreground truncate pl-[1.125rem]">
                              {tlist[0].editorial_media_assets.title}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AdminEditorialPlanSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialChannelCode={kpiChannelCode}
        onSaved={async () => {
          await loadData();
        }}
      />

      <AdminEditorialPlanSlotDialog
        open={slotDialogOpen}
        onOpenChange={(o) => {
          setSlotDialogOpen(o);
          if (!o) setSelectedSlot(null);
        }}
        slot={selectedSlot}
        articles={articles}
        allSlots={slots}
        channelId={selectedSlotChannelId}
        channelCode={selectedSlotCode}
        onDone={async () => {
          await loadData();
        }}
      />
    </div>
  );
}

function normalizeSlotTime(t: string): string {
  if (t.length >= 8 && t.includes(":")) return t.slice(0, 8);
  if (t.length === 5) return `${t}:00`;
  return t;
}

function MetricCard({
  label,
  value,
  flash = false,
  small = false,
}: {
  label: string;
  value: number | string;
  flash?: boolean;
  small?: boolean;
}) {
  const display = typeof value === "number" ? value.toLocaleString("it-IT") : value;
  return (
    <div
      className={cn(
        "rounded-[10px] bg-muted/40 text-center transition-all",
        small ? "px-1.5 py-1" : "px-2 py-1.5",
        flash && "animate-pulse bg-accent/20 ring-1 ring-accent/40"
      )}
    >
      <p className={cn("font-sans font-semibold tabular-nums", small ? "text-xs" : "text-sm")}>{display}</p>
      <p className={cn("text-muted-foreground", small ? "text-[8px]" : "text-[9px]")} style={{ letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
        {label}
      </p>
    </div>
  );
}
