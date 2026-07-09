import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, Clock, Loader2, MapPinned, Pencil, Plus, RefreshCw, Settings, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  capacityBlockingStatuses,
  computeAutoLegComplexity,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getBookingStatusShortLabel,
  getComplexityClass,
  getComplexityLabel,
  getDangerClass,
  getDangerLabel,
  getLegComplexity,
  getLegDangerLevel,
  getLegLabel,
  getLocalizedBookingVoyageName,
  isLegComplexityAuto,
  isLegSelectable,
} from "@/lib/booking-utils";

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

const AdminVoyageBookings = () => {
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
  const [manualProfileId, setManualProfileId] = useState("");
  const [manualLegIds, setManualLegIds] = useState<string[]>([]);
  const [manualPartySize, setManualPartySize] = useState("1");
  const [manualStatus, setManualStatus] = useState<VoyageBookingStatus>("admin_approved");
  const [manualNotes, setManualNotes] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [editableLegIds, setEditableLegIds] = useState<Set<string>>(() => new Set());

  const selectedVoyage = voyages.find((voyage) => voyage.id === selectedVoyageId) || null;

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
        .select("id,voyage_id,name,name_it,name_en,sort_order,lat,lng,waypoint_type,visibility_mode,planned_stop_duration_minutes,date_start,date_end")
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

    setWaypoints(((waypointsRes.data as BookingWaypoint[] | null) || []));
    setLegs(((legsRes.data as BookableLeg[] | null) || []));
    setRequests(loadedRequests);
    setRequestLegs(((requestLegsRes.data as BookingRequestLeg[] | null) || []));
    setProfiles(((profilesRes.data as BookingProfile[] | null) || []));
    setBookingSettings({
      ...emptySettingsForm,
      ...(((settingsRes.data as BookingSettings[] | null) || [])[0] || {}),
      voyage_id: voyageId,
    });
    setBookingTasks(((tasksRes.data as BookingTask[] | null) || []));
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
  const requestLegSet = useMemo(
    () => new Set(requestLegs.map((link) => `${link.booking_request_id}:${link.bookable_leg_id}`)),
    [requestLegs]
  );
  const activeLegs = useMemo(() => legs.filter(isLegSelectable), [legs]);

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

  const selectedManualPartySize = Math.max(1, Number.parseInt(manualPartySize, 10) || 1);
  const manualOverCapacity = manualLegIds.some(
    (legId) => (legCapacity[legId] || 0) + selectedManualPartySize > (selectedVoyage?.booking_max_guests || 2)
  );
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
    const stopMinutes = publicPlanningWaypoints.reduce((total, waypoint) => total + Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0) || 0), 0);
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
      return (legCapacity[legId] || 0) - alreadyCounted + request.party_size > (selectedVoyage?.booking_max_guests || 2);
    });
  };

  const toggleManualLeg = (legId: string) => {
    setManualLegIds((current) =>
      current.includes(legId) ? current.filter((id) => id !== legId) : [...current, legId]
    );
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

  const toggleLegEditing = (legId: string) => {
    setEditableLegIds((current) => {
      const next = new Set(current);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
      return next;
    });
  };

  const saveRoutePlanning = async ({ syncAfterSave = false }: { syncAfterSave?: boolean } = {}) => {
    if (!selectedVoyageId || !selectedVoyage) return;
    setSaving(true);
    const voyagePatch = {
      booking_enabled: Boolean(selectedVoyage.booking_enabled),
      booking_max_guests: Math.max(1, Number(selectedVoyage.booking_max_guests ?? 2) || 2),
      booking_planning_speed_kn: Math.max(0.1, Number(selectedVoyage.booking_planning_speed_kn ?? 5) || 5),
      departure_window_start: selectedVoyage.departure_window_start || null,
      departure_window_end: selectedVoyage.departure_window_end || null,
    };
    const voyageRes = await typedSupabase.from("voyages").update(voyagePatch).eq("id", selectedVoyageId);
    if (voyageRes.error) {
      setSaving(false);
      toast.error(voyageRes.error.message);
      return;
    }

    const waypointResults = await Promise.all(
      waypoints.map((waypoint) =>
        typedSupabase
          .from("voyage_waypoints")
          .update({ planned_stop_duration_minutes: Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0) || 0) })
          .eq("id", waypoint.id)
      )
    );
    const waypointError = waypointResults.find((result) => result.error)?.error;
    if (waypointError) {
      setSaving(false);
      toast.error(waypointError.message);
      return;
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
        return;
      }
    }

    if (syncAfterSave) {
      const { error } = await typedSupabase.rpc("sync_voyage_bookable_legs", { _voyage_id: selectedVoyageId });
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
    }

    setSaving(false);
    toast.success(syncAfterSave ? "Pianificazione salvata e tratte ricalcolate." : "Pianificazione rotta salvata.");
    await loadVoyages();
    await loadVoyageDetails(selectedVoyageId);
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

  const createManualBooking = async () => {
    if (!selectedVoyageId || !manualProfileId || manualLegIds.length === 0) {
      toast.error("Seleziona persona e almeno una tratta.");
      return;
    }
    if (manualOverCapacity && !confirm("Questo inserimento supera il limite persone per almeno una tratta. Procedere comunque?")) {
      return;
    }
    setSaving(true);
    const { data, error } = await typedSupabase.rpc("admin_create_voyage_booking", {
      _voyage_id: selectedVoyageId,
      _profile_id: manualProfileId,
      _leg_ids: manualLegIds,
      _party_size: selectedManualPartySize,
      _status: manualStatus,
      _message: null,
      _admin_notes: manualNotes || (manualOverCapacity ? "Inserimento manuale oltre capienza." : null),
      _allow_over_capacity: true,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = Array.isArray(data) ? (data[0] as AdminBookingRpcResult | undefined) : undefined;
    toast.success(result?.over_capacity ? "Persona aggiunta oltre capienza." : "Persona aggiunta al booking.");
    setManualLegIds([]);
    setManualNotes("");
    await loadVoyageDetails(selectedVoyageId);
  };

  const updateSettingsField = (field: keyof BookingSettings, value: string | number) => {
    setBookingSettings((current) => ({ ...current, [field]: value }));
  };

  const saveBookingSettings = async () => {
    if (!selectedVoyageId) return;
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
      return;
    }
    toast.success("Settings booking salvati.");
    await loadVoyageDetails(selectedVoyageId);
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
            <div className="flex flex-wrap gap-3">
              <select
                value={selectedVoyageId}
                onChange={(event) => setSelectedVoyageId(event.target.value)}
                className="min-w-[18rem] border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                {voyages.map((voyage) => (
                  <option key={voyage.id} value={voyage.id}>
                    {getLocalizedBookingVoyageName(voyage, "it")}
                    {voyage.booking_enabled ? "" : " · booking off"}
                  </option>
                ))}
              </select>
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
            <div className="flex flex-wrap gap-2">
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
                    value={selectedVoyage?.booking_max_guests ?? 2}
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
                {publicPlanningWaypoints.map((waypoint, index) => (
                  <div key={waypoint.id} className="grid gap-3 rounded-[18px] border border-border/70 p-3 sm:grid-cols-[1fr_120px] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {index + 1}. {waypoint.name_it || waypoint.name_en || waypoint.name || "Waypoint"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        narrative · {formatPlanningDate(waypoint.date_start)} → {formatPlanningDate(waypoint.date_end)}
                      </p>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sosta min</span>
                      <input
                        type="number"
                        min="0"
                        step="30"
                        value={Math.max(0, Number(waypoint.planned_stop_duration_minutes ?? 0) || 0)}
                        onChange={(event) =>
                          updateWaypointPlanning(waypoint.id, {
                            planned_stop_duration_minutes: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                        className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      />
                    </label>
                  </div>
                ))}
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
                          title="Mare aperto (>12 nm dalla costa): aumenta la complessità"
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            leg.open_sea
                              ? "border-indigo-300/70 bg-indigo-100/70 text-indigo-800"
                              : "border-border/70 bg-background text-muted-foreground"
                          }`}
                        >
                          Mare aperto{leg.open_sea ? " ✓" : ""}
                        </button>
                      </div>
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

        <section className="glass-panel rounded-[30px] p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <UserPlus size={18} className="text-accent" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Inserimento manuale</p>
                <h2 className="editorial-heading text-2xl">Aggiungi persona alle tratte</h2>
              </div>
            </div>
            {manualOverCapacity && (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-amber-100/70 px-3 py-1.5 text-xs text-amber-800">
                <AlertTriangle size={14} /> Supera il limite impostato
              </span>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_120px_180px]">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Persona</label>
              <select
                value={manualProfileId}
                onChange={(event) => setManualProfileId(event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">Seleziona utente registrato</option>
                {combinedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || profile.email || profile.id}
                    {profile.email ? ` · ${profile.email}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Pax</label>
              <input
                type="number"
                min="1"
                value={manualPartySize}
                onChange={(event) => setManualPartySize(event.target.value)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Stato</label>
              <select
                value={manualStatus}
                onChange={(event) => setManualStatus(event.target.value as VoyageBookingStatus)}
                className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="admin_approved">Da confermare</option>
                <option value="user_confirmed">Confermato</option>
                <option value="requested">Prenotato</option>
                <option value="waitlisted">Waiting list</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_260px]">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Tratte attive</p>
              {activeLegs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuna tratta attiva e prenotabile per questo viaggio.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {activeLegs.map((leg) => {
                    const selected = manualLegIds.includes(leg.id);
                    const nextCount = (legCapacity[leg.id] || 0) + (selected ? selectedManualPartySize : 0);
                    const full = nextCount > (selectedVoyage?.booking_max_guests || 2);
                    return (
                      <label key={leg.id} className="flex gap-3 rounded-[18px] border border-border/70 p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleManualLeg(leg.id)}
                          className="mt-1 h-4 w-4 accent-[hsl(var(--accent))]"
                        />
                        <span>
                          <span className="block text-foreground">{getLegLabel(leg, waypointsById, "it")}</span>
                          <span className={full ? "mt-1 block text-xs text-amber-700" : "mt-1 block text-xs text-muted-foreground"}>
                            {legCapacity[leg.id] || 0}/{selectedVoyage?.booking_max_guests || 2} pax
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Note admin</span>
                <textarea
                  value={manualNotes}
                  onChange={(event) => setManualNotes(event.target.value)}
                  rows={4}
                  className="w-full border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void createManualBooking()}
                disabled={saving || !manualProfileId || manualLegIds.length === 0 || activeLegs.length === 0}
                className="glass-chip inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-foreground hover:text-accent disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                Aggiungi al booking
              </button>
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
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[220px] border-b border-border bg-background/95 p-3 text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      Persona
                    </th>
                    {legs.map((leg) => (
                      <th key={leg.id} className="min-w-[170px] border-b border-border p-3 text-left align-bottom">
                        <span className="block text-xs font-medium leading-snug">{getLegLabel(leg, waypointsById, "it")}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {legCapacity[leg.id] || 0}/{selectedVoyage?.booking_max_guests || 2} pax
                        </span>
                      </th>
                    ))}
                    <th className="min-w-[210px] border-b border-border p-3 text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      Azioni
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((request) => {
                    const profile = profilesById[request.profile_id];
                    return (
                      <tr key={request.id}>
                        <td className="sticky left-0 z-10 border-b border-border/60 bg-background/95 p-3 align-top">
                          <div className="font-medium">{profile?.name || profile?.email || request.profile_id}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {profile?.email || "No email"} · {request.party_size} pax
                          </div>
                          <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] ${getBookingStatusClass(request.status)}`}>
                            {getBookingStatusLabel(request.status, "it")}
                          </span>
                        </td>
                        {legs.map((leg) => {
                          const active = requestLegSet.has(`${request.id}:${leg.id}`);
                          return (
                            <td key={leg.id} className="border-b border-border/60 p-3 align-top">
                              {active ? (
                                <span className={`inline-flex min-w-[4rem] justify-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${getBookingStatusClass(request.status)}`}>
                                  {getBookingStatusShortLabel(request.status)}
                                </span>
                              ) : (
                                <span className="inline-flex min-w-[4rem] justify-center rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                                  -
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="border-b border-border/60 p-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            {request.status === "requested" || request.status === "waitlisted" ? (
                              <button
                                type="button"
                                onClick={() => void approveRequest(request.id)}
                                className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-foreground hover:text-accent"
                              >
                                <Check size={13} /> Approva
                              </button>
                            ) : null}
                            {!["cancelled", "rejected", "expired"].includes(request.status) ? (
                              <button
                                type="button"
                                onClick={() => void rejectRequest(request.id)}
                                className="glass-chip inline-flex items-center gap-1.5 px-3 py-2 text-xs text-destructive"
                              >
                                <X size={13} /> Rifiuta
                              </button>
                            ) : null}
                            <select
                              value={request.status}
                              onChange={(event) => void updateRequestStatus(request.id, event.target.value as VoyageBookingStatus)}
                              className="border border-border bg-background/80 px-2 py-2 text-xs focus:border-accent focus:outline-none"
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
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRequests.length === 0 && (
                    <tr>
                      <td colSpan={legs.length + 2} className="p-8 text-center text-sm text-muted-foreground">
                        Nessuna richiesta per questo filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
    </div>
  );
};

export default AdminVoyageBookings;
