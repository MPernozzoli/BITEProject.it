import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EDITORIAL_PLAN_SETTINGS_ID, WEEKDAY_LABELS_IT } from "@/lib/editorial-plan";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { useNavigate } from "react-router-dom";

export type WeeklySlotFormRow = {
  localKey: string;
  day_of_week: number;
  time_of_day: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
};

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function AdminEditorialPlanSettingsDialog({ open, onOpenChange, onSaved }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weeklyCount, setWeeklyCount] = useState(1);
  const [horizonWeeks, setHorizonWeeks] = useState(8);
  const [mixPillar, setMixPillar] = useState(15);
  const [mixSupport, setMixSupport] = useState(55);
  const [mixUtility, setMixUtility] = useState(30);
  const [timezone, setTimezone] = useState("Europe/Rome");
  const [slotRows, setSlotRows] = useState<WeeklySlotFormRow[]>([
    { localKey: uuid(), day_of_week: 1, time_of_day: "09:00" },
  ]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      const [settingsRes, weeklyRes] = await Promise.all([
        supabase.from("editorial_plan_settings").select("*").eq("id", EDITORIAL_PLAN_SETTINGS_ID).maybeSingle(),
        supabase.from("editorial_plan_weekly_slots").select("*").order("sort_order", { ascending: true }),
      ]);
      if (settingsRes.error && isAuthFailureError(settingsRes.error)) {
        await supabase.auth.signOut();
        navigate("/login", { state: { from: "/admin" } });
        setLoading(false);
        return;
      }
      const s = settingsRes.data;
      if (s) {
        setWeeklyCount(s.weekly_count);
        setHorizonWeeks(s.horizon_weeks);
        setMixPillar(Number(s.mix_pillar));
        setMixSupport(Number(s.mix_support));
        setMixUtility(Number(s.mix_utility));
        setTimezone(s.timezone || "Europe/Rome");
      }
      const rows = weeklyRes.data;
      if (rows && rows.length > 0) {
        setSlotRows(
          rows.map((r) => ({
            localKey: r.id,
            day_of_week: r.day_of_week,
            time_of_day: (r.time_of_day as string).slice(0, 5),
          }))
        );
        setWeeklyCount(rows.length);
      } else {
        setSlotRows([{ localKey: uuid(), day_of_week: 1, time_of_day: "09:00" }]);
        setWeeklyCount(1);
      }
      setLoading(false);
    })();
  }, [open, navigate]);

  const addRow = () => {
    setSlotRows((prev) => [...prev, { localKey: uuid(), day_of_week: 1, time_of_day: "09:00" }]);
    setWeeklyCount((c) => c + 1);
  };

  const removeRow = (key: string) => {
    setSlotRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.localKey !== key)));
    setWeeklyCount((c) => Math.max(1, c - 1));
  };

  const save = async () => {
    const sum = mixPillar + mixSupport + mixUtility;
    if (Math.abs(sum - 100) > 0.05) {
      toast.error("Il mix deve sommare a 100%.");
      return;
    }
    if (slotRows.length === 0) {
      toast.error("Aggiungi almeno uno slot settimanale.");
      return;
    }
    if (slotRows.length !== weeklyCount) {
      setWeeklyCount(slotRows.length);
    }

    setSaving(true);
    const today = format(new Date(), "yyyy-MM-dd");

    const { error: settingsErr } = await supabase.from("editorial_plan_settings").upsert(
      {
        id: EDITORIAL_PLAN_SETTINGS_ID,
        weekly_count: slotRows.length,
        horizon_weeks: horizonWeeks,
        mix_pillar: mixPillar,
        mix_support: mixSupport,
        mix_utility: mixUtility,
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (settingsErr) {
      toast.error(settingsErr.message);
      setSaving(false);
      return;
    }

    const { error: delWeeklyErr } = await supabase
      .from("editorial_plan_weekly_slots")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delWeeklyErr) {
      toast.error(delWeeklyErr.message);
      setSaving(false);
      return;
    }

    const inserts = slotRows.map((row, i) => ({
      day_of_week: row.day_of_week,
      time_of_day: row.time_of_day.length === 5 ? `${row.time_of_day}:00` : row.time_of_day,
      sort_order: i,
    }));
    const { error: insWeeklyErr } = await supabase.from("editorial_plan_weekly_slots").insert(inserts);
    if (insWeeklyErr) {
      toast.error(insWeeklyErr.message);
      setSaving(false);
      return;
    }

    const { error: delSlotsErr } = await supabase
      .from("editorial_plan_slots")
      .delete()
      .gte("slot_date", today)
      .eq("status", "open")
      .is("assigned_article_id", null);
    if (delSlotsErr) {
      toast.error(delSlotsErr.message);
      setSaving(false);
      return;
    }

    toast.success("Impostazioni salvate. Rigenerazione slot in corso…");
    setSaving(false);
    onOpenChange(false);
    await onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto sm:rounded-[22px] border-stone-200/90">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Impostazioni piano editoriale</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Caricamento…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                Pubblicazioni settimanali
              </label>
              <input
                type="number"
                min={1}
                max={21}
                value={weeklyCount}
                onChange={(e) => {
                  const n = Math.min(21, Math.max(1, Number(e.target.value) || 1));
                  setWeeklyCount(n);
                  setSlotRows((prev) => {
                    if (n === prev.length) return prev;
                    if (n > prev.length) {
                      const add = n - prev.length;
                      const extra = Array.from({ length: add }, () => ({
                        localKey: uuid(),
                        day_of_week: 1,
                        time_of_day: "09:00",
                      }));
                      return [...prev, ...extra];
                    }
                    return prev.slice(0, n);
                  });
                }}
                className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
              />
              <p className="text-xs text-muted-foreground mt-1">Deve coincidere con il numero di righe slot sotto.</p>
            </div>

            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                Orizzonte calendario (settimane)
              </label>
              <input
                type="number"
                min={1}
                max={52}
                value={horizonWeeks}
                onChange={(e) => setHorizonWeeks(Math.min(52, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
              />
            </div>

            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                Mix contenuti (%)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-[10px] text-muted-foreground">Pillar</span>
                  <input
                    type="number"
                    step={0.5}
                    value={mixPillar}
                    onChange={(e) => setMixPillar(Number(e.target.value))}
                    className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Support</span>
                  <input
                    type="number"
                    step={0.5}
                    value={mixSupport}
                    onChange={(e) => setMixSupport(Number(e.target.value))}
                    className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Utility</span>
                  <input
                    type="number"
                    step={0.5}
                    value={mixUtility}
                    onChange={(e) => setMixUtility(Number(e.target.value))}
                    className="w-full rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans"
                  />
                </div>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">Somma: {mixPillar + mixSupport + mixUtility}%</p>
            </div>

            <div>
              <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground block mb-1.5">
                Timezone
              </label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-[14px] border border-border bg-background/80 px-3 py-2 font-sans"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                  Slot settimanali (giorno + ora)
                </label>
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  + Slot
                </Button>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {slotRows.map((row) => (
                  <div key={row.localKey} className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.day_of_week}
                      onChange={(e) =>
                        setSlotRows((prev) =>
                          prev.map((r) =>
                            r.localKey === row.localKey ? { ...r, day_of_week: Number(e.target.value) } : r
                          )
                        )
                      }
                      className="flex-1 min-w-[7rem] rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans text-xs"
                    >
                      {WEEKDAY_LABELS_IT.map((label, dow) => (
                        <option key={dow} value={dow}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={row.time_of_day.length > 5 ? row.time_of_day.slice(0, 5) : row.time_of_day}
                      onChange={(e) =>
                        setSlotRows((prev) =>
                          prev.map((r) => (r.localKey === row.localKey ? { ...r, time_of_day: e.target.value } : r))
                        )
                      }
                      className="w-[7.5rem] rounded-[14px] border border-border bg-background/80 px-2 py-1.5 font-sans text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={slotRows.length <= 1}
                      onClick={() => removeRow(row.localKey)}
                    >
                      Rimuovi
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button type="button" disabled={saving || loading} onClick={() => void save()}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
