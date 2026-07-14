import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarCheck, Check, Loader2, MessageSquare, Ship, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import BookingConfirmDialog from "@/components/booking/BookingConfirmDialog";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import UserBookingMatrix from "@/components/booking/UserBookingMatrix";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import { buildCandidateInfoPrefill, emptyCandidateInfo, type CandidateInfo } from "@/lib/booking-candidate-info";
import { perPersonDepositEur, shouldApplyContributionFixedMinimum, totalDepositEur } from "@/lib/booking-deposit";
import { startDepositPayment } from "@/lib/booking-payment";
import { updateBookingStatusWithRefund } from "@/lib/booking-refunds";
import { getBookingBriefingContent } from "@/lib/booking-briefings";
import {
  listMyParticipations,
  acceptParticipation,
  declineParticipation,
  type MyParticipation,
} from "@/lib/booking-participants";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  type BookableLeg,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingSettings,
  type BookingTask,
  type BookingTaskCompletion,
  type BookingVoyage,
  type BookingWaypoint,
  type VoyageBookingOccupancyRow,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getLegLabel,
  getLocalizedBookingVoyageName,
  isLegSelectable,
  isVoyageBookableNow,
} from "@/lib/booking-utils";

type RequestBookingResult = { booking_request_id: string; booking_status: BookingRequest["status"] };
type PlanChangeAction =
  | "accept_proposed_change"
  | "request_different_route"
  | "reject_proposed_change"
  | "cancel_with_full_refund";

