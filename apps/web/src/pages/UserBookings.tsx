import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Bell, BellOff, CalendarCheck, Check, CreditCard, Hourglass, Loader2, MessageSquare, Ship, Users, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import BookingConfirmDialog from "@/components/booking/BookingConfirmDialog";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import PaymentMethodDialog from "@/components/booking/PaymentMethodDialog";
import ContributionTrustNote from "@/components/booking/ContributionTrustNote";
import UserBookingMatrix from "@/components/booking/UserBookingMatrix";
import VoyageLiveWidget from "@/components/voyage/VoyageLiveWidget";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CandidateInfoForm from "@/components/booking/CandidateInfoForm";
import {
  buildCandidateInfoPrefill,
  emptyCandidateInfo,
  getCandidateInfoValidationError,
  type CandidateInfo,
} from "@/lib/booking-candidate-info";
import {
  buildBookingApplicationDraft,
  clearCloudBookingApplicationDraft,
  clearLocalBookingApplicationDraft,
  isBookingApplicationDraftEmpty,
  loadBookingApplicationDraft,
  saveCloudBookingApplicationDraft,
  saveLocalBookingApplicationDraft,
} from "@/lib/booking-application-draft";
import {
  contributionFixedMinimumEur,
  formatDepositEur,
  legDepositEur,
  perPersonDepositEur,
  shouldApplyContributionFixedMinimum,
  totalDepositEur,
} from "@/lib/booking-deposit";
import { settleBookingIfZeroDue, startDepositPayment } from "@/lib/booking-payment";
import { updateBookingStatusWithRefund } from "@/lib/booking-refunds";
import {
  acceptContributionCounter,
  applyVoyageBookingWithProposal,
  getWorkawayFileSignedUrl,
  uploadWorkawayProposalFiles,
} from "@/lib/booking-proposal-apply";
import {
  contributionProposalKind,
  emptyContributionProposal,
  toApplyWithProposalPayload,
  type ContributionProposal,
} from "@/lib/booking-workaway-proposal";
import { getBookingBriefingContent } from "@/lib/booking-briefings";
import {
  listMyParticipations,
  acceptParticipation,
  declineParticipation,
  type MyParticipation,
  getBookingPartyOverview,
  dropUnpaidGuestShare,
  type BookingPartyMember,
} from "@/lib/booking-participants";
import BookingPartyPanel from "@/components/booking/BookingPartyPanel";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  type BookableLeg,
  type BookingContributionProposal,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingSettings,
  type BookingTask,
  type BookingTaskCompletion,
  type BookingVoyage,
  type BookingWaypoint,
  type VoyageBookingOccupancyRow,
  type WorkawayRole,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getLegLabel,
  getLocalizedBookingVoyageName,
  isLegSelectable,
  isVoyageBookableNow,
} from "@/lib/booking-utils";

type RequestBookingResult = { booking_request_id: string; booking_status: BookingRequest["status"] };
type VoyageAvailabilityWatch = {
  id: string;
  profile_id: string;
  voyage_id: string | null;
  leg_ids: string[];
  scope: "all_bookable_voyages" | "voyage_availability";
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  last_notified_at: string | null;
};
type PlanChangeAction =
  | "accept_proposed_change"
  | "request_different_route"
  | "reject_proposed_change"
  | "cancel_with_full_refund"
  | "acknowledge_delay";

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

const boolFromMetadata = (metadata: Record<string, unknown> | null | undefined, key: string) => {
  const value = metadata?.[key];
  return value === true || value === "true";
};

