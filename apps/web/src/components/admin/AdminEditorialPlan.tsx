import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, eachDayOfInterval, endOfWeek, format, isSameMonth, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { BarChart3, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Dog, Eye, Instagram, Music2, Plus, Settings2, TrendingUp, Youtube } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import AdminEditorialPlanSettingsDialog from "./AdminEditorialPlanSettingsDialog";
import AdminEditorialPlanSlotDialog from "./AdminEditorialPlanSlotDialog";

type ArticleLite = ArticleForPlan & { title_en: string; title_it: string };
type ChannelRow = Database["public"]["Tables"]["editorial_plan_channels"]["Row"];

type TargetRow = {
  id: string;
  channel_id: string;
  editorial_plan_slot_id: string | null;
  status: string;
  content_format: string;
  caption: string | null;
  editorial_media_assets: { title: string; editorial_type: EditorialArticleType | null } | null;
};

type InsightLite = {
  target_id: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  captured_at: string;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotForPlan | null>(null);

  const [slots, setSlots] = useState<SlotForPlan[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [targetsBySlotId, setTargetsBySlotId] = useState<Record<string, TargetRow[]>>({});
  const [insightsBySlotId, setInsightsBySlotId] = useState<Record<string, InsightLite[]>>({});

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
      setLoading(false);
      return;
    }

    const [weeklyAllRes, slotsAllRes, articlesRes] = await Promise.all([
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
    ]);

    const err = weeklyAllRes.error || slotsAllRes.error || articlesRes.error;
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
          "id, channel_id, editorial_plan_slot_id, status, content_format, caption, editorial_media_assets(title, editorial_type)"
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
            .select("target_id, reach, views, likes, comments, shares, saves, captured_at")
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

    setLoading(false);
  }, [session?.user, navigate]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadData();
  }, [authLoading, session?.user, loadData]);

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
    for (const s of slotsInMonth) {
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
  }, [slotsInMonth, channelOrderIdx]);

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

  const socialSummary = useMemo(() => {
    const socialSlots = slotsInMonth.filter((s) => slotChannelCode(s) !== "site");
    const socialTargets = socialSlots.flatMap((slot) => targetsBySlotId[slot.id] ?? []);
    const published = socialTargets.filter((target) => target.status === "published").length;
    const pending = socialTargets.filter((target) => target.status === "pending" || target.status === "publishing").length;
    const failed = socialTargets.filter((target) => target.status === "failed").length;
    const insights = Object.entries(insightsBySlotId)
      .filter(([slotId]) => {
        const slot = slotsById.get(slotId);
        return slot ? slotChannelCode(slot) !== "site" : false;
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
      slots: socialSlots.length,
      targets: socialTargets.length,
      published,
      pending,
      failed,
      insightSnapshots: insights.length,
      reach,
      views,
      engagement,
    };
  }, [insightsBySlotId, slotsById, slotChannelCode, slotsInMonth, targetsBySlotId]);

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
            Un solo calendario: tutti i canali insieme. Ogni slot mostra il canale; i KPI sotto sono per il canale selezionato nel menu.
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
              Distribuzione vs target
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
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <p className="mt-1 text-xs text-muted-foreground">Target e insight del mese visibile.</p>
            </div>
            <BarChart3 className="size-5 text-accent" aria-hidden />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Slot social", value: socialSummary.slots, icon: CalendarDays },
              { label: "Target", value: socialSummary.targets, icon: TrendingUp },
              { label: "Reach", value: socialSummary.reach, icon: Eye },
              { label: "Engagement", value: socialSummary.engagement, icon: BarChart3 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-[16px] border border-border/70 bg-background/60 p-3">
                <Icon className="mb-2 size-4 text-accent" aria-hidden />
                <p className="font-sans text-xl font-semibold tabular-nums">{value.toLocaleString("it-IT")}</p>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.pending} in coda</span>
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.published} pubblicati</span>
            <span className="rounded-full bg-muted/60 px-3 py-1">{socialSummary.insightSnapshots} snapshot</span>
            {socialSummary.failed > 0 && (
              <span className="rounded-full bg-destructive/10 px-3 py-1 text-destructive">{socialSummary.failed} errori</span>
            )}
          </div>
        </div>
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