type SupabaseError = { message: string } | null;
type SupabaseResponse = { data: unknown; error: SupabaseError };
type SupabaseQueryBuilder = PromiseLike<SupabaseResponse> & {
  select: (columns?: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  in: (column: string, values: unknown[]) => SupabaseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => SupabaseQueryBuilder;
  insert: (values: unknown) => SupabaseQueryBuilder;
  delete: () => SupabaseQueryBuilder;
};
type UntypedSupabase = {
  from: (table: string) => SupabaseQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResponse>;
};

const typedSupabase = supabase as unknown as UntypedSupabase;

const stringArrayFromMetadata = (metadata: Record<string, unknown> | null | undefined, key: string) => {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const stringFromMetadata = (metadata: Record<string, unknown> | null | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const UserBookings = () => {
  const { session, loading } = useAuth();
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const locale = lang === "it" ? "it-IT" : "en-US";
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voyages, setVoyages] = useState<BookingVoyage[]>([]);
  const [waypoints, setWaypoints] = useState<BookingWaypoint[]>([]);
  const [legs, setLegs] = useState<BookableLeg[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [requestLegs, setRequestLegs] = useState<BookingRequestLeg[]>([]);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings[]>([]);
  const [bookingTasks, setBookingTasks] = useState<BookingTask[]>([]);
  const [taskCompletions, setTaskCompletions] = useState<BookingTaskCompletion[]>([]);
  const [selectedVoyageId, setSelectedVoyageId] = useState<string>("");
  const [selectedLegIds, setSelectedLegIds] = useState<string[]>([]);
  const [partySize, setPartySize] = useState("1");
  const [message, setMessage] = useState("");
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [candidateInfoPrefill, setCandidateInfoPrefill] = useState<CandidateInfo>(emptyCandidateInfo);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [myParticipations, setMyParticipations] = useState<MyParticipation[]>([]);
  const [acceptTarget, setAcceptTarget] = useState<MyParticipation | null>(null);
  const [acceptCandidateInfo, setAcceptCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [acceptSubmitting, setAcceptSubmitting] = useState(false);
  const [planChangeMessages, setPlanChangeMessages] = useState<Record<string, string>>({});
  const [occupancy, setOccupancy] = useState<VoyageBookingOccupancyRow[]>([]);
  const [detailsRequestId, setDetailsRequestId] = useState<string | null>(null);
  const [bankTransfer, setBankTransfer] = useState<{ bookingRequestId: string; participantId?: string } | null>(
    null
  );
  const candidateInfoTouchedRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!session?.user.id) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const [voyagesRes, requestsRes, profileRes] = await Promise.all([
      typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,booking_contribution_per_nm_eur,start_date,end_date")
        .eq("booking_enabled", true)
        .eq("is_published", true)
        .order("start_date", { ascending: true, nullsFirst: false }),
      typedSupabase
        .from("voyage_booking_requests")
        .select("*")
        .eq("profile_id", session.user.id)
        .order("requested_at", { ascending: false }),
      typedSupabase
        .from("profiles")
        .select("preferred_language,secondary_language")
        .eq("id", session.user.id),
    ]);

    if (voyagesRes.error || requestsRes.error || profileRes.error) {
      toast.error(voyagesRes.error?.message || requestsRes.error?.message || profileRes.error?.message || "Unable to load bookings");
      setBusy(false);
      return;
    }

    let loadedVoyages = ((voyagesRes.data as BookingVoyage[] | null) || []);
    const loadedRequests = ((requestsRes.data as BookingRequest[] | null) || []);
    const profile = Array.isArray(profileRes.data) ? profileRes.data[0] as { preferred_language?: string | null; secondary_language?: string | null } | undefined : undefined;
    const latestReusableInfo = loadedRequests.find((request) => request.candidate_info)?.candidate_info as Partial<CandidateInfo> | null | undefined;
    const prefill = buildCandidateInfoPrefill({
      latestCandidateInfo: latestReusableInfo,
      preferredLanguage: profile?.preferred_language,
      secondaryLanguage: profile?.secondary_language,
    });
    setCandidateInfoPrefill(prefill);
    if (!candidateInfoTouchedRef.current) setCandidateInfo(prefill);
    const requestedVoyageIds = [...new Set(loadedRequests.map((request) => request.voyage_id))];
    const missingVoyageIds = requestedVoyageIds.filter((id) => !loadedVoyages.some((voyage) => voyage.id === id));
    if (missingVoyageIds.length) {
      const { data: archivedVoyages, error: archivedVoyagesError } = await typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,booking_contribution_per_nm_eur,start_date,end_date")
        .in("id", missingVoyageIds);
      if (archivedVoyagesError) {
        toast.error(archivedVoyagesError.message);
      } else {
        loadedVoyages = [...loadedVoyages, ...((archivedVoyages as BookingVoyage[] | null) || [])];
      }
    }

    const voyageIds = [...new Set([...loadedVoyages.map((v) => v.id), ...requestedVoyageIds])];
    const requestIds = loadedRequests.map((request) => request.id);

    const [legsRes, waypointsRes, requestLegsRes, settingsRes, tasksRes, completionsRes] = await Promise.all([
      voyageIds.length
        ? typedSupabase
            .from("voyage_bookable_legs")
            .select("*")
            .in("voyage_id", voyageIds)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      voyageIds.length
        ? typedSupabase
            .from("voyage_waypoints")
            .select("id,voyage_id,name,name_it,name_en,sort_order,date_start,date_end")
            .in("voyage_id", voyageIds)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_request_legs")
            .select("*")
            .in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      voyageIds.length
        ? typedSupabase
            .from("voyage_booking_settings")
            .select("*")
            .in("voyage_id", voyageIds)
        : Promise.resolve({ data: [], error: null }),
      voyageIds.length
        ? typedSupabase
            .from("voyage_booking_tasks")
            .select("*")
            .in("voyage_id", voyageIds)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_task_completions")
            .select("*")
            .in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (legsRes.error || waypointsRes.error || requestLegsRes.error || settingsRes.error || tasksRes.error || completionsRes.error) {
      toast.error(
        legsRes.error?.message ||
          waypointsRes.error?.message ||
          requestLegsRes.error?.message ||
          settingsRes.error?.message ||
          tasksRes.error?.message ||
          completionsRes.error?.message ||
          "Unable to load booking details"
      );
      setBusy(false);
      return;
    }

    setVoyages(loadedVoyages);
    setRequests(loadedRequests);
    setLegs(((legsRes.data as BookableLeg[] | null) || []));
    setWaypoints(((waypointsRes.data as BookingWaypoint[] | null) || []));
    setRequestLegs(((requestLegsRes.data as BookingRequestLeg[] | null) || []));
    setBookingSettings(((settingsRes.data as BookingSettings[] | null) || []));
    setBookingTasks(((tasksRes.data as BookingTask[] | null) || []));
    setTaskCompletions(((completionsRes.data as BookingTaskCompletion[] | null) || []));
    setSelectedVoyageId((current) => {
      const requestedVoyageId = searchParams.get("voyage");
      if (requestedVoyageId && loadedVoyages.some((voyage) => voyage.id === requestedVoyageId && isVoyageBookableNow(voyage))) {
        return requestedVoyageId;
      }
      if (current && loadedVoyages.some((voyage) => voyage.id === current && isVoyageBookableNow(voyage))) return current;
      return loadedVoyages.find(isVoyageBookableNow)?.id || "";
    });
    setBusy(false);
  }, [searchParams, session?.user.id]);

  useEffect(() => {
    if (!loading && session?.user.id) void loadData();
  }, [loadData, loading, session?.user.id]);

  const loadParticipations = useCallback(async () => {
    if (!session?.user.id) return;
    try {
      setMyParticipations(await listMyParticipations());
    } catch {
      /* non-fatal: the invites section just stays empty */
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!loading && session?.user.id) void loadParticipations();
  }, [loadParticipations, loading, session?.user.id]);

  const loadOccupancy = useCallback(async (voyageId: string) => {
    if (!voyageId) {
      setOccupancy([]);
      return;
    }
    const { data, error } = await typedSupabase.rpc("list_voyage_booking_occupancy", { _voyage_id: voyageId });
    if (error) {
      // Non-fatal: the matrix just shows no companion rows.
      setOccupancy([]);
      return;
    }
    setOccupancy((data as VoyageBookingOccupancyRow[] | null) || []);
  }, []);

  useEffect(() => {
    // Re-runs whenever `requests`/`requestLegs` refresh too, so occupancy stays in sync
    // after a submit/cancel/propose-change round-trip without threading a reload call
    // through every handler.
    if (!loading && session?.user.id && selectedVoyageId) void loadOccupancy(selectedVoyageId);
  }, [loadOccupancy, loading, session?.user.id, selectedVoyageId, requests, requestLegs]);

  const waypointsById = useMemo(
    () => Object.fromEntries(waypoints.map((waypoint) => [waypoint.id, waypoint])),
    [waypoints]
  );
  const voyagesById = useMemo(
    () => Object.fromEntries(voyages.map((voyage) => [voyage.id, voyage])),
    [voyages]
  );
  const bookableVoyages = useMemo(() => voyages.filter(isVoyageBookableNow), [voyages]);
  const legsById = useMemo(() => Object.fromEntries(legs.map((leg) => [leg.id, leg])), [legs]);
  const selectedVoyage = voyagesById[selectedVoyageId] || null;
  const selectedVoyageLegs = isVoyageBookableNow(selectedVoyage)
    ? legs.filter((leg) => leg.voyage_id === selectedVoyageId && isLegSelectable(leg))
    : [];
  const selectedContributionOptions = useMemo(
    () => ({
      contributionPerNmEur: selectedVoyage?.booking_contribution_per_nm_eur,
      fixedMinimumEur: shouldApplyContributionFixedMinimum(requests, selectedVoyageId) ? undefined : 0,
    }),
    [requests, selectedVoyage?.booking_contribution_per_nm_eur, selectedVoyageId],
  );

  // The matrix edits a single active request per voyage; with several active requests
  // (allowed server-side when their legs don't overlap) it targets the most recent one.
  const ownRequestForSelectedVoyage = useMemo(
    () =>
      requests
        .filter((request) => request.voyage_id === selectedVoyageId && !["cancelled", "rejected", "expired"].includes(request.status))
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())[0] || null,
    [requests, selectedVoyageId]
  );
  const ownRequestLegIdsForSelectedVoyage = useMemo(
    () =>
      ownRequestForSelectedVoyage
        ? requestLegs
            .filter((link) => link.booking_request_id === ownRequestForSelectedVoyage.id)
            .map((link) => link.bookable_leg_id)
        : [],
    [requestLegs, ownRequestForSelectedVoyage]
  );
  const companionRows = useMemo(() => occupancy.filter((row) => !row.is_own), [occupancy]);

  // Details modal: opened by clicking a booking's bar on the matrix. Keeps the matrix itself
  // clean and moves all the status/briefing/checklist/plan-change detail behind one click.
  const detailsRequest = detailsRequestId ? requests.find((request) => request.id === detailsRequestId) || null : null;
  const detailsVoyage = detailsRequest ? voyagesById[detailsRequest.voyage_id] : null;
  const detailsSettings = detailsRequest
    ? bookingSettings.find((item) => item.voyage_id === detailsRequest.voyage_id)
    : undefined;
  const detailsVoyageTasks = detailsRequest ? bookingTasks.filter((task) => task.voyage_id === detailsRequest.voyage_id) : [];
  const detailsCompletionSet = new Set(
    detailsRequest
      ? taskCompletions.filter((completion) => completion.booking_request_id === detailsRequest.id).map((completion) => completion.task_id)
      : []
  );
  const detailsPredepartureInfo = detailsSettings
    ? lang === "it"
      ? detailsSettings.predeparture_info_it || detailsSettings.predeparture_info_en
      : detailsSettings.predeparture_info_en || detailsSettings.predeparture_info_it
    : null;
  const detailsFirstBriefingContent = getBookingBriefingContent(detailsSettings, "first", lang);
  const detailsSecondBriefingContent = getBookingBriefingContent(detailsSettings, "second", lang);
  const detailsShowBriefings = detailsRequest?.status === "user_confirmed";
  const detailsTermsContent = detailsSettings
    ? lang === "it"
      ? detailsSettings.terms_content_it || detailsSettings.terms_content_en
      : detailsSettings.terms_content_en || detailsSettings.terms_content_it
    : null;
  const detailsLegLabels = detailsRequest
    ? requestLegs
        .filter((link) => link.booking_request_id === detailsRequest.id)
        .map((link) => legsById[link.bookable_leg_id])
        .filter(Boolean)
        .map((leg) => getLegLabel(leg, waypointsById, lang))
    : [];
  const detailsProposedLegLabels = detailsRequest
    ? stringArrayFromMetadata(detailsRequest.plan_change_metadata, "proposed_leg_ids")
        .map((legId) => legsById[legId])
        .filter(Boolean)
        .map((leg) => getLegLabel(leg, waypointsById, lang))
    : [];
  const detailsPlanChangeUserAction = detailsRequest
    ? stringFromMetadata(detailsRequest.plan_change_metadata, "user_response_action")
    : null;
  const detailsShowPendingPlanChange =
    detailsRequest?.plan_change_status === "pending_user_approval" &&
    !detailsPlanChangeUserAction &&
    detailsProposedLegLabels.length > 0;
  const detailsShowCounterWaiting =
    detailsRequest?.plan_change_status === "pending_user_approval" && detailsPlanChangeUserAction === "request_different_route";
  const detailsShowAwaitingAdminApproval = detailsRequest?.plan_change_status === "pending_admin_approval";
  const detailsAdminPlanMessage = detailsRequest
    ? stringFromMetadata(detailsRequest.plan_change_metadata, "admin_message") ||
      stringFromMetadata(detailsRequest.plan_change_metadata, "admin_note")
    : null;

  const validateBookingRequest = () => {
    if (!selectedVoyageId || selectedLegIds.length === 0) {
      toast.error(lang === "it" ? "Seleziona almeno una tratta." : "Select at least one leg.");
      return false;
    }
    if (!isVoyageBookableNow(selectedVoyage)) {
      toast.error(lang === "it" ? "Questo viaggio non è più aperto alle adesioni." : "This voyage is no longer open to join.");
      return false;
    }
    if (candidateInfo.motivation.trim().length < 20) {
      toast.error(
        lang === "it"
          ? "Scrivi qualche riga sul perche vorresti partecipare."
          : "Write a few lines about why you would like to join."
      );
      return false;
    }
    const parsedPartySize = Math.max(1, Number.parseInt(partySize, 10) || 1);
    const maxGuests = selectedVoyage?.booking_max_guests || 1;
    if (parsedPartySize > maxGuests) {
      toast.error(
        lang === "it"
          ? `Per questo viaggio puoi richiedere al massimo ${maxGuests} persone.`
          : `You can request at most ${maxGuests} people for this voyage.`
      );
      return false;
    }
    return true;
  };

  const openBookingConfirm = () => {
    if (!validateBookingRequest()) return;
    setConfirmOpen(true);
  };

  const submitRequest = async () => {
    if (!validateBookingRequest()) return;
    const parsedPartySize = Math.max(1, Number.parseInt(partySize, 10) || 1);
    setSaving(true);
    const { data, error } = await typedSupabase.rpc("request_voyage_booking", {
      _voyage_id: selectedVoyageId,
      _leg_ids: selectedLegIds,
      _party_size: parsedPartySize,
      _message: message,
      _candidate_info: candidateInfo,
    });
    if (error) {
      setSaving(false);
      if ((error as { code?: string }).code === "BK001") {
        toast.error(
          lang === "it"
            ? "Hai già aderito a una di queste tratte."
            : "You've already joined one of these legs."
        );
      } else {
        toast.error(error.message);
      }
      return;
    }
    const result = Array.isArray(data) ? (data[0] as RequestBookingResult | undefined) : undefined;
    toast.success(
      result?.booking_status === "waitlisted"
        ? lang === "it" ? "Posti pieni: sei in lista d'attesa." : "Fully booked: you are on the waiting list."
        : lang === "it" ? "Richiesta inviata." : "Request sent."
    );

    const bookingRequestId = result?.booking_request_id;

    // Multi-person bookings go to the participants page (add guests, choose who pays).
    if (bookingRequestId && parsedPartySize > 1) {
      navigate(`/bookings/${bookingRequestId}/participants`);
      return;
    }

    // Solo booking: kick off the Bunq voyage-contribution payment right away.
    if (bookingRequestId) {
      const payment = await startDepositPayment(bookingRequestId);
      if (payment.ok && "shareUrl" in payment) {
        // Leave the app to complete the payment on Bunq; state reset is unnecessary.
        window.location.href = payment.shareUrl;
        return;
      }
      if (!payment.ok && "notConfigured" in payment) {
        toast.info(
          lang === "it"
            ? "Adesione registrata. Il pagamento del contributo non è ancora attivo: ti invieremo il link a breve."
            : "You're in! Contribution payment is not active yet: we'll send you the link shortly."
        );
      } else if (!payment.ok) {
        toast.info(
          lang === "it"
            ? "Adesione registrata. Puoi completare il pagamento con bonifico."
            : "You're in! You can complete the payment by bank transfer."
        );
        setBankTransfer({ bookingRequestId });
      }
    }

    setSaving(false);
    setConfirmOpen(false);
    setSelectedLegIds([]);
    setMessage("");
    candidateInfoTouchedRef.current = false;
    setCandidateInfo(candidateInfoPrefill);
    await loadData();
  };

  const confirmBooking = async (requestId: string) => {
    setSaving(true);
    const { error } = await typedSupabase.rpc("confirm_voyage_booking", { _booking_request_id: requestId });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(lang === "it" ? "Partecipazione confermata." : "Participation confirmed.");
      await loadData();
    }
  };

  const cancelBooking = async (request: BookingRequest) => {
    if (!confirm(lang === "it" ? "Annullare questa partecipazione?" : "Cancel this participation?")) return;
    setSaving(true);
    const result = await updateBookingStatusWithRefund({
      bookingRequestId: request.id,
      status: "cancelled",
      trigger: request.plan_change_status === "pending_user_approval" ? "admin_plan_change_declined" : "user_cancelled",
    });
    setSaving(false);
    if (!result.ok) toast.error(result.error);
    else {
      const refundMessage =
        result.refundAmountEur > 0
          ? lang === "it"
            ? ` Rimborso automatico: EUR ${result.refundAmountEur.toFixed(2)}.`
            : ` Automatic refund: EUR ${result.refundAmountEur.toFixed(2)}.`
          : "";
      toast.success((lang === "it" ? "Partecipazione annullata." : "Participation cancelled.") + refundMessage);
      await loadData();
    }
  };

  const toggleTaskCompletion = async (requestId: string, taskId: string, completed: boolean) => {
    setSaving(true);
    const { error } = completed
      ? await typedSupabase
          .from("voyage_booking_task_completions")
          .delete()
          .eq("booking_request_id", requestId)
          .eq("task_id", taskId)
      : await typedSupabase.from("voyage_booking_task_completions").insert({
          booking_request_id: requestId,
          task_id: taskId,
        });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await loadData();
  };

  /** Traveller drags their own bar on the matrix: opens an admin-approval proposal, mirroring resizeBookingLegs on the admin Gantt. */
  const proposeLegChange = async (requestId: string, proposedLegIds: string[]) => {
    setSaving(true);
    const { error } = await typedSupabase.rpc("user_propose_voyage_booking_legs", {
      _booking_request_id: requestId,
      _proposed_leg_ids: proposedLegIds,
      _user_message: null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(lang === "it" ? "Richiesta di modifica inviata al team." : "Change request sent to the team.");
    await loadData();
  };

  const respondToPlanChange = async (requestId: string, action: PlanChangeAction) => {
    if (action === "cancel_with_full_refund") {
      if (!confirm(lang === "it" ? "Annullare questa partecipazione con rimborso completo?" : "Cancel this participation with a full refund?")) return;
      setSaving(true);
      const result = await updateBookingStatusWithRefund({
        bookingRequestId: requestId,
        status: "cancelled",
        trigger: "admin_plan_change_declined",
      });
      setSaving(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const refundMessage =
        result.refundAmountEur > 0
          ? lang === "it"
            ? ` Rimborso automatico: EUR ${result.refundAmountEur.toFixed(2)}.`
            : ` Automatic refund: EUR ${result.refundAmountEur.toFixed(2)}.`
          : "";
      toast.success((lang === "it" ? "Richiesta annullata." : "Booking cancelled.") + refundMessage);
      setPlanChangeMessages((current) => ({ ...current, [requestId]: "" }));
      await loadData();
      return;
    }

    setSaving(true);
    const { error } = await typedSupabase.rpc("respond_voyage_booking_plan_change", {
      _booking_request_id: requestId,
      _action: action,
      _message: planChangeMessages[requestId]?.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const successMessage: Record<PlanChangeAction, string> = {
      accept_proposed_change: lang === "it" ? "Proposta accettata." : "Proposal accepted.",
      request_different_route: lang === "it" ? "Controproposta inviata." : "Counterproposal sent.",
      reject_proposed_change: lang === "it" ? "Proposta rifiutata." : "Proposal declined.",
      cancel_with_full_refund: lang === "it" ? "Richiesta annullata." : "Booking cancelled.",
    };
    toast.success(successMessage[action]);
    setPlanChangeMessages((current) => ({ ...current, [requestId]: "" }));
    await loadData();
  };

  const handleAcceptConfirm = async () => {
    if (!acceptTarget) return;
    if (acceptCandidateInfo.motivation.trim().length < 20) {
      toast.error(
        lang === "it"
          ? "Scrivi qualche riga sul perche vorresti partecipare."
          : "Write a few lines about why you would like to join."
      );
      return;
    }
    setAcceptSubmitting(true);
    try {
      await acceptParticipation(acceptTarget.participant_id, acceptCandidateInfo);
      // Guests paying their own share are sent straight to Bunq.
      if (acceptTarget.requires_payment) {
        const payment = await startDepositPayment(acceptTarget.booking_request_id, acceptTarget.participant_id);
        if (payment.ok && "shareUrl" in payment) {
          window.location.href = payment.shareUrl;
          return;
        }
        if (!payment.ok && "notConfigured" in payment) {
          toast.info(
            lang === "it"
              ? "Invito accettato. Il pagamento del contributo non è ancora attivo: ti invieremo il link a breve."
              : "Invitation accepted. Contribution payment is not active yet: we'll send you the link shortly."
          );
        } else if (!payment.ok) {
          toast.info(
            lang === "it"
              ? "Invito accettato. Puoi completare il pagamento con bonifico."
              : "Invitation accepted. You can complete the payment by bank transfer."
          );
          setBankTransfer({
            bookingRequestId: acceptTarget.booking_request_id,
            participantId: acceptTarget.participant_id,
          });
        }
      } else {
        toast.success(lang === "it" ? "Invito accettato." : "Invitation accepted.");
      }
      setAcceptTarget(null);
      setAcceptCandidateInfo(candidateInfoPrefill);
      await loadParticipations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    } finally {
      setAcceptSubmitting(false);
    }
  };

  const handleDecline = async (participantId: string) => {
    if (!confirm(lang === "it" ? "Rifiutare questo invito?" : "Decline this invitation?")) return;
    try {
      await declineParticipation(participantId);
      toast.success(lang === "it" ? "Invito rifiutato." : "Invitation declined.");
      await loadParticipations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  const participationVoyageName = (p: MyParticipation) =>
    (lang === "it" ? p.voyage_name_it : p.voyage_name_en) || p.voyage_name || (lang === "it" ? "Viaggio" : "Voyage");

  const pendingParticipations = myParticipations.filter((p) => p.status === "pending");

  if (loading) {
    return <div className="min-h-screen pt-28 text-center text-sm text-muted-foreground">Loading...</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: "/bookings" }} replace />;
  }

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="editorial-heading text-4xl md:text-5xl">
                {lang === "it" ? "I tuoi imbarchi" : "Your bookings"}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {lang === "it"
                  ? "Monitora richieste, conferme, tratte e informazioni operative dei viaggi programmati."
                  : "Track requests, confirmations, legs, and operational information for scheduled voyages."}
              </p>
            </div>
            <CalendarCheck className="text-accent" size={26} />
          </div>
        </section>

        {pendingParticipations.length > 0 && (
          <section className="glass-panel rounded-[30px] border border-accent/40 p-5 md:p-6">
            <h2 className="editorial-heading mb-4 text-2xl">
              {lang === "it" ? "Inviti in attesa" : "Pending invitations"}
            </h2>
            <div className="space-y-3">
              {pendingParticipations.map((p) => (
                <div
                  key={p.participant_id}
                  className="flex flex-col gap-3 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{participationVoyageName(p)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.requires_payment
                        ? lang === "it"
                          ? "Accetta le condizioni e versa la tua quota di contributo per confermare la partecipazione."
                          : "Accept the terms and pay your contribution share to confirm participation."
                        : lang === "it"
                          ? "Accetta le condizioni per confermare la partecipazione."
                          : "Accept the terms to confirm your participation."}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAcceptCandidateInfo(candidateInfoPrefill);
                        setAcceptTarget(p);
                      }}
                      className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                    >
                      <Check size={14} /> {lang === "it" ? "Accetta" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecline(p.participant_id)}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} /> {lang === "it" ? "Rifiuta" : "Decline"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <BookingConfirmDialog
          open={acceptTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setAcceptTarget(null);
              setAcceptCandidateInfo(candidateInfoPrefill);
            }
          }}
          lang={lang}
          voyageName={acceptTarget ? participationVoyageName(acceptTarget) : undefined}
          partySize={1}
          candidateInfo={acceptCandidateInfo}
          onCandidateInfoChange={setAcceptCandidateInfo}
          requiresPayment={acceptTarget?.requires_payment ?? false}
          submitting={acceptSubmitting}
          onConfirm={() => void handleAcceptConfirm()}
        />

        <BankTransferDialog
          open={bankTransfer !== null}
          onOpenChange={(open) => {
            if (!open) setBankTransfer(null);
          }}
          bookingRequestId={bankTransfer?.bookingRequestId ?? ""}
          participantId={bankTransfer?.participantId}
          onConfirmed={() => {
            setBankTransfer(null);
            void loadData();
            void loadParticipations();
          }}
        />

        {busy ? (
          <div className="glass-panel rounded-[30px] p-8 text-muted-foreground">
            <Loader2 className="mr-2 inline animate-spin" size={16} /> Loading bookings...
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="glass-panel rounded-[30px] p-5 md:p-6">
              <div className="mb-5 flex items-center gap-3">
                <Ship size={18} className="text-accent" />
                <h2 className="editorial-heading text-2xl">
                  {lang === "it" ? "Richiedi imbarco" : "Request a berth"}
                </h2>
              </div>
              {bookableVoyages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {lang === "it" ? "Nessun viaggio aperto alle adesioni al momento." : "No voyages open to join right now."}
                </p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Voyage</label>
                    <select
                      value={selectedVoyageId}
                      onChange={(event) => {
                        setSelectedVoyageId(event.target.value);
                        setSelectedLegIds([]);
                      }}
                      className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    >
                      {bookableVoyages.map((voyage) => (
                        <option key={voyage.id} value={voyage.id}>
                          {getLocalizedBookingVoyageName(voyage, lang)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      {lang === "it" ? "Tratte" : "Legs"}
                    </p>
                    {selectedVoyageLegs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {lang === "it"
                          ? "Le tratte non sono ancora state generate."
                          : "Legs have not been generated yet."}
                      </p>
                    ) : (
                      <UserBookingMatrix
                        lang={lang}
                        legs={selectedVoyageLegs}
                        waypointsById={waypointsById}
                        saving={saving}
                        ownRequest={ownRequestForSelectedVoyage}
                        ownRequestLegIds={ownRequestLegIdsForSelectedVoyage}
                        companions={companionRows}
                        draftLegIds={selectedLegIds}
                        onDraftLegIdsChange={setSelectedLegIds}
                        onSubmitDraft={openBookingConfirm}
                        onProposeChange={(requestId, proposedLegIds) => void proposeLegChange(requestId, proposedLegIds)}
                        onOpenOwnRequest={(request) => setDetailsRequestId(request.id)}
                      />
                    )}
                  </div>

                  {!ownRequestForSelectedVoyage && (
                    <>
                      <div className="grid grid-cols-[120px_1fr] gap-3">
                        <div>
                          <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                            Persone
                          </label>
                          <input
                            type="number"
                            min="1"
                            max={selectedVoyage?.booking_max_guests || undefined}
                            value={partySize}
                            onChange={(event) => setPartySize(event.target.value)}
                            className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                            Note
                          </label>
                          <input
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
                            placeholder={lang === "it" ? "Messaggio opzionale" : "Optional message"}
                          />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-border/70 bg-background/40 p-4">
                        <div className="mb-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                            {lang === "it" ? "Dicci di te" : "Tell us about you"}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {lang === "it"
                              ? "Ci serve per valutare incastri, sicurezza e vita a bordo. Evitiamo testo libero dove bastano scelte rapide."
                              : "This helps us evaluate fit, safety and life aboard. We avoid free text where quick choices are enough."}
                          </p>
                        </div>
                        <CandidateInfoForm
                          value={candidateInfo}
                          onChange={(nextInfo) => {
                            candidateInfoTouchedRef.current = true;
                            setCandidateInfo(nextInfo);
                          }}
                          lang={lang}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

            <BookingConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              lang={lang}
              voyageName={selectedVoyage ? getLocalizedBookingVoyageName(selectedVoyage, lang) : undefined}
              legLabels={selectedLegIds
                .map((id) => legsById[id])
                .filter(Boolean)
                .map((leg) => getLegLabel(leg, waypointsById, lang))}
              legs={selectedLegIds.map((id) => legsById[id]).filter(Boolean)}
              partySize={Math.max(1, Number.parseInt(partySize, 10) || 1)}
              message={message}
              requiresPayment
              depositPerPersonEur={perPersonDepositEur(
                selectedLegIds.map((id) => legsById[id]).filter(Boolean),
                selectedContributionOptions
              )}
              depositTotalEur={totalDepositEur(
                selectedLegIds.map((id) => legsById[id]).filter(Boolean),
                Math.max(1, Number.parseInt(partySize, 10) || 1),
                selectedContributionOptions
              )}
              contributionPerNmEur={selectedVoyage?.booking_contribution_per_nm_eur}
              submitting={saving}
              onConfirm={() => void submitRequest()}
            />

            <Dialog
              open={detailsRequestId !== null}
              onOpenChange={(open) => {
                if (!open) setDetailsRequestId(null);
              }}
            >
              <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-[24px] border-border bg-background p-5">
                {detailsRequest && (
                  <>
                    <DialogHeader>
                      <DialogTitle className="font-serif text-xl">
                        {getLocalizedBookingVoyageName(detailsVoyage, lang) || detailsRequest.voyage_id}
                      </DialogTitle>
                      <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                        {formatBookingDate(detailsRequest.requested_at, locale)} · {detailsRequest.party_size} pax
                        {detailsRequest.is_crew && (
                          <span className="inline-flex items-center rounded-full border border-indigo-300/70 bg-indigo-100/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-indigo-800">
                            {lang === "it" ? "Equipaggio" : "Crew"}
                          </span>
                        )}
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${getBookingStatusClass(detailsRequest.status)}`}>
                          {["requested", "waitlisted"].includes(detailsRequest.status)
                            ? lang === "it"
                              ? "In attesa di approvazione"
                              : "Pending approval"
                            : getBookingStatusLabel(detailsRequest.status, lang)}
                        </span>
                      </DialogDescription>
                    </DialogHeader>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {detailsLegLabels.map((label) => (
                        <span key={label} className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                          {label}
                        </span>
                      ))}
                    </div>
                    {detailsRequest.message && <p className="mt-3 text-sm text-muted-foreground">{detailsRequest.message}</p>}

                    {detailsShowAwaitingAdminApproval && (
                      <div className="mt-4 rounded-[18px] border border-sky-300/60 bg-sky-50/70 p-3 text-sm text-sky-950">
                        {lang === "it"
                          ? "La tua richiesta di modifica tratte è in attesa di approvazione da parte del team."
                          : "Your leg-change request is pending approval from the team."}
                      </div>
                    )}

                    {detailsShowPendingPlanChange && (
                      <div className="mt-4 rounded-[18px] border border-sky-300/60 bg-sky-50/70 p-3 text-sm text-sky-950">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="mt-0.5 shrink-0 text-sky-700" size={16} />
                          <div>
                            <p className="font-semibold">
                              {lang === "it" ? "Proposta di modifica tratte" : "Route change proposal"}
                            </p>
                            {detailsAdminPlanMessage && <p className="mt-1 whitespace-pre-line text-sky-900/80">{detailsAdminPlanMessage}</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {detailsProposedLegLabels.map((label) => (
                            <span key={label} className="rounded-full border border-sky-300/70 bg-white/65 px-3 py-1 text-xs text-sky-900">
                              {label}
                            </span>
                          ))}
                        </div>
                        <textarea
                          value={planChangeMessages[detailsRequest.id] || ""}
                          onChange={(event) => setPlanChangeMessages((current) => ({ ...current, [detailsRequest.id]: event.target.value }))}
                          rows={3}
                          className="mt-3 w-full resize-y rounded-2xl border border-sky-200 bg-white/80 px-3 py-2 text-sm text-foreground focus:border-sky-500 focus:outline-none"
                          placeholder={lang === "it" ? "Messaggio opzionale per il team" : "Optional message for the team"}
                        />
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "accept_proposed_change")}
                            disabled={saving}
                            className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Accetta" : "Accept"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "request_different_route")}
                            disabled={saving}
                            className="rounded-full border border-sky-300 bg-white/70 px-3 py-2 text-xs font-semibold text-sky-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Controproponi" : "Counter"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "reject_proposed_change")}
                            disabled={saving}
                            className="rounded-full border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Rifiuta" : "Decline"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "cancel_with_full_refund")}
                            disabled={saving}
                            className="rounded-full border border-red-300 bg-red-100 px-3 py-2 text-xs font-semibold text-red-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Annulla" : "Cancel"}
                          </button>
                        </div>
                      </div>
                    )}
                    {detailsShowCounterWaiting && (
                      <div className="mt-4 rounded-[18px] border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950">
                        {lang === "it"
                          ? "Controproposta inviata: il team la sta revisionando."
                          : "Counterproposal sent: the team is reviewing it."}
                      </div>
                    )}
                    {(detailsPredepartureInfo || detailsShowBriefings || detailsTermsContent || detailsVoyageTasks.length > 0) && (
                      <div className="mt-4 space-y-3 rounded-[18px] border border-border/70 bg-background/45 p-3">
                        {detailsPredepartureInfo && (
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                              {lang === "it" ? "Info prepartenza" : "Predeparture info"}
                            </p>
                            <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{detailsPredepartureInfo}</p>
                          </div>
                        )}
                        {detailsShowBriefings && (
                          <div className="space-y-3">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                              {lang === "it" ? "Mail briefing" : "Briefing emails"}
                            </p>
                            <div className="rounded-[16px] border border-border/70 bg-background/55 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                {lang === "it" ? "1. Prima mail di briefing" : "1. First briefing email"}
                              </p>
                              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{detailsFirstBriefingContent}</p>
                            </div>
                            <div className="rounded-[16px] border border-border/70 bg-background/55 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                {lang === "it" ? "2. Seconda mail operativa" : "2. Second operational email"}
                              </p>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-[14px] border border-border/70 bg-white/55 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Type L</p>
                                  <div className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/80">
                                    <span className="h-2.5 w-2.5 rounded-full border border-foreground/70" />
                                    <span className="h-2.5 w-2.5 rounded-full border border-foreground/70" />
                                    <span className="h-2.5 w-2.5 rounded-full border border-foreground/70" />
                                  </div>
                                </div>
                                <div className="rounded-[14px] border border-border/70 bg-white/55 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Type F</p>
                                  <div className="mt-2 flex h-12 items-center justify-center rounded-xl border border-border/60 bg-background/80">
                                    <div className="flex h-9 w-9 items-center justify-center gap-3 rounded-full border-2 border-foreground/70">
                                      <span className="h-2.5 w-2.5 rounded-full bg-foreground/70" />
                                      <span className="h-2.5 w-2.5 rounded-full bg-foreground/70" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{detailsSecondBriefingContent}</p>
                            </div>
                          </div>
                        )}
                        {detailsTermsContent && (
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                              {lang === "it" ? "Note operative" : "Operational notes"}
                            </p>
                            <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{detailsTermsContent}</p>
                          </div>
                        )}
                        {detailsVoyageTasks.length > 0 && !detailsRequest.is_crew && (
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                              {lang === "it" ? "Checklist" : "Checklist"}
                            </p>
                            <div className="mt-2 space-y-2">
                              {detailsVoyageTasks.map((task) => {
                                const completed = detailsCompletionSet.has(task.id);
                                const label = lang === "it"
                                  ? task.title_it || task.title_en
                                  : task.title_en || task.title_it;
                                return (
                                  <label key={task.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={completed}
                                      disabled={saving || ["cancelled", "rejected", "expired"].includes(detailsRequest.status)}
                                      onChange={() => void toggleTaskCompletion(detailsRequest.id, task.id, completed)}
                                      className="mt-1 h-4 w-4 accent-[hsl(var(--accent))]"
                                    />
                                    <span>
                                      {label}
                                      {task.required && <span className="ml-2 text-[11px] uppercase tracking-[0.18em] text-accent">required</span>}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detailsRequest.status === "admin_approved" && (
                        <button
                          type="button"
                          onClick={() => void confirmBooking(detailsRequest.id)}
                          className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:text-accent"
                        >
                          <Check size={14} /> {lang === "it" ? "Conferma" : "Confirm"}
                        </button>
                      )}
                      {["requested", "waitlisted", "admin_approved", "user_confirmed"].includes(detailsRequest.status) && (
                        <button
                          type="button"
                          onClick={() => {
                            void cancelBooking(detailsRequest);
                            setDetailsRequestId(null);
                          }}
                          className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-destructive"
                        >
                          <X size={14} /> {lang === "it" ? "Annulla" : "Cancel"}
                        </button>
                      )}
                      {detailsVoyage && (
                        <Link to="/voyages" className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                          {lang === "it" ? "Vedi viaggi" : "View voyages"}
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserBookings;
