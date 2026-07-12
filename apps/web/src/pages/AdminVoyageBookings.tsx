import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarClock, Check, Clock, Loader2, MapPinned, Mountain, Pencil, Plus, RefreshCw, Search, Settings, Ship, Trash2, X } from "lucide-react";
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
import BookingGanttTable from "@/components/admin/BookingGanttTable";
import { getWaypointEffectiveType, totalWaypointDistance } from "@/lib/voyage-utils";
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
import { DANGER_REASONS, type DangerReasonKey } from "@/lib/danger-reasons";
import { sendBookingInvites } from "@/lib/booking-participants";
import { updateBookingStatusWithRefund } from "@/lib/booking-refunds";
import { useI18n } from "@/lib/i18n";

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

const emptySettingsForm: BookingSettings = {
  voyage_id: "",
  confirmation_deadline_hours: 72,
  predeparture_info_it: "",
  predeparture_info_en: "",
  briefing_content_it: "",
  briefing_content_en: "",
  terms_content_it: "",
  terms_content_en: "",
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
  const [profiles, setProfiles] = useState<BookingProfile[]>([]);
  const [availableProfiles, setAvailableProfiles] = useState<BookingProfile[]>([]);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(emptySettingsForm);
  const [bookingTasks, setBookingTasks] = useState<BookingTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | VoyageBookingStatus>("all");
  const [voyageSearchQuery, setVoyageSearchQuery] = useState("");
  const [voyageTypeFilter, setVoyageTypeFilter] = useState<"all" | "water" | "land">("all");
  // Completed voyages can't act on their bookings anymore, so they're hidden by default;
  // toggle them back in when you need to look up historical bookings.
  const [voyageStatusFilter, setVoyageStatusFilter] = useState<Set<BookingVoyage["status"]>>(
    () => new Set(["planned", "active"])
  );
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [editableLegIds, setEditableLegIds] = useState<Set<string>>(() => new Set());
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [saveAndLeavePending, setSaveAndLeavePending] = useState(false);

  // Holds the last voyages list loaded from the DB (updated only by loadVoyages, never by
  // local edits) so loadVoyageDetails can snapshot the voyage-level route-planning fields
  // without a render-timing race against a separate sync effect.
  const voyagesRef = useRef<BookingVoyage[]>([]);
  const initialRoutePlanningSnapshotRef = useRef<string | null>(null);
  const initialBookingSettingsSnapshotRef = useRef<string | null>(null);
  const pendingNavigationRef = useRef<{ type: "path"; to: string } | { type: "back" } | null>(null);
  const ignoreNextPopRef = useRef(false);

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId) || null;

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

    const [requestLegsRes, profilesRes] = await Promise.all([
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
    ]);

    if (requestLegsRes.error || profilesRes.error) {
      toast.error(requestLegsRes.error?.message || profilesRes.error?.message || "Unable to load booking people");
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
    () => requests.filter((request) => statusFilter === "all" || request.status === statusFilter),
    [requests, statusFilter]
  );

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
            waypoint.stop_mode === "nights" ? waypoint.stop_departure_time || null : null;
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
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.refundAmountEur > 0) {
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

  /** Converts a Gantt-bar drag-resize into a traveller-facing route proposal. */
  const resizeBookingLegs = async (requestId: string, nextLegIds: string[]) => {
    const request = requests.find((item) => item.id === requestId);
    const currentLegIds = requestLegs
      .filter((link) => link.booking_request_id === requestId)
      .map((link) => link.bookable_leg_id)
      .sort();
    const proposedLegIds = [...nextLegIds].sort();
    if (currentLegIds.length === proposedLegIds.length && currentLegIds.every((id, index) => id === proposedLegIds[index])) {
      return;
    }
    const adminNote = window.prompt(
      "Messaggio per il viaggiatore sulla modifica proposta",
      "Ti proponiamo una modifica alle tratte per incastrare meglio equipaggio, meteo e disponibilità."
    );
    if (adminNote === null) {
      await loadVoyageDetails(selectedVoyageId);
      return;
    }
    setSaving(true);
    const { error } = await typedSupabase.rpc("admin_propose_voyage_booking_legs", {
      _booking_request_id: requestId,
      _proposed_leg_ids: nextLegIds,
      _admin_note: adminNote.trim() || null,
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

  /** Creates brand-new single-leg bookings/invites from the Gantt table's "+" column pill. */
  const addPeopleToLeg = async (legId: string, profileIds: string[], inviteEmails: string[] = []) => {
    const uniqueProfileIds = [...new Set(profileIds)];
    const uniqueInviteEmails = [...new Set(inviteEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (uniqueProfileIds.length === 0 && uniqueInviteEmails.length === 0) return;

    const remainingSeats = Math.max(0, (selectedVoyage?.booking_max_guests || 4) - (legCapacity[legId] || 0));
    if (uniqueProfileIds.length + uniqueInviteEmails.length > remainingSeats) {
      toast.error("Hai selezionato più persone dei posti disponibili su questa tratta.");
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
          (link) => link.booking_request_id === request.id && link.bookable_leg_id === legId
        );
      })
    );
    if (duplicateProfileId) {
      toast.error("Una delle persone selezionate è già presente su questa tratta.");
      return;
    }

    const duplicateInviteEmail = uniqueInviteEmails.find((email) =>
      requests.some((request) => {
        if (!duplicateBookingStatuses.has(request.status)) return false;
        const profile = profilesById[request.profile_id];
        if (profile?.email?.trim().toLowerCase() !== email) return false;
        return requestLegs.some(
          (link) => link.booking_request_id === request.id && link.bookable_leg_id === legId
        );
      })
    );
    if (duplicateInviteEmail) {
      toast.error(`${duplicateInviteEmail} è già presente su questa tratta.`);
      return;
    }

    setSaving(true);
    const registeredResults = await Promise.all(
      uniqueProfileIds.map((profileId) =>
        typedSupabase.rpc("admin_create_voyage_booking", {
          _voyage_id: selectedVoyageId,
          _profile_id: profileId,
          _leg_ids: [legId],
          _party_size: 1,
          _status: "admin_approved",
          _allow_over_capacity: false,
        })
      )
    );
    const inviteResults = await Promise.all(
      uniqueInviteEmails.map((email) =>
        typedSupabase.rpc("admin_create_voyage_booking_invite_by_email", {
          _voyage_id: selectedVoyageId,
          _email: email,
          _leg_ids: [legId],
          _status: "admin_approved",
          _admin_notes: "Invito creato manualmente da admin.",
          _allow_over_capacity: false,
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

  const updateSettingsField = (field: keyof BookingSettings, value: string | number) => {
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
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty || saving || saveAndLeavePending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, saveAndLeavePending, saving]);

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

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-[92rem] space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <Link to="/admin" className="glass-chip mb-6 inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Dashboard
          </Link>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="editorial-heading text-4xl md:text-5xl">Booking control room</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Monitora imbarchi programmati, disponibilità per tratta e stato delle persone a bordo.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <button
                type="button"
                onClick={syncLegs}
                disabled={saving || !selectedVoyageId || !selectedVoyage?.booking_enabled}
                className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                Sync tratte
              </button>
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

        <section className="glass-panel rounded-[30px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <MapPinned size={18} className="text-accent" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Route planning</p>
                <h2 className="editorial-heading text-2xl">Percorso, soste e tratte future</h2>
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

          <div className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Soste waypoint</p>
                <span className="text-xs text-muted-foreground">Durata prevista in sosta</span>
              </div>
              <div className="space-y-2">
                {publicPlanningWaypoints.map((waypoint, index) => {
                  const stopUiMode = getWaypointStopUiMode(waypoint);
                  const outboundLeg = legs.find((leg) => leg.from_waypoint_id === waypoint.id);
                  const effectiveHours = getEffectiveStopHoursDefault(waypoint);
                  const effectiveNights = Math.max(1, Number(waypoint.stop_nights ?? 1));
                  const defaultDeparture = getDefaultStopDepartureTime(Boolean(outboundLeg?.open_sea));
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
                        stop_departure_time: null,
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

                  return (
                    <div key={waypoint.id} className="grid gap-3 rounded-[18px] border border-border/70 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {index + 1}. {waypoint.name_it || waypoint.name_en || waypoint.name || "Waypoint"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          narrative · {formatPlanningDate(waypoint.date_start)} → {formatPlanningDate(waypoint.date_end)}
                        </p>
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
                                    planned_stop_duration_minutes: hours * 60,
                                  });
                                }}
                                className="w-20 border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                              />
                              {STOP_HOURS_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() =>
                                    updateWaypointPlanning(waypoint.id, {
                                      stop_hours: preset,
                                      planned_stop_duration_minutes: preset * 60,
                                    })
                                  }
                                  className="glass-chip px-2.5 py-1 text-xs text-foreground hover:text-accent"
                                >
                                  {preset}h
                                </button>
                              ))}
                            </div>
                          </div>
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

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Tratte di navigazione</p>
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
          </div>
        </section>

        <section className="glass-panel rounded-[34px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Matrice</p>
              <h2 className="editorial-heading text-3xl">
                {selectedVoyage ? getLocalizedBookingVoyageName(selectedVoyage, "it") : "Booking"}
              </h2>
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="all">Tutti gli stati</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {getBookingStatusLabel(status, "it")}
                </option>
              ))}
            </select>
          </div>

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
              onResize={resizeBookingLegs}
              onAddPeople={addPeopleToLeg}
            />
          )}
        </section>

        <section className="glass-panel rounded-[30px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Settings size={17} className="text-accent" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Admin / bookings / settings</p>
                <h2 className="editorial-heading text-2xl">Prepartenza, briefing e checklist</h2>
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
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing IT</span>
              <textarea
                rows={4}
                value={bookingSettings.briefing_content_it || ""}
                onChange={(event) => updateSettingsField("briefing_content_it", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Briefing EN</span>
              <textarea
                rows={4}
                value={bookingSettings.briefing_content_en || ""}
                onChange={(event) => updateSettingsField("briefing_content_en", event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
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
    </div>
  );
};

export default AdminVoyageBookings;
