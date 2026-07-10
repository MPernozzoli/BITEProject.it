import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  type BookableLeg,
  type BookingProfile,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingWaypoint,
  type VoyageBookingStatus,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getBookingStatusShortLabel,
  getLegLabel,
} from "@/lib/booking-utils";

const COLUMN_WIDTH = 170;
const PERSON_COL_WIDTH = 220;
const ACTIONS_COL_WIDTH = 210;
const ROW_HEIGHT = 76;

interface BookingGanttTableProps {
  legs: BookableLeg[];
  waypointsById: Record<string, BookingWaypoint>;
  requests: BookingRequest[];
  requestLegs: BookingRequestLeg[];
  profilesById: Record<string, BookingProfile>;
  availableProfiles: BookingProfile[];
  legCapacity: Record<string, number>;
  maxGuests: number;
  saving: boolean;
  statusOptions: VoyageBookingStatus[];
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onStatusChange: (requestId: string, status: VoyageBookingStatus) => void;
  /** Persist a request's leg range after a drag-resize; nextLegIds is the full new set. */
  onResize: (requestId: string, nextLegIds: string[]) => Promise<void>;
  /** Create a brand-new single-leg booking from a column's "+" pill. */
  onAddPerson: (legId: string, profileId: string, partySize: number) => Promise<void>;
}

/** A contiguous run of leg-column indices a booking occupies. */
type Segment = { startIdx: number; endIdx: number };

const computeSegments = (indices: number[]): Segment[] => {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const idx of sorted) {
    if (start === null) {
      start = idx;
      prev = idx;
      continue;
    }
    if (idx === prev! + 1) {
      prev = idx;
      continue;
    }
    segments.push({ startIdx: start, endIdx: prev! });
    start = idx;
    prev = idx;
  }
  if (start !== null) segments.push({ startIdx: start, endIdx: prev! });
  return segments;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface DragState {
  requestId: string;
  edge: "start" | "end";
  segStart: number;
  segEnd: number;
  /** Leg-column indices this request occupies OUTSIDE the segment being dragged. */
  otherIndices: number[];
  originClientX: number;
  previewStart: number;
  previewEnd: number;
}

