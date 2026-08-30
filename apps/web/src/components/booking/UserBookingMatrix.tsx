import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Hourglass, RotateCcw, Users, X } from "lucide-react";
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
import type { BookingApplicationBlocker } from "@/lib/booking-application-gate";
import {
  emptyLegSelection,
  getLegSelectionHint,
  getLegSelectionRole,
  getLegSelectionRoleLabel,
  getSelectionRange,
  selectLegOnTap,
} from "@/lib/booking-leg-selection";
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
  /** True when ownRequest is admin_approved but the traveller's own contribution is still
   * unpaid — the seat is reserved but not yet fully confirmed (see settle_voyage_booking_payment). */
  ownRequestAwaitingPayment?: boolean;
  /** Anonymized occupancy of other bookers, already scoped to this voyage. */
  companions: VoyageBookingOccupancyRow[];
  /** Draft, not-yet-submitted leg selection — controlled by the parent (existing submit flow). */
  draftLegIds: string[];
  onDraftLegIdsChange: (legIds: string[]) => void;
  onSubmitDraft: () => void;
  onProposeChange: (requestId: string, proposedLegIds: string[]) => void;
  /** A plain click (no drag) on the traveller's own bar — opens the details modal (cancel lives there too). */
  onOpenOwnRequest: (request: BookingRequest) => void;
  /** Seats still free per leg, so a full leg reads as full before the request is refused. */
  remainingSeatsByLegId?: Record<string, number>;
  /** People the application is for, to flag legs that cannot take the whole party. */
  partySize?: number;
  /** Why the application can't be sent yet — spelled out instead of a dead disabled button. */
  blocker?: BookingApplicationBlocker | null;
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
  ownRequestAwaitingPayment = false,
  companions,
  draftLegIds,
  onDraftLegIdsChange,
  onSubmitDraft,
  onProposeChange,
  onOpenOwnRequest,
  remainingSeatsByLegId,
  partySize = 1,
  blocker = null,
}: UserBookingMatrixProps) => {
  const it = lang === "it";
  const legIndexById = useMemo(() => {
    const map = new Map<string, number>();
    legs.forEach((leg, index) => map.set(leg.id, index));
    return map;
  }, [legs]);
  const orderedLegIds = useMemo(() => legs.map((leg) => leg.id), [legs]);

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
  /** The leg the tap-to-select range is growing from; null once the range is closed. */
  const [anchorLegId, setAnchorLegId] = useState<string | null>(null);
  const anchorOpen = Boolean(anchorLegId && draftLegIds.includes(anchorLegId));

  // The anchor belongs to the range being built: once the parent resets or replaces the draft
  // (submit, draft hydration, voyage switch) the next tap has to start a fresh range.
  useEffect(() => {
    if (draftLegIds.length === 0) setAnchorLegId(null);
  }, [draftLegIds]);

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
        // Dragging states both ends at once, so the range is closed: the next tap starts over.
        setAnchorLegId(null);
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

  /** The one gesture that selects legs: a plain tap, on the grid and in the mobile list alike. */
  const handleLegTap = (legId: string) => {
    if (saving) return;
    if (hasOwnRequest) {
      if (ownRequest) onOpenOwnRequest(ownRequest);
      return;
    }
    const next = selectLegOnTap(orderedLegIds, { legIds: draftLegIds, anchorLegId }, legId);
    setAnchorLegId(next.anchorLegId);
    onDraftLegIdsChange(next.legIds);
    setDrag(null);
  };

  const clearDraft = () => {
    if (saving) return;
    setAnchorLegId(null);
    onDraftLegIdsChange([]);
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
  /** Selection shown on the leg cells themselves — the draft while composing, own legs once sent. */
  const highlightRange = hasOwnRequest ? ownDisplayRange : draftDisplayRange;

  const locale = it ? "it-IT" : "en-US";
  const legMeta = useMemo(
    () =>
      legs.map((leg) => {
        const remaining = remainingSeatsByLegId?.[leg.id];
        return {
          leg,
          label: getLegLabel(leg, waypointsById, lang),
          dateRange: formatBookingWindow(leg.starts_at_window_start, leg.ends_at_window_start, locale),
          durationLabel: formatLegDurationDays(getLegDurationHours(leg), lang),
          remaining,
          isFull: typeof remaining === "number" && remaining <= 0,
          isTight: typeof remaining === "number" && remaining > 0 && remaining < Math.max(1, partySize),
        };
      }),
    [lang, legs, locale, partySize, remainingSeatsByLegId, waypointsById]
  );

  const selectedRange = getSelectionRange(orderedLegIds, hasOwnRequest ? ownRequestLegIds : draftLegIds);
  const selectionSummary = (() => {
    if (!selectedRange) return null;
    const first = legMeta[selectedRange.start];
    const last = legMeta[selectedRange.end];
    if (!first || !last) return null;
    const count = selectedRange.end - selectedRange.start + 1;
    const countLabel = it
      ? `${count} ${count === 1 ? "tratta selezionata" : "tratte selezionate"}`
      : `${count} ${count === 1 ? "leg selected" : "legs selected"}`;
    const fromTo =
      first === last ? first.label : `${first.label.split(" → ")[0]} → ${last.label.split(" → ").pop()}`;
    return { countLabel, fromTo };
  })();

  const legsBlocked = blocker?.step === "legs";

  return (
    <div className="space-y-3">
      {/* The instruction the form was missing: what to do, and where the selection stands. */}
      {!hasOwnRequest && legs.length > 0 && (
        <div
          className={`rounded-[22px] border p-4 transition-colors ${
            selectionSummary && !legsBlocked
              ? "border-emerald-300/70 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 dark:bg-emerald-400/10"
              : legsBlocked
                ? "border-amber-400/80 bg-amber-50/80 dark:bg-amber-500/10 dark:bg-amber-400/10"
                : "border-accent/40 bg-accent/5"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    selectionSummary
                      ? "bg-emerald-600 text-white"
                      : "bg-accent text-accent-foreground"
                  }`}
                  aria-hidden
                >
                  {selectionSummary ? <Check size={13} /> : "1"}
                </span>
                {selectionSummary
                  ? selectionSummary.countLabel
                  : it
                    ? "Scegli le tue tratte"
                    : "Pick your legs"}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {selectionSummary ? (
                  <span className="font-medium text-foreground">{selectionSummary.fromTo}</span>
                ) : null}
                {selectionSummary ? " · " : null}
                {getLegSelectionHint(draftLegIds.length, anchorOpen, it ? "it" : "en")}
              </p>
            </div>
            {selectionSummary && (
              <button
                type="button"
                onClick={clearDraft}
                disabled={saving}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw size={13} /> {it ? "Ricomincia" : "Start over"}
              </button>
            )}
          </div>
        </div>
      )}

      {showProposalPreview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-6 rounded-full border border-emerald-300/75 dark:border-emerald-500/30 bg-emerald-100/80 dark:bg-emerald-500/15" />
            <span className="font-medium text-foreground">{it ? "Adesso" : "Now"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-6 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70 dark:bg-sky-500/15" />
            <span className="font-medium text-foreground">{it ? "Proposta (da confermare)" : "Proposed (to confirm)"}</span>
          </span>
        </div>
      )}

      {/* Mobile: the horizontal gantt is unusable on a phone (one column barely fits and the
          drag fights the page scroll), so the same legs become a plain tappable list. */}
      <ul className="space-y-2 md:hidden">
        {legMeta.map(({ leg, label, dateRange, durationLabel, remaining, isFull, isTight }, index) => {
          const role = getLegSelectionRole(index, highlightRange);
          const roleLabel = getLegSelectionRoleLabel(role, it ? "it" : "en");
          const selected = role !== "none";
          const companionCount = companions.filter((row) => row.leg_ids.includes(leg.id)).length;
          return (
            <li key={leg.id}>
              <button
                type="button"
                onClick={() => handleLegTap(leg.id)}
                disabled={saving}
                aria-pressed={hasOwnRequest ? undefined : selected}
                className={`flex w-full items-center gap-3 rounded-[20px] border p-3 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? hasOwnRequest
                      ? "border-emerald-400/80 bg-emerald-50/80 dark:bg-emerald-500/10 dark:bg-emerald-400/10"
                      : "border-emerald-500/80 bg-emerald-50/85 dark:bg-emerald-500/10 shadow-sm dark:bg-emerald-400/10"
                    : isFull
                      ? "border-border/60 bg-background/40"
                      : "border-border/70 bg-background/40 active:bg-accent/10"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                    selected
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : isFull
                        ? "border-border bg-background text-muted-foreground"
                        : "border-accent/60 bg-background text-accent"
                  }`}
                  aria-hidden
                >
                  {selected ? <Check size={14} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
                  {(dateRange || durationLabel) && (
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                      {[dateRange, durationLabel].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
                    {roleLabel && (
                      <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 font-semibold text-emerald-800 dark:text-emerald-300 dark:text-emerald-200">
                        {roleLabel}
                      </span>
                    )}
                    {typeof remaining === "number" && (
                      <span className={isFull ? "font-medium text-red-700 dark:text-red-300" : isTight ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
                        {isFull
                          ? it ? "Nessun posto libero" : "No seats left"
                          : it ? `${remaining} posti liberi` : `${remaining} seats left`}
                      </span>
                    )}
                    {companionCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Users size={11} />
                        {it ? `${companionCount} a bordo` : `${companionCount} aboard`}
                      </span>
                    )}
                  </span>
                </span>
                {!selected && !hasOwnRequest && (
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                    {it ? "Scegli" : "Pick"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Desktop: the gantt keeps the companion overview and drag-to-resize, on top of the
          same single-click selection as the mobile list. */}
      <div className="hidden overflow-x-auto rounded-[18px] border border-border/70 md:block">
        <div style={{ minWidth: LABEL_COL_WIDTH + trackWidth }}>
          {/* Header: leg name, date window and estimated duration in days. */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-10 min-w-0 border-b border-border bg-background/95 p-2 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground" />
            {legMeta.map(({ leg, label, dateRange, durationLabel, remaining, isFull }, index) => {
              const role = getLegSelectionRole(index, highlightRange);
              const roleLabel = getLegSelectionRoleLabel(role, it ? "it" : "en");
              return (
                <div
                  key={leg.id}
                  className={`min-w-0 border-l border-border p-2.5 align-bottom transition-colors ${
                    role !== "none" ? "bg-emerald-50/70 dark:bg-emerald-500/10 dark:bg-emerald-400/10" : ""
                  }`}
                >
                  <span className="block text-[13px] font-semibold leading-snug text-foreground">{label}</span>
                  {(dateRange || durationLabel) && (
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
                      {[dateRange, durationLabel].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    {roleLabel && (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">{roleLabel}</span>
                    )}
                    {typeof remaining === "number" && (
                      <span className={isFull ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}>
                        {isFull
                          ? it ? "Nessun posto libero" : "No seats left"
                          : it ? `${remaining} posti liberi` : `${remaining} seats left`}
                      </span>
                    )}
                  </span>
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
                    className="absolute top-2 bottom-2 rounded-full border border-border/60 bg-muted/60"
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
                    ownRequestAwaitingPayment
                      ? "border-orange-300/75 dark:border-orange-500/30 bg-orange-100/80 dark:bg-orange-500/15 text-orange-900 dark:text-orange-300"
                      : showProposalPreview
                        ? "border-emerald-300/70 dark:border-emerald-500/30 bg-emerald-100/70 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                        : "border-emerald-300/75 dark:border-emerald-500/30 bg-emerald-100/80 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                  ].join(" ")}
                  style={{
                    top: 8,
                    height: ROW_HEIGHT - 16,
                    left: ownDisplayRange.start * COLUMN_WIDTH + 4,
                    width: (ownDisplayRange.end - ownDisplayRange.start + 1) * COLUMN_WIDTH - 8,
                    cursor: ownPlanChangePending ? "default" : "grab",
                    touchAction: "none",
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
                      style={{ touchAction: "none" }}
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  )}
                  <span className="flex items-center gap-1.5 truncate">
                    {showProposalPreview ? (
                      <>{it ? "Adesso" : "Now"}</>
                    ) : (
                      <>
                        {(pendingApprovalStatuses.has(ownRequest.status) || ownRequestAwaitingPayment) && (
                          <Hourglass size={13} className="shrink-0" />
                        )}
                        {ownRequestAwaitingPayment
                          ? it
                            ? "In attesa di pagamento"
                            : "Awaiting payment"
                          : pendingApprovalStatuses.has(ownRequest.status)
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
                      style={{ touchAction: "none" }}
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                  )}
                </div>

                {/* Proposed legs: dashed to read as "not confirmed yet". */}
                {showProposalPreview && proposedRange && (
                  <div
                    className="absolute flex items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70 dark:bg-sky-500/15 px-3 text-[13px] font-semibold text-sky-900 dark:text-sky-300"
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
                {legMeta.map(({ leg, label }, colIndex) => {
                  const role = getLegSelectionRole(colIndex, draftDisplayRange);
                  return (
                    <button
                      key={leg.id}
                      type="button"
                      onClick={() => handleLegTap(leg.id)}
                      disabled={saving}
                      aria-pressed={role !== "none"}
                      aria-label={
                        role !== "none"
                          ? it ? `${label} — selezionata` : `${label} — selected`
                          : it ? `Seleziona la tratta ${label}` : `Select leg ${label}`
                      }
                      className="absolute inset-y-0 flex cursor-pointer items-center justify-center border-l border-border/30 text-[11px] font-semibold text-accent/0 transition-colors first:border-l-0 hover:bg-accent/10 hover:text-accent/90 focus-visible:bg-accent/10 focus-visible:outline-none disabled:cursor-not-allowed"
                      style={{ left: colIndex * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                      title={it ? "Clicca per selezionare questa tratta" : "Click to select this leg"}
                    >
                      {role === "none" ? (it ? "Clicca per selezionare" : "Click to select") : ""}
                    </button>
                  );
                })}
                {!draftDisplayRange && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-start pl-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/60 bg-background/80 px-3 py-1.5 text-[12px] font-semibold text-accent">
                      <ArrowRight size={13} />
                      {it ? "Clicca una tratta qui sopra per iniziare" : "Click a leg above to start"}
                    </span>
                  </div>
                )}
                {draftDisplayRange && (
                  <div
                    className="absolute top-2 bottom-2 flex items-center justify-center rounded-full border border-emerald-500/80 bg-emerald-100/85 dark:bg-emerald-500/15 px-3 text-[12px] font-semibold text-emerald-900 dark:text-emerald-300 shadow-sm dark:bg-emerald-400/20 dark:text-emerald-100"
                    style={{
                      left: draftDisplayRange.start * COLUMN_WIDTH + 4,
                      width: (draftDisplayRange.end - draftDisplayRange.start + 1) * COLUMN_WIDTH - 8,
                      cursor: "grab",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => draftRange && startDrag(event, "move", draftRange)}
                    title={it ? "Trascina i bordi per allungare o accorciare" : "Drag the edges to extend or shorten"}
                  >
                    <span
                      onPointerDown={(event) => draftRange && startDrag(event, "start", draftRange)}
                      className="absolute left-0 top-0 h-full w-3 cursor-ew-resize"
                      style={{ touchAction: "none" }}
                      title={it ? "Trascina per allungare/accorciare" : "Drag to extend/shorten"}
                    />
                    <span className="truncate">
                      {it ? "Le tue tratte" : "Your legs"}
                    </span>
                    <span
                      onPointerDown={(event) => draftRange && startDrag(event, "end", draftRange)}
                      className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                      style={{ touchAction: "none" }}
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
                className="w-full rounded-2xl border border-sky-300/70 dark:border-sky-500/30 bg-sky-50/80 dark:bg-sky-500/10 px-4 py-3 text-left transition-colors hover:border-sky-400 dark:bg-sky-400/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-300 dark:text-sky-100">
                  <Hourglass size={15} className="shrink-0" />
                  {it ? "L'organizzatore propone di cambiare le tue tratte" : "The organiser is proposing to change your legs"}
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-sky-900/80 dark:text-sky-300 dark:text-sky-100/80">
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
                className="w-full rounded-2xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 px-4 py-3 text-left transition-colors hover:border-amber-400 dark:bg-amber-400/10"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-300 dark:text-amber-100">
                  <Hourglass size={15} className="shrink-0" />
                  {it ? "Il viaggio è in ritardo" : "The voyage is running late"}
                </span>
                <span className="mt-1 block text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-300 dark:text-amber-100/80">
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
        <div className="space-y-2">
          {/* Never a silently dead button: when something is missing the button still reacts and
              the step that blocks it is named right here. */}
          {blocker && (
            <div className="flex items-start gap-2.5 rounded-[20px] border border-amber-400/70 bg-amber-50/80 dark:bg-amber-500/10 p-3.5 text-amber-950 dark:text-amber-300 dark:bg-amber-400/10 dark:text-amber-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{blocker.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed opacity-90">{blocker.detail}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onSubmitDraft}
            disabled={saving}
            className={`glass-chip inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm transition-colors disabled:opacity-50 ${
              blocker ? "text-muted-foreground hover:text-foreground" : "text-foreground hover:text-accent"
            }`}
          >
            <Check size={15} /> {it ? "Invia richiesta" : "Send request"}
          </button>
        </div>
      )}
    </div>
  );
};

export default UserBookingMatrix;
