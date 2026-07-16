import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronDown, Clock, Anchor, Navigation, AlertTriangle, X } from "lucide-react";
import { formatBookingWindow } from "@/lib/booking-utils";
import {
  getCurrentLegIndex,
  getLegDelayHours,
  getPendingActual,
  getVoyagePhase,
  isLegDelayed,
  shouldShowLiveWidget,
  type SchedulePhase,
  type ScheduledLeg,
} from "@/lib/voyage-schedule";
import type { Language } from "@/lib/language";

interface WidgetVoyage {
  id: string;
  name: string;
  name_it: string | null;
  name_en: string | null;
  status_override: SchedulePhase | null;
  start_date: string | null;
  end_date: string | null;
}

interface WidgetWaypoint {
  id: string;
  name: string | null;
  name_it: string | null;
  name_en: string | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
}

interface WidgetLeg extends ScheduledLeg {
  id: string;
  voyage_id: string;
  from_waypoint_id: string;
  to_waypoint_id: string;
  sort_order: number;
  starts_at_window_start: string | null;
  starts_at_window_end: string | null;
  ends_at_window_start: string | null;
  ends_at_window_end: string | null;
}

interface VoyageLiveWidgetProps {
  /** Read-only removes the recording controls; used for the traveller-facing copy. */
  readOnly?: boolean;
  /** Restricts the widget to these voyages, e.g. the ones the traveller booked. */
  voyageIds?: string[] | null;
  lang?: Language | "it" | "en";
}

const copy = {
  it: {
    eyebrow: "Viaggio in corso",
    upcoming: "Prossima partenza",
    planned: "Programmato",
    active: "In corso",
    completed: "Concluso",
    departNow: "Parti ora",
    arriveNow: "Arriva ora",
    pickDeparture: "Imposta data e ora di partenza",
    pickArrival: "Imposta data e ora di arrivo",
    confirm: "Registra",
    plannedDeparture: "Partenza prevista",
    plannedArrival: "Arrivo previsto",
    actualDeparture: "Partito il",
    actualArrival: "Arrivato il",
    delayed: (hours: number) => `In ritardo di ${formatDelay(hours, "it")} sul previsto`,
    stopOngoing: "In sosta da",
    allDone: "Tutte le tratte sono concluse.",
    saving: "Salvo...",
    close: "Chiudi",
  },
  en: {
    eyebrow: "Voyage in progress",
    upcoming: "Next departure",
    planned: "Planned",
    active: "Under way",
    completed: "Completed",
    departNow: "Depart now",
    arriveNow: "Arrive now",
    pickDeparture: "Set departure date and time",
    pickArrival: "Set arrival date and time",
    confirm: "Record",
    plannedDeparture: "Planned departure",
    plannedArrival: "Planned arrival",
    actualDeparture: "Departed",
    actualArrival: "Arrived",
    delayed: (hours: number) => `Running ${formatDelay(hours, "en")} behind plan`,
    stopOngoing: "Stopped since",
    allDone: "Every leg is complete.",
    saving: "Saving...",
    close: "Dismiss",
  },
} as const;

/**
 * Dismissals are stored per leg, not per voyage: closing the card hides the leg
 * you have already read about, but the widget comes back when the voyage moves on
 * to the next one. One click should not cost the traveller the feature for good.
 */
const DISMISSED_LEG_STORAGE_KEY = "bite_voyage_live_widget_dismissed_leg";

function formatDelay(hours: number, lang: "it" | "en") {
  if (hours >= 48) {
    const days = Math.round(hours / 24);
    return lang === "it" ? `${days} giorni` : `${days} days`;
  }
  const rounded = Math.round(hours);
  if (rounded <= 1) return lang === "it" ? "un'ora" : "an hour";
  return lang === "it" ? `${rounded} ore` : `${rounded} hours`;
}

/**
 * Renders a leg bound the way the booking matrix does: the whole window as a
 * range ("10–13 set h 07:30"), collapsing to a single date once the bounds meet —
 * which is exactly what recording an actual does to them. Reusing
 * formatBookingWindow keeps the widget and the matrix reading the same.
 */
