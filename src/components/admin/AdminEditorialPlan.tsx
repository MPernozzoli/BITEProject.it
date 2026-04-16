import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, eachDayOfInterval, endOfWeek, format, isSameMonth, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { Plus, Settings2, ChevronLeft, ChevronRight } from "lucide-react";
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
  type PublishTargetForMix,
  type SlotForPlan,
  type WeeklyTemplate,
} from "@/lib/editorial-plan";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminEditorialPlanSettingsDialog from "./AdminEditorialPlanSettingsDialog";
import AdminEditorialPlanSlotDialog from "./AdminEditorialPlanSlotDialog";

type ArticleLite = ArticleForPlan & { title_en: string; title_it: string };
type ChannelRow = Database["public"]["Tables"]["editorial_plan_channels"]["Row"];

type TargetRow = {
  id: string;
  editorial_plan_slot_id: string | null;
  status: string;
  content_format: string;
  caption: string | null;
  editorial_media_assets: { title: string; editorial_type: EditorialArticleType | null } | null;
};

export default function AdminEditorialPlan() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cursorMonth, setCursorMonth] = useState(() => startOfMonth(new Date()));
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>(EDITORIAL_CHANNEL_IDS.site);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotForPlan | null>(null);

  const [mix, setMix] = useState<EditorialMix>({ mix_pillar: 15, mix_support: 55, mix_utility: 30 });
  const [horizonWeeks, setHorizonWeeks] = useState(8);
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([]);
  const [slots, setSlots] = useState<SlotForPlan[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [targetsBySlotId, setTargetsBySlotId] = useState<Record<string, TargetRow[]>>({});

  const selectedChannelCode = useMemo((): EditorialChannelCode => {
    const c = channels.find((x) => x.id === selectedChannelId);
    return (c?.code as EditorialChannelCode) ?? "site";
  }, [channels, selectedChannelId]);

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
    const chRows = (channelsRes.data ?? []) as ChannelRow[];
    setChannels(chRows);

    const channelRow = chRows.find((c) => c.id === selectedChannelId) ?? chRows.find((c) => c.code === "site");
    const horizon = channelRow?.horizon_weeks ?? 8;
    const mixFromChannel: EditorialMix = channelRow
      ? {
          mix_pillar: Number(channelRow.mix_pillar),
          mix_support: Number(channelRow.mix_support),
          mix_utility: Number(channelRow.mix_utility),
        }
      : { mix_pillar: 15, mix_support: 55, mix_utility: 30 };
    setMix(mixFromChannel);
    setHorizonWeeks(horizon);
    const toStr = format(addDays(today, horizon * 7), "yyyy-MM-dd");

    const isSite = channelRow?.code === "site";

    const [weeklyRes, slotsRes, articlesRes] = await Promise.all([
      supabase
        .from("editorial_plan_weekly_slots")
        .select("*")
        .eq("channel_id", selectedChannelId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("editorial_plan_slots")
        .select("*")
        .eq("channel_id", selectedChannelId)
        .gte("slot_date", fromStr)
        .lte("slot_date", toStr)
        .order("slot_date", { ascending: true })
        .order("slot_time", { ascending: true }),
      isSite
        ? supabase.from("logbook_articles").select("id, title_en, title_it, status, editorial_type")
        : Promise.resolve({ data: [], error: null }),
    ]);

    const err = weeklyRes.error || slotsRes.error || ("error" in articlesRes ? articlesRes.error : null);
    if (err && isAuthFailureError(err)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }

    const tmpl = (weeklyRes.data ?? []) as WeeklyTemplate[];
    let slotRows = (slotsRes.data ?? []) as SlotForPlan[];
    const arts = (isSite && "data" in articlesRes ? articlesRes.data : []) as unknown as ArticleLite[];

    setTemplates(tmpl);
    setArticles(arts);

    const newRows = ensureSlotsForHorizon(today, horizon, tmpl, slotRows, arts, mixFromChannel, selectedChannelId);
    if (newRows.length > 0) {
      const { error: insErr } = await supabase.from("editorial_plan_slots").insert(newRows);
      if (insErr) {
        console.error(insErr);
        toast.error("Impossibile generare alcuni slot.");
      } else {
        const { data: refetched } = await supabase
          .from("editorial_plan_slots")
          .select("*")
          .eq("channel_id", selectedChannelId)
          .gte("slot_date", fromStr)
          .lte("slot_date", toStr)
          .order("slot_date", { ascending: true })
          .order("slot_time", { ascending: true });
        if (refetched) slotRows = refetched as SlotForPlan[];
      }
    }

    if (isSite) {
      const updates = recomputeOpenSlotSuggestions(slotRows, arts, mixFromChannel);
      const toPatch = updates.filter((u) => {
        const row = slotRows.find((r) => r.id === u.id);
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
          .eq("channel_id", selectedChannelId)
          .gte("slot_date", fromStr)
          .lte("slot_date", toStr)
          .order("slot_date", { ascending: true })
          .order("slot_time", { ascending: true });
        if (again) slotRows = again as SlotForPlan[];
      }
    }

    setSlots(slotRows);

    if (!isSite && slotRows.length > 0) {
      const ids = slotRows.map((s) => s.id);
      const { data: tdata, error: terr } = await supabase
        .from("editorial_publish_targets")
        .select("id, editorial_plan_slot_id, status, content_format, caption, editorial_media_assets(title, editorial_type)")
        .in("editorial_plan_slot_id", ids);
      if (!terr && tdata) {
        const map: Record<string, TargetRow[]> = {};
        for (const row of tdata as unknown as TargetRow[]) {
          const sid = row.editorial_plan_slot_id;
          if (!sid) continue;
          if (!map[sid]) map[sid] = [];
          map[sid].push(row);
        }
        setTargetsBySlotId(map);
      } else {
        setTargetsBySlotId({});
      }
    } else {
      setTargetsBySlotId({});
    }

    setLoading(false);
  }, [session?.user, navigate, selectedChannelId]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadData();
  }, [authLoading, session?.user, loadData]);

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

  const slotsByDate = useMemo(() => {
    const m = new Map<string, SlotForPlan[]>();
    for (const s of slotsInMonth) {
      const list = m.get(s.slot_date) ?? [];
      list.push(s);
      m.set(s.slot_date, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => a.slot_time.localeCompare(b.slot_time));
    }
    return m;
  }, [slotsInMonth]);

  const slotsById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  const distribution = useMemo(() => {
    if (selectedChannelCode === "site") {
      return computeTypeDistribution(articles, slots);
    }
    const targetsForMix: PublishTargetForMix[] = [];
    for (const list of Object.values(targetsBySlotId)) {
      for (const t of list) {
        targetsForMix.push({
          id: t.id,
          status: t.status,
          editorial_plan_slot_id: t.editorial_plan_slot_id,
          editorial_type: (t.editorial_media_assets?.editorial_type as EditorialArticleType | null) ?? null,
        });
      }
    }
    return computeSocialTypeDistribution(targetsForMix, slotsById);
  }, [articles, slots, selectedChannelCode, targetsBySlotId, slotsById]);

  const distTotal = distribution.pillar + distribution.support + distribution.utility_reflection || 1;

  const openSlot = (s: SlotForPlan) => {
    setSelectedSlot(s);
    setSlotDialogOpen(true);
  };

  const goTodayMonth = () => setCursorMonth(startOfMonth(new Date()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">Piano editoriale</p>
          <h2 className="editorial-heading text-3xl md:text-4xl">Calendario</h2>
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

      <Tabs value={selectedChannelId} onValueChange={setSelectedChannelId} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-muted/40 p-1 rounded-[16px]">
          {EDITORIAL_CHANNEL_ORDER.map((code) => {
            const id = EDITORIAL_CHANNEL_IDS[code];
            const label = EDITORIAL_CHANNEL_LABELS[code];
            return (
              <TabsTrigger
                key={code}
                value={id}
                className="text-xs px-3 py-2 data-[state=active]:bg-background rounded-[12px]"
              >
                {label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="glass-panel-soft rounded-[26px] p-5 space-y-4">
        <p className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">Distribuzione vs target</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(
            [
              ["pillar", mix.mix_pillar, distribution.pillar],
              ["support", mix.mix_support, distribution.support],
              ["utility_reflection", mix.mix_utility, distribution.utility_reflection],
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
        <p className="text-xs text-muted-foreground font-sans">Orizzonte generazione: {horizonWeeks} sett.</p>
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
                      const art = articles.find((a) => a.id === s.assigned_article_id);
                      const eff = effectiveSlotType(s, art);
                      const label = eff ? EDITORIAL_TYPE_LABELS[eff] : "—";
                      const tlist = targetsBySlotId[s.id];
                      const socialHint =
                        selectedChannelCode !== "site" && tlist?.length
                          ? `${tlist.length} uscit${tlist.length === 1 ? "a" : "e"}`
                          : null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => openSlot(s)}
                          className="text-left rounded-[10px] bg-muted/50 hover:bg-muted px-1.5 py-1 border border-transparent hover:border-accent/30 transition-colors"
                        >
                          <div className="text-[10px] text-muted-foreground truncate">{String(s.slot_time).slice(0, 5)}</div>
                          <div className="text-[10px] font-medium truncate">{label}</div>
                          {s.content_format && (
                            <div className="text-[9px] text-muted-foreground truncate">{s.content_format}</div>
                          )}
                          {socialHint && <div className="text-[9px] text-accent truncate">{socialHint}</div>}
                          {selectedChannelCode === "site" && s.status === "assigned" && art && (
                            <div className="text-[9px] text-foreground truncate">{art.title_it || art.title_en}</div>
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
        channelId={selectedChannelId}
        channelCode={selectedChannelCode}
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
        channelId={selectedChannelId}
        channelCode={selectedChannelCode}
        onDone={async () => {
          await loadData();
        }}
      />
    </div>
  );
}