const UserBookings = () => {
  const { session, loading } = useAuth();
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locale = lang === "it" ? "it-IT" : "en-US";
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voyages, setVoyages] = useState<BookingVoyage[]>([]);
  const [waypoints, setWaypoints] = useState<BookingWaypoint[]>([]);
  const [legs, setLegs] = useState<BookableLeg[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [requestLegs, setRequestLegs] = useState<BookingRequestLeg[]>([]);
  const [paidDepositRequestIds, setPaidDepositRequestIds] = useState<Set<string>>(() => new Set());
  /** Sum of paid deposits (EUR) per booking request, used to show the outstanding balance. */
  const [paidEurByRequestId, setPaidEurByRequestId] = useState<Record<string, number>>({});
  const [bookingSettings, setBookingSettings] = useState<BookingSettings[]>([]);
  const [bookingTasks, setBookingTasks] = useState<BookingTask[]>([]);
  const [taskCompletions, setTaskCompletions] = useState<BookingTaskCompletion[]>([]);
  const [availabilityWatches, setAvailabilityWatches] = useState<VoyageAvailabilityWatch[]>([]);
  const [selectedVoyageId, setSelectedVoyageId] = useState<string>("");
  const [selectedLegIds, setSelectedLegIds] = useState<string[]>([]);
  const [partySize, setPartySize] = useState("1");
  const [message, setMessage] = useState("");
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [candidateInfoPrefill, setCandidateInfoPrefill] = useState<CandidateInfo>(emptyCandidateInfo);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // One negotiation per application, run by the booker for the whole party — same contract as
  // the logbook map flow: the figures are per person and guests inherit the agreed amount.
  const [proposal, setProposal] = useState<ContributionProposal>(emptyContributionProposal);
  const [proposalCvFile, setProposalCvFile] = useState<File | null>(null);
  const [proposalPortfolioFile, setProposalPortfolioFile] = useState<File | null>(null);
  const [workawayRoles, setWorkawayRoles] = useState<WorkawayRole[]>([]);
  const [myParticipations, setMyParticipations] = useState<MyParticipation[]>([]);
  const [partyMembers, setPartyMembers] = useState<BookingPartyMember[]>([]);
  const [droppingParticipantId, setDroppingParticipantId] = useState<string | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<MyParticipation | null>(null);
  const [acceptCandidateInfo, setAcceptCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [acceptSubmitting, setAcceptSubmitting] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<{
    bookingRequestId: string;
    participantId?: string;
    amountEur?: number;
    phase?: "deposit" | "balance";
  } | null>(null);
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [reactivatingRequestId, setReactivatingRequestId] = useState<string | null>(null);
  const [planChangeMessages, setPlanChangeMessages] = useState<Record<string, string>>({});
  const [contributionProposals, setContributionProposals] = useState<BookingContributionProposal[]>([]);
  const [contributionCounterMessages, setContributionCounterMessages] = useState<Record<string, string>>({});
  const [contributionCounterSaving, setContributionCounterSaving] = useState(false);
  const [retryCvFile, setRetryCvFile] = useState<File | null>(null);
  const [retryPortfolioFile, setRetryPortfolioFile] = useState<File | null>(null);
  const [retryUploadSaving, setRetryUploadSaving] = useState(false);
  const [occupancy, setOccupancy] = useState<VoyageBookingOccupancyRow[]>([]);
  const [detailsRequestId, setDetailsRequestId] = useState<string | null>(null);
  const [bankTransfer, setBankTransfer] = useState<{ bookingRequestId: string; participantId?: string } | null>(
    null
  );
  const candidateInfoTouchedRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const selectedVoyageIdRef = useRef("");

  useEffect(() => {
    selectedVoyageIdRef.current = selectedVoyageId;
  }, [selectedVoyageId]);

  const loadData = useCallback(async () => {
    setBusy(true);
    const [voyagesRes, requestsRes, profileRes, watchesRes] = await Promise.all([
      typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,booking_contribution_per_nm_eur,start_date,end_date")
        .eq("booking_enabled", true)
        .eq("is_published", true)
        .order("start_date", { ascending: true, nullsFirst: false }),
      session?.user.id
        ? typedSupabase
            .from("voyage_booking_requests")
            .select("*")
            .eq("profile_id", session.user.id)
            .order("requested_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      session?.user.id
        ? typedSupabase
            .from("profiles")
            .select("preferred_language,secondary_language")
            .eq("id", session.user.id)
        : Promise.resolve({ data: [], error: null }),
      session?.user.id
        ? typedSupabase.rpc("list_my_voyage_availability_watches")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (voyagesRes.error || requestsRes.error || profileRes.error || watchesRes.error) {
      const loadErrorDetail =
        voyagesRes.error?.message || requestsRes.error?.message || profileRes.error?.message || watchesRes.error?.message;
      toast.error(
        lang === "it"
          ? `Non è stato possibile caricare le tue prenotazioni. Riprova più tardi.${loadErrorDetail ? ` (${loadErrorDetail})` : ""}`
          : `Unable to load your bookings. Please try again later.${loadErrorDetail ? ` (${loadErrorDetail})` : ""}`
      );
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
    if (!candidateInfoTouchedRef.current && !draftHydratedRef.current) setCandidateInfo(prefill);
    const requestedVoyageIds = [...new Set(loadedRequests.map((request) => request.voyage_id))];
    const missingVoyageIds = requestedVoyageIds.filter((id) => !loadedVoyages.some((voyage) => voyage.id === id));
    if (missingVoyageIds.length) {
      const { data: archivedVoyages, error: archivedVoyagesError } = await typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,booking_contribution_per_nm_eur,start_date,end_date")
        .in("id", missingVoyageIds);
      if (archivedVoyagesError) {
        toast.error(
          lang === "it"
            ? `Non è stato possibile caricare alcuni viaggi passati. (${archivedVoyagesError.message})`
            : `Unable to load some past voyages. (${archivedVoyagesError.message})`
        );
      } else {
        loadedVoyages = [...loadedVoyages, ...((archivedVoyages as BookingVoyage[] | null) || [])];
      }
    }

    const voyageIds = [...new Set([...loadedVoyages.map((v) => v.id), ...requestedVoyageIds])];
    const requestIds = loadedRequests.map((request) => request.id);

    const [legsRes, waypointsRes, requestLegsRes, settingsRes, tasksRes, completionsRes, depositsRes, contributionProposalsRes] = await Promise.all([
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
        ? session?.user.id
          ? typedSupabase
              .from("voyage_booking_settings")
              .select("*")
              .in("voyage_id", voyageIds)
          : Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: [], error: null }),
      voyageIds.length
        ? session?.user.id
          ? typedSupabase
              .from("voyage_booking_tasks")
              .select("*")
              .in("voyage_id", voyageIds)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_task_completions")
            .select("*")
            .in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_deposits")
            .select("booking_request_id,status,amount_cents")
            .in("booking_request_id", requestIds)
            .eq("status", "paid")
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_contribution_proposals")
            .select("*")
            .in("booking_request_id", requestIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (legsRes.error || waypointsRes.error || requestLegsRes.error || settingsRes.error || tasksRes.error || completionsRes.error || depositsRes.error || contributionProposalsRes.error) {
      const detailsErrorDetail =
        legsRes.error?.message ||
        waypointsRes.error?.message ||
        requestLegsRes.error?.message ||
        settingsRes.error?.message ||
        tasksRes.error?.message ||
        completionsRes.error?.message ||
        depositsRes.error?.message ||
        contributionProposalsRes.error?.message;
      toast.error(
        lang === "it"
          ? `Non è stato possibile caricare i dettagli delle prenotazioni. Riprova più tardi.${detailsErrorDetail ? ` (${detailsErrorDetail})` : ""}`
          : `Unable to load booking details. Please try again later.${detailsErrorDetail ? ` (${detailsErrorDetail})` : ""}`
      );
      setBusy(false);
      return;
    }

    setVoyages(loadedVoyages);
    setRequests(loadedRequests);
    setLegs(((legsRes.data as BookableLeg[] | null) || []));
    setWaypoints(((waypointsRes.data as BookingWaypoint[] | null) || []));
    setRequestLegs(((requestLegsRes.data as BookingRequestLeg[] | null) || []));
    setContributionProposals(((contributionProposalsRes.data as BookingContributionProposal[] | null) || []));
    const paidDeposits = ((depositsRes.data as { booking_request_id: string; amount_cents: number }[] | null) || []);
    setPaidDepositRequestIds(new Set(paidDeposits.map((deposit) => deposit.booking_request_id)));
    setPaidEurByRequestId(
      paidDeposits.reduce<Record<string, number>>((acc, deposit) => {
        acc[deposit.booking_request_id] = (acc[deposit.booking_request_id] ?? 0) + deposit.amount_cents / 100;
        return acc;
      }, {})
    );
    setBookingSettings(((settingsRes.data as BookingSettings[] | null) || []));
    setBookingTasks(((tasksRes.data as BookingTask[] | null) || []));
    setTaskCompletions(((completionsRes.data as BookingTaskCompletion[] | null) || []));
    setAvailabilityWatches(((watchesRes.data as VoyageAvailabilityWatch[] | null) || []));
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
    if (!loading) void loadData();
  }, [loadData, loading, session?.user.id]);

  useEffect(() => {
    draftHydratedRef.current = false;
    candidateInfoTouchedRef.current = false;
  }, [selectedVoyageId, session?.user.id]);

  useEffect(() => {
    if (loading || busy || !selectedVoyageId) return;
    let cancelled = false;

    void (async () => {
      try {
        const draft = await loadBookingApplicationDraft(selectedVoyageId, session?.user.id);
        if (cancelled || selectedVoyageIdRef.current !== selectedVoyageId) return;
        if (draft) {
          setSelectedLegIds(draft.selectedLegIds.filter((legId) => legs.some((leg) => leg.id === legId && leg.voyage_id === selectedVoyageId)));
          setPartySize(draft.partySize);
          setMessage(draft.message);
          setCandidateInfo(draft.candidateInfo);
          candidateInfoTouchedRef.current = true;
        } else if (!candidateInfoTouchedRef.current) {
          setSelectedLegIds([]);
          setPartySize("1");
          setMessage("");
          setCandidateInfo(candidateInfoPrefill);
        }
      } catch (error) {
        console.error("Failed to load booking draft", error);
      } finally {
        if (!cancelled) draftHydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [busy, candidateInfoPrefill, legs, loading, selectedVoyageId, session?.user.id]);

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

  /** Who else is on the booking currently open, and where each of them stands with their share. */
  const loadPartyMembers = useCallback(async (bookingRequestId: string | null) => {
    if (!bookingRequestId) {
      setPartyMembers([]);
      return;
    }
    try {
      setPartyMembers(await getBookingPartyOverview(bookingRequestId));
    } catch {
      /* non-fatal: the party panel just stays hidden */
      setPartyMembers([]);
    }
  }, []);

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
  /** Voyages the traveller is actually on, so the live widget only tracks their own. */
  const bookedVoyageIds = useMemo(
    () => [...new Set(requests.map((request) => request.voyage_id))],
    [requests]
  );
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

  const selectedVoyageSettings = useMemo(
    () => bookingSettings.find((item) => item.voyage_id === selectedVoyageId) ?? null,
    [bookingSettings, selectedVoyageId],
  );
  const selectedLegsForRequest = useMemo(
    () => selectedLegIds.map((id) => legsById[id]).filter(Boolean),
    [selectedLegIds, legsById],
  );
  /** The negotiable part of the quote: everything except the €20 fixed minimum. */
  const standardVariableEur = useMemo(
    () => selectedLegsForRequest.reduce((acc, leg) => acc + legDepositEur(leg, selectedContributionOptions), 0),
    [selectedLegsForRequest, selectedContributionOptions],
  );
  const fixedMinimumEur = useMemo(
    () => contributionFixedMinimumEur(selectedContributionOptions.fixedMinimumEur),
    [selectedContributionOptions],
  );

  // Only needed to label a workaway proposal, which stays a per-voyage opt-in.
  useEffect(() => {
    if (!selectedVoyageSettings?.workaway_enabled) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await typedSupabase
        .from("voyage_workaway_roles")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (cancelled || error) return;
      setWorkawayRoles((data as WorkawayRole[] | null) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVoyageSettings?.workaway_enabled]);

  // The matrix edits a single active request per voyage; with several active requests
  // (allowed server-side when their legs don't overlap) it targets the most recent one.
  const ownRequestForSelectedVoyage = useMemo(
    () =>
      requests
        .filter((request) => request.voyage_id === selectedVoyageId && !["cancelled", "rejected", "expired"].includes(request.status))
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())[0] || null,
    [requests, selectedVoyageId]
  );
  /** admin_approved but the traveller's own contribution isn't paid yet: the seat is reserved,
   * but settle_voyage_booking_payment hasn't promoted it to user_confirmed yet. */
  const isAwaitingContributionPayment = useCallback(
    (request: BookingRequest | null) =>
      Boolean(
        request &&
          request.status === "admin_approved" &&
          request.payment_mode === "each_pays_own" &&
          !request.is_comped &&
          !paidDepositRequestIds.has(request.id)
      ),
    [paidDepositRequestIds]
  );
  const ownRequestAwaitingPayment = isAwaitingContributionPayment(ownRequestForSelectedVoyage);
  // Expired applications are otherwise invisible on this page; surfaced separately so the
  // traveller can retrieve payment info or re-propose them (see reactivateExpiredBooking).
  const expiredRequestsForSelectedVoyage = useMemo(
    () =>
      requests
        .filter((request) => request.voyage_id === selectedVoyageId && request.status === "expired")
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
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
  /** Outstanding balance (EUR) still owed on the own request for the selected voyage, and the
   * date by which it must arrive (15 days before the earliest departure among its own legs — the
   * traveller's embarkation leg, mirroring voyage_booking_balance_deadline in the DB). Best-effort
   * client-side estimate for display only: the amount actually charged is always recomputed
   * server-side when the payment is started. */
  const ownRequestBalance = useMemo(() => {
    if (!ownRequestForSelectedVoyage) return null;
    const ownLegs = ownRequestLegIdsForSelectedVoyage.map((id) => legsById[id]).filter(Boolean);
    if (ownLegs.length === 0) return null;
    const totalDueEur = totalDepositEur(ownLegs, ownRequestForSelectedVoyage.party_size, selectedContributionOptions);
    const paidEur = paidEurByRequestId[ownRequestForSelectedVoyage.id] ?? 0;
    const outstandingEur = Math.round((totalDueEur - paidEur + Number.EPSILON) * 100) / 100;
    const departureTimes = ownLegs
      .map((leg) => leg.starts_at_window_start)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((time) => Number.isFinite(time));
    const deadline = departureTimes.length
      ? new Date(Math.min(...departureTimes) - 15 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    return { outstandingEur, deadline };
  }, [ownRequestForSelectedVoyage, ownRequestLegIdsForSelectedVoyage, legsById, selectedContributionOptions, paidEurByRequestId]);
  /** Shown once the traveller has already paid something (the deposit) but a genuine balance
   * remains — not while the very first payment is still outstanding, which has its own banner. */
  const ownRequestBalanceDue =
    ownRequestForSelectedVoyage &&
    !ownRequestForSelectedVoyage.is_comped &&
    ["requested", "waitlisted", "admin_approved", "user_confirmed"].includes(ownRequestForSelectedVoyage.status) &&
    paidDepositRequestIds.has(ownRequestForSelectedVoyage.id) &&
    ownRequestBalance &&
    ownRequestBalance.outstandingEur > 0.5
      ? ownRequestBalance
      : null;
  const companionRows = useMemo(() => occupancy.filter((row) => !row.is_own), [occupancy]);
  const generalAvailabilityWatch = useMemo(
    () => availabilityWatches.find((watch) => watch.scope === "all_bookable_voyages") || null,
    [availabilityWatches]
  );
  const selectedVoyageWatch = useMemo(
    () =>
      availabilityWatches.find(
        (watch) => watch.scope === "voyage_availability" && watch.voyage_id === selectedVoyageId
      ) || null,
    [availabilityWatches, selectedVoyageId]
  );
  /** Seats still free on each leg of the selected voyage — only approved/confirmed bookings occupy. */
  const remainingSeatsByLegId = useMemo(() => {
    const capacity = Math.max(1, selectedVoyage?.booking_max_guests || 1);
    const remaining: Record<string, number> = {};
    for (const leg of selectedVoyageLegs) {
      const occupied = occupancy
        .filter(
          (row) =>
            row.leg_ids.includes(leg.id) &&
            ["admin_approved", "user_confirmed"].includes(row.status)
        )
        .reduce((sum, row) => sum + row.party_size, 0);
      remaining[leg.id] = Math.max(0, capacity - occupied);
    }
    return remaining;
  }, [occupancy, selectedVoyage?.booking_max_guests, selectedVoyageLegs]);
  const selectedFullLegIds = useMemo(
    () => selectedVoyageLegs.filter((leg) => (remainingSeatsByLegId[leg.id] ?? 0) <= 0).map((leg) => leg.id),
    [remainingSeatsByLegId, selectedVoyageLegs]
  );
  const selectedFullLegLabels = useMemo(
    () => selectedFullLegIds.map((id) => legsById[id]).filter(Boolean).map((leg) => getLegLabel(leg, waypointsById, lang)),
    [lang, legsById, selectedFullLegIds, waypointsById]
  );
  const selectedWatchTracksCurrentFullLegs = Boolean(
    selectedVoyageWatch?.active &&
      (selectedVoyageWatch.leg_ids.length === 0 ||
        selectedFullLegIds.some((legId) => selectedVoyageWatch.leg_ids.includes(legId)))
  );

  // Only multi-person bookings have a party to show; for a solo one the RPC would just return
  // the booker themselves.
  const ownPartyRequestId =
    ownRequestForSelectedVoyage && ownRequestForSelectedVoyage.party_size > 1
      ? ownRequestForSelectedVoyage.id
      : null;
  useEffect(() => {
    void loadPartyMembers(ownPartyRequestId);
  }, [loadPartyMembers, ownPartyRequestId]);

  useEffect(() => {
    if (loading || busy || !draftHydratedRef.current || !selectedVoyageId || ownRequestForSelectedVoyage) return;
    if (
      selectedLegIds.length === 0 &&
      (partySize.trim() === "" || partySize.trim() === "1") &&
      message.trim() === "" &&
      !candidateInfoTouchedRef.current
    ) {
      return;
    }
    const draft = buildBookingApplicationDraft({
      voyageId: selectedVoyageId,
      selectedLegIds,
      partySize,
      message,
      candidateInfo,
    });
    if (isBookingApplicationDraftEmpty(draft)) return;

    const timer = window.setTimeout(() => {
      saveLocalBookingApplicationDraft(draft);
      if (session?.user.id) {
        void saveCloudBookingApplicationDraft(session.user.id, draft).catch((error) => {
          console.error("Failed to save booking draft", error);
        });
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [busy, candidateInfo, loading, message, ownRequestForSelectedVoyage, partySize, selectedLegIds, selectedVoyageId, session?.user.id]);

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
  const detailsProposedLegs = detailsRequest
    ? stringArrayFromMetadata(detailsRequest.plan_change_metadata, "proposed_leg_ids")
        .map((legId) => legsById[legId])
        .filter(Boolean)
    : [];
  const detailsOwnLegs = detailsRequest
    ? requestLegs
        .filter((link) => link.booking_request_id === detailsRequest.id)
        .map((link) => legsById[link.bookable_leg_id])
        .filter(Boolean)
    : [];
  /** Outstanding balance for the booking currently open in the details panel — see
   * ownRequestBalance above for the same best-effort, display-only computation. */
  const detailsRequestBalanceDue = (() => {
    if (
      !detailsRequest ||
      detailsOwnLegs.length === 0 ||
      detailsRequest.is_comped ||
      !["requested", "waitlisted", "admin_approved", "user_confirmed"].includes(detailsRequest.status) ||
      !paidDepositRequestIds.has(detailsRequest.id)
    ) {
      return null;
    }
    const totalDueEur = totalDepositEur(detailsOwnLegs, detailsRequest.party_size, {
      contributionPerNmEur: detailsVoyage?.booking_contribution_per_nm_eur,
      fixedMinimumEur: shouldApplyContributionFixedMinimum(requests, detailsRequest.voyage_id, detailsRequest.id)
        ? undefined
        : 0,
    });
    const paidEur = paidEurByRequestId[detailsRequest.id] ?? 0;
    const outstandingEur = Math.round((totalDueEur - paidEur + Number.EPSILON) * 100) / 100;
    if (outstandingEur <= 0.5) return null;
    const departureTimes = detailsOwnLegs
      .map((leg) => leg.starts_at_window_start)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((time) => Number.isFinite(time));
    const deadline = departureTimes.length
      ? new Date(Math.min(...departureTimes) - 15 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    return { outstandingEur, deadline };
  })();
  const detailsProposedLegLabels = detailsProposedLegs.map((leg) => getLegLabel(leg, waypointsById, lang));
  // A route change the organiser flagged as chargeable: accepting it sends the traveller to pay
  // the difference (here the whole amount, since nothing has been paid yet). Comped bookings skip it.
  const detailsRequiresSettlement =
    Boolean(detailsRequest) &&
    !detailsRequest?.is_comped &&
    (boolFromMetadata(detailsRequest?.plan_change_metadata, "require_settlement") ||
      boolFromMetadata(detailsRequest?.plan_change_metadata, "settlement_due"));
  const detailsProposedAmountEur = detailsRequest
    ? totalDepositEur(detailsProposedLegs, Math.max(1, detailsRequest.party_size), {
        contributionPerNmEur: detailsVoyage?.booking_contribution_per_nm_eur,
        fixedMinimumEur: shouldApplyContributionFixedMinimum(requests, detailsRequest.voyage_id, detailsRequest.id)
          ? undefined
          : 0,
      })
    : 0;
  const detailsPlanChangeUserAction = detailsRequest
    ? stringFromMetadata(detailsRequest.plan_change_metadata, "user_response_action")
    : null;
  const detailsPlanChangeKind = detailsRequest ? stringFromMetadata(detailsRequest.plan_change_metadata, "change_kind") : null;
  const detailsShowPendingPlanChange =
    detailsRequest?.plan_change_status === "pending_user_approval" &&
    !detailsPlanChangeUserAction &&
    detailsProposedLegLabels.length > 0;
  const detailsShowCounterWaiting =
    detailsRequest?.plan_change_status === "pending_user_approval" && detailsPlanChangeUserAction === "request_different_route";
  const detailsShowAwaitingAdminApproval = detailsRequest?.plan_change_status === "pending_admin_approval";
  // A delay notice keeps the same legs (only the dates move), so it gets its own panel
  // instead of the route-change one, which would have nothing to show.
  const detailsShowScheduleDelay =
    detailsRequest?.plan_change_status === "pending_user_approval" &&
    !detailsPlanChangeUserAction &&
    detailsPlanChangeKind === "schedule_delayed";
  const detailsDelayedLegLabels = detailsRequest
    ? stringArrayFromMetadata(detailsRequest.plan_change_metadata, "delayed_leg_ids")
        .map((legId) => legsById[legId])
        .filter(Boolean)
        .map((leg) => getLegLabel(leg, waypointsById, lang))
    : [];
  const detailsDelayNewDeparture = detailsRequest
    ? stringFromMetadata(detailsRequest.plan_change_metadata, "new_departure_at")
    : null;
  const detailsAdminPlanMessage = detailsRequest
    ? stringFromMetadata(detailsRequest.plan_change_metadata, "admin_message") ||
      stringFromMetadata(detailsRequest.plan_change_metadata, "admin_note")
    : null;

  // Latest non-superseded contribution/workaway proposal for the booking currently open in
  // the details dialog — rows come pre-sorted created_at desc from load().
  const detailsContributionProposal = detailsRequest
    ? contributionProposals.find(
        (proposal) => proposal.booking_request_id === detailsRequest.id && proposal.status !== "superseded",
      ) || null
    : null;
  const detailsContributionCounterPending =
    detailsContributionProposal?.status === "pending_user_approval" && detailsContributionProposal.proposed_by === "admin";
  const detailsContributionAwaitingReview = detailsContributionProposal?.status === "pending_admin_review";
  const detailsContributionMissingFiles =
    Boolean(detailsContributionProposal) &&
    (detailsContributionProposal?.proposal_kind === "workaway" || detailsContributionProposal?.proposal_kind === "hybrid") &&
    ["pending_admin_review", "pending_user_approval"].includes(detailsContributionProposal?.status ?? "") &&
    !detailsContributionProposal?.workaway_cv_storage_path &&
    !detailsContributionProposal?.workaway_portfolio_storage_path;

  const respondToContributionCounter = async (action: "accept" | "reject") => {
    if (!detailsRequest) return;
    if (action === "reject" && !confirm(lang === "it" ? "Rifiutare la contro-proposta?" : "Reject the counter-proposal?")) {
      return;
    }
    setContributionCounterSaving(true);
    const message = contributionCounterMessages[detailsRequest.id]?.trim() || null;
    if (action === "accept") {
      const result = await acceptContributionCounter(detailsRequest.id, message);
      setContributionCounterSaving(false);
      if (result.ok === false) {
        toast.error(
          lang === "it"
            ? `Non è stato possibile accettare la contro-proposta. Riprova. (${result.error})`
            : `Unable to accept the counter-proposal. Please try again. (${result.error})`
        );
        return;
      }
      toast.success(
        lang === "it"
          ? "Contro-proposta accettata. Se resta un saldo da versare, ti verra chiesto a breve."
          : "Counter-proposal accepted. If a balance remains, you'll be asked to pay it shortly."
      );
    } else {
      const result = await updateBookingStatusWithRefund({
        bookingRequestId: detailsRequest.id,
        status: "rejected",
        trigger: "user_rejected_contribution_counter",
        adminNotes: message,
      });
      setContributionCounterSaving(false);
      if (result.ok === false) {
        toast.error(
          lang === "it"
            ? `Non è stato possibile rifiutare la contro-proposta. Riprova. (${result.error})`
            : `Unable to reject the counter-proposal. Please try again. (${result.error})`
        );
        return;
      }
      toast.success(
        lang === "it"
          ? `Contro-proposta rifiutata. Rimborso automatico: ${formatDepositEur(result.refundAmountEur, "it")}.`
          : `Counter-proposal rejected. Automatic refund: ${formatDepositEur(result.refundAmountEur, "en")}.`
      );
    }
    setContributionCounterMessages((current) => ({ ...current, [detailsRequest.id]: "" }));
    await loadData();
  };

  const retryWorkawayUpload = async () => {
    if (!detailsRequest || !session?.user.id || (!retryCvFile && !retryPortfolioFile)) return;
    setRetryUploadSaving(true);
    try {
      await uploadWorkawayProposalFiles({
        bookingRequestId: detailsRequest.id,
        userId: session.user.id,
        cvFile: retryCvFile,
        portfolioFile: retryPortfolioFile,
      });
      toast.success(lang === "it" ? "File caricati." : "Files uploaded.");
      setRetryCvFile(null);
      setRetryPortfolioFile(null);
      await loadData();
    } catch (error) {
      toast.error(
        lang === "it"
          ? "Caricamento non riuscito. Riprova."
          : "Upload failed. Try again."
      );
      console.error("[UserBookings] workaway file retry upload failed", error);
    } finally {
      setRetryUploadSaving(false);
    }
  };

  const downloadOwnWorkawayFile = async (path: string | null) => {
    if (!path) return;
    const signedUrl = await getWorkawayFileSignedUrl(path);
    if (!signedUrl) {
      toast.error(lang === "it" ? "Impossibile generare il link al file." : "Could not generate the file link.");
      return;
    }
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  const validateBookingRequest = () => {
    if (!selectedVoyageId || selectedLegIds.length === 0) {
      toast.error(lang === "it" ? "Seleziona almeno una tratta." : "Select at least one leg.");
      return false;
    }
    if (!isVoyageBookableNow(selectedVoyage)) {
      toast.error(lang === "it" ? "Questo viaggio non è più aperto alle adesioni." : "This voyage is no longer open to join.");
      return false;
    }
    const candidateInfoError = getCandidateInfoValidationError(candidateInfo, lang);
    if (candidateInfoError) {
      toast.error(candidateInfoError);
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
    // A party only fits where there is room for *all* of it: an application the organiser could
    // never approve as-is is worse than a refusal here, because the contribution is paid first.
    const tooTightLegIds = selectedLegIds.filter(
      (legId) => legId in remainingSeatsByLegId && remainingSeatsByLegId[legId] < parsedPartySize
    );
    if (tooTightLegIds.length > 0) {
      const labels = tooTightLegIds
        .map((legId) => legsById[legId])
        .filter(Boolean)
        .map((leg) => getLegLabel(leg, waypointsById, lang));
      toast.error(
        lang === "it"
          ? `Non ci sono ${parsedPartySize} posti liberi su: ${labels.join(", ")}. Riduci il numero di persone o togli queste tratte.`
          : `There aren't ${parsedPartySize} free seats on: ${labels.join(", ")}. Reduce the party size or remove these legs.`
      );
      return false;
    }
    return true;
  };

  const openBookingConfirm = () => {
    if (!validateBookingRequest()) return;
    if (!session?.user.id) {
      const draft = buildBookingApplicationDraft({
        voyageId: selectedVoyageId,
        selectedLegIds,
        partySize,
        message,
        candidateInfo,
      });
      saveLocalBookingApplicationDraft(draft);
      navigate("/login", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setConfirmOpen(true);
  };

  const setAvailabilityWatch = async (params: {
    scope: "all_bookable_voyages" | "voyage_availability";
    active: boolean;
    voyageId?: string | null;
    legIds?: string[];
  }) => {
    if (!session?.user.id) {
      navigate("/login", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setSaving(true);
    const { error } = await typedSupabase.rpc("set_voyage_availability_watch", {
      _scope: params.scope,
      _active: params.active,
      _voyage_id: params.voyageId || null,
      _leg_ids: params.legIds || [],
      _source: "booking",
    });
    setSaving(false);
    if (error) {
      toast.error(
        lang === "it"
          ? `Non è stato possibile aggiornare le notifiche. Riprova. (${error.message})`
          : `Unable to update notifications. Please try again. (${error.message})`
      );
      return;
    }
    toast.success(
      params.active
        ? lang === "it"
          ? "Ti avviseremo quando ci sono aggiornamenti utili."
          : "We will notify you when there are relevant updates."
        : lang === "it"
          ? "Aggiornamenti disattivati."
          : "Updates disabled."
    );
    await loadData();
  };

  /** Clears the application form after a successful submit, proposal included: leaving any of it
   * behind would re-hydrate the form with what was just sent, and the next attempt would only
   * earn a BK001. */
  const resetBookingApplicationForm = () => {
    setSelectedLegIds([]);
    setMessage("");
    candidateInfoTouchedRef.current = false;
    setCandidateInfo(candidateInfoPrefill);
    setProposal(emptyContributionProposal);
    setProposalCvFile(null);
    setProposalPortfolioFile(null);
  };

  const submitRequest = async () => {
    if (!validateBookingRequest()) return;
    if (!session?.user.id) {
      const draft = buildBookingApplicationDraft({
        voyageId: selectedVoyageId,
        selectedLegIds,
        partySize,
        message,
        candidateInfo,
      });
      saveLocalBookingApplicationDraft(draft);
      navigate("/login", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    const parsedPartySize = Math.max(1, Number.parseInt(partySize, 10) || 1);
    // One negotiation per application, run by the booker on everyone's behalf: the figures are
    // per person, so guests simply inherit the agreed amount and pay their own share.
    const attachedProposal = toApplyWithProposalPayload(proposal);
    setSaving(true);

    let bookingRequestId: string | undefined;
    // Set only when a proposal is attached: nothing but the €20 fixed share is due until the
    // crew has reviewed it, so this — not the standard quote — is what gets charged now.
    let fixedOnlyAmountEur: number | null = null;

    if (attachedProposal) {
      const applyResult = await applyVoyageBookingWithProposal({
        voyageId: selectedVoyageId,
        legIds: selectedLegIds,
        message: message.trim() || null,
        candidateInfo,
        proposal: attachedProposal,
        candidateMessage: proposal.candidateMessage.trim() || null,
        partySize: parsedPartySize,
      });
      if (applyResult.ok === false) {
        setSaving(false);
        toast.error(
          applyResult.error === "proposal_out_of_range"
            ? lang === "it"
              ? "L'importo proposto è fuori dal range consentito."
              : "The proposed amount is outside the allowed range."
            : lang === "it"
              ? "Invio della proposta non riuscito."
              : "Couldn't submit your proposal."
        );
        return;
      }
      bookingRequestId = applyResult.bookingRequestId;
      fixedOnlyAmountEur = fixedMinimumEur;

      if (bookingRequestId && (proposalCvFile || proposalPortfolioFile)) {
        try {
          await uploadWorkawayProposalFiles({
            bookingRequestId,
            userId: session.user.id,
            cvFile: proposalCvFile,
            portfolioFile: proposalPortfolioFile,
          });
        } catch (uploadError) {
          console.error("[UserBookings] workaway file upload failed", uploadError);
          toast.warning(
            lang === "it"
              ? "Candidatura inviata, ma il caricamento dei file non è riuscito. Potrai riprovare in seguito."
              : "Application sent, but the file upload failed. You can try again later."
          );
        }
      }

      toast.info(
        lang === "it"
          ? "Ultimo passo: versa la quota fissa per inviare la candidatura. L'eventuale saldo verrà richiesto dopo la revisione."
          : "One last step: pay the fixed share to submit your application. Any balance will be requested after review."
      );
    } else {
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
          toast.error(
            lang === "it"
              ? `Non è stato possibile inviare la candidatura. Riprova. (${error.message})`
              : `Unable to submit the application. Please try again. (${error.message})`
          );
        }
        return;
      }
      const result = Array.isArray(data) ? (data[0] as RequestBookingResult | undefined) : undefined;
      bookingRequestId = result?.booking_request_id;
      toast.info(
        lang === "it"
          ? "Ultimo passo: completa il pagamento del contributo per inviare la candidatura."
          : "One last step: pay the contribution to submit your application."
      );
    }

    // Multi-person applications still need participant details, and payment is chosen there.
    if (bookingRequestId && parsedPartySize > 1) {
      setSaving(false);
      setConfirmOpen(false);
      // Same cleanup as the solo path below: leaving the draft behind would re-hydrate this form
      // with the legs that were just submitted, and the next attempt would only earn a BK001.
      resetBookingApplicationForm();
      clearLocalBookingApplicationDraft(selectedVoyageId);
      await clearCloudBookingApplicationDraft(session.user.id, selectedVoyageId).catch((error) => {
        console.error("Failed to clear booking draft", error);
      });
      navigate(`/bookings/${bookingRequestId}/participants`);
      return;
    }

    // Capture the contribution before the selection is cleared below, so the payment dialog can
    // show the amount and pick card-vs-transfer (bank transfer only above the €500 card cap).
    const soloAmountEur =
      fixedOnlyAmountEur ?? totalDepositEur(selectedLegsForRequest, 1, selectedContributionOptions);

    setSaving(false);
    setConfirmOpen(false);
    resetBookingApplicationForm();
    clearLocalBookingApplicationDraft(selectedVoyageId);
    await clearCloudBookingApplicationDraft(session.user.id, selectedVoyageId).catch((error) => {
      console.error("Failed to clear booking draft", error);
    });

    // A proposal whose fixed share resolved to €0 (already covered by another active application
    // on this voyage) has nothing to pay at all — settle it directly instead of opening a
    // payment dialog for a zero amount.
    if (bookingRequestId && fixedOnlyAmountEur != null && fixedOnlyAmountEur <= 0) {
      const settled = await settleBookingIfZeroDue(bookingRequestId);
      if (settled.ok) {
        toast.success(
          lang === "it"
            ? "Candidatura inviata: nessun contributo fisso da versare, già coperto da una tua candidatura attiva su questo viaggio."
            : "Application submitted: no fixed contribution due, already covered by your active application on this voyage."
        );
      } else {
        toast.warning(
          lang === "it"
            ? "Candidatura creata, ma risulta ancora un importo da versare: completa il pagamento da questa pagina."
            : "Application created, but an amount is still due: complete the payment from this page."
        );
      }
      await loadData();
      return;
    }

    // Solo applications must complete the contribution payment now: the request stays
    // unreviewable until it's paid, and a refund is issued automatically if later rejected.
    if (bookingRequestId) {
      setPaymentChoice({ bookingRequestId, amountEur: soloAmountEur });
    }
    await loadData();
  };

  /**
   * Re-proposes an expired application: resets only the payment timer on the same
   * voyage_booking_requests row (legs, party size, candidate info untouched). The server
   * re-checks the original legs are still bookable and not already filled before allowing it.
   */
  const reactivateExpiredBooking = async (request: BookingRequest) => {
    setReactivatingRequestId(request.id);
    const { error } = await typedSupabase.rpc("reactivate_expired_voyage_booking", {
      _booking_request_id: request.id,
    });
    setReactivatingRequestId(null);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "BK002") {
        toast.error(
          lang === "it"
            ? "Una o più tratte non sono più disponibili: questa candidatura non può essere riproposta."
            : "One or more legs are no longer available: this application cannot be re-proposed."
        );
      } else if (code === "BK001") {
        toast.error(
          lang === "it"
            ? "Hai già un'altra candidatura attiva su una di queste tratte."
            : "You already have another active application on one of these legs."
        );
      } else {
        toast.error(
          lang === "it"
            ? `Non è stato possibile riproporre la candidatura. Riprova. (${error.message})`
            : `Unable to re-propose the application. Please try again. (${error.message})`
        );
      }
      return;
    }
    const legsForRequest = requestLegs
      .filter((link) => link.booking_request_id === request.id)
      .map((link) => legsById[link.bookable_leg_id])
      .filter(Boolean);
    const amountEur = totalDepositEur(legsForRequest, request.party_size, selectedContributionOptions);
    toast.info(
      lang === "it"
        ? "Candidatura riproposta: completa il pagamento del contributo per inviarla."
        : "Application re-proposed: complete the contribution payment to submit it."
    );
    setPaymentChoice({ bookingRequestId: request.id, amountEur });
    await loadData();
  };

  const confirmBooking = async (requestId: string) => {
    setSaving(true);
    const { error } = await typedSupabase.rpc("confirm_voyage_booking", { _booking_request_id: requestId });
    setSaving(false);
    if (error) {
      toast.error(
        lang === "it"
          ? `Non è stato possibile confermare la partecipazione. Riprova. (${error.message})`
          : `Unable to confirm participation. Please try again. (${error.message})`
      );
    } else {
      toast.success(lang === "it" ? "Partecipazione confermata." : "Participation confirmed.");
      await loadData();
    }
  };

  /** The booker chose to sail without the guest who missed their share deadline. */
  const dropParticipant = async (participantId: string) => {
    if (
      !confirm(
        lang === "it"
          ? "Proseguire senza questa persona? Il suo posto viene liberato e quanto eventualmente versato le viene restituito."
          : "Continue without this person? Their seat is released and anything they paid is refunded to them."
      )
    ) {
      return;
    }
    setDroppingParticipantId(participantId);
    try {
      await dropUnpaidGuestShare(participantId);
      toast.success(
        lang === "it" ? "Partecipante rimosso dalla prenotazione." : "Participant removed from the booking."
      );
      await loadData();
      await loadPartyMembers(ownRequestForSelectedVoyage?.id ?? null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      toast.error(
        lang === "it"
          ? `Non è stato possibile rimuovere il partecipante.${detail ? ` (${detail})` : ""}`
          : `Unable to remove the participant.${detail ? ` (${detail})` : ""}`
      );
    } finally {
      setDroppingParticipantId(null);
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
    if (result.ok === false) {
      toast.error(
        lang === "it"
          ? `Non è stato possibile annullare la partecipazione. Riprova. (${result.error})`
          : `Unable to cancel the participation. Please try again. (${result.error})`
      );
    } else {
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
      toast.error(
        lang === "it"
          ? `Non è stato possibile aggiornare la checklist. Riprova. (${error.message})`
          : `Unable to update the checklist. Please try again. (${error.message})`
      );
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
      toast.error(
        lang === "it"
          ? `Non è stato possibile inviare la richiesta di modifica. Riprova. (${error.message})`
          : `Unable to send the change request. Please try again. (${error.message})`
      );
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
      if (result.ok === false) {
        toast.error(
          lang === "it"
            ? `Non è stato possibile annullare la partecipazione. Riprova. (${result.error})`
            : `Unable to cancel the participation. Please try again. (${result.error})`
        );
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

    // Accepting a chargeable route change sends the traveller straight to pay the difference
    // (captured before loadData() recomputes the details view).
    const goToPaymentAfterAccept = action === "accept_proposed_change" && detailsRequiresSettlement;
    const settlementAmountEur = detailsProposedAmountEur;

    setSaving(true);
    const { error } = await typedSupabase.rpc("respond_voyage_booking_plan_change", {
      _booking_request_id: requestId,
      _action: action,
      _message: planChangeMessages[requestId]?.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(
        lang === "it"
          ? `Non è stato possibile inviare la risposta. Riprova. (${error.message})`
          : `Unable to send the response. Please try again. (${error.message})`
      );
      return;
    }
    setPlanChangeMessages((current) => ({ ...current, [requestId]: "" }));

    if (goToPaymentAfterAccept) {
      toast.info(
        lang === "it"
          ? "Modifica accettata: completa il pagamento del contributo per confermarla."
          : "Change accepted: complete the contribution payment to confirm it."
      );
      setDetailsRequestId(null);
      setPaymentChoice({ bookingRequestId: requestId, amountEur: settlementAmountEur });
      await loadData();
      return;
    }

    const successMessage: Record<PlanChangeAction, string> = {
      accept_proposed_change: lang === "it" ? "Proposta accettata." : "Proposal accepted.",
      request_different_route: lang === "it" ? "Controproposta inviata." : "Counterproposal sent.",
      reject_proposed_change: lang === "it" ? "Proposta rifiutata." : "Proposal declined.",
      cancel_with_full_refund: lang === "it" ? "Richiesta annullata." : "Booking cancelled.",
      acknowledge_delay: lang === "it" ? "Ritardo confermato." : "Delay acknowledged.",
    };
    toast.success(successMessage[action]);
    await loadData();
  };

  const handleAcceptConfirm = async () => {
    if (!acceptTarget) return;
    const candidateInfoError = getCandidateInfoValidationError(acceptCandidateInfo, lang);
    if (candidateInfoError) {
      toast.error(candidateInfoError);
      return;
    }
    setAcceptSubmitting(true);
    try {
      await acceptParticipation(acceptTarget.participant_id, acceptCandidateInfo);
      // While the booker is still negotiating the amount there is nothing to charge yet: the
      // server refuses a guest payment in that window, and the guest is emailed with their own
      // two-day deadline once the figure is agreed.
      if (acceptTarget.requires_payment && acceptTarget.negotiation_open) {
        toast.success(
          lang === "it"
            ? "Invito accettato. L'importo del contributo è ancora in accordo con chi ha prenotato: ti avviseremo appena è definito, poi avrai due giorni per versare la tua quota."
            : "Invitation accepted. The contribution is still being agreed with whoever booked: we'll let you know as soon as it's settled, and you'll then have two days to pay your share."
        );
        setAcceptTarget(null);
        setAcceptCandidateInfo(candidateInfoPrefill);
        await loadParticipations();
        return;
      }
      // Guests paying their own share choose between the Bunq link and bank transfer after accepting.
      if (acceptTarget.requires_payment) {
        toast.success(lang === "it" ? "Invito accettato." : "Invitation accepted.");
        setPaymentChoice({
          bookingRequestId: acceptTarget.booking_request_id,
          participantId: acceptTarget.participant_id,
        });
      } else {
        toast.success(lang === "it" ? "Invito accettato." : "Invitation accepted.");
      }
      setAcceptTarget(null);
      setAcceptCandidateInfo(candidateInfoPrefill);
      await loadParticipations();
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      toast.error(
        lang === "it"
          ? `Non è stato possibile accettare l'invito. Riprova.${detail ? ` (${detail})` : ""}`
          : `Unable to accept the invitation. Please try again.${detail ? ` (${detail})` : ""}`
      );
    } finally {
      setAcceptSubmitting(false);
    }
  };

  const startOnlinePayment = async (reservedWindow?: Window | null) => {
    if (!paymentChoice) return;
    setPaymentStarting(true);
    try {
      const payment = await startDepositPayment(paymentChoice.bookingRequestId, paymentChoice.participantId);
      if (payment.ok && "shareUrl" in payment) {
        if (reservedWindow && !reservedWindow.closed) {
          reservedWindow.location.href = payment.shareUrl;
        } else {
          window.location.assign(payment.shareUrl);
        }
        return;
      }
      reservedWindow?.close();
      if (payment.ok && "alreadyPaid" in payment) {
        setPaymentChoice(null);
        toast.success(lang === "it" ? "Hai già saldato per intero." : "You have already paid in full.");
        await loadData();
        return;
      }
      if (!payment.ok && "error" in payment && payment.error === "already_settled") {
        setPaymentChoice(null);
        toast.success(lang === "it" ? "Hai già saldato per intero." : "You have already paid in full.");
        await loadData();
        return;
      }
      setPaymentChoice(null);
      toast.info(
        lang === "it"
          ? "Non sono riuscito ad aprire Bunq. Puoi completare con bonifico."
          : "Could not open Bunq. You can complete by bank transfer."
      );
      setBankTransfer(paymentChoice);
    } finally {
      setPaymentStarting(false);
    }
  };

  /** Opens the payment-method dialog for a booking's next payment (deposit or balance — the
   * server resolves which one is actually due; the dialog just doesn't preview an amount until
   * the API responds). Used for the "Paga il saldo" action on an already-confirmed booking. */
  const openBalancePayment = (request: BookingRequest) => {
    setPaymentChoice({ bookingRequestId: request.id, phase: "balance" });
  };

  const handleDecline = async (participantId: string) => {
    if (!confirm(lang === "it" ? "Rifiutare questo invito?" : "Decline this invitation?")) return;
    try {
      await declineParticipation(participantId);
      toast.success(lang === "it" ? "Invito rifiutato." : "Invitation declined.");
      await loadParticipations();
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      toast.error(
        lang === "it"
          ? `Non è stato possibile rifiutare l'invito. Riprova.${detail ? ` (${detail})` : ""}`
          : `Unable to decline the invitation. Please try again.${detail ? ` (${detail})` : ""}`
      );
    }
  };

  const participationVoyageName = (p: MyParticipation) =>
    (lang === "it" ? p.voyage_name_it : p.voyage_name_en) || p.voyage_name || (lang === "it" ? "Viaggio" : "Voyage");

  const pendingParticipations = myParticipations.filter((p) => p.status === "pending");
  /**
   * Accepted invitations where this guest still owes their own share — either suspended while
   * the booker negotiates, or armed with a deadline. Without this the guest had nowhere at all
   * to see or pay their share: only pending invitations were ever rendered.
   */
  const shareDueParticipations = myParticipations.filter(
    (p) =>
      p.status === "accepted" &&
      p.requires_payment &&
      (p.negotiation_open || (p.share_due_cents != null && p.share_paid_cents < p.share_due_cents))
  );

  if (loading) {
    return <div className="min-h-screen pt-28 text-center text-sm text-muted-foreground">Loading...</div>;
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
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/35 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">
                {lang === "it" ? "Resta aggiornato sui prossimi viaggi" : "Stay updated about upcoming voyages"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {lang === "it"
                  ? "Una mail sobria quando viene pubblicato un nuovo viaggio a cui si puo chiedere di partecipare."
                  : "A quiet email when a new voyage becomes available for joining requests."}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void setAvailabilityWatch({
                  scope: "all_bookable_voyages",
                  active: !(generalAvailabilityWatch?.active ?? false),
                })
              }
              disabled={saving}
              className="glass-chip inline-flex shrink-0 items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
            >
              {generalAvailabilityWatch?.active ? <BellOff size={14} /> : <Bell size={14} />}
              {generalAvailabilityWatch?.active
                ? lang === "it"
                  ? "Non avvisarmi"
                  : "Stop updates"
                : lang === "it"
                  ? "Resta aggiornato"
                  : "Keep me updated"}
            </button>
          </div>
          {!session && (
            <div className="mt-5 rounded-2xl border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-foreground">
              {lang === "it"
                ? "Puoi preparare la candidatura qui: la bozza resta salvata su questo dispositivo. Per inviarla ti chiederemo l'accesso e poi tornerai automaticamente a questo viaggio."
                : "You can prepare the application here: the draft stays saved on this device. To submit it, we'll ask you to log in and then bring you back to this voyage."}
            </div>
          )}
        </section>

        {bookedVoyageIds.length > 0 && (
          <VoyageLiveWidget readOnly voyageIds={bookedVoyageIds} lang={lang} />
        )}

        {shareDueParticipations.length > 0 && (
          <section className="glass-panel rounded-[30px] border border-amber-400/50 p-5 md:p-6">
            <h2 className="editorial-heading mb-4 text-2xl">
              {lang === "it" ? "La tua quota" : "Your share"}
            </h2>
            <div className="space-y-3">
              {shareDueParticipations.map((p) => {
                const overdue =
                  p.share_payment_due_at != null && new Date(p.share_payment_due_at).getTime() <= Date.now();
                return (
                  <div
                    key={p.participant_id}
                    className="rounded-[22px] border border-border/70 bg-background/50 p-4 text-sm"
                  >
                    <p className="font-medium text-foreground">{participationVoyageName(p)}</p>
                    {p.negotiation_open ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {lang === "it"
                          ? "L'importo del contributo è ancora in accordo con chi ha prenotato. Non devi versare nulla adesso: ti avviseremo appena è definito e da quel momento avrai due giorni per pagare la tua quota."
                          : "The contribution is still being agreed with whoever booked. Nothing to pay right now: we'll let you know as soon as it's settled, and you'll then have two days to pay your share."}
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {lang === "it"
                            ? "L'importo è stato concordato da chi ha prenotato e vale per ciascun partecipante: non è rinegoziabile singolarmente."
                            : "The amount was agreed by whoever booked and applies to every participant: it cannot be renegotiated individually."}
                        </p>
                        <p className={`mt-2 text-xs font-semibold ${overdue ? "text-orange-700 dark:text-orange-300" : "text-foreground"}`}>
                          {p.share_due_cents != null
                            ? formatDepositEur(
                                (p.share_due_cents - p.share_paid_cents) / 100,
                                lang === "it" ? "it" : "en"
                              )
                            : ""}
                          {p.share_payment_due_at && (
                            <span className="ml-2 font-normal text-muted-foreground">
                              {overdue
                                ? lang === "it"
                                  ? `termine scaduto il ${formatBookingDate(p.share_payment_due_at, locale)}`
                                  : `deadline passed on ${formatBookingDate(p.share_payment_due_at, locale)}`
                                : lang === "it"
                                  ? `entro il ${formatBookingDate(p.share_payment_due_at, locale)}`
                                  : `by ${formatBookingDate(p.share_payment_due_at, locale)}`}
                            </span>
                          )}
                        </p>
                        {overdue && (
                          <p className="mt-1 text-xs leading-relaxed text-orange-800 dark:text-orange-300/90">
                            {lang === "it"
                              ? "Il termine è passato: chi ha prenotato può decidere di proseguire senza di te. Puoi ancora pagare finché non lo fa."
                              : "The deadline has passed: whoever booked may decide to continue without you. You can still pay until they do."}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setPaymentChoice({
                              bookingRequestId: p.booking_request_id,
                              participantId: p.participant_id,
                            })
                          }
                          className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                        >
                          <Wallet size={14} />
                          {lang === "it" ? "Versa la tua quota" : "Pay your share"}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

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
          showPaymentMethodChoice={false}
          submitting={acceptSubmitting}
          onConfirm={() => void handleAcceptConfirm()}
        />

        <PaymentMethodDialog
          open={paymentChoice !== null}
          onOpenChange={(open) => {
            if (!open) setPaymentChoice(null);
          }}
          loading={paymentStarting}
          amountEur={paymentChoice?.amountEur}
          phase={paymentChoice?.phase}
          onPayNow={(reservedWindow) => void startOnlinePayment(reservedWindow)}
          onBankTransfer={() => {
            if (!paymentChoice) return;
            setBankTransfer(paymentChoice);
            setPaymentChoice(null);
          }}
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
          <div className="space-y-6">
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
                        ownRequestAwaitingPayment={ownRequestAwaitingPayment}
                        companions={companionRows}
                        draftLegIds={selectedLegIds}
                        onDraftLegIdsChange={setSelectedLegIds}
                        onSubmitDraft={openBookingConfirm}
                        onProposeChange={(requestId, proposedLegIds) => void proposeLegChange(requestId, proposedLegIds)}
                        onOpenOwnRequest={(request) => setDetailsRequestId(request.id)}
                      />
                    )}
                    {ownRequestForSelectedVoyage?.status === "pending_payment" && (
                      <div className="rounded-[22px] border border-orange-300/60 bg-orange-50/70 p-4 text-sm text-orange-950 dark:bg-orange-400/10 dark:text-orange-100/90">
                        <p className="font-medium">
                          {lang === "it"
                            ? "Candidatura non ancora inviata"
                            : "Application not submitted yet"}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed opacity-85">
                          {lang === "it"
                            ? "Manca solo il pagamento del contributo: finché non arriva, la candidatura non viene inviata all'organizzatore."
                            : "Only the contribution payment is missing: until it arrives the application is not sent to the organiser."}
                        </p>
                        <p className="mt-2 rounded-xl border border-orange-400/40 bg-white/50 px-3 py-2 text-xs leading-relaxed dark:bg-white/5">
                          {lang === "it"
                            ? "Se non completi il pagamento in tempo la richiesta viene annullata in automatico: 1 ora per carta e link di pagamento, 24 ore per bonifico."
                            : "If you don't complete the payment in time the request is cancelled automatically: 1 hour for card and payment link, 24 hours for bank transfer."}
                          {ownRequestForSelectedVoyage.expires_at && (
                            <span className="mt-1 block font-semibold">
                              {lang === "it" ? "Scade il " : "Expires on "}
                              {formatBookingDate(ownRequestForSelectedVoyage.expires_at, locale)}
                            </span>
                          )}
                        </p>
                        {ownRequestForSelectedVoyage.party_size > 1 ? (
                          // Who pays and how much depend on the guest list and the split the lead
                          // picks, so a multi-person application must go through the participants
                          // page — paying straight from here would silently charge for the whole
                          // party and leave the guests unnamed and uninvited.
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/bookings/${ownRequestForSelectedVoyage.id}/participants`)
                            }
                            className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                          >
                            <Users size={14} />
                            {lang === "it"
                              ? "Indica i partecipanti e paga"
                              : "Add participants & pay"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setPaymentChoice({ bookingRequestId: ownRequestForSelectedVoyage.id })
                            }
                            className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                          >
                            <Wallet size={14} />
                            {lang === "it" ? "Completa il pagamento" : "Complete the payment"}
                          </button>
                        )}
                      </div>
                    )}

                    {ownRequestForSelectedVoyage &&
                      ownRequestForSelectedVoyage.party_size > 1 &&
                      ["requested", "waitlisted", "admin_approved", "user_confirmed"].includes(
                        ownRequestForSelectedVoyage.status
                      ) && (
                        <div className="rounded-[22px] border border-border/70 bg-background/40 p-4 text-sm">
                          <p className="font-medium text-foreground">
                            {lang === "it" ? "Persone della tua prenotazione" : "People on your booking"}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {lang === "it"
                              ? `Hai aderito per ${ownRequestForSelectedVoyage.party_size} persone. Da qui puoi rivedere i dati degli altri partecipanti, correggere un'email sbagliata e rimandare gli inviti.`
                              : `You joined for ${ownRequestForSelectedVoyage.party_size} people. From here you can review the other participants, fix a wrong address and re-send the invitations.`}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/bookings/${ownRequestForSelectedVoyage.id}/participants`)
                            }
                            className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                          >
                            <Users size={14} />
                            {lang === "it" ? "Gestisci partecipanti" : "Manage participants"}
                          </button>

                          {partyMembers.length > 0 && (
                            <div className="mt-4">
                              <BookingPartyPanel
                                lang={lang}
                                members={partyMembers}
                                isLead
                                paymentMode={ownRequestForSelectedVoyage.payment_mode ?? null}
                                droppingParticipantId={droppingParticipantId}
                                onDropParticipant={(participantId) => void dropParticipant(participantId)}
                                onCancelWholeBooking={() => void cancelBooking(ownRequestForSelectedVoyage)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    {ownRequestForSelectedVoyage?.status === "admin_approved" &&
                      ownRequestForSelectedVoyage.payment_mode === "each_pays_own" &&
                      !ownRequestForSelectedVoyage.is_comped &&
                      !paidDepositRequestIds.has(ownRequestForSelectedVoyage.id) && (
                        <div className="rounded-[22px] border border-orange-300/60 bg-orange-50/70 p-4 text-sm text-orange-950 dark:bg-orange-400/10 dark:text-orange-100/90">
                          <p className="font-medium">
                            {lang === "it" ? "In attesa di pagamento" : "Awaiting payment"}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed opacity-85">
                            {lang === "it"
                              ? "Il tuo posto è riservato. Manca solo il pagamento della tua quota di contributo per confermare definitivamente la partecipazione."
                              : "Your seat is reserved. Only your contribution payment is missing to fully confirm your participation."}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setPaymentChoice({ bookingRequestId: ownRequestForSelectedVoyage.id })
                            }
                            className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                          >
                            <Wallet size={14} />
                            {lang === "it" ? "Completa il pagamento" : "Complete the payment"}
                          </button>
                        </div>
                      )}
                    {ownRequestBalanceDue && (
                      <div className="rounded-[22px] border border-sky-300/60 bg-sky-50/70 p-4 text-sm text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100/90">
                        <p className="font-medium">
                          {lang === "it" ? "Saldo da versare" : "Balance due"}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed opacity-85">
                          {lang === "it"
                            ? `Hai versato l'acconto: manca il saldo di ${formatDepositEur(ownRequestBalanceDue.outstandingEur, "it")}.`
                            : `You've paid the deposit: the ${formatDepositEur(ownRequestBalanceDue.outstandingEur, "en")} balance is still due.`}
                          {ownRequestBalanceDue.deadline && (
                            <span className="mt-1 block font-semibold">
                              {lang === "it" ? "Da versare entro il " : "Due by "}
                              {formatBookingDate(ownRequestBalanceDue.deadline, locale)}
                              {lang === "it"
                                ? " (15 giorni prima della partenza della tua tratta di imbarco)."
                                : " (15 days before your own embarkation leg departs)."}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed opacity-70">
                          {lang === "it"
                            ? "Se il saldo non arriva entro quella data la prenotazione decade e l'acconto non è rimborsabile."
                            : "If the balance does not arrive by then the booking lapses and the deposit is not refundable."}
                        </p>
                        <button
                          type="button"
                          onClick={() => openBalancePayment(ownRequestForSelectedVoyage)}
                          className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent"
                        >
                          <CreditCard size={14} />
                          {lang === "it" ? "Paga il saldo" : "Pay the balance"}
                        </button>
                      </div>
                    )}

                    {expiredRequestsForSelectedVoyage.map((request) => {
                      const requestLegLabels = requestLegs
                        .filter((link) => link.booking_request_id === request.id)
                        .map((link) => legsById[link.bookable_leg_id])
                        .filter(Boolean)
                        .map((leg) => getLegLabel(leg, waypointsById, lang));
                      return (
                        <div
                          key={request.id}
                          className="rounded-[22px] border border-stone-300/60 bg-stone-50/70 p-4 text-sm text-stone-800 dark:bg-stone-400/10 dark:text-stone-100/90"
                        >
                          <p className="font-medium">
                            {lang === "it" ? "Candidatura scaduta" : "Expired application"}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed opacity-85">
                            {lang === "it"
                              ? "Il pagamento del contributo non è arrivato in tempo e la candidatura è stata annullata automaticamente. Puoi riproporla con le stesse tratte e gli stessi dati: verrà rinnovato solo il termine per il pagamento, se le tratte sono ancora disponibili."
                              : "The contribution payment did not arrive in time and the application was automatically cancelled. You can re-propose it with the same legs and details: only the payment deadline is renewed, provided the legs are still available."}
                          </p>
                          {requestLegLabels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {requestLegLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full border border-stone-300/70 bg-white/60 px-2.5 py-1 text-[11px] text-stone-800"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void reactivateExpiredBooking(request)}
                            disabled={reactivatingRequestId === request.id}
                            className="glass-chip mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
                          >
                            {reactivatingRequestId === request.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Wallet size={14} />
                            )}
                            {lang === "it" ? "Riproponi candidatura" : "Re-propose application"}
                          </button>
                        </div>
                      );
                    })}

                    {selectedFullLegIds.length > 0 && !ownRequestForSelectedVoyage && (
                      <div className="rounded-[22px] border border-amber-300/50 bg-amber-50/60 p-4 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100/90">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-medium">
                              {lang === "it" ? "Alcune tratte risultano piene" : "Some legs are currently full"}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed opacity-85">
                              {lang === "it"
                                ? "Puoi chiedere un avviso se si libera spazio su queste tratte, senza entrare automaticamente in candidatura."
                                : "You can ask for a note if space opens on these legs, without automatically submitting an application."}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selectedFullLegLabels.map((label) => (
                                <span key={label} className="rounded-full border border-amber-300/70 bg-white/60 px-2.5 py-1 text-[11px] text-amber-950">
                                  {label}
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void setAvailabilityWatch({
                                scope: "voyage_availability",
                                active: !selectedWatchTracksCurrentFullLegs,
                                voyageId: selectedVoyageId,
                                legIds: selectedFullLegIds,
                              })
                            }
                            disabled={saving}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-amber-400/70 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-white disabled:opacity-50"
                          >
                            {selectedWatchTracksCurrentFullLegs ? <BellOff size={14} /> : <Bell size={14} />}
                            {selectedWatchTracksCurrentFullLegs
                              ? lang === "it"
                                ? "Non avvisarmi"
                                : "Stop updates"
                              : lang === "it"
                                ? "Avvisami se si libera"
                                : "Notify me if space opens"}
                          </button>
                        </div>
                      </div>
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
              showPaymentMethodChoice={false}
              mode="application"
              fixedOnlyPayment={Boolean(contributionProposalKind(proposal))}
              depositPerPersonEur={
                contributionProposalKind(proposal)
                  ? fixedMinimumEur
                  : perPersonDepositEur(selectedLegsForRequest, selectedContributionOptions)
              }
              depositTotalEur={
                contributionProposalKind(proposal)
                  ? fixedMinimumEur * Math.max(1, Number.parseInt(partySize, 10) || 1)
                  : totalDepositEur(
                      selectedLegsForRequest,
                      Math.max(1, Number.parseInt(partySize, 10) || 1),
                      selectedContributionOptions
                    )
              }
              contributionPerNmEur={selectedVoyage?.booking_contribution_per_nm_eur}
              standardVariableEur={standardVariableEur}
              fixedMinimumEur={fixedMinimumEur}
              contributionProposalMaxPercent={selectedVoyageSettings?.contribution_proposal_max_percent ?? 150}
              workawayEnabled={Boolean(selectedVoyageSettings?.workaway_enabled)}
              workawayRoles={workawayRoles}
              activeWorkawayRoleKeys={selectedVoyageSettings?.workaway_role_keys ?? []}
              proposal={proposal}
              onProposalChange={setProposal}
              cvFile={proposalCvFile}
              onCvFileChange={setProposalCvFile}
              portfolioFile={proposalPortfolioFile}
              onPortfolioFileChange={setProposalPortfolioFile}
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
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs ${
                            isAwaitingContributionPayment(detailsRequest)
                              ? "border-orange-300/70 bg-orange-100/70 text-orange-900"
                              : getBookingStatusClass(detailsRequest.status)
                          }`}
                        >
                          {["requested", "waitlisted"].includes(detailsRequest.status)
                            ? lang === "it"
                              ? "In attesa di approvazione"
                              : "Pending approval"
                            : isAwaitingContributionPayment(detailsRequest)
                              ? lang === "it"
                                ? "In attesa di pagamento"
                                : "Awaiting payment"
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
                        {detailsRequiresSettlement && (
                          <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900">
                            <p className="font-semibold">
                              {lang === "it"
                                ? `Accettando dovrai versare il contributo del nuovo percorso: ${formatDepositEur(detailsProposedAmountEur, "it")}.`
                                : `By accepting you will need to pay the new route's contribution: ${formatDepositEur(detailsProposedAmountEur, "en")}.`}
                            </p>
                            <p className="mt-1">
                              {lang === "it"
                                ? "Senza pagamento la modifica non si conclude e non potrai partecipare al viaggio."
                                : "Without payment the change is not finalised and you cannot take part in the voyage."}
                            </p>
                            <div className="mt-2">
                              <ContributionTrustNote lang={lang} variant="plain" />
                            </div>
                          </div>
                        )}
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
                            {detailsRequiresSettlement
                              ? lang === "it" ? "Accetta e paga" : "Accept & pay"
                              : lang === "it" ? "Accetta" : "Accept"}
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
                    {detailsShowScheduleDelay && (
                      <div className="mt-4 rounded-[18px] border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950">
                        <div className="flex items-start gap-2">
                          <Hourglass className="mt-0.5 shrink-0 text-amber-700" size={16} />
                          <div>
                            <p className="font-semibold">{lang === "it" ? "Il viaggio è in ritardo" : "The voyage is running late"}</p>
                            <p className="mt-1 text-amber-900/80">
                              {lang === "it"
                                ? "Le tue tratte restano le stesse, solo le date si spostano."
                                : "Your legs stay the same, only the dates shift."}
                            </p>
                          </div>
                        </div>
                        {detailsDelayedLegLabels.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {detailsDelayedLegLabels.map((label) => (
                              <span key={label} className="rounded-full border border-amber-300/70 bg-white/65 px-3 py-1 text-xs text-amber-900">
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {detailsDelayNewDeparture && (
                          <p className="mt-2 text-amber-900/80">
                            {lang === "it" ? "Nuova partenza prevista: " : "New expected departure: "}
                            {formatBookingDate(detailsDelayNewDeparture, locale)}
                          </p>
                        )}
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "acknowledge_delay")}
                            disabled={saving}
                            className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Ho capito" : "Got it"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondToPlanChange(detailsRequest.id, "cancel_with_full_refund")}
                            disabled={saving}
                            className="rounded-full border border-red-300 bg-red-100 px-3 py-2 text-xs font-semibold text-red-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Annulla con rimborso" : "Cancel with refund"}
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
                    {detailsContributionAwaitingReview && (
                      <div className="mt-4 rounded-[18px] border border-sky-300/60 bg-sky-50/70 p-3 text-sm text-sky-950">
                        {lang === "it"
                          ? "La tua proposta di contributo/workaway e in revisione: ti avviseremo appena c'e una risposta."
                          : "Your contribution/workaway proposal is under review: we'll notify you as soon as there's a response."}
                      </div>
                    )}
                    {detailsContributionCounterPending && detailsContributionProposal && (
                      <div className="mt-4 rounded-[18px] border border-sky-300/60 bg-sky-50/70 p-3 text-sm text-sky-950">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="mt-0.5 shrink-0 text-sky-700" size={16} />
                          <div>
                            <p className="font-semibold">
                              {lang === "it" ? "Contro-proposta sul contributo" : "Counter-proposal on the contribution"}
                            </p>
                            {detailsContributionProposal.admin_note && (
                              <p className="mt-1 whitespace-pre-line text-sky-900/80">{detailsContributionProposal.admin_note}</p>
                            )}
                          </div>
                        </div>
                        {detailsContributionProposal.proposed_variable_cents != null && (
                          <p className="mt-2 text-sky-900">
                            {lang === "it"
                              ? `Nuovo contributo variabile proposto: ${formatDepositEur(detailsContributionProposal.proposed_variable_cents / 100, "it")} (il fisso di €20 resta invariato).`
                              : `New proposed variable contribution: ${formatDepositEur(detailsContributionProposal.proposed_variable_cents / 100, "en")} (the fixed €20 stays unchanged).`}
                          </p>
                        )}
                        {(detailsContributionProposal.workaway_role_keys.length > 0 || detailsContributionProposal.workaway_other_role_text) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {detailsContributionProposal.workaway_role_keys.map((key) => (
                              <span key={key} className="rounded-full border border-sky-300/70 bg-white/65 px-3 py-1 text-xs text-sky-900">
                                {key}
                              </span>
                            ))}
                            {detailsContributionProposal.workaway_other_role_text && (
                              <span className="rounded-full border border-sky-300/70 bg-white/65 px-3 py-1 text-xs text-sky-900">
                                {detailsContributionProposal.workaway_other_role_text}
                              </span>
                            )}
                          </div>
                        )}
                        {detailsContributionProposal.workaway_hours_commitment_value != null && (
                          <p className="mt-1 text-xs text-sky-900/80">
                            {lang === "it" ? "Ore: " : "Hours: "}
                            {detailsContributionProposal.workaway_hours_commitment_value}{" "}
                            {detailsContributionProposal.workaway_hours_commitment_type === "per_week"
                              ? lang === "it" ? "a settimana" : "per week"
                              : lang === "it" ? "al giorno" : "per day"}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-sky-900/80">
                          {lang === "it"
                            ? "Puoi solo accettare o rifiutare: non e possibile un ulteriore rilancio."
                            : "You can only accept or reject: no further counter-offer is possible."}
                        </p>
                        <textarea
                          value={contributionCounterMessages[detailsRequest.id] || ""}
                          onChange={(event) =>
                            setContributionCounterMessages((current) => ({ ...current, [detailsRequest.id]: event.target.value }))
                          }
                          rows={2}
                          className="mt-3 w-full resize-y rounded-2xl border border-sky-200 bg-white/80 px-3 py-2 text-sm text-foreground focus:border-sky-500 focus:outline-none"
                          placeholder={lang === "it" ? "Messaggio opzionale per il team" : "Optional message for the team"}
                        />
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void respondToContributionCounter("accept")}
                            disabled={contributionCounterSaving}
                            className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Accetta" : "Accept"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void respondToContributionCounter("reject")}
                            disabled={contributionCounterSaving}
                            className="rounded-full border border-red-300 bg-red-100 px-3 py-2 text-xs font-semibold text-red-900 disabled:opacity-50"
                          >
                            {lang === "it" ? "Rifiuta" : "Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                    {detailsContributionMissingFiles && (
                      <div className="mt-4 rounded-[18px] border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950">
                        <p className="font-semibold">
                          {lang === "it" ? "CV/portfolio non caricati" : "CV/portfolio not uploaded"}
                        </p>
                        <p className="mt-1 text-amber-900/80">
                          {lang === "it"
                            ? "Il caricamento potrebbe non essere andato a buon fine. Puoi riprovare qui."
                            : "The upload may not have gone through. You can retry here."}
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-amber-400/70 bg-white/60 px-3 py-2 text-xs text-amber-900">
                            <span className="truncate">{retryCvFile ? retryCvFile.name : lang === "it" ? "CV" : "CV"}</span>
                            <input
                              type="file"
                              accept=".pdf,.doc,.docx"
                              className="hidden"
                              onChange={(event) => setRetryCvFile(event.target.files?.[0] ?? null)}
                            />
                          </label>
                          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-amber-400/70 bg-white/60 px-3 py-2 text-xs text-amber-900">
                            <span className="truncate">{retryPortfolioFile ? retryPortfolioFile.name : lang === "it" ? "Portfolio" : "Portfolio"}</span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(event) => setRetryPortfolioFile(event.target.files?.[0] ?? null)}
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => void retryWorkawayUpload()}
                          disabled={retryUploadSaving || (!retryCvFile && !retryPortfolioFile)}
                          className="mt-2 w-full rounded-full border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                        >
                          {retryUploadSaving
                            ? lang === "it" ? "Caricamento..." : "Uploading..."
                            : lang === "it" ? "Carica" : "Upload"}
                        </button>
                      </div>
                    )}
                    {detailsContributionProposal &&
                      (detailsContributionProposal.workaway_cv_storage_path || detailsContributionProposal.workaway_portfolio_storage_path) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {detailsContributionProposal.workaway_cv_storage_path && (
                            <button
                              type="button"
                              onClick={() => void downloadOwnWorkawayFile(detailsContributionProposal.workaway_cv_storage_path)}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-foreground hover:border-accent/50"
                            >
                              {lang === "it" ? "Il tuo CV" : "Your CV"}
                            </button>
                          )}
                          {detailsContributionProposal.workaway_portfolio_storage_path && (
                            <button
                              type="button"
                              onClick={() => void downloadOwnWorkawayFile(detailsContributionProposal.workaway_portfolio_storage_path)}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-foreground hover:border-accent/50"
                            >
                              {lang === "it" ? "Il tuo portfolio" : "Your portfolio"}
                            </button>
                          )}
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
                      {detailsRequest.status === "admin_approved" && !isAwaitingContributionPayment(detailsRequest) && (
                        <button
                          type="button"
                          onClick={() => void confirmBooking(detailsRequest.id)}
                          className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:text-accent"
                        >
                          <Check size={14} /> {lang === "it" ? "Conferma" : "Confirm"}
                        </button>
                      )}
                      {detailsRequestBalanceDue && (
                        <button
                          type="button"
                          onClick={() => openBalancePayment(detailsRequest)}
                          className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:text-accent"
                        >
                          <CreditCard size={14} />
                          {lang === "it"
                            ? `Paga il saldo (${formatDepositEur(detailsRequestBalanceDue.outstandingEur, "it")})`
                            : `Pay the balance (${formatDepositEur(detailsRequestBalanceDue.outstandingEur, "en")})`}
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
