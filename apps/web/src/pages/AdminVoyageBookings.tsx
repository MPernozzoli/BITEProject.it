import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Anchor, ArrowLeft, CalendarClock, Check, Clock, LayoutGrid, Loader2, Mail, MapPinned, Mountain, Pencil, Plus, RefreshCw, Search, Settings, Ship, Trash2, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import BookingGanttTable from "@/components/admin/BookingGanttTable";
import VoyageCandidatesPanel from "@/components/admin/VoyageCandidatesPanel";
import PlanChangeProposalDialog, { type PlanChangeProposal } from "@/components/admin/PlanChangeProposalDialog";
import ManualPaymentDialog, { type ManualPayment } from "@/components/admin/ManualPaymentDialog";
import WaypointDetailsDialog from "@/components/admin/WaypointDetailsDialog";
import { getWaypointEffectiveType, hasVoyageDatesTbd, totalWaypointDistance } from "@/lib/voyage-utils";
import {
  type BookableLeg,
  type BookingProfile,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingSettings,
  type BookingTask,
  type BookingVoyage,
  type BookingWaypoint,
  type VoyageBookingStatus,
  type WorkawayRole,
  DANGER_MAX,
  STOP_DEPARTURE_PRESETS,
  STOP_HOURS_PRESETS,
  STOP_NIGHTS_PRESETS,
  capacityBlockingStatuses,
  computeAutoLegComplexity,
  estimateStopMinutes,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getComplexityClass,
  getComplexityLabel,
  getDangerClass,
  getDangerLabel,
  getDefaultStopDepartureTime,
  getEffectiveStopHoursDefault,
  getLegComplexity,
  getLegDangerLevel,
  getLegLabel,
  getLocalizedBookingVoyageName,
  getWaypointStopUiMode,
  isLegComplexityAuto,
} from "@/lib/booking-utils";
import { depositForPayerEur } from "@/lib/booking-deposit";
import { DANGER_REASONS, type DangerReasonKey } from "@/lib/danger-reasons";
import { DEFAULT_BOOKING_BRIEFINGS } from "@/lib/booking-briefings";
import { sendBookingInvites, type BookingParticipant } from "@/lib/booking-participants";
import { updateBookingStatusWithRefund } from "@/lib/booking-refunds";
import { useI18n } from "@/lib/i18n";
import { useBeforeUnloadPrompt } from "@/hooks/useBeforeUnloadPrompt";

