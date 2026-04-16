import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { Plus, Settings2, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { isAuthFailureError } from "@/lib/supabase-auth";
import {
  EDITORIAL_PLAN_SETTINGS_ID,
  EDITORIAL_TYPE_LABELS,
  WEEKDAY_LABELS_IT,
  computeTypeDistribution,
  ensureSlotsForHorizon,
  recomputeOpenSlotSuggestions,
  effectiveSlotType,
  type ArticleForPlan,
  type EditorialArticleType,
  type EditorialMix,
  type SlotForPlan,
  type WeeklyTemplate,
} from "@/lib/editorial-plan";
import { Button } from "@/components/ui/button";
import AdminEditorialPlanSettingsDialog from "./AdminEditorialPlanSettingsDialog";
import AdminEditorialPlanSlotDialog from "./AdminEditorialPlanSlotDialog";

type ArticleLite = ArticleForPlan & { title_en: string; title_it: string };

export default function AdminEditorialPlan() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotForPlan | null>(null);

  const [mix, setMix] = useState<EditorialMix>({ mix_pillar: 15, mix_support: 55, mix_utility: 30 });
  const [horizonWeeks, setHorizonWeeks] = useState(8);
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([]);
  const [slots, setSlots] = useState<SlotForPlan[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);

  const loadData = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    const today = startOfDay(new Date());
    const fromStr = format(addDays(today, -7), "yyyy-MM-dd");

    const settingsRes = await supabase.from("editorial_plan_settings").select("*").eq("id", EDITORIAL_PLAN_SETTINGS_ID).maybeSingle();
    if (settingsRes.error && isAuthFailureError(settingsRes.error)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }

    const s = settingsRes.data;
    const horizon = s?.horizon_weeks ?? 8;
    const toStr = format(addDays(today, horizon * 7), "yyyy-MM-dd");
    const mixFromSettings: EditorialMix = s
      ? {
          mix_pillar: Number(s.mix_pillar),
          mix_support: Number(s.mix_support),
          mix_utility: Number(s.mix_utility),
        }
      : { mix_pillar: 15, mix_support: 55, mix_utility: 30 };
    setMix(mixFromSettings);
    setHorizonWeeks(horizon);

    const [weeklyRes, slotsRes, articlesRes] = await Promise.all([
      supabase.from("editorial_plan_weekly_slots").select("*").order("sort_order", { ascending: true }),
      supabase
        .from("editorial_plan_slots")
        .select("*")
        .gte("slot_date", fromStr)
        .lte("slot_date", toStr)
        .order("slot_date", { ascending: true })
        .order("slot_time", { ascending: true }),
      supabase.from("logbook_articles").select("id, title_en, title_it, status, editorial_type"),
    ]);

    const err = weeklyRes.error || slotsRes.error || articlesRes.error;
    if (err && isAuthFailureError(err)) {
      await supabase.auth.signOut();
      navigate("/login", { state: { from: "/admin" } });
      setLoading(false);
      return;
    }

    const tmpl = (weeklyRes.data ?? []) as WeeklyTemplate[];
    let slotRows = (slotsRes.data ?? []) as SlotForPlan[];
    const arts = (articlesRes.data ?? []) as unknown as ArticleLite[];

    setTemplates(tmpl);
    setArticles(arts);

    const newRows = ensureSlotsForHorizon(today, horizon, tmpl, slotRows, arts, mixFromSettings);
    if (newRows.length > 0) {
      const { error: insErr } = await supabase.from("editorial_plan_slots").insert(newRows);
      if (insErr) {
        console.error(insErr);
        toast.error("Impossibile generare alcuni slot.");
      } else {
        const { data: refetched } = await supabase
          .from("editorial_plan_slots")
          .select("*")
          .gte("slot_date", fromStr)
          .lte("slot_date", toStr)
          .order("slot_date", { ascending: true })
          .order("slot_time", { ascending: true });
        if (refetched) slotRows = refetched as SlotForPlan[];
      }
    }

    const updates = recomputeOpenSlotSuggestions(slotRows, arts, mixFromSettings);
    const toPatch = updates.filter((u) => {
      const row = slotRows.find((r) => r.id === u.id);
      return row && row.suggested_type !== u.suggested_type;
    });
    if (toPatch.length > 0) {
      await Promise.all(
        toPatch.map((u) =>
          supabase.from("editorial_plan_slots").update({ suggested_type: u.suggested_type, updated_at: new Date().toISOString() }).eq("id", u.id)
        )
      );
      const { data: again } = await supabase
        .from("editorial_plan_slots")
        .select("*")
        .gte("slot_date", fromStr)
        .lte("slot_date", toStr)
        .order("slot_date", { ascending: true })
        .order("slot_time", { ascending: true });
      if (again) slotRows = again as SlotForPlan[];
    }

    setSlots(slotRows);
    setLoading(false);
  }, [session?.user, navigate]);

  useEffect(() => {
    if (authLoading || !session?.user) return;
    void loadData();
  }, [authLoading, session?.user, loadData]);

  const weekStart = useMemo(
    () => startOfWeek(addDays(startOfDay(new Date()), weekOffset * 7), { weekStartsOn: 1 }),
    [weekOffset]
  );
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekFrom = format(weekStart, "yyyy-MM-dd");
  const weekTo = format(weekEnd, "yyyy-MM-dd");

  const slotsInWeek = useMemo(
    () => slots.filter((s) => s.slot_date >= weekFrom && s.slot_date <= weekTo),
    [slots, weekFrom, weekTo]
  );

  const distribution = useMemo(() => computeTypeDistribution(articles, slots), [articles, slots]);
  const distTotal = distribution.pillar + distribution.support + distribution.utility_reflection || 1;

  const openSlot = (s: SlotForPlan) => {
    setSelectedSlot(s);
    setSlotDialogOpen(true);
  };

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
                  <div
                    className="h-full bg-accent/80 transition-all"
                    style={{ width: `${Math.min(100, curPct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Settimana precedente">
            <ChevronLeft size={18} />
          </Button>
          <span className="text-sm font-sans text-foreground min-w-[12rem] text-center">
            {format(weekStart, "d MMM", { locale: it })} – {format(weekEnd, "d MMM yyyy", { locale: it })}
          </span>
          <Button type="button" variant="outline" size="icon" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Settimana successiva">
            <ChevronRight size={18} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
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
      ) : slotsInWeek.length === 0 ? (
        <div className="glass-panel-soft rounded-[28px] p-8 text-center text-muted-foreground text-sm">
          Nessuno slot in questa settimana. Controlla le impostazioni o la finestra temporale.
        </div>
      ) : (
        <div className="space-y-2">
          {slotsInWeek.map((s) => {
            const art = articles.find((a) => a.id === s.assigned_article_id);
            const eff = effectiveSlotType(s, art);
            const label = eff ? EDITORIAL_TYPE_LABELS[eff] : "—";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => openSlot(s)}
                className="w-full text-left glass-panel-soft rounded-[22px] p-4 border border-transparent hover:border-accent/40 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-sans uppercase tracking-[0.18em] text-muted-foreground">
                        {WEEKDAY_LABELS_IT[new Date(s.slot_date + "T12:00:00").getDay()]}{" "}
                        {format(new Date(s.slot_date + "T12:00:00"), "d MMM", { locale: it })} ·{" "}
                        {String(s.slot_time).slice(0, 5)}
                      </span>
                      <span className="glass-chip text-[10px] px-2 py-0.5 uppercase tracking-wider">{label}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">{s.status}</span>
                    </div>
                    {s.status === "assigned" && art ? (
                      <p className="font-serif text-lg text-foreground">{art.title_it || art.title_en}</p>
                    ) : s.status === "skipped" ? (
                      <p className="text-sm text-muted-foreground">Saltato</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Segnaposto — clic per bozza o assegnazione</p>
                    )}
                  </div>
                  <span className="text-xs text-accent shrink-0">Modifica →</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AdminEditorialPlanSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
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
        onDone={async () => {
          await loadData();
        }}
      />
    </div>
  );
}