function formatWindow(start: string | null | undefined, end: string | null | undefined, lang: "it" | "en") {
  return formatBookingWindow(start, end, lang === "it" ? "it-IT" : "en-GB") ?? "—";
}

/** `datetime-local` speaks wall-clock time; the widget's wall clock is Rome. */
function toRomeInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Reads a `datetime-local` value as a Rome wall-clock instant. Resolves the
 * offset from the date itself so a value entered either side of the DST switch
 * lands on the instant the user meant.
 */
function fromRomeInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  // Probe the offset Rome had at that moment, then subtract it.
  const probe = new Date(asUtc);
  const romeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const get = (type: string) => Number(romeParts.find((part) => part.type === type)?.value);
  const romeAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = romeAsUtc - asUtc;
  return new Date(asUtc - offset).toISOString();
}

export default function VoyageLiveWidget({ readOnly = false, voyageIds = null, lang = "it" }: VoyageLiveWidgetProps) {
  const locale: "it" | "en" = lang === "en" ? "en" : "it";
  const t = copy[locale];
  const [voyages, setVoyages] = useState<WidgetVoyage[]>([]);
  const [legs, setLegs] = useState<WidgetLeg[]>([]);
  const [waypoints, setWaypoints] = useState<Record<string, WidgetWaypoint>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [dismissedLegId, setDismissedLegId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(DISMISSED_LEG_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const load = useCallback(async () => {
    const [voyagesRes, legsRes, waypointsRes] = await Promise.all([
      supabase
        .from("voyages")
        .select("id,name,name_it,name_en,status_override,start_date,end_date")
        .eq("is_published", true),
      supabase
        .from("voyage_bookable_legs")
        .select(
          "id,voyage_id,from_waypoint_id,to_waypoint_id,sort_order,starts_at_window_start,starts_at_window_end,ends_at_window_start,ends_at_window_end,baseline_starts_at_window_start,baseline_starts_at_window_end,actual_departure_at,actual_arrival_at"
        )
        .order("sort_order", { ascending: true }),
      supabase
        .from("voyage_waypoints")
        .select("id,name,name_it,name_en,actual_arrival_at,actual_departure_at"),
    ]);

    const error = voyagesRes.error || legsRes.error || waypointsRes.error;
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    setVoyages((voyagesRes.data ?? []) as WidgetVoyage[]);
    setLegs((legsRes.data ?? []) as WidgetLeg[]);
    setWaypoints(
      Object.fromEntries(((waypointsRes.data ?? []) as WidgetWaypoint[]).map((wp) => [wp.id, wp]))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The one voyage worth showing: live now, or departing within the lead window. */
  const active = useMemo(() => {
    const candidates = voyages
      .filter((voyage) => !voyageIds || voyageIds.includes(voyage.id))
      .map((voyage) => ({
        voyage,
        voyageLegs: legs
          .filter((leg) => leg.voyage_id === voyage.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .filter(({ voyage, voyageLegs }) => shouldShowLiveWidget(voyage, voyageLegs))
      .sort((a, b) => (a.voyageLegs[0]?.starts_at_window_start ?? "").localeCompare(b.voyageLegs[0]?.starts_at_window_start ?? ""));
    return candidates[0] ?? null;
  }, [voyages, legs, voyageIds]);

  const currentLeg = useMemo(() => {
    if (!active) return null;
    const index = getCurrentLegIndex(active.voyageLegs);
    return index >= 0 ? active.voyageLegs[index] : null;
  }, [active]);

  const pending = useMemo(() => (currentLeg ? getPendingActual(currentLeg) : null), [currentLeg]);

  const recordActual = async (at: string) => {
    if (!pending) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_voyage_waypoint_actual", {
      _waypoint_id: pending.waypointId,
      _kind: pending.kind,
      _at: at,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setManualOpen(false);
    await load();
  };

  if (loading || !active || !currentLeg || !pending) return null;
  if (readOnly && dismissedLegId === currentLeg.id) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_LEG_STORAGE_KEY, currentLeg.id);
    } catch {
      // Private browsing: the card still closes for this session.
    }
    setDismissedLegId(currentLeg.id);
  };

  const phase = getVoyagePhase(active.voyage, active.voyageLegs);
  const fromWaypoint = waypoints[currentLeg.from_waypoint_id];
  const toWaypoint = waypoints[currentLeg.to_waypoint_id];
  const nameOf = (wp: WidgetWaypoint | undefined) =>
    (locale === "it" ? wp?.name_it : wp?.name_en) || wp?.name || "—";
  const voyageName =
    (locale === "it" ? active.voyage.name_it : active.voyage.name_en) || active.voyage.name;

  const pendingKind = pending.kind;
  const delayed = isLegDelayed(currentLeg);

  const phaseLabel = phase === "active" ? t.active : phase === "completed" ? t.completed : t.planned;

  return (
    <section className="glass-panel rounded-[34px] px-5 py-6 md:px-8 md:py-7">
      <div className="flex flex-wrap items-center gap-3">
        <span className="glass-chip inline-flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.24em] text-accent">
          <Navigation size={13} />
          {phase === "active" ? t.eyebrow : t.upcoming}
        </span>
        <span className="text-xs font-sans text-muted-foreground">{voyageName}</span>
        <span className="glass-chip px-2.5 py-1 text-[11px] font-sans text-muted-foreground">{phaseLabel}</span>
        {delayed && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-100/70 px-2.5 py-1 text-[11px] font-sans text-amber-800">
            <AlertTriangle size={12} />
            {t.delayed(getLegDelayHours(currentLeg))}
          </span>
        )}
        {readOnly && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.close}
            title={t.close}
            className="glass-chip ml-auto inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <h2 className="editorial-heading mt-4 text-2xl md:text-3xl">
        {nameOf(fromWaypoint)} → {nameOf(toWaypoint)}
      </h2>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[20px] border border-white/55 bg-white/45 p-4">
          <dt className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
            {fromWaypoint?.actual_departure_at ? t.actualDeparture : t.plannedDeparture}
          </dt>
          <dd className="mt-1.5 font-sans text-lg text-foreground tabular-nums">
            {formatWindow(currentLeg.starts_at_window_start, currentLeg.starts_at_window_end, locale)}
          </dd>
        </div>
        <div className="rounded-[20px] border border-white/55 bg-white/45 p-4">
          <dt className="text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
            {toWaypoint?.actual_arrival_at ? t.actualArrival : t.plannedArrival}
          </dt>
          <dd className="mt-1.5 font-sans text-lg text-foreground tabular-nums">
            {formatWindow(currentLeg.ends_at_window_start, currentLeg.ends_at_window_end, locale)}
          </dd>
        </div>
      </dl>

      {!readOnly && (
        <div className="mt-5">
          <div className="flex items-stretch gap-px overflow-hidden rounded-full bg-primary shadow-[0_16px_34px_rgba(15,23,42,0.16)]">
            <button
              type="button"
              disabled={saving}
              onClick={() => void recordActual(new Date().toISOString())}
              className="inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-sans text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pendingKind === "departure" ? <Navigation size={15} /> : <Anchor size={15} />}
              {saving ? t.saving : pendingKind === "departure" ? t.departNow : t.arriveNow}
            </button>
            <button
              type="button"
              disabled={saving}
              aria-expanded={manualOpen}
              aria-label={pendingKind === "departure" ? t.pickDeparture : t.pickArrival}
              onClick={() => {
                setManualValue(toRomeInputValue(new Date()));
                setManualOpen((open) => !open);
              }}
              className="inline-flex items-center justify-center px-3 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <ChevronDown size={16} className={manualOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          </div>

          {manualOpen && (
            <div className="mt-3 rounded-[20px] border border-white/55 bg-white/45 p-4">
              <label className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                <Clock size={12} />
                {pendingKind === "departure" ? t.pickDeparture : t.pickArrival}
              </label>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={manualValue}
                  onChange={(event) => setManualValue(event.target.value)}
                  className="rounded-full border border-white/60 bg-white/70 px-3 py-2 text-sm font-sans text-foreground"
                />
                <button
                  type="button"
                  disabled={saving || !manualValue}
                  onClick={() => {
                    const iso = fromRomeInputValue(manualValue);
                    if (!iso) return;
                    void recordActual(iso);
                  }}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-sans text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {t.confirm}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
