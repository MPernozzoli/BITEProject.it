import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import {
  type BookableLeg,
  type BookingRequest,
  type BookingWaypoint,
  type VoyageBookingOccupancyRow,
  formatBookingWindow,
  formatLegDurationDays,
  getBookingStatusLabel,
  getLegDurationHours,
  getLegLabel,
} from "@/lib/booking-utils";
import type { Language } from "@/lib/language";

const COLUMN_WIDTH = 150;
const LABEL_COL_WIDTH = 96;
const ROW_HEIGHT = 56;

interface UserBookingMatrixProps {
  lang: Language | "it" | "en";
  legs: BookableLeg[];
  waypointsById: Record<string, BookingWaypoint>;
  saving: boolean;
  /** The traveller's own active (non cancelled/rejected/expired) request for this voyage, if any. */
  ownRequest: BookingRequest | null;
  ownRequestLegIds: string[];
  /** Anonymized occupancy of other bookers, already scoped to this voyage. */
  companions: VoyageBookingOccupancyRow[];
  /** Draft, not-yet-submitted leg selection — controlled by the parent (existing submit flow). */
  draftLegIds: string[];
  onDraftLegIdsChange: (legIds: string[]) => void;
  onSubmitDraft: () => void;
  onProposeChange: (requestId: string, proposedLegIds: string[]) => void;
  onCancelOwnRequest: (request: BookingRequest) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type DragMode = "start" | "end" | "move";

interface DragState {
  mode: DragMode;
  segStart: number;
  segEnd: number;
  originClientX: number;
  previewStart: number;
  previewEnd: number;
}

const indicesToLegIds = (start: number, end: number, legs: BookableLeg[]) =>
  Array.from({ length: end - start + 1 }, (_, i) => legs[start + i]?.id).filter((id): id is string => Boolean(id));

const legIdsToRange = (legIds: string[], legIndexById: Map<string, number>) => {
  const indices = legIds.map((id) => legIndexById.get(id)).filter((idx): idx is number => idx != null);
  if (indices.length === 0) return null;
  return { start: Math.min(...indices), end: Math.max(...indices) };
};

const companionLabel = (row: VoyageBookingOccupancyRow, lang: Language | "it" | "en") => {
  if (row.display_name) return row.display_name;
  const it = lang === "it";
  return it
    ? `Prenotazione${row.party_size > 1 ? ` · ${row.party_size} pax` : ""}`
    : `Booking${row.party_size > 1 ? ` · ${row.party_size} pax` : ""}`;
};

const UserBookingMatrix = ({
  lang,
  legs,
  waypointsById,
  saving,
  ownRequest,
  ownRequestLegIds,
  companions,
  draftLegIds,
  onDraftLegIdsChange,
  onSubmitDraft,
  onProposeChange,
  onCancelOwnRequest,
}: UserBookingMatrixProps) => {
  const it = lang === "it";
  const legIndexById = useMemo(() => {
    const map = new Map<string, number>();
    legs.forEach((leg, index) => map.set(leg.id, index));
    return map;
  }, [legs]);

  const ownRange = useMemo(() => legIdsToRange(ownRequestLegIds, legIndexById), [ownRequestLegIds, legIndexById]);
  const draftRange = useMemo(() => legIdsToRange(draftLegIds, legIndexById), [draftLegIds, legIndexById]);
  const hasOwnRequest = Boolean(ownRequest && ownRange);
  const ownPlanChangePending = ownRequest?.plan_change_status && ownRequest.plan_change_status !== "none";

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const [pendingProposalRange, setPendingProposalRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const handleMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaCols = Math.round((event.clientX - current.originClientX) / COLUMN_WIDTH);
      if (current.mode === "start") {
        const nextStart = clamp(current.segStart + deltaCols, 0, current.segEnd);
        if (nextStart !== current.previewStart) setDrag({ ...current, previewStart: nextStart });
      } else if (current.mode === "end") {
        const nextEnd = clamp(current.segEnd + deltaCols, current.segStart, legs.length - 1);
        if (nextEnd !== current.previewEnd) setDrag({ ...current, previewEnd: nextEnd });
      } else {
        const width = current.segEnd - current.segStart;
        const nextStart = clamp(current.segStart + deltaCols, 0, legs.length - 1 - width);
        const nextEnd = nextStart + width;
        if (nextStart !== current.previewStart) setDrag({ ...current, previewStart: nextStart, previewEnd: nextEnd });
      }
    };
    const handleUp = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      const nextLegIds = indicesToLegIds(current.previewStart, current.previewEnd, legs);
      if (nextLegIds.length === 0) return;
      if (hasOwnRequest) {
        setPendingProposalRange({ start: current.previewStart, end: current.previewEnd });
      } else {
        onDraftLegIdsChange(nextLegIds);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, legs, hasOwnRequest, onDraftLegIdsChange]);

