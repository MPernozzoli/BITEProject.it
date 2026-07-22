import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Hourglass, X } from "lucide-react";
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

/** Statuses shown with a unified "pending approval" hint on the bar. */
const pendingApprovalStatuses = new Set<BookingRequest["status"]>(["requested", "waitlisted"]);

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
  /** A plain click (no drag) on the traveller's own bar — opens the details modal (cancel lives there too). */
  onOpenOwnRequest: (request: BookingRequest) => void;
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

/** Reads a string[] out of the plan-change metadata bag (proposed_leg_ids etc.). */
const readLegIdArray = (meta: Record<string, unknown> | null | undefined, key: string): string[] => {
  const value = meta?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

/** Reads a plain string out of the plan-change metadata bag (change_kind etc.). */
const readMetadataString = (meta: Record<string, unknown> | null | undefined, key: string): string | null => {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

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
  onOpenOwnRequest,
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
  const ownPlanChangeKind = readMetadataString(ownRequest?.plan_change_metadata, "change_kind");
  /** A delay notice keeps the same legs (only the dates move), so there is nothing to preview. */
  const ownPlanChangeIsScheduleDelay = ownPlanChangeKind === "schedule_delayed";
  // When the organiser has proposed different legs, surface them as a dashed "proposal" bar
  // right next to the current one, so the traveller sees the change instead of just reading
  // "a change is pending".
  const proposedRange = useMemo(() => {
    if (ownRequest?.plan_change_status !== "pending_user_approval" || ownPlanChangeIsScheduleDelay) return null;
    return legIdsToRange(readLegIdArray(ownRequest.plan_change_metadata, "proposed_leg_ids"), legIndexById);
  }, [ownRequest?.plan_change_status, ownRequest?.plan_change_metadata, ownPlanChangeIsScheduleDelay, legIndexById]);
  const showProposalPreview = Boolean(proposedRange);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const hasMovedRef = useRef(false);
  const [pendingProposalRange, setPendingProposalRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const handleMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaCols = Math.round((event.clientX - current.originClientX) / COLUMN_WIDTH);
      if (current.mode === "start") {
        const nextStart = clamp(current.segStart + deltaCols, 0, current.segEnd);
        if (nextStart !== current.previewStart) {
          hasMovedRef.current = true;
          setDrag({ ...current, previewStart: nextStart });
        }
      } else if (current.mode === "end") {
        const nextEnd = clamp(current.segEnd + deltaCols, current.segStart, legs.length - 1);
        if (nextEnd !== current.previewEnd) {
          hasMovedRef.current = true;
          setDrag({ ...current, previewEnd: nextEnd });
        }
      } else {
        const width = current.segEnd - current.segStart;
        const nextStart = clamp(current.segStart + deltaCols, 0, legs.length - 1 - width);
        const nextEnd = nextStart + width;
        if (nextStart !== current.previewStart) {
          hasMovedRef.current = true;
          setDrag({ ...current, previewStart: nextStart, previewEnd: nextEnd });
        }
      }
    };
    const handleUp = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      // A "move"-mode press that never actually moved is a plain click: open the details
      // modal instead of registering a (no-op) change proposal.
      if (current.mode === "move" && !hasMovedRef.current) {
        if (hasOwnRequest && ownRequest) onOpenOwnRequest(ownRequest);
        return;
      }
      const nextLegIds = indicesToLegIds(current.previewStart, current.previewEnd, legs);
      if (nextLegIds.length === 0) return;
      if (hasOwnRequest) {
        const unchanged =
          ownRange && current.previewStart === ownRange.start && current.previewEnd === ownRange.end;
        if (!unchanged) setPendingProposalRange({ start: current.previewStart, end: current.previewEnd });
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
  }, [drag, legs, hasOwnRequest, ownRequest, ownRange, onDraftLegIdsChange, onOpenOwnRequest]);

  const startDrag = (event: React.PointerEvent, mode: DragMode, range: { start: number; end: number }) => {
    if (saving) return;
    event.preventDefault();
    event.stopPropagation();
    hasMovedRef.current = false;
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
      {showProposalPreview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-6 rounded-full border border-emerald-300/75 bg-emerald-100/80" />
            <span className="font-medium text-foreground">{it ? "Adesso" : "Now"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-6 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70" />
            <span className="font-medium text-foreground">{it ? "Proposta (da confermare)" : "Proposed (to confirm)"}</span>
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[18px] border border-border/70">
        <div style={{ minWidth: LABEL_COL_WIDTH + trackWidth }}>
          {/* Header: leg name, date window and estimated duration in days. */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-10 min-w-0 border-b border-border bg-background/95 p-2 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground" />
            {legs.map((leg) => {
              const dateRange = formatBookingWindow(leg.starts_at_window_start, leg.ends_at_window_start, it ? "it-IT" : "en-US");
              const durationLabel = formatLegDurationDays(getLegDurationHours(leg), lang);
              return (
                <div key={leg.id} className="min-w-0 border-l border-border p-2.5 align-bottom">
                  <span className="block text-[13px] font-semibold leading-snug text-foreground">{getLegLabel(leg, waypointsById, lang)}</span>
                  {(dateRange || durationLabel) && (
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
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

          {/* Own request row: draggable edges + whole-bar move, gated behind an admin-approved proposal.
              When the organiser has proposed different legs, the row grows to stack the current
              bar ("Adesso") over a dashed proposal bar ("Proposta"). */}
          {hasOwnRequest && ownRequest && ownDisplayRange && (
            <div className="grid border-b border-border/50" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-2 text-[13px] font-semibold">
                {it ? "Tu" : "You"}
              </div>
              <div
                className="relative border-l border-border/50"
                style={{ gridColumn: `2 / span ${legs.length}`, height: showProposalPreview ? ROW_HEIGHT * 2 : ROW_HEIGHT }}
              >
                {legs.map((_, colIndex) => (
                  <div
                    key={colIndex}
                    className="absolute inset-y-0 border-l border-border/30 first:border-l-0"
                    style={{ left: colIndex * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                  />
                ))}

                {/* Current legs. Solid; slightly muted when a proposal is on the table. */}
                <div
                  className={[
                    "absolute flex items-center justify-center rounded-full border px-3 text-[13px] font-semibold shadow-sm",
                    showProposalPreview
                      ? "border-emerald-300/70 bg-emerald-100/70 text-emerald-800"
                      : "border-emerald-300/75 bg-emerald-100/80 text-emerald-800",
                  ].join(" ")}
                  style={{
                    top: 8,
                    height: ROW_HEIGHT - 16,
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
                  <span className="flex items-center gap-1.5 truncate">
                    {showProposalPreview ? (
                      <>{it ? "Adesso" : "Now"}</>
                    ) : (
                      <>
                        {pendingApprovalStatuses.has(ownRequest.status) && <Hourglass size={13} className="shrink-0" />}
                        {pendingApprovalStatuses.has(ownRequest.status)
                          ? it
                            ? "In attesa di approvazione"
                            : "Pending approval"
                          : getBookingStatusLabel(ownRequest.status, lang)}
                      </>
                    )}
                  </span>
                  {!ownPlanChangePending && (
                    <span
                      onPointerDown={(event) => ownRange && startDrag(event, "end", ownRange)}
                      className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  )}
                </div>

                {/* Proposed legs: dashed to read as "not confirmed yet". */}
                {showProposalPreview && proposedRange && (
                  <div
                    className="absolute flex items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70 px-3 text-[13px] font-semibold text-sky-900"
                    style={{
                      top: ROW_HEIGHT + 8,
                      height: ROW_HEIGHT - 16,
                      left: proposedRange.start * COLUMN_WIDTH + 4,
                      width: (proposedRange.end - proposedRange.start + 1) * COLUMN_WIDTH - 8,
                    }}
                  >
                    <Hourglass size={13} className="shrink-0" />
                    <span className="truncate">{it ? "Proposta" : "Proposed"}</span>
                  </div>
                )}
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

      {/* Actions: only contextual ones tied to the drag itself — everything else (cancel, full
          details) lives behind the details modal opened by clicking the bar, to keep this
          view uncluttered. */}
      {hasOwnRequest && ownRequest ? (
        (pendingProposalRange || ownPlanChangePending) && (
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
            {ownPlanChangePending && showProposalPreview && (
              <button
                type="button"
                onClick={() => ownRequest && onOpenOwnRequest(ownRequest)}
                className="w-full rounded-2xl border border-sky-300/70 bg-sky-50/80 px-4 py-3 text-left transition-colors hover:border-sky-400 dark:bg-sky-400/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-100">
                  <Hourglass size={15} className="shrink-0" />
                  {it ? "L'organizzatore propone di cambiare le tue tratte" : "The organiser is proposing to change your legs"}
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-sky-900/80 dark:text-sky-100/80">
                  {it
                    ? "Confronta la barra piena “Adesso” con quella tratteggiata “Proposta” qui sopra. Tocca qui per vedere i dettagli e accettare o rifiutare."
                    : "Compare the solid “Now” bar with the dashed “Proposed” one above. Tap here to see the details and accept or decline."}
                </span>
              </button>
            )}
            {ownPlanChangePending && !showProposalPreview && ownPlanChangeIsScheduleDelay && (
              <button
                type="button"
                onClick={() => ownRequest && onOpenOwnRequest(ownRequest)}
                className="w-full rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-left transition-colors hover:border-amber-400 dark:bg-amber-400/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                  <Hourglass size={15} className="shrink-0" />
                  {it ? "Il viaggio è in ritardo" : "The voyage is running late"}
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                  {it
                    ? "Le tue tratte non cambiano, solo le date si spostano. Tocca qui per i dettagli e per confermare o annullare con rimborso completo."
                    : "Your legs do not change, only the dates shift. Tap here for details, to acknowledge, or to cancel with a full refund."}
                </span>
              </button>
            )}
            {ownPlanChangePending && !showProposalPreview && !ownPlanChangeIsScheduleDelay && (
              <span className="text-[13px] text-muted-foreground">
                {it ? "Modifica in attesa di risposta." : "Change pending a response."}
              </span>
            )}
          </div>
        )
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