type SupabaseError = { message: string } | null;
type SupabaseResponse = { data: unknown; error: SupabaseError };
type SupabaseQueryBuilder = PromiseLike<SupabaseResponse> & {
  select: (columns?: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  in: (column: string, values: unknown[]) => SupabaseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => SupabaseQueryBuilder;
  limit: (count: number) => SupabaseQueryBuilder;
  update: (values: unknown) => SupabaseQueryBuilder;
  upsert: (values: unknown, options?: { onConflict?: string }) => SupabaseQueryBuilder;
  insert: (values: unknown) => SupabaseQueryBuilder;
  delete: () => SupabaseQueryBuilder;
};
type UntypedSupabase = {
  from: (table: string) => SupabaseQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResponse>;
};

const typedSupabase = supabase as unknown as UntypedSupabase;
type AdminBookingRpcResult = { booking_request_id: string; over_capacity: boolean };
type ManualPaymentRpcResult = {
  booking_request_id: string;
  booking_status: VoyageBookingStatus;
  deposit_id: string;
  amount_cents: number;
  reused_pending_deposit: boolean;
};

const emptySettingsForm: BookingSettings = {
  voyage_id: "",
  confirmation_deadline_hours: 72,
  predeparture_info_it: "",
  predeparture_info_en: "",
  briefing_content_it: "",
  briefing_content_en: "",
  first_briefing_content_it: DEFAULT_BOOKING_BRIEFINGS.first.it,
  first_briefing_content_en: DEFAULT_BOOKING_BRIEFINGS.first.en,
  second_briefing_content_it: DEFAULT_BOOKING_BRIEFINGS.second.it,
  second_briefing_content_en: DEFAULT_BOOKING_BRIEFINGS.second.en,
  terms_content_it: "",
  terms_content_en: "",
  contribution_proposal_enabled: false,
  contribution_proposal_min_percent: 50,
  contribution_proposal_max_percent: 150,
  workaway_enabled: false,
  workaway_role_keys: [],
};

const statusOptions: VoyageBookingStatus[] = [
  "requested",
  "waitlisted",
  "admin_approved",
  "user_confirmed",
  "cancelled",
  "rejected",
  "expired",
];

// The Gantt's filter covers one status the select above deliberately does not: 'pending_payment'
// is never something an admin sets by hand (you get there by applying and leave by paying), but
// those rows must still be *visible* — otherwise an application whose transfer went unmatched is
// invisible in every admin surface, and the manual payment confirmation could never reach it.
const statusFilterOptions: VoyageBookingStatus[] = ["pending_payment", ...statusOptions];

// Rifiutato/annullato/scaduto are "negative" outcomes: excluded from the overview's default
// status filter so the Gantt opens showing only bookings still relevant to follow up on.
const negativeBookingStatuses = new Set<VoyageBookingStatus>(["rejected", "cancelled", "expired"]);

const duplicateBookingStatuses = new Set<VoyageBookingStatus>([
  ...capacityBlockingStatuses,
  "waitlisted",
]);

const toDateTimeLocalValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const fromDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const formatPlanningDate = (value?: string | null) => {
  if (!value) return "Non impostata";
  return formatBookingDate(value, "it-IT") || "Non impostata";
};

const formatDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const mins = safeMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}g`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
};

const haversineNm = (from: BookingWaypoint | undefined, to: BookingWaypoint | undefined) => {
  if (typeof from?.lat !== "number" || typeof from?.lng !== "number" || typeof to?.lat !== "number" || typeof to?.lng !== "number") {
    return null;
  }
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const hasWaypointCoordinates = (
  waypoint: BookingWaypoint
): waypoint is BookingWaypoint & { lat: number; lng: number } =>
  Number.isFinite(Number(waypoint.lat)) && Number.isFinite(Number(waypoint.lng));

const formatPlanningWindow = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "Non impostata";
  if (start && end && start !== end) return `${formatPlanningDate(start)} → ${formatPlanningDate(end)}`;
  return formatPlanningDate(start || end);
};

const formatWaypointStopTiming = (
  waypoint: BookingWaypoint,
  incomingLeg?: BookableLeg,
  outboundLeg?: BookableLeg
) => {
  const arrival = waypoint.date_end
    ? formatPlanningDate(waypoint.date_end)
    : formatPlanningWindow(incomingLeg?.ends_at_window_start, incomingLeg?.ends_at_window_end);
  const departure = waypoint.date_start
    ? formatPlanningDate(waypoint.date_start)
    : formatPlanningWindow(outboundLeg?.starts_at_window_start, outboundLeg?.starts_at_window_end);
  return `Arrivo ${arrival} · Ripartenza ${departure}`;
};

const formatLegDistance = (distanceNm: number | null | undefined) => {
  if (!Number.isFinite(Number(distanceNm))) return "NM non disponibili";
  return `${Number(distanceNm).toFixed(1)} NM`;
};

const getWaypointArrivalDate = (waypoint: BookingWaypoint, incomingLeg?: BookableLeg) => {
  const value = waypoint.date_end || incomingLeg?.ends_at_window_start || incomingLeg?.ends_at_window_end;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatLocalTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const isDepartureTimeAfterArrival = (arrival: Date | null, departureTime: string) => {
  if (!arrival || !departureTime) return true;
  const [hoursPart, minutesPart] = departureTime.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return true;
  const departure = new Date(arrival);
  departure.setHours(hours, minutes, 0, 0);
  return departure.getTime() > arrival.getTime();
};

const getDepartureTimeFromArrivalAndHours = (arrival: Date | null, hours: number) => {
  if (!arrival) return null;
  const departure = new Date(arrival.getTime() + Math.max(0, Number(hours) || 0) * 3_600_000);
  return departure.toDateString() === arrival.toDateString() ? formatLocalTime(departure) : null;
};

const getStopHoursFromArrivalAndDepartureTime = (arrival: Date | null, departureTime: string) => {
  if (!arrival || !departureTime) return null;
  const [hoursPart, minutesPart] = departureTime.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const departure = new Date(arrival);
  departure.setHours(hours, minutes, 0, 0);
  if (departure.getTime() <= arrival.getTime()) return null;
  const diffHours = (departure.getTime() - arrival.getTime()) / 3_600_000;
  return Math.max(0, Math.round(diffHours));
};

/**
 * Snapshot of the "Salva planning" batch: voyage booking settings + waypoint stop config +
 * leg windows/bookable flag. Deliberately excludes danger_level/open_sea/complexity_override,
 * which persist immediately on click (see persistLegIndicators) and are never "unsaved".
 */
const buildRoutePlanningSnapshot = (
  voyage: BookingVoyage | null,
  waypointsList: BookingWaypoint[],
  legsList: BookableLeg[]
) =>
  JSON.stringify({
    voyage: voyage
      ? {
          booking_enabled: Boolean(voyage.booking_enabled),
          booking_max_guests: voyage.booking_max_guests ?? null,
          booking_planning_speed_kn: voyage.booking_planning_speed_kn ?? null,
          departure_window_start: voyage.departure_window_start || null,
          departure_window_end: voyage.departure_window_end || null,
        }
      : null,
    waypoints: waypointsList.map((waypoint) => ({
      id: waypoint.id,
      planned_stop_duration_minutes: waypoint.planned_stop_duration_minutes ?? 0,
      stop_mode: waypoint.stop_mode ?? null,
      stop_hours: waypoint.stop_hours ?? null,
      stop_nights: waypoint.stop_nights ?? null,
      stop_departure_time: waypoint.stop_departure_time ?? null,
    })),
    legs: legsList.map((leg) => ({
      id: leg.id,
      starts_at_window_start: leg.starts_at_window_start || null,
      starts_at_window_end: leg.starts_at_window_end || null,
      ends_at_window_start: leg.ends_at_window_start || null,
      ends_at_window_end: leg.ends_at_window_end || null,
      is_bookable: Boolean(leg.is_bookable),
    })),
  });

const buildBookingSettingsSnapshot = (settings: BookingSettings) => JSON.stringify(settings);

type BookingTabKey = "overview" | "soste" | "rotte" | "candidature" | "briefing";
const BOOKING_TABS: { key: BookingTabKey; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "soste", label: "Soste", icon: Anchor },
  { key: "rotte", label: "Rotte", icon: CalendarClock },
  { key: "candidature", label: "Candidature", icon: Users },
  { key: "briefing", label: "Briefing", icon: Mail },
];

const AdminVoyageBookings = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voyages, setVoyages] = useState<BookingVoyage[]>([]);
  const [selectedVoyageId, setSelectedVoyageId] = useState("");
  const [waypoints, setWaypoints] = useState<BookingWaypoint[]>([]);
  const [legs, setLegs] = useState<BookableLeg[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [requestLegs, setRequestLegs] = useState<BookingRequestLeg[]>([]);
  const [participants, setParticipants] = useState<BookingParticipant[]>([]);
  const [paidDepositRequestIds, setPaidDepositRequestIds] = useState<Set<string>>(() => new Set());
  const [profiles, setProfiles] = useState<BookingProfile[]>([]);
  const [availableProfiles, setAvailableProfiles] = useState<BookingProfile[]>([]);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(emptySettingsForm);
  const [bookingTasks, setBookingTasks] = useState<BookingTask[]>([]);
  const [workawayRoles, setWorkawayRoles] = useState<WorkawayRole[]>([]);
  const [newWorkawayRoleLabelIt, setNewWorkawayRoleLabelIt] = useState("");
  const [newWorkawayRoleLabelEn, setNewWorkawayRoleLabelEn] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<VoyageBookingStatus>>(
    () => new Set(statusFilterOptions.filter((status) => !negativeBookingStatuses.has(status)))
  );
  const [voyageSearchQuery, setVoyageSearchQuery] = useState("");
  const [voyageTypeFilter, setVoyageTypeFilter] = useState<"all" | "water" | "land">("all");
  // Completed voyages can't act on their bookings anymore, so they're hidden by default;
  // toggle them back in when you need to look up historical bookings.
  const [voyageStatusFilter, setVoyageStatusFilter] = useState<Set<BookingVoyage["status"]>>(
    () => new Set(["planned", "active"])
  );
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [activeTab, setActiveTab] = useState<BookingTabKey>("overview");
  const [editableLegIds, setEditableLegIds] = useState<Set<string>>(() => new Set());
  /** Drag-resized legs staged locally, awaiting Annulla or Proponi modifica. */
  const [pendingProposal, setPendingProposal] = useState<{ requestId: string; legIds: string[] } | null>(null);
  /** Controls the reason dialog separately from the staged draft, so multiple drags can
   * accumulate into pendingProposal before the admin opts to actually send it. */
  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);
  /** Booking whose contribution is being confirmed by hand; null keeps the dialog closed. */
  const [paymentDialogRequestId, setPaymentDialogRequestId] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [saveAndLeavePending, setSaveAndLeavePending] = useState(false);
  const [detailsWaypointId, setDetailsWaypointId] = useState<string | null>(null);

  // Holds the last voyages list loaded from the DB (updated only by loadVoyages, never by
  // local edits) so loadVoyageDetails can snapshot the voyage-level route-planning fields
  // without a render-timing race against a separate sync effect.
  const voyagesRef = useRef<BookingVoyage[]>([]);
  const initialRoutePlanningSnapshotRef = useRef<string | null>(null);
  const initialBookingSettingsSnapshotRef = useRef<string | null>(null);
  const pendingNavigationRef = useRef<{ type: "path"; to: string } | { type: "back" } | null>(null);
  const ignoreNextPopRef = useRef(false);

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId) || null;
  const selectedVoyageType: "water" | "land" = selectedVoyage?.type === "land" ? "land" : "water";
  const selectedVoyageDatesTbd = selectedVoyage ? hasVoyageDatesTbd(selectedVoyage) : false;

  const toggleVoyageStatusFilter = (status: BookingVoyage["status"]) => {
    setVoyageStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const filteredVoyages = useMemo(() => {
    const query = voyageSearchQuery.trim().toLowerCase();
    const matches = voyages.filter((voyage) => {
      if (voyageTypeFilter !== "all" && voyage.type !== voyageTypeFilter) return false;
      if (!voyageStatusFilter.has(voyage.status)) return false;
      if (query && !getLocalizedBookingVoyageName(voyage, "it").toLowerCase().includes(query)) return false;
      return true;
    });
    // Never let the currently selected voyage disappear from the picker just because a
    // filter changed underneath it — the admin is still actively working on it.
    if (selectedVoyageId && !matches.some((voyage) => voyage.id === selectedVoyageId)) {
      const current = voyages.find((voyage) => voyage.id === selectedVoyageId);
      if (current) return [current, ...matches];
    }
    return matches;
  }, [voyages, voyageTypeFilter, voyageStatusFilter, voyageSearchQuery, selectedVoyageId]);

  const isRoutePlanningDirty = useMemo(
    () =>
      initialRoutePlanningSnapshotRef.current !== null &&
      buildRoutePlanningSnapshot(selectedVoyage, waypoints, legs) !== initialRoutePlanningSnapshotRef.current,
    [selectedVoyage, waypoints, legs]
  );
  const isBookingSettingsDirty = useMemo(
    () =>
      initialBookingSettingsSnapshotRef.current !== null &&
      buildBookingSettingsSnapshot(bookingSettings) !== initialBookingSettingsSnapshotRef.current,
    [bookingSettings]
  );
  const isDirty = isRoutePlanningDirty || isBookingSettingsDirty;

  const loadVoyages = useCallback(async () => {
    const [voyagesRes, profilesRes] = await Promise.all([
      typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,type,status,booking_enabled,booking_max_guests,booking_planning_speed_kn,departure_window_start,departure_window_end,start_date,end_date")
        .order("start_date", { ascending: true, nullsFirst: false }),
      typedSupabase
        .from("profiles")
        .select("id,name,email,avatar_url")
        .order("name", { ascending: true, nullsFirst: false })
        .limit(250),
    ]);
    if (voyagesRes.error || profilesRes.error) {
      toast.error(voyagesRes.error?.message || profilesRes.error?.message || "Unable to load admin booking data");
      return;
    }
    const loaded = ((voyagesRes.data as BookingVoyage[] | null) || []);
    voyagesRef.current = loaded;
    setVoyages(loaded);
    setAvailableProfiles(((profilesRes.data as BookingProfile[] | null) || []));
    setSelectedVoyageId((current) => current || loaded.find((voyage) => voyage.booking_enabled)?.id || loaded[0]?.id || "");
  }, []);

  const loadVoyageDetails = useCallback(async (voyageId: string) => {
    if (!voyageId) return;
    setLoading(true);
    const [waypointsRes, legsRes, requestsRes, settingsRes, tasksRes] = await Promise.all([
      typedSupabase
        .from("voyage_waypoints")
        .select("id,voyage_id,name,name_it,name_en,sort_order,lat,lng,waypoint_type,visibility_mode,planned_stop_duration_minutes,stop_mode,stop_hours,stop_nights,stop_departure_time,date_start,date_end")
        .eq("voyage_id", voyageId)
        .order("sort_order", { ascending: true }),
      typedSupabase
        .from("voyage_bookable_legs")
        .select("*")
        .eq("voyage_id", voyageId)
        .order("sort_order", { ascending: true }),
      typedSupabase
        .from("voyage_booking_requests")
        .select("*")
        .eq("voyage_id", voyageId)
        .order("requested_at", { ascending: false }),
      typedSupabase
        .from("voyage_booking_settings")
        .select("*")
        .eq("voyage_id", voyageId),
      typedSupabase
        .from("voyage_booking_tasks")
        .select("*")
        .eq("voyage_id", voyageId)
        .order("sort_order", { ascending: true }),
    ]);

    if (waypointsRes.error || legsRes.error || requestsRes.error || settingsRes.error || tasksRes.error) {
      toast.error(
        waypointsRes.error?.message ||
          legsRes.error?.message ||
          requestsRes.error?.message ||
          settingsRes.error?.message ||
          tasksRes.error?.message ||
          "Unable to load bookings"
      );
      setLoading(false);
      return;
    }

    const loadedRequests = ((requestsRes.data as BookingRequest[] | null) || []);
    const requestIds = loadedRequests.map((request) => request.id);
    const profileIds = [...new Set(loadedRequests.map((request) => request.profile_id))];

    const [requestLegsRes, profilesRes, participantsRes, depositsRes] = await Promise.all([
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_request_legs")
            .select("*")
            .in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? typedSupabase
            .from("profiles")
            .select("id,name,email,avatar_url")
            .in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_participants")
            .select("id,booking_request_id,profile_id,email,first_name,last_name,is_lead,status,invite_sent_at,accepted_at,expires_at")
            .in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_deposits")
            .select("booking_request_id,status")
            .in("booking_request_id", requestIds)
            .eq("status", "paid")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (requestLegsRes.error || profilesRes.error || participantsRes.error || depositsRes.error) {
      toast.error(
        requestLegsRes.error?.message ||
          profilesRes.error?.message ||
          participantsRes.error?.message ||
          depositsRes.error?.message ||
          "Unable to load booking people"
      );
      setLoading(false);
      return;
    }

    const loadedWaypoints = ((waypointsRes.data as BookingWaypoint[] | null) || []);
    const loadedLegs = ((legsRes.data as BookableLeg[] | null) || []);
    const loadedSettings: BookingSettings = {
      ...emptySettingsForm,
      ...(((settingsRes.data as BookingSettings[] | null) || [])[0] || {}),
      voyage_id: voyageId,
    };

    setWaypoints(loadedWaypoints);
    setLegs(loadedLegs);
    setRequests(loadedRequests);
    setRequestLegs(((requestLegsRes.data as BookingRequestLeg[] | null) || []));
    setProfiles(((profilesRes.data as BookingProfile[] | null) || []));
    setParticipants(((participantsRes.data as BookingParticipant[] | null) || []));
    setPaidDepositRequestIds(
      new Set(
        (((depositsRes.data as { booking_request_id: string }[] | null) || []).map(
          (deposit) => deposit.booking_request_id
        ))
      )
    );
    setBookingSettings(loadedSettings);
    setBookingTasks(((tasksRes.data as BookingTask[] | null) || []));

    // Baseline for the unsaved-changes guard: this reflects what's actually persisted, so
    // it must be captured from the freshly-fetched data, not from (possibly stale) state.
    const loadedVoyage = voyagesRef.current.find((voyage) => voyage.id === voyageId) || null;
    initialRoutePlanningSnapshotRef.current = buildRoutePlanningSnapshot(loadedVoyage, loadedWaypoints, loadedLegs);
    initialBookingSettingsSnapshotRef.current = buildBookingSettingsSnapshot(loadedSettings);

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadVoyages();
  }, [loadVoyages]);

  useEffect(() => {
    if (selectedVoyageId) void loadVoyageDetails(selectedVoyageId);
  }, [loadVoyageDetails, selectedVoyageId]);

  useEffect(() => {
    setEditableLegIds(new Set());
  }, [selectedVoyageId]);

  const loadWorkawayRoles = useCallback(async () => {
    const { data, error } = await typedSupabase
      .from("voyage_workaway_roles")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    setWorkawayRoles((data as WorkawayRole[] | null) || []);
  }, []);

  useEffect(() => {
    void loadWorkawayRoles();
  }, [loadWorkawayRoles]);

  const addWorkawayRole = async () => {
    const labelIt = newWorkawayRoleLabelIt.trim();
    const labelEn = newWorkawayRoleLabelEn.trim() || labelIt;
    if (!labelIt) {
      toast.error("Indica almeno il nome del ruolo in italiano.");
      return;
    }
    const key = labelIt
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const { error } = await typedSupabase.from("voyage_workaway_roles").insert({
      key,
      label_it: labelIt,
      label_en: labelEn,
      active: true,
      sort_order: workawayRoles.length,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewWorkawayRoleLabelIt("");
    setNewWorkawayRoleLabelEn("");
    await loadWorkawayRoles();
  };

  const toggleWorkawayRoleActive = async (role: WorkawayRole) => {
    const { error } = await typedSupabase
      .from("voyage_workaway_roles")
      .update({ active: !role.active, updated_at: new Date().toISOString() })
      .eq("id", role.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await loadWorkawayRoles();
  };

  const toggleVoyageWorkawayRoleKey = (key: string) => {
    const current = bookingSettings.workaway_role_keys || [];
    updateSettingsField(
      "workaway_role_keys",
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };

  const waypointsById = useMemo(
    () => Object.fromEntries(waypoints.map((waypoint) => [waypoint.id, waypoint])),
    [waypoints]
  );
  const combinedProfiles = useMemo(() => {
    const map = new Map<string, BookingProfile>();
    for (const profile of availableProfiles) map.set(profile.id, profile);
    for (const profile of profiles) map.set(profile.id, profile);
    return [...map.values()];
  }, [availableProfiles, profiles]);
  const profilesById = useMemo(
    () => Object.fromEntries(combinedProfiles.map((profile) => [profile.id, profile])),
    [combinedProfiles]
  );
  const visibleRequests = useMemo(
    () =>
      requests
        .filter((request) => statusFilter.has(request.status))
        // Crew rows pinned to the top of the Gantt, everyone else keeps the existing order below.
        .slice()
        .sort((a, b) => Number(b.is_crew) - Number(a.is_crew)),
    [requests, statusFilter]
  );
  // Candidature "in revisione" for this voyage — drives the tab badge. Mirrors the panel's
  // own filter (non-crew requests still awaiting a decision). Deliberately does NOT include
  // plan_change_status === "pending_user_approval": that means an ADMIN-sent proposal is
  // awaiting the TRAVELLER, the opposite direction from "needs admin review" — counting it here
  // made a change the admin proposed look like a candidacy the guest had requested. Traveller-
  // initiated changes awaiting the admin ("pending_admin_approval") already have their own
  // Accetta/Rifiuta section further down this tab.
  const candidatesInReview = useMemo(
    () =>
      requests.filter(
        (request) =>
          !request.is_crew &&
          (request.status === "requested" || request.status === "waitlisted")
      ).length,
    [requests]
  );

  /** Bookings whose only participant is still an unaccepted email invite — nobody has agreed
   * to anything yet, so leg changes on these should apply directly instead of going through the
   * traveller-approval proposal flow (see admin_apply_pending_invite_legs). */
  const pendingInviteRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const participant of participants) {
      if (participant.status === "pending") ids.add(participant.booking_request_id);
    }
    for (const participant of participants) {
      if (participant.status === "accepted") ids.delete(participant.booking_request_id);
    }
    return ids;
  }, [participants]);

  /** Accepted email invites still owing their contribution (payment_mode each_pays_own, not
   * comped, no paid deposit yet) — settle_voyage_booking_payment promotes these to
   * user_confirmed automatically once the deposit is marked paid. */
  const awaitingPaymentRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const request of requests) {
      if (
        request.status === "admin_approved" &&
        request.payment_mode === "each_pays_own" &&
        !request.is_comped &&
        !paidDepositRequestIds.has(request.id)
      ) {
        ids.add(request.id);
      }
    }
    return ids;
  }, [requests, paidDepositRequestIds]);

  const legCapacity = useMemo(() => {
    const map: Record<string, number> = {};
    for (const leg of legs) map[leg.id] = 0;
    for (const request of requests) {
      if (!capacityBlockingStatuses.has(request.status)) continue;
      for (const link of requestLegs) {
        if (link.booking_request_id === request.id) {
          map[link.bookable_leg_id] = (map[link.bookable_leg_id] || 0) + request.party_size;
        }
      }
    }
    return map;
  }, [legs, requestLegs, requests]);

  const planningSpeedKn = Math.max(0.1, Number(selectedVoyage?.booking_planning_speed_kn ?? 5) || 5);
  const publicPlanningWaypoints = useMemo(
    () =>
      waypoints.filter(
        (waypoint, index) => getWaypointEffectiveType(waypoint, index, waypoints.length) === "narrative"
      ),
    [waypoints]
  );
  const detailsWaypointIndex = publicPlanningWaypoints.findIndex((waypoint) => waypoint.id === detailsWaypointId);
  const routePlanningStats = useMemo(() => {
    const routeWaypoints = waypoints.filter(hasWaypointCoordinates);
    const totalDistanceNm = routeWaypoints.length >= 2 ? totalWaypointDistance(routeWaypoints) : 0;
    const navigationMinutes = planningSpeedKn > 0 ? (totalDistanceNm / planningSpeedKn) * 60 : 0;
    const stopMinutes = publicPlanningWaypoints.reduce((total, waypoint) => total + estimateStopMinutes(waypoint), 0);
    return {
      totalDistanceNm,
      navigationMinutes,
      stopMinutes,
      totalMinutes: navigationMinutes + stopMinutes,
    };
  }, [planningSpeedKn, publicPlanningWaypoints, waypoints]);

  const requestWouldExceedCapacity = (request: BookingRequest, nextStatus: VoyageBookingStatus) => {
    if (!capacityBlockingStatuses.has(nextStatus)) return false;
    const currentLegIds = requestLegs
      .filter((link) => link.booking_request_id === request.id)
      .map((link) => link.bookable_leg_id);
    return currentLegIds.some((legId) => {
      const alreadyCounted = capacityBlockingStatuses.has(request.status) ? request.party_size : 0;
      return (legCapacity[legId] || 0) - alreadyCounted + request.party_size > (selectedVoyage?.booking_max_guests || 4);
    });
  };

  const updateSelectedVoyagePlanning = (patch: Partial<BookingVoyage>) => {
    if (!selectedVoyageId) return;
    setVoyages((current) => current.map((voyage) => (voyage.id === selectedVoyageId ? { ...voyage, ...patch } : voyage)));
  };

  const updateWaypointPlanning = (waypointId: string, patch: Partial<BookingWaypoint>) => {
    setWaypoints((current) => current.map((waypoint) => (waypoint.id === waypointId ? { ...waypoint, ...patch } : waypoint)));
  };

  const updateLegPlanning = (legId: string, patch: Partial<BookableLeg>) => {
    setLegs((current) => current.map((leg) => (leg.id === legId ? { ...leg, ...patch } : leg)));
  };

  // Difficulty/danger indicators persist immediately (they behave like cycle toggles,
  // not part of the "Salva" batch). Optimistic update, reload on failure.
  const persistLegIndicators = async (legId: string, patch: Partial<BookableLeg>) => {
    updateLegPlanning(legId, patch);
    const { error } = await typedSupabase.from("voyage_bookable_legs").update(patch).eq("id", legId);
    if (error) {
      toast.error(error.message);
      if (selectedVoyageId) await loadVoyageDetails(selectedVoyageId);
    }
  };

  const cycleLegComplexity = (leg: BookableLeg) => {
    const current = leg.complexity_override ?? null;
    const next = current == null ? 1 : current >= 5 ? null : current + 1;
    void persistLegIndicators(leg.id, { complexity_override: next });
  };

  const cycleLegDanger = (leg: BookableLeg) => {
    const current = getLegDangerLevel(leg);
    const next = current >= DANGER_MAX ? 0 : current + 1;
    void persistLegIndicators(leg.id, { danger_level: next });
  };

  const toggleLegOpenSea = (leg: BookableLeg) => {
    void persistLegIndicators(leg.id, { open_sea: !leg.open_sea });
  };

  const toggleLegDangerReason = (leg: BookableLeg, key: DangerReasonKey) => {
    const current = leg.danger_reasons ?? [];
    const next = current.includes(key) ? current.filter((existing) => existing !== key) : [...current, key];
    void persistLegIndicators(leg.id, { danger_reasons: next });
  };

  const toggleLegEditing = (legId: string) => {
    setEditableLegIds((current) => {
      const next = new Set(current);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
      return next;
    });
  };

  const saveRoutePlanning = async ({
    syncAfterSave = false,
    showSuccessToast = true,
  }: { syncAfterSave?: boolean; showSuccessToast?: boolean } = {}): Promise<boolean> => {
    if (!selectedVoyageId || !selectedVoyage) return false;
    setSaving(true);
    const voyagePatch = {
      booking_enabled: Boolean(selectedVoyage.booking_enabled),
      booking_max_guests: Math.max(1, Number(selectedVoyage.booking_max_guests ?? 4) || 4),
      booking_planning_speed_kn: Math.max(0.1, Number(selectedVoyage.booking_planning_speed_kn ?? 5) || 5),
      departure_window_start: selectedVoyage.departure_window_start || null,
      departure_window_end: selectedVoyage.departure_window_end || null,
    };
    const invalidHoursStop = waypoints.find((waypoint) => {
      if (waypoint.stop_mode !== "hours" || !waypoint.stop_departure_time) return false;
      const incomingLeg = legs.find((leg) => leg.to_waypoint_id === waypoint.id);
      const arrivalDate = getWaypointArrivalDate(waypoint, incomingLeg);
      return arrivalDate !== null && !isDepartureTimeAfterArrival(arrivalDate, waypoint.stop_departure_time);
    });
    if (invalidHoursStop) {
      setSaving(false);
      toast.error(
        `Ripartenza non valida per ${invalidHoursStop.name_it || invalidHoursStop.name_en || invalidHoursStop.name || "waypoint"}: deve essere dopo l'arrivo.`
      );
      return false;
    }

    const voyageRes = await typedSupabase.from("voyages").update(voyagePatch).eq("id", selectedVoyageId);
    if (voyageRes.error) {
      setSaving(false);
      toast.error(voyageRes.error.message);
      return false;
    }

    const waypointResults = await Promise.all(
      waypoints.map((waypoint) => {
        // Only persist the new stop_mode/hours/nights/departure columns for waypoints the
        // admin has actually switched into "hours" or "nights" mode via this editor. A
        // waypoint still in the DB default 'legacy' mode is left untouched here so an
        // unrelated save (e.g. editing dates) can't silently zero out its existing
        // minutes-based stop.
        const patch: Record<string, unknown> = {
          planned_stop_duration_minutes: Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0) || 0),
        };
        if (waypoint.stop_mode === "hours" || waypoint.stop_mode === "nights") {
          patch.stop_mode = waypoint.stop_mode;
          patch.stop_hours = waypoint.stop_mode === "hours" ? Math.max(0, Number(waypoint.stop_hours ?? 0)) : null;
          patch.stop_nights =
            waypoint.stop_mode === "nights" ? Math.max(1, Number(waypoint.stop_nights ?? 1)) : null;
          patch.stop_departure_time =
            waypoint.stop_mode === "hours" || waypoint.stop_mode === "nights" ? waypoint.stop_departure_time || null : null;
        }
        return typedSupabase.from("voyage_waypoints").update(patch).eq("id", waypoint.id);
      })
    );
    const waypointError = waypointResults.find((result) => result.error)?.error;
    if (waypointError) {
      setSaving(false);
      toast.error(waypointError.message);
      return false;
    }

    if (!syncAfterSave) {
      const legResults = await Promise.all(
        legs.map((leg) =>
          typedSupabase
            .from("voyage_bookable_legs")
            .update({
              starts_at_window_start: leg.starts_at_window_start || null,
              starts_at_window_end: leg.starts_at_window_end || null,
              ends_at_window_start: leg.ends_at_window_start || null,
              ends_at_window_end: leg.ends_at_window_end || null,
              is_bookable: Boolean(leg.is_bookable),
              danger_level: getLegDangerLevel(leg),
              danger_reasons: leg.danger_reasons ?? [],
              open_sea: Boolean(leg.open_sea),
              complexity_override: leg.complexity_override ?? null,
            })
            .eq("id", leg.id)
        )
      );
      const legError = legResults.find((result) => result.error)?.error;
      if (legError) {
        setSaving(false);
        toast.error(legError.message);
        return false;
      }
    }

    if (syncAfterSave) {
      const { error } = await typedSupabase.rpc("sync_voyage_bookable_legs", { _voyage_id: selectedVoyageId });
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return false;
      }
    }

    setSaving(false);
    if (showSuccessToast) {
      toast.success(syncAfterSave ? "Pianificazione salvata e tratte ricalcolate." : "Pianificazione rotta salvata.");
    }
    await loadVoyages();
    await loadVoyageDetails(selectedVoyageId);
    return true;
  };

  const syncLegs = async () => {
    if (!selectedVoyageId) return;
    if (!selectedVoyage?.booking_enabled) {
      toast.error("Attiva il booking su questo viaggio prima di sincronizzare le tratte.");
      return;
    }
    setSaving(true);
    const { error } = await typedSupabase.rpc("sync_voyage_bookable_legs", { _voyage_id: selectedVoyageId });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tratte prenotabili sincronizzate.");
    await loadVoyageDetails(selectedVoyageId);
  };

  const updateRequestStatus = async (requestId: string, status: VoyageBookingStatus) => {
    const request = requests.find((item) => item.id === requestId);
    if (status === "cancelled" || status === "rejected") {
      setSaving(true);
      const result = await updateBookingStatusWithRefund({
        bookingRequestId: requestId,
        status,
        trigger: status === "rejected" ? "admin_rejected" : "admin_cancelled",
      });
      setSaving(false);
      if (result.ok === false) {
        toast.error(result.error);
        return;
      }
      if (result.refundPending) {
        toast.warning(
          `Booking aggiornato. Rimborso da gestire manualmente (EUR ${result.refundPendingAmountEur.toFixed(2)}): nessun IBAN disponibile, all'utente e stato chiesto via email di comunicarlo.`,
        );
      } else if (result.refundAmountEur > 0) {
        toast.success(`Booking aggiornato. Rimborso automatico: EUR ${result.refundAmountEur.toFixed(2)}.`);
      }
      await loadVoyageDetails(selectedVoyageId);
      return;
    }

    const overCapacity = request ? requestWouldExceedCapacity(request, status) : false;
    if (overCapacity && !confirm("Questa conferma supera il limite persone impostato per almeno una tratta. Procedere comunque?")) {
      return;
    }
    setSaving(true);
    const { data, error } = await typedSupabase.rpc("admin_set_voyage_booking_status", {
      _booking_request_id: requestId,
      _status: status,
      _allow_over_capacity: overCapacity,
      _admin_notes: overCapacity ? "Override capienza approvato da admin." : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = Array.isArray(data) ? (data[0] as AdminBookingRpcResult | undefined) : undefined;
    if (result?.over_capacity) toast.warning("Booking aggiornato oltre il limite impostato.");
    await loadVoyageDetails(selectedVoyageId);
  };

  const approveRequest = (requestId: string) => updateRequestStatus(requestId, "admin_approved");
  const rejectRequest = (requestId: string) => updateRequestStatus(requestId, "rejected");

  /**
   * Contribution due on a booking's current legs, recomputed exactly like the payment flow does,
   * purely to prefill the manual dialog. The fixed minimum is always applied here: waiving it
   * needs the payer's other bookings on this voyage, which this page does not load, and a
   * prefill that is €20 too high is harmless — the admin types what actually arrived anyway.
   */
  const dueEurForRequest = (requestId: string): number | null => {
    const request = requests.find((item) => item.id === requestId);
    if (!request) return null;
    const legIds = new Set(
      requestLegs.filter((link) => link.booking_request_id === requestId).map((link) => link.bookable_leg_id)
    );
    const bookedLegs = legs.filter((leg) => legIds.has(leg.id));
    if (!bookedLegs.length) return null;
    return depositForPayerEur(
      bookedLegs,
      {
        isLead: true,
        paymentMode: request.payment_mode ?? "lead_pays_all",
        partySize: request.party_size,
      },
      { contributionPerNmEur: selectedVoyage?.booking_contribution_per_nm_eur }
    );
  };

  /**
   * Records a contribution that reached the bank account but not the matcher. The RPC owns every
   * consequence (deposit row, reactivation of an expired application, promotion out of
   * pending_payment, notifications), so there is nothing to sequence here.
   */
  const confirmManualPayment = async ({ amountEur, reference, note }: ManualPayment) => {
    if (!paymentDialogRequestId) return;
    setSaving(true);
    const { data, error } = await typedSupabase.rpc("admin_confirm_voyage_booking_payment", {
      _booking_request_id: paymentDialogRequestId,
      _amount_eur: amountEur,
      _reference: reference,
      _participant_id: null,
      _admin_note: note,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPaymentDialogRequestId(null);
    const result = Array.isArray(data) ? (data[0] as ManualPaymentRpcResult | undefined) : undefined;
    toast.success(
      result?.booking_status
        ? `Pagamento registrato. Stato: ${getBookingStatusLabel(result.booking_status, "it")}.`
        : "Pagamento registrato."
    );
    await loadVoyageDetails(selectedVoyageId);
  };

  /**
   * Stages a Gantt-bar drag-resize locally (no RPC call yet). Repeated drags on the same
   * request — either edge, any number of times — keep updating this same draft, since
   * BookingGanttTable renders the bar from pendingProposal once one is staged for that row.
   * The reason dialog (which decides the refund owed on decline: force majeure follows the
   * withdrawal tiers, anything else refunds fully) only opens when the admin explicitly clicks
   * "Proponi modifica", not on every drag.
   */
  const stageResize = (requestId: string, nextLegIds: string[]) => {
    const currentLegIds = requestLegs
      .filter((link) => link.booking_request_id === requestId)
      .map((link) => link.bookable_leg_id)
      .sort();
    const proposedLegIds = [...nextLegIds].sort();
    if (currentLegIds.length === proposedLegIds.length && currentLegIds.every((id, index) => id === proposedLegIds[index])) {
      setPendingProposal(null);
      return;
    }
    setPendingProposal({ requestId, legIds: nextLegIds });
  };

  /** Sends the staged resize once the admin has picked a reason in the dialog. */
  const submitPlanChangeProposal = async ({ reason, note, requireSettlement }: PlanChangeProposal) => {
    if (!pendingProposal) return;
    const { requestId, legIds } = pendingProposal;
    const request = requests.find((item) => item.id === requestId);
    setPendingProposal(null);
    setProposalDialogOpen(false);
    setSaving(true);
    const { error } = await typedSupabase.rpc("admin_propose_voyage_booking_legs", {
      _booking_request_id: requestId,
      _proposed_leg_ids: legIds,
      _admin_note: note,
      _change_reason: reason,
      _require_settlement: requireSettlement,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      await loadVoyageDetails(selectedVoyageId);
      return;
    }
    toast.success(request?.is_crew ? "Proposta registrata." : "Proposta inviata al viaggiatore.");
    await loadVoyageDetails(selectedVoyageId);
  };

  /** Discards the staged draft so the Gantt bar snaps back to the stored legs. */
  const cancelPlanChangeProposal = async () => {
    setPendingProposal(null);
    setProposalDialogOpen(false);
    await loadVoyageDetails(selectedVoyageId);
  };

  /** Applies a staged resize directly for a not-yet-accepted invite — no traveller approval to
   * wait for, since nobody has agreed to a plan yet. */
  const applyPendingInviteResize = async () => {
    if (!pendingProposal) return;
    const { requestId, legIds } = pendingProposal;
    setPendingProposal(null);
    setSaving(true);
    const { data, error } = await typedSupabase.rpc("admin_apply_pending_invite_legs", {
      _booking_request_id: requestId,
      _leg_ids: legIds,
      _allow_over_capacity: false,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      await loadVoyageDetails(selectedVoyageId);
      return;
    }
    const result = Array.isArray(data) ? (data[0] as { over_capacity?: boolean } | undefined) : undefined;
    toast.success(result?.over_capacity ? "Tratte aggiornate oltre capienza." : "Tratte aggiornate.");
    await loadVoyageDetails(selectedVoyageId);
  };

  /** Admin accepts/rejects a traveller-initiated leg-change proposal from the public matrix. */
  const respondToUserPlanChange = async (requestId: string, action: "accept" | "reject") => {
    setSaving(true);
    const { error } = await typedSupabase.rpc("admin_respond_voyage_booking_plan_change", {
      _booking_request_id: requestId,
      _action: action,
      _admin_note: null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(action === "accept" ? "Modifica accettata." : "Modifica rifiutata.");
    await loadVoyageDetails(selectedVoyageId);
  };

  /** Creates brand-new bookings/invites, possibly spanning several contiguous legs, from the
   * Gantt table's "+" column pill. */
  const addPeopleToLegs = async (
    legIds: string[],
    profileIds: string[],
    inviteEmails: string[] = [],
    isComped = false,
  ) => {
    const uniqueLegIds = [...new Set(legIds)];
    const uniqueProfileIds = [...new Set(profileIds)];
    const uniqueInviteEmails = [...new Set(inviteEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (uniqueLegIds.length === 0 || (uniqueProfileIds.length === 0 && uniqueInviteEmails.length === 0)) return;

    // The binding constraint is whichever selected leg has the least free capacity.
    const remainingSeats = Math.min(
      ...uniqueLegIds.map((legId) => Math.max(0, (selectedVoyage?.booking_max_guests || 4) - (legCapacity[legId] || 0)))
    );
    if (uniqueProfileIds.length + uniqueInviteEmails.length > remainingSeats) {
      toast.error("Hai selezionato più persone dei posti disponibili su una delle tratte scelte.");
      return;
    }
    const selectedProfileEmail = uniqueProfileIds
      .map((profileId) => profilesById[profileId]?.email?.trim().toLowerCase())
      .find((email): email is string => Boolean(email && uniqueInviteEmails.includes(email)));
    if (selectedProfileEmail) {
      toast.error(`${selectedProfileEmail} è già selezionato come profilo registrato.`);
      return;
    }

    const duplicateProfileId = uniqueProfileIds.find((profileId) =>
      requests.some((request) => {
        if (request.profile_id !== profileId || !duplicateBookingStatuses.has(request.status)) return false;
        return requestLegs.some(
          (link) => link.booking_request_id === request.id && uniqueLegIds.includes(link.bookable_leg_id)
        );
      })
    );
    if (duplicateProfileId) {
      toast.error("Una delle persone selezionate è già presente su una delle tratte scelte.");
      return;
    }

    const duplicateInviteEmail = uniqueInviteEmails.find((email) =>
      requests.some((request) => {
        if (!duplicateBookingStatuses.has(request.status)) return false;
        const profile = profilesById[request.profile_id];
        if (profile?.email?.trim().toLowerCase() !== email) return false;
        return requestLegs.some(
          (link) => link.booking_request_id === request.id && uniqueLegIds.includes(link.bookable_leg_id)
        );
      })
    );
    if (duplicateInviteEmail) {
      toast.error(`${duplicateInviteEmail} è già presente su una delle tratte scelte.`);
      return;
    }

    setSaving(true);
    const registeredResults = await Promise.all(
      uniqueProfileIds.map((profileId) =>
        typedSupabase.rpc("admin_create_voyage_booking", {
          _voyage_id: selectedVoyageId,
          _profile_id: profileId,
          _leg_ids: uniqueLegIds,
          _party_size: 1,
          _status: "admin_approved",
          _allow_over_capacity: false,
          _is_comped: isComped,
        })
      )
    );
    const inviteResults = await Promise.all(
      uniqueInviteEmails.map((email) =>
        typedSupabase.rpc("admin_create_voyage_booking_invite_by_email", {
          _voyage_id: selectedVoyageId,
          _email: email,
          _leg_ids: uniqueLegIds,
          _status: "admin_approved",
          _admin_notes: "Invito creato manualmente da admin.",
          _allow_over_capacity: false,
          _is_comped: isComped,
        })
      )
    );
    const results = [...registeredResults, ...inviteResults];
    const error = results.find((result) => result.error)?.error;
    if (error) {
      setSaving(false);
      toast.error(error.message);
      await loadVoyageDetails(selectedVoyageId);
      return;
    }
    const inviteRequestIds = inviteResults
      .map(({ data }) => {
        const result = Array.isArray(data) ? (data[0] as { booking_request_id?: string } | undefined) : undefined;
        return result?.booking_request_id;
      })
      .filter((id): id is string => Boolean(id));
    const inviteEmailResults = await Promise.allSettled(
      inviteRequestIds.map((requestId) => sendBookingInvites(requestId, lang === "en" ? "en" : "it"))
    );
    setSaving(false);
    const overCapacity = results.some(({ data }) => {
      const result = Array.isArray(data) ? (data[0] as AdminBookingRpcResult | undefined) : undefined;
      return Boolean(result?.over_capacity);
    });
    const sentInvites = inviteEmailResults.reduce((total, result) => {
      if (result.status !== "fulfilled" || "notConfigured" in result.value) return total;
      return total + result.value.sent;
    }, 0);
    const notConfiguredInvites = inviteEmailResults.some(
      (result) => result.status === "fulfilled" && "notConfigured" in result.value
    );
    toast.success(
      overCapacity
        ? "Persone aggiunte oltre capienza."
        : uniqueProfileIds.length + uniqueInviteEmails.length === 1
          ? "Persona aggiunta."
          : `${uniqueProfileIds.length + uniqueInviteEmails.length} persone aggiunte.`
    );
    if (sentInvites > 0) toast.success(`Inviti email inviati: ${sentInvites}.`);
    if (notConfiguredInvites) toast.info("Inviti creati. Invio email non configurato in questo ambiente.");
    await loadVoyageDetails(selectedVoyageId);
  };

  const updateSettingsField = (field: keyof BookingSettings, value: string | number | boolean | string[]) => {
    setBookingSettings((current) => ({ ...current, [field]: value }));
  };

  const saveBookingSettings = async ({
    showSuccessToast = true,
  }: { showSuccessToast?: boolean } = {}): Promise<boolean> => {
    if (!selectedVoyageId) return false;
    setSaving(true);
    const { error } = await typedSupabase
      .from("voyage_booking_settings")
      .upsert(
        {
          ...bookingSettings,
          voyage_id: selectedVoyageId,
          confirmation_deadline_hours: Math.max(1, Number(bookingSettings.confirmation_deadline_hours) || 72),
        },
        { onConflict: "voyage_id" }
      );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (showSuccessToast) toast.success("Settings booking salvati.");
    await loadVoyageDetails(selectedVoyageId);
    return true;
  };

  // Unsaved-changes leave guard (same pattern as /profile): warns on tab close/reload,
  // in-app link clicks, and back/forward navigation while route planning or booking
  // settings edits haven't been persisted yet.
  useBeforeUnloadPrompt(isDirty && !saving && !saveAndLeavePending);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isDirty || saving || saveAndLeavePending) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;

      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentUrl === nextPath) return;

      event.preventDefault();
      pendingNavigationRef.current = { type: "path", to: nextPath };
      setLeaveDialogOpen(true);
    };
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [isDirty, location.hash, location.pathname, location.search, saveAndLeavePending, saving]);

  useEffect(() => {
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;

    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (!isDirty || saving || saveAndLeavePending) return;

      pendingNavigationRef.current = { type: "back" };
      setLeaveDialogOpen(true);
      window.history.pushState(null, "", currentUrl);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty, location.hash, location.pathname, location.search, saveAndLeavePending, saving]);

  const continuePendingNavigation = () => {
    const pendingNavigation = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setLeaveDialogOpen(false);

    if (!pendingNavigation) return;

    if (pendingNavigation.type === "path") {
      navigate(pendingNavigation.to);
      return;
    }

    ignoreNextPopRef.current = true;
    window.history.back();
  };

  const handleStayOnPage = () => {
    setLeaveDialogOpen(false);
    pendingNavigationRef.current = null;
  };

  const handleLeaveWithoutSaving = () => {
    continuePendingNavigation();
  };

  const handleSaveAndLeave = async () => {
    setSaveAndLeavePending(true);
    // Route planning must be saved before booking settings: saveBookingSettings ends by
    // reloading voyage details, which unconditionally overwrites the local waypoints/legs
    // state with fresh DB data — if it ran first it would silently discard any still-
    // unsaved route-planning edits.
    let ok = true;
    if (isRoutePlanningDirty) {
      ok = (await saveRoutePlanning({ showSuccessToast: false })) && ok;
    }
    if (ok && isBookingSettingsDirty) {
      ok = (await saveBookingSettings({ showSuccessToast: false })) && ok;
    }
    if (ok) {
      continuePendingNavigation();
      toast.success("Modifiche salvate.");
    }
    setSaveAndLeavePending(false);
  };

  const addBookingTask = async () => {
    const title = newTaskTitle.trim();
    if (!selectedVoyageId || !title) return;
    setSaving(true);
    const { error } = await typedSupabase.from("voyage_booking_tasks").insert({
      voyage_id: selectedVoyageId,
      title_it: title,
      title_en: title,
      required: true,
      sort_order: bookingTasks.length,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewTaskTitle("");
    await loadVoyageDetails(selectedVoyageId);
  };

  const updateBookingTask = async (taskId: string, patch: Partial<BookingTask>) => {
    setSaving(true);
    const { error } = await typedSupabase.from("voyage_booking_tasks").update(patch).eq("id", taskId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await loadVoyageDetails(selectedVoyageId);
  };

  const deleteBookingTask = async (taskId: string) => {
    if (!confirm("Eliminare questa checklist item?")) return;
    setSaving(true);
    const { error } = await typedSupabase.from("voyage_booking_tasks").delete().eq("id", taskId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await loadVoyageDetails(selectedVoyageId);
  };

  // Shared save controls for the route-planning tabs (Soste / Rotte). The Overview tab keeps
  // its own copy inline. All three save the same pending route-planning changes.
  const routePlanningActions = (
    <div className="flex flex-wrap items-center gap-2">
      {isRoutePlanningDirty && (
        <span className="rounded-full border border-amber-300/70 bg-amber-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
          Modifiche non salvate
        </span>
      )}
      <button
        type="button"
        onClick={() => void saveRoutePlanning()}
        disabled={saving || !selectedVoyageId}
        className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
      >
        {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
        Salva planning
      </button>
      <button
        type="button"
        onClick={() => void saveRoutePlanning({ syncAfterSave: true })}
        disabled={saving || !selectedVoyageId || !selectedVoyage?.booking_enabled}
        className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
      >
        {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
        Salva e ricalcola
      </button>
    </div>
  );

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-[92rem] space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <Link to="/admin" className="glass-chip mb-6 inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Torna alla Dashboard
          </Link>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="editorial-heading text-4xl md:text-5xl">Booking control room</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Monitora imbarchi programmati, disponibilità per tratta e stato delle persone a bordo.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={voyageSearchQuery}
                onChange={(event) => setVoyageSearchQuery(event.target.value)}
                placeholder="Cerca viaggio..."
                className="w-[15rem] border border-border bg-background/70 py-2 pl-8 pr-3 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <span className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => setVoyageTypeFilter("all")}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                voyageTypeFilter === "all" ? "bg-foreground text-background" : "glass-chip text-muted-foreground hover:text-foreground"
              }`}
            >
              Tutti
            </button>
            <button
              type="button"
              onClick={() => setVoyageTypeFilter("water")}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                voyageTypeFilter === "water" ? "bg-sky-100 text-sky-800" : "glass-chip text-sky-700 hover:bg-sky-50"
              }`}
            >
              <Ship size={11} /> Mare
            </button>
            <button
              type="button"
              onClick={() => setVoyageTypeFilter("land")}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                voyageTypeFilter === "land" ? "bg-orange-100 text-orange-800" : "glass-chip text-orange-700 hover:bg-orange-50"
              }`}
            >
              <Mountain size={11} /> Terra
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            {(
              [
                { value: "planned" as const, label: "Programmati" },
                { value: "active" as const, label: "In corso" },
                { value: "completed" as const, label: "Completati" },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleVoyageStatusFilter(option.value)}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  voyageStatusFilter.has(option.value)
                    ? "bg-accent/15 text-accent"
                    : "glass-chip text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <select
              value={selectedVoyageId}
              onChange={(event) => setSelectedVoyageId(event.target.value)}
              className="min-w-[18rem] max-w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {filteredVoyages.length === 0 && <option value="">Nessun viaggio con questi filtri</option>}
              {filteredVoyages.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {getLocalizedBookingVoyageName(voyage, "it")}
                  {voyage.booking_enabled ? "" : " · booking off"}
                </option>
              ))}
            </select>
          </div>
        </section>

        <nav className="glass-panel flex flex-wrap gap-1.5 rounded-[26px] p-1.5">
          {BOOKING_TABS.map((tab) => {
            const active = activeTab === tab.key;
            const badge = tab.key === "candidature" ? candidatesInReview : 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-[20px] px-4 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon size={16} />
                <span className="whitespace-nowrap">{tab.label}</span>
                {badge > 0 && (
                  <span
                    className={`ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                      active ? "bg-background/25 text-background" : "bg-accent text-accent-foreground"
                    }`}
                  >
                    {badge}
                  </span>
                )}
                {tab.key === "briefing" && (bookingSettings.contribution_proposal_enabled || bookingSettings.workaway_enabled) && (
                  <span
                    title="Contributo alternativo e/o workaway attivi per questo viaggio"
                    className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-background/80" : "bg-emerald-500"}`}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {activeTab === "overview" && (
        <section className="glass-panel rounded-[34px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Gantt · Matrice</p>
              <h2 className="editorial-heading text-3xl">
                {selectedVoyage ? getLocalizedBookingVoyageName(selectedVoyage, "it") : "Booking"}
              </h2>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  {statusFilter.size === statusFilterOptions.length
                    ? "Tutti gli stati"
                    : statusFilter.size === 0
                      ? "Nessuno stato"
                      : `${statusFilter.size} stati selezionati`}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {statusFilterOptions.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={statusFilter.has(status)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      setStatusFilter((current) => {
                        const next = new Set(current);
                        if (checked) next.add(status);
                        else next.delete(status);
                        return next;
                      })
                    }
                  >
                    {getBookingStatusLabel(status, "it")}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {(() => {
            const pendingUserProposals = requests.filter((request) => request.plan_change_status === "pending_admin_approval");
            if (pendingUserProposals.length === 0) return null;
            return (
              <div className="mb-5 space-y-3">
                {pendingUserProposals.map((request) => {
                  const profile = profilesById[request.profile_id];
                  const proposedLegIds = (request.plan_change_metadata?.proposed_leg_ids as string[] | undefined) || [];
                  const proposedLabels = proposedLegIds
                    .map((legId) => legs.find((leg) => leg.id === legId))
                    .filter((leg): leg is BookableLeg => Boolean(leg))
                    .map((leg) => getLegLabel(leg, waypointsById, "it"));
                  const userMessage = request.plan_change_metadata?.user_message as string | undefined;
                  return (
                    <div key={request.id} className="rounded-[18px] border border-sky-300/60 bg-sky-50/70 p-3 text-sm text-sky-950">
                      <p className="font-semibold">
                        {profile?.name || profile?.email || request.profile_id} · proposta modifica tratte
                      </p>
                      {userMessage && <p className="mt-1 text-sky-900/80">{userMessage}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {proposedLabels.map((label) => (
                          <span key={label} className="rounded-full border border-sky-300/70 bg-white/65 px-3 py-1 text-xs text-sky-900">
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void respondToUserPlanChange(request.id, "accept")}
                          disabled={saving}
                          className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                        >
                          Accetta
                        </button>
                        <button
                          type="button"
                          onClick={() => void respondToUserPlanChange(request.id, "reject")}
                          disabled={saving}
                          className="rounded-full border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                        >
                          Rifiuta
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {loading ? (
            <div className="rounded-[24px] border border-border/70 p-8 text-muted-foreground">
              <Loader2 className="mr-2 inline animate-spin" size={16} /> Loading matrix...
            </div>
          ) : legs.length === 0 ? (
            <div className="rounded-[24px] border border-border/70 p-8 text-sm text-muted-foreground">
              Nessuna tratta prenotabile. Usa “Sync tratte” dopo aver creato waypoint pubblici.
            </div>
          ) : (
            <BookingGanttTable
              legs={legs}
              waypointsById={waypointsById}
              requests={visibleRequests}
              requestLegs={requestLegs}
              profilesById={profilesById}
              availableProfiles={combinedProfiles}
              legCapacity={legCapacity}
              maxGuests={selectedVoyage?.booking_max_guests || 4}
              saving={saving}
              statusOptions={statusOptions}
              onApprove={(requestId) => void approveRequest(requestId)}
              onReject={(requestId) => void rejectRequest(requestId)}
              onStatusChange={(requestId, status) => void updateRequestStatus(requestId, status)}
              stagedResize={pendingProposal}
              pendingInviteRequestIds={pendingInviteRequestIds}
              awaitingPaymentRequestIds={awaitingPaymentRequestIds}
              paidDepositRequestIds={paidDepositRequestIds}
              onConfirmPayment={(requestId) => setPaymentDialogRequestId(requestId)}
              onStageResize={stageResize}
              onCancelStagedResize={() => void cancelPlanChangeProposal()}
              onOpenProposalDialog={() => setProposalDialogOpen(true)}
              onApplyPendingInviteResize={() => void applyPendingInviteResize()}
              onAddPeople={addPeopleToLegs}
            />
          )}
        </section>
        )}

        {activeTab === "overview" && (
        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Richieste", value: requests.filter((r) => r.status === "requested").length },
            { label: "Confermati", value: requests.filter((r) => r.status === "user_confirmed").length },
            { label: "Waiting list", value: requests.filter((r) => r.status === "waitlisted").length },
            { label: "Tratte", value: legs.length },
          ].map((item) => (
            <div key={item.label} className="glass-panel rounded-[26px] p-5">
              <p className="editorial-heading text-3xl">{item.value}</p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </section>
        )}

        {activeTab === "overview" && (
        <section className="glass-panel rounded-[30px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <MapPinned size={18} className="text-accent" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Parametri booking</p>
                <h2 className="editorial-heading text-2xl">Configurazione del viaggio</h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isRoutePlanningDirty && (
                <span className="rounded-full border border-amber-300/70 bg-amber-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                  Modifiche non salvate
                </span>
              )}
              <button
                type="button"
                onClick={() => void saveRoutePlanning()}
                disabled={saving || !selectedVoyageId}
                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                Salva planning
              </button>
              <button
                type="button"
                onClick={() => void saveRoutePlanning({ syncAfterSave: true })}
                disabled={saving || !selectedVoyageId || !selectedVoyage?.booking_enabled}
                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                Salva e ricalcola
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[22px] border border-border/70 p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(selectedVoyage?.booking_enabled)}
                  onChange={(event) => updateSelectedVoyagePlanning({ booking_enabled: event.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
                />
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-[0.2em] text-foreground">
                    {selectedVoyage?.booking_enabled ? "Booking attivo per questa rotta" : "Booking disattivato per questa rotta"}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    Quando è disattivo, le tratte restano in pianificazione ma non vengono mostrate come prenotabili.
                  </span>
                </span>
              </label>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Persone max</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={selectedVoyage?.booking_max_guests ?? 4}
                    onChange={(event) => updateSelectedVoyagePlanning({ booking_max_guests: Math.max(1, Number(event.target.value) || 1) })}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Velocità stimata kn</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={selectedVoyage?.booking_planning_speed_kn ?? 5}
                    onChange={(event) => updateSelectedVoyagePlanning({ booking_planning_speed_kn: Math.max(0.1, Number(event.target.value) || 5) })}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Finestra partenza da</span>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(selectedVoyage?.departure_window_start)}
                    onChange={(event) => updateSelectedVoyagePlanning({ departure_window_start: fromDateTimeLocalValue(event.target.value) })}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Finestra partenza a</span>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocalValue(selectedVoyage?.departure_window_end)}
                    onChange={(event) => updateSelectedVoyagePlanning({ departure_window_end: fromDateTimeLocalValue(event.target.value) })}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Waypoint pubblici", value: publicPlanningWaypoints.length, icon: <MapPinned size={15} /> },
                { label: "Tratte navigazione", value: legs.length, icon: <CalendarClock size={15} /> },
                { label: "Navigazione stimata", value: formatDuration(routePlanningStats.navigationMinutes), icon: <Clock size={15} /> },
                { label: "Soste pianificate", value: formatDuration(routePlanningStats.stopMinutes), icon: <Clock size={15} /> },
              ].map((item) => (
                <div key={item.label} className="rounded-[22px] border border-border/70 p-4">
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">{item.icon}</div>
                  <p className="editorial-heading text-2xl">{item.value}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                </div>
              ))}
              <div className="rounded-[22px] border border-border/70 p-4 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Totale viaggio stimato</p>
                <p className="mt-2 text-sm text-foreground">
                  {routePlanningStats.totalDistanceNm.toFixed(1)} nm · {formatDuration(routePlanningStats.totalMinutes)} incluse soste
                </p>
              </div>
            </div>
          </div>
        </section>
        )}

        {activeTab === "soste" && (
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
        )}

        {activeTab === "rotte" && (
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
                              ? "border-indigo-300/70 bg-indigo-100/70 text-indigo-800"
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
                                    ? "border-red-300/70 bg-red-100/70 text-red-800"
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
        )}

        {activeTab === "candidature" && (
        <section className="glass-panel rounded-[34px] p-5 md:p-6">
          <div className="mb-4 flex justify-end">
            <Link
              to="/admin/bookings/rimborsi"
              className="glass-chip inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Wallet size={14} /> Rimborsi da eseguire
            </Link>
          </div>
          <VoyageCandidatesPanel voyageId={selectedVoyageId} />
        </section>
        )}

        {activeTab === "briefing" && (
        <section className="glass-panel rounded-[30px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Settings size={17} className="text-accent" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Admin / bookings / settings</p>
                <h2 className="editorial-heading text-2xl">Prepartenza, briefing email e checklist</h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isBookingSettingsDirty && (
                <span className="rounded-full border border-amber-300/70 bg-amber-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                  Modifiche non salvate
                </span>
              )}
              <button
                type="button"
                onClick={() => void saveBookingSettings()}
                disabled={saving || !selectedVoyageId}
                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                Salva settings
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Deadline conferma ore</span>
              <input
                type="number"
                min="1"
                value={bookingSettings.confirmation_deadline_hours}
                onChange={(event) => updateSettingsField("confirmation_deadline_hours", Number(event.target.value))}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Info prepartenza IT</span>
              <textarea
                rows={4}
                value={bookingSettings.predeparture_info_it || ""}
                onChange={(event) => updateSettingsField("predeparture_info_it", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Predeparture info EN</span>
              <textarea
                rows={4}
                value={bookingSettings.predeparture_info_en || ""}
                onChange={(event) => updateSettingsField("predeparture_info_en", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <fieldset className="lg:col-span-3 rounded-[22px] border border-border/70 bg-background/35 p-4">
              <legend className="px-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Mail briefing 1 · invio automatico alla conferma
              </legend>
              <p className="mb-4 text-sm text-muted-foreground">
                Riepilogo viaggio, spostamenti flessibili, bagaglio morbido, abbigliamento caldo/antivento, scarpe da barca e prodotti già disponibili a bordo.
              </p>
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 1 IT</span>
                  <textarea
                    rows={9}
                    value={bookingSettings.first_briefing_content_it || ""}
                    onChange={(event) => updateSettingsField("first_briefing_content_it", event.target.value)}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 1 EN</span>
                  <textarea
                    rows={9}
                    value={bookingSettings.first_briefing_content_en || ""}
                    onChange={(event) => updateSettingsField("first_briefing_content_en", event.target.value)}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="lg:col-span-3 rounded-[22px] border border-border/70 bg-background/35 p-4">
              <legend className="px-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Mail briefing 2 · operativo a ridosso della partenza
              </legend>
              <p className="mb-4 text-sm text-muted-foreground">
                Vita a bordo, lavaggio a mano, Starlink, audio/proiettore, prese tipo L/F, USB-A/USB-C, frigo e suggerimenti per luoghi o esperienze.
              </p>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[16px] border border-border/70 bg-white/55 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tipo L</p>
                  <div className="mt-3 flex h-16 items-center justify-center gap-3 rounded-xl border border-border/60 bg-background/80">
                    <span className="h-3 w-3 rounded-full border border-foreground/70" />
                    <span className="h-3 w-3 rounded-full border border-foreground/70" />
                    <span className="h-3 w-3 rounded-full border border-foreground/70" />
                  </div>
                </div>
                <div className="rounded-[16px] border border-border/70 bg-white/55 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tipo F</p>
                  <div className="mt-3 flex h-16 items-center justify-center rounded-xl border border-border/60 bg-background/80">
                    <div className="flex h-12 w-12 items-center justify-center gap-4 rounded-full border-2 border-foreground/70">
                      <span className="h-3 w-3 rounded-full bg-foreground/70" />
                      <span className="h-3 w-3 rounded-full bg-foreground/70" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 2 IT</span>
                  <textarea
                    rows={9}
                    value={bookingSettings.second_briefing_content_it || ""}
                    onChange={(event) => updateSettingsField("second_briefing_content_it", event.target.value)}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing 2 EN</span>
                  <textarea
                    rows={9}
                    value={bookingSettings.second_briefing_content_en || ""}
                    onChange={(event) => updateSettingsField("second_briefing_content_en", event.target.value)}
                    className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            </fieldset>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Termini / note operative IT</span>
              <textarea
                rows={3}
                value={bookingSettings.terms_content_it || ""}
                onChange={(event) => updateSettingsField("terms_content_it", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Terms / operational notes EN</span>
              <textarea
                rows={3}
                value={bookingSettings.terms_content_en || ""}
                onChange={(event) => updateSettingsField("terms_content_en", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>

            <fieldset className="lg:col-span-3 rounded-[22px] border border-border/70 bg-background/35 p-4">
              <legend className="px-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Contributo alternativo &amp; workaway
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">Proposta economica alternativa</span>
                    <input
                      type="checkbox"
                      checked={bookingSettings.contribution_proposal_enabled}
                      onChange={(event) => updateSettingsField("contribution_proposal_enabled", event.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Permette al candidato di proporre un importo diverso dalla quota variabile calcolata.
                  </p>
                  {bookingSettings.contribution_proposal_enabled && (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Range consentito:</span>
                      <input
                        type="number"
                        min={0}
                        value={bookingSettings.contribution_proposal_min_percent}
                        onChange={(event) =>
                          updateSettingsField("contribution_proposal_min_percent", Number(event.target.value))
                        }
                        className="w-16 border border-border bg-background/70 px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      />
                      <span className="text-muted-foreground">% —</span>
                      <input
                        type="number"
                        min={0}
                        value={bookingSettings.contribution_proposal_max_percent}
                        onChange={(event) =>
                          updateSettingsField("contribution_proposal_max_percent", Number(event.target.value))
                        }
                        className="w-16 border border-border bg-background/70 px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      />
                      <span className="text-muted-foreground">%</span>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">Workaway attivo</span>
                    <input
                      type="checkbox"
                      checked={bookingSettings.workaway_enabled}
                      onChange={(event) => updateSettingsField("workaway_enabled", event.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Permette candidature con mansioni (social, foto, video, cucina, skipper...) invece del contributo.
                  </p>
                </div>
              </div>

              {bookingSettings.workaway_enabled && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                    Posizioni attive per questo viaggio
                  </p>
                  {workawayRoles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nessun ruolo nel catalogo. Aggiungine uno qui sotto.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {workawayRoles.map((role) => {
                        const active = (bookingSettings.workaway_role_keys || []).includes(role.key);
                        return (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => toggleVoyageWorkawayRoleKey(role.key)}
                            aria-pressed={active}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              active
                                ? "border-accent bg-accent/10 text-foreground"
                                : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                            } ${role.active ? "" : "opacity-50"}`}
                            title={role.active ? undefined : "Ruolo disattivato dal catalogo globale"}
                          >
                            {role.label_it}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 border-t border-border/60 pt-4">
                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Catalogo ruoli workaway (globale, condiviso tra tutti i viaggi)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {workawayRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => void toggleWorkawayRoleActive(role)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        role.active
                          ? "border-emerald-300/70 bg-emerald-100/60 text-emerald-900"
                          : "border-border/70 bg-background/40 text-muted-foreground line-through"
                      }`}
                      title={role.active ? "Clicca per disattivare globalmente" : "Clicca per riattivare globalmente"}
                    >
                      {role.label_it}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={newWorkawayRoleLabelIt}
                    onChange={(event) => setNewWorkawayRoleLabelIt(event.target.value)}
                    placeholder="Nome ruolo IT (es. Cuoco)"
                    className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <input
                    value={newWorkawayRoleLabelEn}
                    onChange={(event) => setNewWorkawayRoleLabelEn(event.target.value)}
                    placeholder="Role name EN (e.g. Cook)"
                    className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void addWorkawayRole()}
                    className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-foreground hover:text-accent"
                  >
                    <Plus size={14} /> Aggiungi al catalogo
                  </button>
                </div>
              </div>
            </fieldset>
          </div>

          <div className="mt-6 border-t border-border/70 pt-5">
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="block flex-1">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Nuovo item checklist</span>
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void addBookingTask()}
                disabled={saving || !newTaskTitle.trim()}
                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                <Plus size={15} /> Aggiungi
              </button>
            </div>
            <div className="space-y-2">
              {bookingTasks.map((task) => (
                <div key={task.id} className="grid gap-3 rounded-[18px] border border-border/70 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <input
                    value={task.title_it}
                    onChange={(event) => setBookingTasks((items) => items.map((item) => item.id === task.id ? { ...item, title_it: event.target.value } : item))}
                    onBlur={(event) => void updateBookingTask(task.id, { title_it: event.target.value })}
                    className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={task.required}
                      onChange={(event) => void updateBookingTask(task.id, { required: event.target.checked })}
                      className="h-4 w-4 accent-[hsl(var(--accent))]"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => void deleteBookingTask(task.id)}
                    className="glass-chip inline-flex items-center justify-center gap-2 px-3 py-2 text-xs text-destructive"
                  >
                    <Trash2 size={13} /> Elimina
                  </button>
                </div>
              ))}
              {bookingTasks.length === 0 && (
                <p className="text-sm text-muted-foreground">Nessuna checklist configurata per questo viaggio.</p>
              )}
            </div>
          </div>
        </section>
        )}
      </div>

      <AlertDialog open={leaveDialogOpen}>
        <AlertDialogContent className="glass-panel max-w-[560px] rounded-[28px] border-border/70">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="editorial-heading text-2xl leading-tight">
              Hai modifiche non salvate
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
              Se lasci questa pagina adesso perdi le modifiche alla pianificazione. Puoi uscire senza salvare oppure salvare prima di continuare.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-end">
            <AlertDialogCancel onClick={handleStayOnPage} className="mt-0">
              Resta qui
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={handleLeaveWithoutSaving}
              className="border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Esci senza salvare
            </Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleSaveAndLeave();
              }}
              disabled={saving || saveAndLeavePending}
            >
              {saveAndLeavePending ? "Salvataggio..." : "Salva ed esci"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WaypointDetailsDialog
        waypointId={detailsWaypointId}
        index={Math.max(0, detailsWaypointIndex)}
        total={publicPlanningWaypoints.length}
        lang={lang}
        voyageType={selectedVoyageType}
        datesTbd={selectedVoyageDatesTbd}
        onOpenChange={(open) => {
          if (!open) setDetailsWaypointId(null);
        }}
        onSaved={() => void loadVoyageDetails(selectedVoyageId)}
      />

      <PlanChangeProposalDialog
        open={proposalDialogOpen && pendingProposal !== null}
        onOpenChange={(open) => {
          setProposalDialogOpen(open);
          if (!open) void cancelPlanChangeProposal();
        }}
        onConfirm={(proposal) => void submitPlanChangeProposal(proposal)}
        travellerName={
          pendingProposal
            ? profilesById[
                requests.find((item) => item.id === pendingProposal.requestId)?.profile_id ?? ""
              ]?.name ?? null
            : null
        }
      />

      <ManualPaymentDialog
        open={paymentDialogRequestId !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentDialogRequestId(null);
        }}
        onConfirm={(payment) => void confirmManualPayment(payment)}
        saving={saving}
        travellerName={
          paymentDialogRequestId
            ? profilesById[
                requests.find((item) => item.id === paymentDialogRequestId)?.profile_id ?? ""
              ]?.name ?? null
            : null
        }
        bookingStatus={
          paymentDialogRequestId
            ? requests.find((item) => item.id === paymentDialogRequestId)?.status ?? null
            : null
        }
        dueEur={paymentDialogRequestId ? dueEurForRequest(paymentDialogRequestId) : null}
      />
    </div>
  );
};

export default AdminVoyageBookings;