  const startDrag = (event: React.PointerEvent, mode: DragMode, range: { start: number; end: number }) => {
    if (saving) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({
      mode,
      segStart: range.start,
      segEnd: range.end,
      originClientX: event.clientX,
      previewStart: range.start,
      previewEnd: range.end,
    });
  };

  const handleEmptyCellDoubleClick = (colIndex: number) => {
    if (saving || hasOwnRequest) return;
    onDraftLegIdsChange(indicesToLegIds(colIndex, colIndex, legs));
    setDrag(null);
  };

  const submitProposal = () => {
    if (!ownRequest || !pendingProposalRange) return;
    const nextLegIds = indicesToLegIds(pendingProposalRange.start, pendingProposalRange.end, legs);
    onProposeChange(ownRequest.id, nextLegIds);
    setPendingProposalRange(null);
  };

  const discardProposal = () => setPendingProposalRange(null);

  const trackWidth = legs.length * COLUMN_WIDTH;
  const gridTemplateColumns = `${LABEL_COL_WIDTH}px repeat(${legs.length}, ${COLUMN_WIDTH}px)`;

  const isDraggingOwn = drag != null && hasOwnRequest;
  const ownDisplayRange =
    pendingProposalRange ?? (isDraggingOwn ? { start: drag!.previewStart, end: drag!.previewEnd } : ownRange);
  const isDraggingDraft = drag != null && !hasOwnRequest;
  const draftDisplayRange = isDraggingDraft ? { start: drag!.previewStart, end: drag!.previewEnd } : draftRange;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[18px] border border-border/70">
        <div style={{ minWidth: LABEL_COL_WIDTH + trackWidth }}>
          {/* Header: leg name, date window and estimated duration in days. */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-10 min-w-0 border-b border-border bg-background/95 p-2 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground" />
            {legs.map((leg) => {
              const dateRange = formatBookingWindow(leg.starts_at_window_start, leg.ends_at_window_start, it ? "it-IT" : "en-US");
              const durationLabel = formatLegDurationDays(getLegDurationHours(leg), lang);
              return (
                <div key={leg.id} className="min-w-0 border-l border-border p-2 align-bottom">
                  <span className="block text-[11px] font-medium leading-snug">{getLegLabel(leg, waypointsById, lang)}</span>
                  {(dateRange || durationLabel) && (
                    <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                      {[dateRange, durationLabel].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Companion rows: anonymized, read-only, only overlapping bookers (server-filtered). */}
          {companions.map((row) => {
            const range = legIdsToRange(row.leg_ids, legIndexById);
            if (!range) return null;
            return (
              <div key={row.booking_request_id} className="grid border-b border-border/50" style={{ gridTemplateColumns }}>
                <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-2 text-[11px] text-muted-foreground">
                  {companionLabel(row, lang)}
                </div>
                <div className="relative border-l border-border/50" style={{ gridColumn: `2 / span ${legs.length}`, height: ROW_HEIGHT }}>
                  <div
                    className="absolute top-2 bottom-2 rounded-full border border-stone-300/60 bg-stone-100/60"
                    style={{ left: range.start * COLUMN_WIDTH + 4, width: (range.end - range.start + 1) * COLUMN_WIDTH - 8 }}
                  />
                </div>
              </div>
            );
          })}

          {/* Own request row: draggable edges + whole-bar move, gated behind an admin-approved proposal. */}
          {hasOwnRequest && ownRequest && ownDisplayRange && (
            <div className="grid border-b border-border/50" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-2 text-[11px] font-medium">
                {it ? "Tu" : "You"}
              </div>
              <div className="relative border-l border-border/50" style={{ gridColumn: `2 / span ${legs.length}`, height: ROW_HEIGHT }}>
                {legs.map((_, colIndex) => (
                  <div
                    key={colIndex}
                    className="absolute inset-y-0 border-l border-border/30 first:border-l-0"
                    style={{ left: colIndex * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                  />
                ))}
                <div
                  className="absolute top-2 bottom-2 flex items-center justify-center rounded-full border border-emerald-300/75 bg-emerald-100/80 px-3 text-[11px] font-medium text-emerald-800 shadow-sm"
                  style={{
                    left: ownDisplayRange.start * COLUMN_WIDTH + 4,
                    width: (ownDisplayRange.end - ownDisplayRange.start + 1) * COLUMN_WIDTH - 8,
                    cursor: ownPlanChangePending ? "default" : "grab",
                  }}
                  onPointerDown={(event) => {
                    if (ownPlanChangePending || !ownRange) return;
                    startDrag(event, "move", ownRange);
                  }}
                >
                  {!ownPlanChangePending && (
                    <span
                      onPointerDown={(event) => ownRange && startDrag(event, "start", ownRange)}
                      className="absolute left-0 top-0 h-full w-3 cursor-ew-resize"
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  )}
                  <span className="truncate">{getBookingStatusLabel(ownRequest.status, lang)}</span>
                  {!ownPlanChangePending && (
                    <span
                      onPointerDown={(event) => ownRange && startDrag(event, "end", ownRange)}
                      className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Draft row: pure client-side selection for a brand-new request, no writes until submit. */}
          {!hasOwnRequest && (
            <div className="grid" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-2 text-[11px] font-medium">
                {it ? "Bozza" : "Draft"}
              </div>
              <div className="relative border-l border-border/50" style={{ gridColumn: `2 / span ${legs.length}`, height: ROW_HEIGHT }}>
                {legs.map((_, colIndex) => (
                  <div
                    key={colIndex}
                    onDoubleClick={() => handleEmptyCellDoubleClick(colIndex)}
                    className="absolute inset-y-0 cursor-copy border-l border-border/30 first:border-l-0 hover:bg-accent/5"
                    style={{ left: colIndex * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                    title={it ? "Doppio clic per iniziare una richiesta" : "Double-click to start a request"}
                  />
                ))}
                {draftDisplayRange && (
                  <div
                    className="absolute top-2 bottom-2 flex items-center justify-center rounded-full border border-amber-300/75 bg-amber-100/80 px-3 text-[11px] font-medium text-amber-800 shadow-sm"
                    style={{
                      left: draftDisplayRange.start * COLUMN_WIDTH + 4,
                      width: (draftDisplayRange.end - draftDisplayRange.start + 1) * COLUMN_WIDTH - 8,
                      cursor: "grab",
                    }}
                    onPointerDown={(event) => draftRange && startDrag(event, "move", draftRange)}
                  >
                    <span
                      onPointerDown={(event) => draftRange && startDrag(event, "start", draftRange)}
                      className="absolute left-0 top-0 h-full w-3 cursor-ew-resize"
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                    <span className="truncate">{it ? "Nuova richiesta" : "New request"}</span>
                    <span
                      onPointerDown={(event) => draftRange && startDrag(event, "end", draftRange)}
                      className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {hasOwnRequest && ownRequest ? (
        <div className="flex flex-wrap items-center gap-2">
          {pendingProposalRange && (
            <>
              <button
                type="button"
                onClick={submitProposal}
                disabled={saving}
                className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-foreground hover:text-accent disabled:opacity-50"
              >
                <Check size={13} /> {it ? "Richiedi modifica" : "Request change"}
              </button>
              <button
                type="button"
                onClick={discardProposal}
                disabled={saving}
                className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground disabled:opacity-50"
              >
                <X size={13} /> {it ? "Annulla modifica" : "Discard"}
              </button>
            </>
          )}
          {ownPlanChangePending && (
            <span className="text-xs text-muted-foreground">
              {it ? "Modifica in attesa di risposta." : "Change pending a response."}
            </span>
          )}
          <button
            type="button"
            onClick={() => onCancelOwnRequest(ownRequest)}
            disabled={saving}
            className="glass-chip ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs text-destructive disabled:opacity-50"
          >
            <X size={13} /> {it ? "Annulla prenotazione" : "Cancel booking"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSubmitDraft}
          disabled={saving || draftLegIds.length === 0}
          className="glass-chip inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:text-accent disabled:opacity-50"
        >
          <Check size={15} /> {it ? "Invia richiesta" : "Send request"}
        </button>
      )}
    </div>
  );
};

export default UserBookingMatrix;
