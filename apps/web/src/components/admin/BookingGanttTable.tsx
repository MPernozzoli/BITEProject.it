import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Mail, Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ProfileAvatar from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type BookableLeg,
  type BookingProfile,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingWaypoint,
  type VoyageBookingStatus,
  capacityBlockingStatuses,
  formatBookingDate,
  formatBookingWindow,
  formatLegDurationDays,
  getBookingStatusClass,
  getBookingStatusLabel,
  getLegDurationHours,
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
  /** A locally-staged (not yet sent) leg range for a booking, awaiting Annulla/Proponi modifica. */
  stagedResize: { requestId: string; legIds: string[] } | null;
  /** Booking ids whose only participant is still an unaccepted email invite — for these, a
   * staged resize applies directly (no traveller to await approval from) instead of going
   * through the propose-and-wait dialog. */
  pendingInviteRequestIds: Set<string>;
  /** Stage a request's leg range after a drag-resize; nextLegIds is the full new set. Does not call any RPC. */
  onStageResize: (requestId: string, nextLegIds: string[]) => void;
  /** Discard the staged resize for the row currently being edited. */
  onCancelStagedResize: () => void;
  /** Open the reason dialog to actually send the staged resize as a plan-change proposal. */
  onOpenProposalDialog: () => void;
  /** Applies the staged resize directly for a not-yet-accepted invite (no proposal needed). */
  onApplyPendingInviteResize: () => void;
  /** Create brand-new bookings (possibly spanning several contiguous legs) from a column's "+" pill. */
  onAddPeople: (legIds: string[], profileIds: string[], inviteEmails: string[], isComped: boolean) => Promise<void>;
}

