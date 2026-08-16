import type { ReactNode } from "react";
import { Anchor, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  STOP_DEPARTURE_PRESETS,
  STOP_HOURS_PRESETS,
  STOP_NIGHTS_PRESETS,
  getDefaultStopDepartureTime,
  getEffectiveStopHoursDefault,
  getWaypointStopUiMode,
  type BookableLeg,
  type BookingWaypoint,
} from "@/lib/booking-utils";
import {
  formatDuration,
  formatLegDistance,
  formatLocalTime,
  formatWaypointStopTiming,
  getDepartureTimeFromArrivalAndHours,
  getStopHoursFromArrivalAndDepartureTime,
  getWaypointArrivalDate,
  haversineNm,
  isDepartureTimeAfterArrival,
} from "@/lib/booking-planning";

export interface VoyageStopsPanelProps {
  publicPlanningWaypoints: BookingWaypoint[];
  legs: BookableLeg[];
  planningSpeedKn: number;
  routePlanningActions: ReactNode;
  updateWaypointPlanning: (waypointId: string, patch: Partial<BookingWaypoint>) => void;
  setDetailsWaypointId: (waypointId: string | null) => void;
}

const VoyageStopsPanel = ({
  publicPlanningWaypoints,
  legs,
  planningSpeedKn,
  routePlanningActions,
  updateWaypointPlanning,
  setDetailsWaypointId,
}: VoyageStopsPanelProps) => {
  return (
    <section className="glass-panel rounded-[30px] p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Anchor size={18} className="text-accent" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Soste</p>
            <h2 className="editorial-heading text-2xl">Durata delle soste ai waypoint</h2>
          </div>
        </div>
        {routePlanningActions}
      </div>
      <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Soste waypoint</p>
            <span className="text-xs text-muted-foreground">Durata prevista in sosta</span>
          </div>
          <div className="space-y-2">
            {publicPlanningWaypoints.map((waypoint, index) => {
              const stopUiMode = getWaypointStopUiMode(waypoint);
              const outboundLeg = legs.find((leg) => leg.from_waypoint_id === waypoint.id);
              const previousWaypoint = index > 0 ? publicPlanningWaypoints[index - 1] : undefined;
              const incomingLeg = previousWaypoint
                ? legs.find((leg) => leg.from_waypoint_id === previousWaypoint.id && leg.to_waypoint_id === waypoint.id) ||
                  legs.find((leg) => leg.to_waypoint_id === waypoint.id)
                : undefined;
              const incomingDistanceNm =
                typeof incomingLeg?.planned_nautical_miles === "number"
                  ? incomingLeg.planned_nautical_miles
                  : haversineNm(previousWaypoint, waypoint);
              const incomingDurationMinutes =
                incomingDistanceNm !== null && planningSpeedKn > 0 ? (incomingDistanceNm / planningSpeedKn) * 60 : null;
              const previousWaypointName = previousWaypoint?.name_it || previousWaypoint?.name_en || previousWaypoint?.name || "Waypoint";
              const waypointName = waypoint.name_it || waypoint.name_en || waypoint.name || "Waypoint";
              const effectiveHours = getEffectiveStopHoursDefault(waypoint);
              const effectiveNights = Math.max(1, Number(waypoint.stop_nights ?? 1));
              const defaultDeparture = getDefaultStopDepartureTime(Boolean(outboundLeg?.open_sea));
              const arrivalDate = getWaypointArrivalDate(waypoint, incomingLeg);
              const effectiveShortDeparture =
                (waypoint.stop_departure_time || getDepartureTimeFromArrivalAndHours(arrivalDate, effectiveHours) || defaultDeparture).slice(0, 5);
              const effectiveDeparture = (waypoint.stop_departure_time ?? defaultDeparture).slice(0, 5);

              const applyStopMode = (mode: "none" | "hours" | "nights") => {
                if (mode === "none") {
                  updateWaypointPlanning(waypoint.id, {
                    stop_mode: "hours",
                    stop_hours: 0,
                    stop_nights: null,
                    stop_departure_time: null,
                    planned_stop_duration_minutes: 0,
                  });
                } else if (mode === "hours") {
                  updateWaypointPlanning(waypoint.id, {
                    stop_mode: "hours",
                    stop_hours: effectiveHours,
                    stop_nights: null,
                    stop_departure_time: effectiveShortDeparture,
                    planned_stop_duration_minutes: effectiveHours * 60,
                  });
                } else {
                  updateWaypointPlanning(waypoint.id, {
                    stop_mode: "nights",
                    stop_nights: effectiveNights,
                    stop_departure_time: waypoint.stop_departure_time || defaultDeparture,
                    stop_hours: null,
                    planned_stop_duration_minutes: 0,
                  });
                }
              };

              const applyHoursDepartureTime = (time: string) => {
                if (!isDepartureTimeAfterArrival(arrivalDate, time)) {
                  toast.error("L'orario di ripartenza deve essere successivo all'arrivo.");
                  return;
                }
                const computedHours = getStopHoursFromArrivalAndDepartureTime(arrivalDate, time);
                const hours = computedHours ?? effectiveHours;
                updateWaypointPlanning(waypoint.id, {
                  stop_mode: "hours",
                  stop_departure_time: time,
                  stop_hours: hours,
                  planned_stop_duration_minutes: hours * 60,
                });
              };

              const applyHoursPreset = (hours: number) => {
                updateWaypointPlanning(waypoint.id, {
                  stop_mode: "hours",
                  stop_hours: hours,
                  stop_departure_time: getDepartureTimeFromArrivalAndHours(arrivalDate, hours) || waypoint.stop_departure_time || null,
                  planned_stop_duration_minutes: hours * 60,
                });
              };

              return (
                <div key={waypoint.id} className="grid gap-3 rounded-[18px] border border-border/70 p-3">
                  {previousWaypoint && (
                    <div className="flex flex-col gap-1 rounded-[14px] bg-muted/35 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                      <span className="truncate">
                        Tratta da {previousWaypointName} a {waypointName}
                      </span>
                      <span className="shrink-0 font-medium text-foreground">
                        {formatLegDistance(incomingDistanceNm)} ·{" "}
                        {incomingDurationMinutes === null ? "durata non disponibile" : formatDuration(incomingDurationMinutes)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {index + 1}. {waypointName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatWaypointStopTiming(waypoint, incomingLeg, outboundLeg)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailsWaypointId(waypoint.id)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                    >
                      <Pencil size={12} /> Dettagli tappa
                    </button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sosta</span>
                      <select
                        value={stopUiMode}
                        onChange={(event) => applyStopMode(event.target.value as "none" | "hours" | "nights")}
                        className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="none">Nessuna sosta</option>
                        <option value="hours">Sosta breve (ore)</option>
                        <option value="nights">Giorni + orario di ripartenza</option>
                      </select>
                    </label>

                    {stopUiMode === "hours" && (
                      <>
                        <div>
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ripartenza</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              min={arrivalDate ? formatLocalTime(arrivalDate) : undefined}
                              value={effectiveShortDeparture}
                              onChange={(event) => applyHoursDepartureTime(event.target.value)}
                              className="w-28 border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                            />
                            {STOP_DEPARTURE_PRESETS.map((preset) => {
                              const disabled = !isDepartureTimeAfterArrival(arrivalDate, preset);
                              return (
                                <button
                                  key={preset}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => applyHoursDepartureTime(preset)}
                                  className="glass-chip px-2.5 py-1 text-xs text-foreground hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {preset}
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {arrivalDate
                              ? `Durata calcolata dall'arrivo: ${formatDuration(effectiveHours * 60)}. Per ripartenze il giorno dopo usa la modalità giorni.`
                              : "Arrivo non impostato: usa le ore come fallback manuale."}
                          </p>
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ore</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={effectiveHours}
                              onChange={(event) => {
                                const hours = Math.max(0, Number(event.target.value) || 0);
                                updateWaypointPlanning(waypoint.id, {
                                  stop_hours: hours,
                                  stop_departure_time:
                                    getDepartureTimeFromArrivalAndHours(arrivalDate, hours) || waypoint.stop_departure_time || null,
                                  planned_stop_duration_minutes: hours * 60,
                                });
                              }}
                              className="w-20 border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                            />
                            {STOP_HOURS_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => applyHoursPreset(preset)}
                                className="glass-chip px-2.5 py-1 text-xs text-foreground hover:text-accent"
                              >
                                {preset}h
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {stopUiMode === "nights" && (
                      <>
                        <div>
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Giorni</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={effectiveNights}
                              onChange={(event) =>
                                updateWaypointPlanning(waypoint.id, {
                                  stop_nights: Math.max(1, Number(event.target.value) || 1),
                                })
                              }
                              className="w-20 border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                            />
                            {STOP_NIGHTS_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => updateWaypointPlanning(waypoint.id, { stop_nights: preset })}
                                className="glass-chip px-2.5 py-1 text-xs text-foreground hover:text-accent"
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Ripartenza{outboundLeg?.open_sea ? " · navigazione d'altura → default 19:00" : ""}
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={effectiveDeparture}
                              onChange={(event) =>
                                updateWaypointPlanning(waypoint.id, { stop_departure_time: event.target.value })
                              }
                              className="w-28 border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                            />
                            {STOP_DEPARTURE_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => updateWaypointPlanning(waypoint.id, { stop_departure_time: preset })}
                                className="glass-chip px-2.5 py-1 text-xs text-foreground hover:text-accent"
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {publicPlanningWaypoints.length === 0 && <p className="text-sm text-muted-foreground">Nessun waypoint pubblico caricato per questa rotta.</p>}
          </div>
      </div>
    </section>
  );
};

export default VoyageStopsPanel;
