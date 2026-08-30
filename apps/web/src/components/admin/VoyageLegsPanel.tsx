import type { ReactNode } from "react";
import { CalendarClock, Loader2, Pencil, RefreshCw } from "lucide-react";
import {
  computeAutoLegComplexity,
  getComplexityClass,
  getComplexityLabel,
  getDangerClass,
  getDangerLabel,
  getLegComplexity,
  getLegDangerLevel,
  getLegLabel,
  isLegComplexityAuto,
  type BookableLeg,
  type BookingVoyage,
  type BookingWaypoint,
} from "@/lib/booking-utils";
import {
  formatDuration,
  formatPlanningWindow,
  fromDateTimeLocalValue,
  haversineNm,
  toDateTimeLocalValue,
} from "@/lib/booking-planning";
import { DANGER_REASONS, type DangerReasonKey } from "@/lib/danger-reasons";

export interface VoyageLegsPanelProps {
  legs: BookableLeg[];
  waypointsById: Record<string, BookingWaypoint>;
  selectedVoyage: BookingVoyage | null;
  selectedVoyageId: string;
  planningSpeedKn: number;
  saving: boolean;
  editableLegIds: Set<string>;
  routePlanningActions: ReactNode;
  toggleLegEditing: (legId: string) => void;
  updateLegPlanning: (legId: string, patch: Partial<BookableLeg>) => void;
  cycleLegComplexity: (leg: BookableLeg) => void;
  cycleLegDanger: (leg: BookableLeg) => void;
  toggleLegOpenSea: (leg: BookableLeg) => void;
  toggleLegDangerReason: (leg: BookableLeg, key: DangerReasonKey) => void;
  syncLegs: () => Promise<unknown>;
}

const VoyageLegsPanel = ({
  legs,
  waypointsById,
  selectedVoyage,
  selectedVoyageId,
  planningSpeedKn,
  saving,
  editableLegIds,
  routePlanningActions,
  toggleLegEditing,
  updateLegPlanning,
  cycleLegComplexity,
  cycleLegDanger,
  toggleLegOpenSea,
  toggleLegDangerReason,
  syncLegs,
}: VoyageLegsPanelProps) => {
  return (
    <section className="glass-panel rounded-[30px] p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <CalendarClock size={18} className="text-accent" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Rotte</p>
            <h2 className="editorial-heading text-2xl">Tratte di navigazione</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={syncLegs}
            disabled={saving || !selectedVoyageId || !selectedVoyage?.booking_enabled}
            className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            Sync tratte
          </button>
          {routePlanningActions}
        </div>
      </div>
      <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Finestre e disponibilità</p>
            <span className="text-xs text-muted-foreground">Finestre e disponibilità</span>
          </div>
          <div className="space-y-2">
            {legs.map((leg) => {
              const distanceNm = haversineNm(waypointsById[leg.from_waypoint_id], waypointsById[leg.to_waypoint_id]);
              const estimatedMinutes = distanceNm === null ? null : (distanceNm / planningSpeedKn) * 60;
              const isEditingLeg = editableLegIds.has(leg.id);
              return (
                <div key={leg.id} className="rounded-[18px] border border-border/70 p-3">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{getLegLabel(leg, waypointsById, "it")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {distanceNm === null ? "Distanza non disponibile" : `${distanceNm.toFixed(1)} nm`}
                        {estimatedMinutes === null ? "" : ` · ${formatDuration(estimatedMinutes)} a ${planningSpeedKn.toFixed(1)} kn`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Partenza: {formatPlanningWindow(leg.starts_at_window_start, leg.starts_at_window_end)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Arrivo: {formatPlanningWindow(leg.ends_at_window_start, leg.ends_at_window_end)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(leg.is_bookable)}
                          onChange={(event) => updateLegPlanning(leg.id, { is_bookable: event.target.checked })}
                          className="h-4 w-4 accent-[hsl(var(--accent))]"
                        />
                        Prenotabile
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleLegEditing(leg.id)}
                        className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-foreground hover:text-accent"
                      >
                        <Pencil size={12} />
                        {isEditingLeg ? "Chiudi edit" : "Edit orari"}
                      </button>
                    </div>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => cycleLegComplexity(leg)}
                      title="Clic per cambiare livello (Auto → 1 → … → 5 → Auto)"
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getComplexityClass(getLegComplexity(leg))}`}
                    >
                      Complessità {getLegComplexity(leg)} · {getComplexityLabel(getLegComplexity(leg), "it")}
                      {isLegComplexityAuto(leg) ? ` (auto ${computeAutoLegComplexity(leg)})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => cycleLegDanger(leg)}
                      title="Clic per cambiare livello di pericolo (0 → 3 → 0)"
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getDangerClass(getLegDangerLevel(leg))}`}
                    >
                      Pericolo · {getDangerLabel(getLegDangerLevel(leg), "it")}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLegOpenSea(leg)}
                      title="Navigazione d'altura (>12 nm dalla costa): aumenta complessità e contributo"
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        leg.open_sea
                          ? "border-indigo-300/70 dark:border-indigo-500/30 bg-indigo-100/70 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300"
                          : "border-border/70 bg-background text-muted-foreground"
                      }`}
                    >
                      Navigazione d'altura{leg.open_sea ? " ✓" : ""}
                    </button>
                  </div>
                  {getLegDangerLevel(leg) > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Motivi:</span>
                      {DANGER_REASONS.map((reason) => {
                        const active = (leg.danger_reasons ?? []).includes(reason.key);
                        const Icon = reason.icon;
                        return (
                          <button
                            key={reason.key}
                            type="button"
                            onClick={() => toggleLegDangerReason(leg, reason.key)}
                            title={reason.label_it}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                              active
                                ? "border-red-300/70 dark:border-red-500/30 bg-red-100/70 dark:bg-red-500/15 text-red-800 dark:text-red-300"
                                : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon size={11} />
                            {reason.label_it}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {isEditingLeg && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Partenza da</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(leg.starts_at_window_start)}
                          onChange={(event) => updateLegPlanning(leg.id, { starts_at_window_start: fromDateTimeLocalValue(event.target.value) })}
                          className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Partenza a</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(leg.starts_at_window_end)}
                          onChange={(event) => updateLegPlanning(leg.id, { starts_at_window_end: fromDateTimeLocalValue(event.target.value) })}
                          className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Arrivo da</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(leg.ends_at_window_start)}
                          onChange={(event) => updateLegPlanning(leg.id, { ends_at_window_start: fromDateTimeLocalValue(event.target.value) })}
                          className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Arrivo a</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(leg.ends_at_window_end)}
                          onChange={(event) => updateLegPlanning(leg.id, { ends_at_window_end: fromDateTimeLocalValue(event.target.value) })}
                          className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
            {legs.length === 0 && <p className="text-sm text-muted-foreground">Nessuna tratta: abilita il booking e usa “Salva e ricalcola”.</p>}
          </div>
      </div>
    </section>
  );
};

export default VoyageLegsPanel;