const BookingGanttTable = ({
  legs,
  waypointsById,
  requests,
  requestLegs,
  profilesById,
  availableProfiles,
  legCapacity,
  maxGuests,
  saving,
  statusOptions,
  onApprove,
  onReject,
  onStatusChange,
  onResize,
  onAddPerson,
}: BookingGanttTableProps) => {
  const legIndexById = useMemo(() => {
    const map = new Map<string, number>();
    legs.forEach((leg, index) => map.set(leg.id, index));
    return map;
  }, [legs]);

  const legIndicesByRequest = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const link of requestLegs) {
      const idx = legIndexById.get(link.bookable_leg_id);
      if (idx == null) continue;
      const list = map.get(link.booking_request_id) || [];
      list.push(idx);
      map.set(link.booking_request_id, list);
    }
    return map;
  }, [requestLegs, legIndexById]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const [addPersonLegId, setAddPersonLegId] = useState<string | null>(null);
  const [addPersonProfileId, setAddPersonProfileId] = useState("");
  const [addPersonPartySize, setAddPersonPartySize] = useState("1");
  const [addPersonBusy, setAddPersonBusy] = useState(false);

  useEffect(() => {
    if (!drag) return;
    const handleMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaCols = Math.round((event.clientX - current.originClientX) / COLUMN_WIDTH);
      if (current.edge === "start") {
        const nextStart = clamp(current.segStart + deltaCols, 0, current.segEnd);
        if (nextStart !== current.previewStart) {
          setDrag({ ...current, previewStart: nextStart });
        }
      } else {
        const nextEnd = clamp(current.segEnd + deltaCols, current.segStart, legs.length - 1);
        if (nextEnd !== current.previewEnd) {
          setDrag({ ...current, previewEnd: nextEnd });
        }
      }
    };
    const handleUp = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      const finalIndices = [
        ...current.otherIndices,
        ...Array.from(
          { length: current.previewEnd - current.previewStart + 1 },
          (_, i) => current.previewStart + i
        ),
      ];
      const nextLegIds = [...new Set(finalIndices)]
        .sort((a, b) => a - b)
        .map((idx) => legs[idx]?.id)
        .filter((id): id is string => Boolean(id));
      if (nextLegIds.length === 0) return;
      void onResize(current.requestId, nextLegIds);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, legs, onResize]);

  const startDrag = (
    event: React.PointerEvent,
    requestId: string,
    segment: Segment,
    allIndices: number[],
    edge: "start" | "end"
  ) => {
    if (saving) return;
    event.preventDefault();
    event.stopPropagation();
    const segmentSet = new Set<number>();
    for (let i = segment.startIdx; i <= segment.endIdx; i += 1) segmentSet.add(i);
    setDrag({
      requestId,
      edge,
      segStart: segment.startIdx,
      segEnd: segment.endIdx,
      otherIndices: allIndices.filter((idx) => !segmentSet.has(idx)),
      originClientX: event.clientX,
      previewStart: segment.startIdx,
      previewEnd: segment.endIdx,
    });
  };

  const trackWidth = legs.length * COLUMN_WIDTH;
  const gridTemplateColumns = `${PERSON_COL_WIDTH}px repeat(${legs.length}, ${COLUMN_WIDTH}px) ${ACTIONS_COL_WIDTH}px`;

  const openAddPerson = (legId: string) => {
    setAddPersonLegId(legId);
    setAddPersonProfileId("");
    setAddPersonPartySize("1");
  };

  const submitAddPerson = async () => {
    if (!addPersonLegId || !addPersonProfileId) return;
    setAddPersonBusy(true);
    await onAddPerson(addPersonLegId, addPersonProfileId, Math.max(1, Number.parseInt(addPersonPartySize, 10) || 1));
    setAddPersonBusy(false);
    setAddPersonLegId(null);
  };

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: PERSON_COL_WIDTH + trackWidth + ACTIONS_COL_WIDTH }}>
        {/* Header row */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-10 min-w-0 border-b border-border bg-background/95 p-3 text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Persona
          </div>
          {legs.map((leg) => {
            const occupied = legCapacity[leg.id] || 0;
            const full = occupied >= maxGuests;
            return (
              <div key={leg.id} className="min-w-0 border-l border-border p-3 align-bottom">
                <span className="block text-xs font-medium leading-snug">{getLegLabel(leg, waypointsById, "it")}</span>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className={`text-[11px] ${full ? "text-amber-700" : "text-muted-foreground"}`}>
                    {occupied}/{maxGuests} pax
                  </span>
                  <button
                    type="button"
                    onClick={() => openAddPerson(leg.id)}
                    title="Aggiungi persona su questa tratta"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent/50 text-accent hover:bg-accent/10"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {addPersonLegId === leg.id && (
                  <div className="absolute z-20 mt-2 w-64 rounded-[16px] border border-border bg-background p-3 shadow-xl">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Aggiungi su {getLegLabel(leg, waypointsById, "it")}
                    </p>
                    <select
                      value={addPersonProfileId}
                      onChange={(event) => setAddPersonProfileId(event.target.value)}
                      className="mb-2 w-full border border-border bg-background/80 px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                    >
                      <option value="">Seleziona persona</option>
                      {availableProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name || profile.email}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={addPersonPartySize}
                      onChange={(event) => setAddPersonPartySize(event.target.value)}
                      className="mb-2 w-full border border-border bg-background/80 px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void submitAddPerson()}
                        disabled={addPersonBusy || !addPersonProfileId}
                        className="glass-chip inline-flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-foreground hover:text-accent disabled:opacity-50"
                      >
                        <Check size={12} /> Aggiungi
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddPersonLegId(null)}
                        className="glass-chip inline-flex items-center justify-center px-2 py-1.5 text-[11px] text-muted-foreground"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="border-l border-border p-3 text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Azioni
          </div>
        </div>

        {/* Person rows */}
        {requests.map((request) => {
          const profile = profilesById[request.profile_id];
          const allIndices = legIndicesByRequest.get(request.id) || [];
          const segments = computeSegments(allIndices);
          const statusClass = getBookingStatusClass(request.status);
          return (
            <div key={request.id} className="grid border-b border-border/60" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-3 align-top">
                <div className="flex items-center gap-1.5 font-medium">
                  {profile?.name || profile?.email || request.profile_id}
                  {request.is_crew && (
                    <span className="rounded-full border border-indigo-300/70 bg-indigo-100/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-indigo-800">
                      Equipaggio
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {profile?.email || "No email"} · {request.party_size} pax
                </div>
                <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] ${statusClass}`}>
                  {getBookingStatusLabel(request.status, "it")}
                </span>
              </div>

              <div
                className="relative border-l border-border/60"
                style={{ gridColumn: `2 / span ${legs.length}`, height: ROW_HEIGHT }}
              >
                {legs.map((_, colIndex) => (
                  <div
                    key={colIndex}
                    className="absolute inset-y-0 border-l border-border/30 first:border-l-0"
                    style={{ left: colIndex * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                  />
                ))}
                {segments.map((segment, segIndex) => {
                  const isDraggingThis = drag?.requestId === request.id && drag.segStart === segment.startIdx && drag.segEnd === segment.endIdx;
                  const start = isDraggingThis ? drag!.previewStart : segment.startIdx;
                  const end = isDraggingThis ? drag!.previewEnd : segment.endIdx;
                  return (
                    <div
                      key={segIndex}
                      className={`absolute top-2 bottom-2 flex items-center rounded-full border px-3 text-[11px] font-medium shadow-sm ${statusClass}`}
                      style={{ left: start * COLUMN_WIDTH + 4, width: (end - start + 1) * COLUMN_WIDTH - 8 }}
                    >
                      <span
                        onPointerDown={(event) => startDrag(event, request.id, segment, allIndices, "start")}
                        className="absolute left-0 top-0 h-full w-3 cursor-ew-resize"
                        title="Trascina per estendere/ridurre"
                      />
                      <span className="truncate">{getBookingStatusShortLabel(request.status)}</span>
                      <span
                        onPointerDown={(event) => startDrag(event, request.id, segment, allIndices, "end")}
                        className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                        title="Trascina per estendere/ridurre"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="border-l border-border/60 p-3 align-top">
                <div className="flex flex-wrap gap-2">
                  {request.status === "requested" || request.status === "waitlisted" ? (
                    <button
                      type="button"
                      onClick={() => onApprove(request.id)}
                      disabled={saving}
                      className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-foreground hover:text-accent disabled:opacity-50"
                    >
                      <Check size={13} /> Approva
                    </button>
                  ) : null}
                  {!["cancelled", "rejected", "expired"].includes(request.status) ? (
                    <button
                      type="button"
                      onClick={() => onReject(request.id)}
                      disabled={saving}
                      className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-destructive disabled:opacity-50"
                    >
                      <X size={13} /> Rifiuta
                    </button>
                  ) : null}
                  <select
                    value={request.status}
                    onChange={(event) => onStatusChange(request.id, event.target.value as VoyageBookingStatus)}
                    disabled={saving}
                    className="border border-border bg-background/80 px-2 py-2 text-xs focus:border-accent focus:outline-none disabled:opacity-50"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {getBookingStatusLabel(status, "it")}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Richiesta: {formatBookingDate(request.requested_at, "it-IT")}
                </p>
              </div>
            </div>
          );
        })}
        {requests.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nessuna richiesta per i filtri selezionati.</p>
        )}
      </div>
    </div>
  );
};

export default BookingGanttTable;