/** Pulls proposed_leg_ids out of a request's plan-change metadata bag. */
const readProposedLegIds = (meta: Record<string, unknown> | null | undefined): string[] => {
  const value = meta?.proposed_leg_ids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

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

const duplicateBlockingStatuses = new Set<VoyageBookingStatus>([
  ...capacityBlockingStatuses,
  "waitlisted",
]);

const getProfileLabel = (profile: BookingProfile) => profile.name || profile.email || "Profilo senza nome";
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const getProfileInitials = (profile: BookingProfile) => {
  const source = getProfileLabel(profile).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase() || "?";
};

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
  stagedResize,
  pendingInviteRequestIds,
  onStageResize,
  onCancelStagedResize,
  onOpenProposalDialog,
  onApplyPendingInviteResize,
  onAddPeople,
}: BookingGanttTableProps) => {
  const navigate = useNavigate();
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
  /** Ordered, contiguous leg ids the "Aggiungi persona" dialog currently targets. */
  const [addPersonLegIds, setAddPersonLegIds] = useState<string[]>([]);
  const [addPersonProfileIds, setAddPersonProfileIds] = useState<string[]>([]);
  // "Omaggio": the invited person is exempt from the contribution payment gate. Off by
  // default so the exemption is always a deliberate act, never an accident.
  const [addPersonComped, setAddPersonComped] = useState(false);
  const [addPersonInviteEmail, setAddPersonInviteEmail] = useState("");
  const [addPersonBusy, setAddPersonBusy] = useState(false);
  const [addPersonPickerOpen, setAddPersonPickerOpen] = useState(false);
  const [profileDialogRequestId, setProfileDialogRequestId] = useState<string | null>(null);

  const uniqueAvailableProfiles = useMemo(() => {
    const map = new Map<string, BookingProfile>();
    const seenIdentities = new Set<string>();
    for (const profile of availableProfiles) {
      if (!profile.id || map.has(profile.id)) continue;
      const identity = (profile.email || profile.name || profile.id).trim().toLowerCase();
      if (identity && seenIdentities.has(identity)) continue;
      map.set(profile.id, profile);
      if (identity) seenIdentities.add(identity);
    }
    return [...map.values()].sort((a, b) =>
      getProfileLabel(a).localeCompare(getProfileLabel(b), "it", { sensitivity: "base" })
    );
  }, [availableProfiles]);

  const activeProfileIdsByLeg = useMemo(() => {
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const map = new Map<string, Set<string>>();
    for (const link of requestLegs) {
      const request = requestById.get(link.booking_request_id);
      if (!request || !duplicateBlockingStatuses.has(request.status)) continue;
      const profilesForLeg = map.get(link.bookable_leg_id) || new Set<string>();
      profilesForLeg.add(request.profile_id);
      map.set(link.bookable_leg_id, profilesForLeg);
    }
    return map;
  }, [requestLegs, requests]);

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
      onStageResize(current.requestId, nextLegIds);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, legs, onStageResize]);

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
  const anyPendingProposal = requests.some(
    (request) =>
      request.plan_change_status === "pending_user_approval" &&
      readProposedLegIds(request.plan_change_metadata).length > 0,
  );
  // Ordered by voyage leg sequence (not selection order), so extend/remove always act on the ends.
  const activeAddLegIndices = addPersonLegIds
    .map((id) => legIndexById.get(id))
    .filter((idx): idx is number => idx != null)
    .sort((a, b) => a - b);
  const activeAddLegs = activeAddLegIndices.map((idx) => legs[idx]).filter((leg): leg is BookableLeg => Boolean(leg));
  const activeAddRemainingSeats =
    activeAddLegs.length > 0
      ? Math.min(...activeAddLegs.map((leg) => Math.max(0, maxGuests - (legCapacity[leg.id] || 0))))
      : 0;
  const activeAddAlreadyOnLeg = activeAddLegs.reduce((acc, leg) => {
    for (const profileId of activeProfileIdsByLeg.get(leg.id) || []) acc.add(profileId);
    return acc;
  }, new Set<string>());
  const activeAddSelectableProfiles = activeAddLegs.length > 0
    ? uniqueAvailableProfiles.filter((profile) => !activeAddAlreadyOnLeg.has(profile.id))
    : [];
  const canExtendAddBefore = activeAddLegIndices.length > 0 && activeAddLegIndices[0] > 0;
  const canExtendAddAfter =
    activeAddLegIndices.length > 0 && activeAddLegIndices[activeAddLegIndices.length - 1] < legs.length - 1;
  const activeAddSelectedProfiles = activeAddSelectableProfiles.filter((profile) =>
    addPersonProfileIds.includes(profile.id)
  );
  const activeAddInviteEmail = addPersonInviteEmail.trim().toLowerCase();
  const activeAddHasInviteEmail = activeAddInviteEmail.length > 0;
  const activeAddInviteEmailReady = emailValid(activeAddInviteEmail);
  const activeAddSelectedCount = addPersonProfileIds.length + (activeAddInviteEmailReady ? 1 : 0);
  const selectedProfileRequest = profileDialogRequestId
    ? requests.find((request) => request.id === profileDialogRequestId) ?? null
    : null;
  const selectedProfile = selectedProfileRequest ? profilesById[selectedProfileRequest.profile_id] : null;

  const openAddPerson = (legId: string) => {
    setAddPersonLegIds([legId]);
    setAddPersonProfileIds([]);
    setAddPersonInviteEmail("");
    setAddPersonPickerOpen(false);
  };

  const closeAddPerson = () => {
    setAddPersonLegIds([]);
    setAddPersonInviteEmail("");
    setAddPersonPickerOpen(false);
  };

  /** Extends the contiguous "Aggiungi persona" range to the previous/next tratta. */
  const extendAddPersonRange = (direction: "before" | "after") => {
    if (activeAddLegIndices.length === 0) return;
    const targetIdx =
      direction === "before" ? activeAddLegIndices[0] - 1 : activeAddLegIndices[activeAddLegIndices.length - 1] + 1;
    const targetLeg = legs[targetIdx];
    if (!targetLeg) return;
    setAddPersonLegIds((current) => [...current, targetLeg.id]);
  };

  /** Shrinks the range by dropping one of its two ends (keeps it contiguous). */
  const removeAddPersonEnd = (end: "before" | "after") => {
    if (activeAddLegIndices.length <= 1) return;
    const dropIdx = end === "before" ? activeAddLegIndices[0] : activeAddLegIndices[activeAddLegIndices.length - 1];
    setAddPersonLegIds((current) => current.filter((id) => legIndexById.get(id) !== dropIdx));
  };

  const toggleAddProfile = (profileId: string) => {
    setAddPersonProfileIds((current) => {
      if (current.includes(profileId)) return current.filter((id) => id !== profileId);
      if (current.length + (activeAddInviteEmailReady ? 1 : 0) >= activeAddRemainingSeats) return current;
      return [...current, profileId];
    });
  };

  const openMailForProfile = () => {
    if (!selectedProfile?.email) return;
    const query = new URLSearchParams({
      compose: "1",
      to: selectedProfile.email,
      subject: `Viaggio BITE - ${getProfileLabel(selectedProfile)}`,
    });
    navigate(`/admin/mail?${query.toString()}`);
  };

  const submitAddPerson = async () => {
    const inviteEmail = addPersonInviteEmail.trim().toLowerCase();
    const inviteEmails = emailValid(inviteEmail) ? [inviteEmail] : [];
    if (addPersonLegIds.length === 0 || (addPersonProfileIds.length === 0 && inviteEmails.length === 0)) return;
    setAddPersonBusy(true);
    await onAddPeople(addPersonLegIds, addPersonProfileIds, inviteEmails, addPersonComped);
    setAddPersonBusy(false);
    setAddPersonLegIds([]);
    setAddPersonInviteEmail("");
    setAddPersonComped(false);
    setAddPersonPickerOpen(false);
  };

  return (
    <>
    <Dialog
      open={activeAddLegs.length > 0}
      onOpenChange={(open) => {
        if (!open) closeAddPerson();
      }}
    >
      <DialogContent className="max-w-md rounded-[24px] border-border bg-background p-5">
        <DialogHeader>
          <DialogTitle className="text-base">
            {activeAddLegs.length > 0
              ? activeAddLegs.length === 1
                ? `Aggiungi su ${getLegLabel(activeAddLegs[0], waypointsById, "it")}`
                : `Aggiungi su ${activeAddLegs.length} tratte`
              : "Aggiungi persona"}
          </DialogTitle>
          <DialogDescription>
            {activeAddLegs.length > 0
              ? activeAddRemainingSeats > 0
                ? `${activeAddRemainingSeats} posti disponibili su tutte le tratte selezionate`
                : "Almeno una tratta selezionata e al completo"
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border/70 bg-background/70 p-2">
          <label className="mb-1.5 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Tratte
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => extendAddPersonRange("before")}
              disabled={!canExtendAddBefore}
              title="Aggiungi la tratta precedente"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-30"
            >
              ◀
            </button>
            {activeAddLegs.map((leg, index) => {
              const isEnd = index === 0 || index === activeAddLegs.length - 1;
              const canRemove = activeAddLegs.length > 1 && isEnd;
              return (
                <span
                  key={leg.id}
                  className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent"
                >
                  {getLegLabel(leg, waypointsById, "it")}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => removeAddPersonEnd(index === 0 ? "before" : "after")}
                      title="Rimuovi questa tratta dalla selezione"
                      className="ml-0.5 rounded-full hover:text-destructive"
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => extendAddPersonRange("after")}
              disabled={!canExtendAddAfter}
              title="Aggiungi la tratta successiva"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-30"
            >
              ▶
            </button>
          </div>
        </div>
        <Popover open={addPersonPickerOpen} onOpenChange={setAddPersonPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              disabled={activeAddRemainingSeats === 0}
              className="h-auto min-h-11 w-full justify-between gap-2 border-border bg-background/80 px-2 py-2 text-left text-xs font-normal hover:bg-background"
            >
              {activeAddSelectedProfiles.length > 0 ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex -space-x-2">
                    {activeAddSelectedProfiles.slice(0, 3).map((profile) => (
                      <span
                        key={profile.id}
                        className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-background bg-accent/10 text-[10px] font-semibold text-accent"
                      >
                        <ProfileAvatar
                          name={getProfileLabel(profile)}
                          avatarUrl={profile.avatar_url}
                          fallback={<span>{getProfileInitials(profile)}</span>}
                        />
                      </span>
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {activeAddSelectedProfiles.length === 1
                        ? getProfileLabel(activeAddSelectedProfiles[0])
                        : `${activeAddSelectedProfiles.length} persone selezionate`}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Cerca persone...</span>
              )}
              <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Cerca per nome o email..." />
              <CommandList>
                <CommandEmpty>Nessuna persona trovata.</CommandEmpty>
                <CommandGroup>
                  {activeAddSelectableProfiles.map((profile) => (
                    <CommandItem
                      key={profile.id}
                      value={`${getProfileLabel(profile)} ${profile.email || ""} ${profile.id}`}
                      onSelect={() => toggleAddProfile(profile.id)}
                      disabled={!addPersonProfileIds.includes(profile.id) && activeAddSelectedCount >= activeAddRemainingSeats}
                      className="gap-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                        <ProfileAvatar
                          name={getProfileLabel(profile)}
                          avatarUrl={profile.avatar_url}
                          fallback={<span>{getProfileInitials(profile)}</span>}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{getProfileLabel(profile)}</span>
                        {profile.email && (
                          <span className="block truncate text-[11px] text-muted-foreground">{profile.email}</span>
                        )}
                      </span>
                      <span
                        className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          addPersonProfileIds.includes(profile.id)
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border"
                        }`}
                      >
                        {addPersonProfileIds.includes(profile.id) && <Check size={12} />}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="rounded-xl border border-border/70 bg-background/70 p-2">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Altri...
          </label>
          <input
            type="email"
            value={addPersonInviteEmail}
            onChange={(event) => setAddPersonInviteEmail(event.target.value)}
            disabled={activeAddRemainingSeats === 0 || addPersonProfileIds.length >= activeAddRemainingSeats}
            placeholder="email@example.com"
            className="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-accent disabled:opacity-50"
          />
          {activeAddHasInviteEmail && !activeAddInviteEmailReady && (
            <p className="mt-1 text-[10px] text-amber-700">Inserisci una email valida.</p>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 bg-background/70 p-2">
          <input
            type="checkbox"
            checked={addPersonComped}
            onChange={(event) => setAddPersonComped(event.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="block font-semibold text-foreground">Omaggio</span>
            Esenta dal contributo: la persona non dovra pagare nulla e la candidatura puo essere
            approvata senza pagamento. Lasciando deselezionato, dovra versare la quota come tutti.
          </span>
        </label>
        <DialogFooter>
          <button
            type="button"
            onClick={closeAddPerson}
            className="glass-chip inline-flex items-center justify-center px-3 py-2 text-xs text-muted-foreground"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => void submitAddPerson()}
            disabled={addPersonBusy || activeAddSelectedCount === 0 || (activeAddHasInviteEmail && !activeAddInviteEmailReady)}
            className="glass-chip inline-flex items-center justify-center gap-1 px-3 py-2 text-xs text-foreground hover:text-accent disabled:opacity-50"
          >
            <Check size={13} /> Aggiungi {activeAddSelectedCount || ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={Boolean(profileDialogRequestId)}
      onOpenChange={(open) => {
        if (!open) setProfileDialogRequestId(null);
      }}
    >
      <DialogContent className="max-w-md rounded-[24px] border-border bg-background p-5">
        <DialogHeader>
          <DialogTitle>{selectedProfile ? getProfileLabel(selectedProfile) : "Profilo"}</DialogTitle>
          <DialogDescription>Dettagli profilo e richiesta viaggio.</DialogDescription>
        </DialogHeader>
        {selectedProfileRequest && selectedProfile && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-xs font-semibold text-accent">
                <ProfileAvatar
                  name={getProfileLabel(selectedProfile)}
                  avatarUrl={selectedProfile.avatar_url}
                  fallback={<span>{getProfileInitials(selectedProfile)}</span>}
                />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{getProfileLabel(selectedProfile)}</p>
                <p className="truncate text-muted-foreground">{selectedProfile.email || "Email non disponibile"}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Stato</dt>
                <dd className="mt-1">{getBookingStatusLabel(selectedProfileRequest.status, "it")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Persone</dt>
                <dd className="mt-1">{selectedProfileRequest.party_size}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Richiesta</dt>
                <dd className="mt-1">{formatBookingDate(selectedProfileRequest.requested_at, "it-IT")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Ruolo</dt>
                <dd className="mt-1">{selectedProfileRequest.is_crew ? "Equipaggio" : "Ospite"}</dd>
              </div>
            </dl>
            {selectedProfileRequest.message?.trim() && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Messaggio</p>
                <p className="mt-1 rounded-xl border border-border/70 bg-background/70 p-3 leading-relaxed">
                  {selectedProfileRequest.message}
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={() => setProfileDialogRequestId(null)}
            className="glass-chip inline-flex items-center justify-center px-3 py-2 text-xs text-muted-foreground"
          >
            Chiudi
          </button>
          <button
            type="button"
            onClick={openMailForProfile}
            disabled={!selectedProfile?.email}
            className="glass-chip inline-flex items-center justify-center gap-2 px-3 py-2 text-xs text-foreground hover:text-accent disabled:opacity-50"
          >
            <Mail size={13} /> Scrivigli una mail
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

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
            const dateRange = formatBookingWindow(leg.starts_at_window_start, leg.ends_at_window_start, "it-IT");
            const durationLabel = formatLegDurationDays(getLegDurationHours(leg), "it");
            return (
              <div key={leg.id} className="min-w-0 border-l border-border p-3 align-bottom">
                <span className="block text-xs font-medium leading-snug">{getLegLabel(leg, waypointsById, "it")}</span>
                {(dateRange || durationLabel) && (
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {[dateRange, durationLabel].filter(Boolean).join(" · ")}
                  </span>
                )}
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
          const isStagedRow = stagedResize?.requestId === request.id;
          // While a resize is staged (not yet sent), the bar shows the draft range instead of
          // the saved one, so a second drag on either edge keeps extending the same draft.
          const allIndices = isStagedRow
            ? stagedResize!.legIds
                .map((id) => legIndexById.get(id))
                .filter((idx): idx is number => idx != null)
            : legIndicesByRequest.get(request.id) || [];
          const segments = computeSegments(allIndices);
          const statusClass = getBookingStatusClass(request.status);
          // An outstanding (sent, not-yet-answered) route change is shown as a dashed "Proposta"
          // bar under the current one, so it's visible here too — not only in the candidate tab.
          const proposedIndices =
            request.plan_change_status === "pending_user_approval"
              ? readProposedLegIds(request.plan_change_metadata)
                  .map((id) => legIndexById.get(id))
                  .filter((idx): idx is number => idx != null)
              : [];
          const proposedSegments = computeSegments(proposedIndices);
          const hasProposal = proposedSegments.length > 0;
          return (
            <div key={request.id} className="grid border-b border-border/60" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 min-w-0 bg-background/95 p-3 align-top">
                <div className="flex items-center gap-1.5 font-medium">
                  <button
                    type="button"
                    onClick={() => setProfileDialogRequestId(request.id)}
                    className="min-w-0 text-left underline-offset-4 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                  >
                    <span className="block truncate">{profile?.name || profile?.email || request.profile_id}</span>
                  </button>
                  {request.is_crew && (
                    <span className="rounded-full border border-indigo-300/70 bg-indigo-100/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-indigo-800">
                      Equipaggio
                    </span>
                  )}
                </div>
              </div>

              <div
                className="relative border-l border-border/60"
                style={{ gridColumn: `2 / span ${legs.length}`, height: hasProposal ? ROW_HEIGHT * 2 : ROW_HEIGHT }}
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
                      className={`absolute flex items-center rounded-full border px-3 text-[12px] font-semibold shadow-sm ${
                        isStagedRow ? "border-2 border-amber-500 bg-amber-100/80 text-amber-900" : statusClass
                      }`}
                      style={{
                        top: 8,
                        height: ROW_HEIGHT - 16,
                        left: start * COLUMN_WIDTH + 4,
                        width: (end - start + 1) * COLUMN_WIDTH - 8,
                      }}
                    >
                      <span
                        onPointerDown={(event) => startDrag(event, request.id, segment, allIndices, "start")}
                        className="absolute left-0 top-0 h-full w-3 cursor-ew-resize"
                        title="Trascina per estendere/ridurre"
                      />
                      <span className="truncate">
                        {isStagedRow ? "Bozza" : hasProposal ? "Adesso" : getBookingStatusLabel(request.status, "it")}
                      </span>
                      <span
                        onPointerDown={(event) => startDrag(event, request.id, segment, allIndices, "end")}
                        className="absolute right-0 top-0 h-full w-3 cursor-ew-resize"
                        title="Trascina per estendere/ridurre"
                      />
                    </div>
                  );
                })}
                {hasProposal &&
                  proposedSegments.map((segment, segIndex) => (
                    <div
                      key={`proposed-${segIndex}`}
                      className="absolute flex items-center gap-1.5 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70 px-3 text-[12px] font-semibold text-sky-900"
                      style={{
                        top: ROW_HEIGHT + 8,
                        height: ROW_HEIGHT - 16,
                        left: segment.startIdx * COLUMN_WIDTH + 4,
                        width: (segment.endIdx - segment.startIdx + 1) * COLUMN_WIDTH - 8,
                      }}
                    >
                      <span className="truncate">Proposta</span>
                    </div>
                  ))}
              </div>

              <div className="border-l border-border/60 p-3 align-top">
                {isStagedRow && (() => {
                  const isPendingInvite = pendingInviteRequestIds.has(request.id);
                  return (
                    <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-2">
                      <p className="w-full text-[11px] font-medium text-amber-900">
                        Bozza non inviata: {allIndices.length} tratt{allIndices.length === 1 ? "a" : "e"} selezionat
                        {allIndices.length === 1 ? "a" : "e"}.
                        {isPendingInvite && " L'invito non è ancora stato accettato: la modifica si applica subito, senza chiedere conferma al viaggiatore."}
                      </p>
                      <button
                        type="button"
                        onClick={onCancelStagedResize}
                        disabled={saving}
                        className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        <X size={12} /> Annulla
                      </button>
                      <button
                        type="button"
                        onClick={isPendingInvite ? onApplyPendingInviteResize : onOpenProposalDialog}
                        disabled={saving}
                        className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50"
                      >
                        <Check size={12} /> {isPendingInvite ? "Applica modifica" : "Proponi modifica"}
                      </button>
                    </div>
                  );
                })()}
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
        {anyPendingProposal && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/60 px-3 py-2.5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border border-emerald-300/75 bg-emerald-100/80" /> Adesso (tratte attuali)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70" /> Proposta (non ancora confermata)
            </span>
          </div>
        )}
      </div>
    </div>
    </>
  );
};

export default BookingGanttTable;
