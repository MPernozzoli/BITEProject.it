/**
 * "Previsto vs effettivo" on the public voyage page, from confirmed GPX tracks
 * (lib/voyage-track-summary.ts). Renders nothing until at least one leg has a
 * confirmed track, so voyages without recordings are unchanged.
 */
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge } from "lucide-react";

import type { Language } from "@/lib/language";
import { formatBookingWindow } from "@/lib/booking-utils";
import { formatTrackDuration, type LegTrackSummary } from "@/lib/voyage-track-summary";
import type { VoyageWaypoint } from "@/lib/voyage-utils";

export interface PlannedVsActualLeg {
  id: string;
  from_waypoint_id: string;
  to_waypoint_id: string;
  sort_order: number;
  planned_nautical_miles: number | string | null;
  baseline_starts_at_window_start?: string | null;
  baseline_starts_at_window_end?: string | null;
  baseline_ends_at_window_start?: string | null;
  baseline_ends_at_window_end?: string | null;
}

interface Props {
  lang: Language;
  waypoints: VoyageWaypoint[];
  /** Bookable legs when the voyage has them; otherwise rows come from the tracked waypoint pairs. */
  legs: PlannedVsActualLeg[];
  summaries: Map<string, LegTrackSummary>;
}

const copy = {
  it: {
    title: "Previsto vs effettivo",
    subtitle: "La rotta registrata a bordo confrontata con quella pianificata.",
    planned: "Previste",
    sailed: "Percorse",
    underWay: "In navigazione",
    speed: "Media / max",
    unplanned: "Soste fuori programma",
    leg: "Tratta",
    departure: "Partenza",
    arrival: "Arrivo",
    plannedShort: "prev.",
    untracked: (n: number) => (n === 1 ? "Un'altra tratta non ha ancora un tracciato registrato." : `Altre ${n} tratte non hanno ancora un tracciato registrato.`),
    partial: "Registrazione parziale: gli estremi sono stimati in linea retta.",
    profile: "Velocità lungo la tratta",
    stops: "Soste",
    unplannedStop: "sosta fuori programma",
    legend: "Tratteggio: rotta prevista · linea piena: rotta reale (sulla mappa in alto).",
    knots: "nodi",
  },
  en: {
    title: "Planned vs actual",
    subtitle: "The route recorded on board compared with the planned one.",
    planned: "Planned",
    sailed: "Sailed",
    underWay: "Under way",
    speed: "Avg / max",
    unplanned: "Unplanned stops",
    leg: "Leg",
    departure: "Departure",
    arrival: "Arrival",
    plannedShort: "planned",
    untracked: (n: number) => (n === 1 ? "One more leg has no recorded track yet." : `${n} more legs have no recorded track yet.`),
    partial: "Partial recording: the ends are estimated as straight lines.",
    profile: "Speed along the leg",
    stops: "Stops",
    unplannedStop: "unplanned stop",
    legend: "Dashed: planned route · solid: actual route (on the map above).",
    knots: "kn",
  },
} as const;

const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));

const VoyagePlannedVsActual = ({ lang, waypoints, legs, summaries }: Props) => {
  const t = copy[lang];
  const locale = lang === "it" ? "it-IT" : "en-GB";
  const byId = useMemo(() => Object.fromEntries(waypoints.map((w) => [w.id, w])), [waypoints]);
  const nameOf = (id: string | null) => {
    const w = id ? byId[id] : null;
    return w ? (lang === "it" ? w.name_it || w.name : w.name_en || w.name) : "—";
  };

  const rows = useMemo(() => {
    if (legs.length) {
      return [...legs]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((leg) => ({ key: leg.id, leg, summary: summaries.get(leg.id) ?? summaries.get(`${leg.from_waypoint_id}>${leg.to_waypoint_id}`) ?? null }));
    }
    return [...summaries.values()]
      .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
      .map((summary) => ({ key: summary.key, leg: null as PlannedVsActualLeg | null, summary }));
  }, [legs, summaries]);

  const tracked = rows.filter((r) => r.summary);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = tracked.find((r) => r.key === selectedKey) ?? tracked[0] ?? null;

  if (!tracked.length) return null;

  const totals = tracked.reduce(
    (acc, { leg, summary }) => {
      acc.planned += num(leg?.planned_nautical_miles) ?? 0;
      acc.sailed += summary!.estimatedNm;
      acc.moving += summary!.movingSec ?? 0;
      acc.recorded += summary!.recordedNm;
      acc.max = Math.max(acc.max, summary!.maxSogKn ?? 0);
      acc.unplanned += summary!.stops.filter((s) => !s.waypointId).length;
      return acc;
    },
    { planned: 0, sailed: 0, moving: 0, recorded: 0, max: 0, unplanned: 0 }
  );
  const avg = totals.moving > 0 ? totals.recorded / (totals.moving / 3600) : null;
  const profile = (selected?.summary?.speedProfile ?? []).map((s) => ({ t: s.t * 1000, s: s.s }));

  return (
    <section className="page-section pt-0">
      <div className="page-section-wide">
        <div className="glass-panel rounded-[34px] p-6 md:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Gauge size={18} />
            </div>
            <div>
              <h2 className="editorial-heading text-2xl md:text-3xl">{t.title}</h2>
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              [t.sailed, `${Math.round(totals.sailed)} nm`, totals.planned ? `${t.planned}: ${Math.round(totals.planned)} nm` : null],
              [t.underWay, formatTrackDuration(totals.moving, lang), null],
              [t.speed, `${avg?.toFixed(1) ?? "—"} / ${totals.max ? totals.max.toFixed(1) : "—"} ${t.knots}`, null],
              [t.unplanned, String(totals.unplanned), null],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-[20px] border border-border/80 bg-glass/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">{label}</p>
                <p className="editorial-heading text-xl md:text-2xl leading-none">{value}</p>
                {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t.legend}</p>

          <div className="space-y-2">
            {tracked.map(({ key, leg, summary }) => {
              const plannedNm = num(leg?.planned_nautical_miles);
              const delta = summary && plannedNm ? ((summary.estimatedNm - plannedNm) / plannedNm) * 100 : null;
              const isSelected = selected?.key === key;
              const from = leg?.from_waypoint_id ?? summary?.fromWaypointId ?? null;
              const to = leg?.to_waypoint_id ?? summary?.toWaypointId ?? null;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`w-full text-left rounded-[20px] border p-4 transition-colors ${
                    isSelected ? "border-accent/50 bg-accent/5" : "border-border/70 bg-glass/50 hover:border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {nameOf(from)} → {nameOf(to)}
                    </p>
                    {summary && (
                      <p className="text-sm">
                        <span className="font-medium">{summary.estimatedNm.toFixed(1)} nm</span>
                        {plannedNm ? (
                          <span className="text-muted-foreground">
                            {" "}
                            / {plannedNm.toFixed(1)} {t.plannedShort}
                            {delta !== null ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta)}%)` : ""}
                          </span>
                        ) : null}
                      </p>
                    )}
                  </div>
                  {summary && (
                    <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                      <p>
                        {t.departure}: <span className="text-foreground">{formatBookingWindow(summary.startedAt, summary.startedAt, locale)}</span>
                        {leg?.baseline_starts_at_window_start ? (
                          <> · {t.plannedShort} {formatBookingWindow(leg.baseline_starts_at_window_start, leg.baseline_starts_at_window_end, locale)}</>
                        ) : null}
                      </p>
                      <p>
                        {t.arrival}: <span className="text-foreground">{formatBookingWindow(summary.endedAt, summary.endedAt, locale)}</span>
                        {leg?.baseline_ends_at_window_start ? (
                          <> · {t.plannedShort} {formatBookingWindow(leg.baseline_ends_at_window_start, leg.baseline_ends_at_window_end, locale)}</>
                        ) : null}
                      </p>
                      <p>
                        {t.underWay}: <span className="text-foreground">{formatTrackDuration(summary.movingSec, lang)}</span>
                      </p>
                      <p>
                        {t.speed}:{" "}
                        <span className="text-foreground">
                          {summary.avgSogKn?.toFixed(1) ?? "—"} / {summary.maxSogKn?.toFixed(1) ?? "—"} {t.knots}
                        </span>
                      </p>
                    </div>
                  )}
                  {summary?.coverage === "partial" && <p className="mt-1 text-[11px] text-muted-foreground">{t.partial}</p>}
                </button>
              );
            })}
            {rows.length > tracked.length && <p className="text-xs text-muted-foreground px-1">{t.untracked(rows.length - tracked.length)}</p>}
          </div>

          {selected?.summary && (profile.length > 1 || selected.summary.stops.length > 0) && (
            <div className="rounded-[24px] border border-border/70 bg-glass/50 p-4 md:p-5 space-y-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {t.profile} · {nameOf(selected.summary.fromWaypointId)} → {nameOf(selected.summary.toWaypointId)}
              </p>
              {profile.length > 1 && (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={profile} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="track-speed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(24,88%,52%)" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="hsl(24,88%,52%)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        tickFormatter={(v: number) => new Date(v).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        strokeOpacity={0.3}
                      />
                      <YAxis tick={{ fontSize: 11 }} stroke="currentColor" strokeOpacity={0.3} unit=" kn" width={56} />
                      <Tooltip
                        labelFormatter={(v: number) => new Date(v).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        formatter={(v: number) => [`${v.toFixed(1)} ${t.knots}`, ""]}
                      />
                      <Area type="monotone" dataKey="s" stroke="hsl(24,88%,52%)" strokeWidth={1.8} fill="url(#track-speed)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {selected.summary.stops.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t.stops}:{" "}
                  {selected.summary.stops
                    .map((stop) => `${stop.waypointId ? nameOf(stop.waypointId) : t.unplannedStop} (${formatTrackDuration(stop.durationSec, lang)})`)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default VoyagePlannedVsActual;
