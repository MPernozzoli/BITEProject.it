import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp, ExternalLink, Loader2, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_CHANGE_REASONS, planChangeReasonOption } from "@/lib/plan-change-reasons";
import {
  type BookableLeg,
  type BookingContributionProposal,
  type BookingProfile,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingSettings,
  type BookingVoyage,
  type BookingWaypoint,
  type VoyageBookingStatus,
  type WorkawayRole,
  formatBookingDate,
  formatBookingWindow,
  getBookingStatusClass,
  getBookingStatusLabel,
  getLegDurationHours,
  getLegLabel,
  getLocalizedBookingVoyageName,
} from "@/lib/booking-utils";
import { experienceOptions, getCandidateLanguageLabel, languageLevelOptions, normalizeCandidateInfo, type CandidateInfo } from "@/lib/booking-candidate-info";
import { formatDepositEur } from "@/lib/booking-deposit";
import { getWorkawayFileSignedUrl } from "@/lib/booking-proposal-apply";
import { updateBookingStatusWithRefund } from "@/lib/booking-refunds";
import ProfileAvatar from "@/components/ProfileAvatar";

type SupabaseError = { message: string } | null;
type SupabaseResponse = { data: unknown; error: SupabaseError };
type SupabaseQueryBuilder = PromiseLike<SupabaseResponse> & {
  select: (columns?: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  in: (column: string, values: unknown[]) => SupabaseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => SupabaseQueryBuilder;
};
type UntypedSupabase = {
  from: (table: string) => SupabaseQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResponse>;
};

const typedSupabase = supabase as unknown as UntypedSupabase;

const reviewStatuses = new Set<VoyageBookingStatus>(["requested", "waitlisted"]);
const blockingStatuses = new Set<VoyageBookingStatus>(["admin_approved", "user_confirmed"]);
// Rejected/cancelled/expired candidatures never need further action: they're kept out of the
// main review list and surfaced in a separate, collapsed "archiviate" section instead.
const archivedStatuses = new Set<VoyageBookingStatus>(["rejected", "cancelled", "expired"]);

const isCandidateInfo = (value: unknown): value is CandidateInfo =>
  typeof value === "object" && value !== null && "sailingExperienceLevel" in value;

const valueList = (items?: string[]) => (items && items.length ? items.join(", ") : "Non indicato");

type CandidateProfile = BookingProfile & {
  bio?: string | null;
  preferred_language?: string | null;
  secondary_language?: string | null;
  social_instagram?: string | null;
  social_youtube?: string | null;
  social_tiktok?: string | null;
  social_facebook?: string | null;
  social_x?: string | null;
  social_linkedin?: string | null;
  social_website?: string | null;
  social_seapeople?: string | null;
};

type BookingDeposit = {
  id: string;
  booking_request_id: string;
  participant_id: string | null;
  payment_method: string;
  status: string;
  amount_cents: number;
  currency: string;
  reference: string;
  created_at: string;
  paid_at: string | null;
};

type VoyageCandidatesPanelProps = {
  /** When set, only candidates for this voyage are shown/loaded. */
  voyageId?: string;
  /** Called after every (re)load with the number of candidates in review. */
  onCountChange?: (count: number) => void;
};

const VoyageCandidatesPanel = ({ voyageId, onCountChange }: VoyageCandidatesPanelProps) => {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [profiles, setProfiles] = useState<CandidateProfile[]>([]);
  const [voyages, setVoyages] = useState<BookingVoyage[]>([]);
  const [legs, setLegs] = useState<BookableLeg[]>([]);
  const [waypoints, setWaypoints] = useState<BookingWaypoint[]>([]);
  const [requestLegs, setRequestLegs] = useState<BookingRequestLeg[]>([]);
  const [deposits, setDeposits] = useState<BookingDeposit[]>([]);
  const [contributionProposals, setContributionProposals] = useState<BookingContributionProposal[]>([]);
  const [workawayRoles, setWorkawayRoles] = useState<WorkawayRole[]>([]);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings[]>([]);
  /** Admin's counter-proposal input for the negotiated variable amount, per request (EUR string). */
  const [contributionCounterEur, setContributionCounterEur] = useState<Record<string, string>>({});
  const [contributionCounterNote, setContributionCounterNote] = useState<Record<string, string>>({});
  /** Workaway terms the admin is countering with, per request — undefined keeps the candidate's original. */
  const [contributionCounterRoleKeys, setContributionCounterRoleKeys] = useState<Record<string, string[]>>({});
  const [proposalLegIds, setProposalLegIds] = useState<Record<string, string[]>>({});
  const [proposalNotes, setProposalNotes] = useState<Record<string, string>>({});
  /** Why each proposal is being made — decides the refund if the candidate declines it. */
  const [proposalReasons, setProposalReasons] = useState<Record<string, string>>({});
  /** Whether accepting each proposal also requires settling the difference in contribution. */
  const [proposalSettlement, setProposalSettlement] = useState<Record<string, boolean>>({});
  const [decisionMessages, setDecisionMessages] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const requestsQuery = voyageId
      ? typedSupabase.from("voyage_booking_requests").select("*").eq("voyage_id", voyageId).order("requested_at", { ascending: false })
      : typedSupabase.from("voyage_booking_requests").select("*").order("requested_at", { ascending: false });
    const [requestsRes, voyagesRes, waypointsRes, legsRes, workawayRolesRes, bookingSettingsRes] = await Promise.all([
      requestsQuery,
      typedSupabase
        .from("voyages")
        .select("id,name,name_it,name_en,type,status,booking_enabled,booking_max_guests,booking_planning_speed_kn,booking_contribution_per_nm_eur,start_date,end_date")
        .order("start_date", { ascending: true, nullsFirst: false }),
      typedSupabase
        .from("voyage_waypoints")
        .select("id,voyage_id,name,name_it,name_en,sort_order,date_start,date_end")
        .order("sort_order", { ascending: true }),
      typedSupabase
        .from("voyage_bookable_legs")
        .select("*")
        .order("sort_order", { ascending: true }),
      typedSupabase.from("voyage_workaway_roles").select("*"),
      typedSupabase.from("voyage_booking_settings").select("*"),
    ]);

    if (requestsRes.error || voyagesRes.error || waypointsRes.error || legsRes.error) {
      toast.error(requestsRes.error?.message || voyagesRes.error?.message || waypointsRes.error?.message || legsRes.error?.message || "Unable to load candidates");
      setLoading(false);
      return;
    }

    setWorkawayRoles((workawayRolesRes.data as WorkawayRole[] | null) || []);
    setBookingSettings((bookingSettingsRes.data as BookingSettings[] | null) || []);

    const loadedRequests = ((requestsRes.data as BookingRequest[] | null) || []).filter((request) => !request.is_crew);
    const requestIds = loadedRequests.map((request) => request.id);
    const profileIds = [...new Set(loadedRequests.map((request) => request.profile_id))];
    const [requestLegsRes, profilesRes, depositsRes, contributionProposalsRes] = await Promise.all([
      requestIds.length
        ? typedSupabase.from("voyage_booking_request_legs").select("*").in("booking_request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? typedSupabase
            .from("profiles")
            .select("id,name,email,avatar_url,bio,preferred_language,secondary_language,social_instagram,social_youtube,social_tiktok,social_facebook,social_x,social_linkedin,social_website,social_seapeople")
            .in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_deposits")
            .select("id,booking_request_id,participant_id,payment_method,status,amount_cents,currency,reference,created_at,paid_at")
            .in("booking_request_id", requestIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      requestIds.length
        ? typedSupabase
            .from("voyage_booking_contribution_proposals")
            .select("*")
            .in("booking_request_id", requestIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (requestLegsRes.error || profilesRes.error || depositsRes.error || contributionProposalsRes.error) {
      toast.error(
        requestLegsRes.error?.message ||
          profilesRes.error?.message ||
          depositsRes.error?.message ||
          contributionProposalsRes.error?.message ||
          "Unable to load candidate details",
      );
      setLoading(false);
      return;
    }

    setRequests(loadedRequests);
    setVoyages((voyagesRes.data as BookingVoyage[] | null) || []);
    setWaypoints((waypointsRes.data as BookingWaypoint[] | null) || []);
    setLegs((legsRes.data as BookableLeg[] | null) || []);
    setRequestLegs((requestLegsRes.data as BookingRequestLeg[] | null) || []);
    setProfiles((profilesRes.data as CandidateProfile[] | null) || []);
    setDeposits((depositsRes.data as BookingDeposit[] | null) || []);
    setContributionProposals((contributionProposalsRes.data as BookingContributionProposal[] | null) || []);
    setLoading(false);
  }, [voyageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const profilesById = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const voyagesById = useMemo(() => Object.fromEntries(voyages.map((voyage) => [voyage.id, voyage])), [voyages]);
  const waypointsById = useMemo(() => Object.fromEntries(waypoints.map((waypoint) => [waypoint.id, waypoint])), [waypoints]);
  const legsByVoyage = useMemo(() => {
    const map: Record<string, BookableLeg[]> = {};
    for (const leg of legs) {
      if (!map[leg.voyage_id]) map[leg.voyage_id] = [];
      map[leg.voyage_id].push(leg);
    }
    return map;
  }, [legs]);
  const legIdsByRequest = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const link of requestLegs) {
      if (!map[link.booking_request_id]) map[link.booking_request_id] = [];
      map[link.booking_request_id].push(link.bookable_leg_id);
    }
    return map;
  }, [requestLegs]);
  const legsById = useMemo(() => Object.fromEntries(legs.map((leg) => [leg.id, leg])), [legs]);
  const depositsByRequest = useMemo(() => {
    const map: Record<string, BookingDeposit[]> = {};
    for (const deposit of deposits) {
      if (!map[deposit.booking_request_id]) map[deposit.booking_request_id] = [];
      map[deposit.booking_request_id].push(deposit);
    }
    return map;
  }, [deposits]);
  // Latest non-superseded proposal per request (rows come pre-sorted created_at desc from load()).
  const latestContributionProposalByRequest = useMemo(() => {
    const map: Record<string, BookingContributionProposal> = {};
    for (const proposal of contributionProposals) {
      if (proposal.status === "superseded") continue;
      if (!map[proposal.booking_request_id]) map[proposal.booking_request_id] = proposal;
    }
    return map;
  }, [contributionProposals]);
  const workawayRoleLabel = useCallback(
    (key: string) => workawayRoles.find((role) => role.key === key)?.label_it || key,
    [workawayRoles],
  );
  const bookingSettingsByVoyage = useMemo(
    () => Object.fromEntries(bookingSettings.map((settings) => [settings.voyage_id, settings])),
    [bookingSettings],
  );

  // Deliberately does NOT include plan_change_status === "pending_user_approval": that means an
  // ADMIN-sent proposal is awaiting the TRAVELLER, not something for the admin to review here —
  // counting it made a change the admin proposed look like a candidacy the guest had requested.
  const candidates = useMemo(
    () => requests.filter((request) => reviewStatuses.has(request.status)),
    [requests],
  );

  const archivedCandidates = useMemo(
    () =>
      requests
        .filter((request) => archivedStatuses.has(request.status))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [requests],
  );

  useEffect(() => {
    onCountChange?.(candidates.length);
  }, [candidates.length, onCountChange]);

  const setStatus = async (request: BookingRequest, status: VoyageBookingStatus) => {
    if (status === "admin_approved") {
      const requestDeposits = depositsByRequest[request.id] || [];
      if (requestDeposits.some((deposit) => deposit.status === "pending")) {
        toast.error("Pagamento contributo ancora in sospeso: la candidatura resta bloccata finche Bunq non conferma il pagamento.");
        return;
      }
      if (!requestDeposits.some((deposit) => deposit.status === "paid")) {
        toast.error("Nessun contributo risulta pagato per questa candidatura: non puoi approvarla finche il pagamento non e stato ricevuto.");
        return;
      }
    }
    const adminMessage = decisionMessages[request.id]?.trim() || null;
    setSavingId(request.id);
    const result =
      status === "rejected"
        ? await updateBookingStatusWithRefund({
            bookingRequestId: request.id,
            status: "rejected",
            trigger: "admin_rejected",
            adminNotes: adminMessage,
          })
        : await typedSupabase.rpc("admin_set_voyage_booking_status", {
            _booking_request_id: request.id,
            _status: status,
            _allow_over_capacity: false,
            _admin_notes: adminMessage,
          });
    setSavingId(null);
    // "ok" tells the refund fetch apart from the rpc response; the explicit
    // === false is what narrows the union with strictNullChecks off.
    if ("ok" in result && result.ok === false) {
      toast.error(result.error);
      return;
    }
    if (!("ok" in result) && result.error) {
      toast.error(result.error.message);
      return;
    }
    if ("ok" in result && result.ok === true && result.refundPending) {
      toast.warning(
        `Candidatura scartata. Rimborso da gestire manualmente (EUR ${result.refundPendingAmountEur.toFixed(2)}): nessun IBAN disponibile, all'utente e stato chiesto via email di comunicarlo.`,
      );
      await load();
      return;
    }
    toast.success(status === "admin_approved" ? "Candidatura approvata." : "Candidatura scartata.");
    await load();
  };

  const toggleProposalLeg = (requestId: string, legId: string) => {
    setProposalLegIds((current) => {
      const selected = current[requestId] || [];
      return {
        ...current,
        [requestId]: selected.includes(legId) ? selected.filter((id) => id !== legId) : [...selected, legId],
      };
    });
  };

  const setProposalRange = (requestId: string, voyageLegs: BookableLeg[], legId: string) => {
    const current = proposalLegIds[requestId] || [];
    if (current.length === 0) {
      setProposalLegIds((values) => ({ ...values, [requestId]: [legId] }));
      return;
    }

    const indexById = new Map(voyageLegs.map((leg, index) => [leg.id, index]));
    const currentIndices = current.map((id) => indexById.get(id)).filter((index): index is number => index != null);
    const nextIndex = indexById.get(legId);
    if (nextIndex == null) return;
    const min = Math.min(...currentIndices, nextIndex);
    const max = Math.max(...currentIndices, nextIndex);
    setProposalLegIds((values) => ({
      ...values,
      [requestId]: voyageLegs.slice(min, max + 1).map((leg) => leg.id),
    }));
  };

  const proposeLegs = async (request: BookingRequest) => {
    const legIds = proposalLegIds[request.id] || [];
    if (legIds.length === 0) {
      toast.error("Seleziona almeno una tratta da proporre.");
      return;
    }
    const reason = proposalReasons[request.id];
    if (!reason) {
      toast.error("Seleziona la motivazione della modifica.");
      return;
    }
    setSavingId(request.id);
    const { error } = await typedSupabase.rpc("admin_propose_voyage_booking_legs", {
      _booking_request_id: request.id,
      _proposed_leg_ids: legIds,
      _admin_note: proposalNotes[request.id] || null,
      _change_reason: reason,
      _require_settlement: proposalSettlement[request.id] ?? false,
    });
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Proposta inviata al candidato.");
    await load();
  };

  const acceptContributionProposal = async (request: BookingRequest) => {
    if (!confirm("Accettare la proposta cosi come inviata dal candidato?")) return;
    setSavingId(request.id);
    const { error } = await typedSupabase.rpc("admin_accept_voyage_booking_contribution_proposal", {
      _booking_request_id: request.id,
      _admin_note: contributionCounterNote[request.id] || null,
    });
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Proposta accettata. Se resta un saldo da versare, verra richiesto al candidato.");
    await load();
  };

  const counterContributionProposal = async (request: BookingRequest) => {
    const rawEur = contributionCounterEur[request.id];
    const hasEurInput = Boolean(rawEur && rawEur.trim());
    const counterEur = hasEurInput ? Number(rawEur) : null;
    if (hasEurInput && (!Number.isFinite(counterEur) || (counterEur as number) < 0)) {
      toast.error("Indica un importo valido per la contro-proposta.");
      return;
    }
    const counterRoleKeys = contributionCounterRoleKeys[request.id];
    if (!hasEurInput && (!counterRoleKeys || counterRoleKeys.length === 0)) {
      toast.error("Indica un importo e/o le mansioni che vuoi contro-proporre.");
      return;
    }
    if (!confirm("Inviare questa contro-proposta al candidato? Potra solo accettarla o rifiutarla, senza ulteriori rilanci.")) {
      return;
    }
    setSavingId(request.id);
    const { error } = await typedSupabase.rpc("admin_counter_voyage_booking_contribution_proposal", {
      _booking_request_id: request.id,
      _proposed_variable_cents: hasEurInput ? Math.round((counterEur as number) * 100) : null,
      _admin_note: contributionCounterNote[request.id] || null,
      _workaway_role_keys: counterRoleKeys && counterRoleKeys.length > 0 ? counterRoleKeys : null,
    });
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contro-proposta inviata al candidato.");
    await load();
  };

  const downloadWorkawayFile = async (path: string | null) => {
    if (!path) return;
    const signedUrl = await getWorkawayFileSignedUrl(path);
    if (!signedUrl) {
      toast.error("Impossibile generare il link al file.");
      return;
    }
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  const profileSocialLinks = (profile?: CandidateProfile) => {
    if (!profile) return [];
    return [
      { label: "Instagram", value: profile.social_instagram },
      { label: "YouTube", value: profile.social_youtube },
      { label: "TikTok", value: profile.social_tiktok },
      { label: "Facebook", value: profile.social_facebook },
      { label: "X", value: profile.social_x },
      { label: "LinkedIn", value: profile.social_linkedin },
      { label: "Website", value: profile.social_website },
      { label: "SeaPeople", value: profile.social_seapeople },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value?.trim()));
  };

  const normalizeSocialUrl = (label: string, value: string) => {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const handle = trimmed.replace(/^@/, "");
    if (label === "Instagram") return `https://instagram.com/${handle}`;
    if (label === "YouTube") return `https://youtube.com/@${handle}`;
    if (label === "TikTok") return `https://tiktok.com/@${handle}`;
    if (label === "Facebook") return `https://facebook.com/${handle}`;
    if (label === "X") return `https://x.com/${handle}`;
    if (label === "LinkedIn") return `https://linkedin.com/in/${handle}`;
    if (label === "SeaPeople") return `https://dashboard.seapeopleapp.com/${handle}`;
    return `https://${handle}`;
  };

  const renderCandidateInfo = (value: unknown) => {
    if (!isCandidateInfo(value)) {
      return <p className="text-sm text-muted-foreground">Informazioni candidato non ancora disponibili.</p>;
    }
    const candidateInfo = normalizeCandidateInfo(value);
    const languageLabels = candidateInfo.languages.map((language) => {
      const level = languageLevelOptions.find((option) => option.value === candidateInfo.languageLevels[language]);
      return `${getCandidateLanguageLabel(language)}${level ? ` (${level.it})` : ""}`;
    });
    const experience = experienceOptions.find((option) => option.value === candidateInfo.sailingExperienceLevel)?.it || "Non indicato";
    return (
      <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <InfoLine label="Esperienza" value={experience} />
        <InfoLine label="Tipo navigazione" value={`${valueList(candidateInfo.sailingKinds)} · ${candidateInfo.navigationRange || "range non indicato"}`} />
        <InfoLine label="Eta" value={candidateInfo.ageRange || "Non indicata"} />
        <InfoLine label="Lingue" value={`${valueList(languageLabels)}${candidateInfo.otherLanguages ? `, ${candidateInfo.otherLanguages}` : ""}`} />
        <InfoLine label="Lavoro remoto" value={candidateInfo.workDuringVoyage || "Non indicato"} />
        <InfoLine label="Professione" value={candidateInfo.workRole || "Non indicata"} />
        <InfoLine label="Cibo/allergie" value={`${valueList(candidateInfo.foodRegimes)}${candidateInfo.allergies ? ` · ${candidateInfo.allergies}` : ""}`} />
        <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Motivazione</p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-foreground">{candidateInfo.motivation || "Non indicata"}</p>
        </div>
        {candidateInfo.notes && (
          <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Altre note</p>
            <p className="mt-1 whitespace-pre-line leading-relaxed text-foreground/80">{candidateInfo.notes}</p>
          </div>
        )}
      </div>
    );
  };

  const formatDepositAmount = (deposit: BookingDeposit) =>
    new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: deposit.currency || "EUR",
    }).format(deposit.amount_cents / 100);

  const paymentMethodLabel = (method: string) =>
    method === "bank_transfer" ? "Bonifico" : method === "bunq_link" ? "Bunq online" : method;

  const depositStatusLabel = (status: string) => {
    if (status === "pending") return "Pagamento in attesa";
    if (status === "paid") return "Pagamento ricevuto";
    if (status === "cancelled") return "Pagamento annullato";
    if (status === "failed") return "Pagamento fallito";
    if (status === "refunded") return "Rimborsato";
    if (status === "partially_refunded") return "Rimborso parziale";
    return status;
  };

  const depositStatusClass = (status: string) => {
    if (status === "pending") return "border-amber-300/70 bg-amber-100/70 text-amber-900";
    if (status === "paid") return "border-emerald-300/70 bg-emerald-100/70 text-emerald-900";
    if (status === "cancelled" || status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
    return "border-border/70 bg-background/60 text-muted-foreground";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Candidature in revisione</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Valuta le informazioni e proponi tratte diverse. Le candidature con contributo pending restano bloccate finche Bunq non conferma il pagamento.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="glass-chip inline-flex items-center gap-2 self-start px-4 py-2 text-sm text-foreground hover:text-accent"
        >
          <RefreshCw size={15} /> Aggiorna
        </button>
      </div>

      {loading ? (
        <div className="rounded-[24px] border border-border/70 p-8 text-muted-foreground">
          <Loader2 className="mr-2 inline animate-spin" size={16} /> Loading candidates...
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-[24px] border border-border/70 p-8 text-sm text-muted-foreground">
          Nessuna candidatura in revisione.
        </div>
      ) : (
        <div className="space-y-5">
          {candidates.map((request) => {
            const profile = profilesById[request.profile_id];
            const voyage = voyagesById[request.voyage_id];
            const currentLegIds = legIdsByRequest[request.id] || [];
            const currentLegs = currentLegIds.map((id) => legsById[id]).filter(Boolean);
            const voyageLegs = legsByVoyage[request.voyage_id] || [];
            const selectedProposal = proposalLegIds[request.id] || [];
            const voyageRequests = requests.filter((item) => item.voyage_id === request.voyage_id);
            const socialLinks = profileSocialLinks(profile);
            const requestDeposits = depositsByRequest[request.id] || [];
            const hasPendingDeposit = requestDeposits.some((deposit) => deposit.status === "pending");
            const contributionProposal = latestContributionProposalByRequest[request.id];
            const hasUnresolvedContributionProposal =
              contributionProposal &&
              (contributionProposal.status === "pending_admin_review" || contributionProposal.status === "pending_user_approval");
            const negotiatedBalancePaidCents = requestDeposits
              .filter((deposit) => deposit.status === "paid")
              .reduce((sum, deposit) => sum + deposit.amount_cents, 0);
            const negotiatedBalanceDue =
              request.contribution_proposal_status === "accepted" &&
              (request.contribution_resolved_variable_cents ?? 0) > 0 &&
              negotiatedBalancePaidCents < 2000 * Math.max(1, request.party_size) + (request.contribution_resolved_variable_cents ?? 0);
            const requestBookingSettings = bookingSettingsByVoyage[request.voyage_id];
            const counterRawEur = contributionCounterEur[request.id];
            const counterEurValue = counterRawEur ? Number(counterRawEur) : null;
            const counterPercent =
              counterEurValue != null && Number.isFinite(counterEurValue) && contributionProposal && contributionProposal.standard_variable_cents > 0
                ? Math.round(((counterEurValue * 100) / contributionProposal.standard_variable_cents) * 100)
                : null;
            const counterOutOfRange =
              counterPercent != null &&
              requestBookingSettings &&
              (counterPercent < requestBookingSettings.contribution_proposal_min_percent ||
                counterPercent > requestBookingSettings.contribution_proposal_max_percent);
            return (
              <article key={request.id} className="rounded-[30px] border border-border/70 bg-background/40 p-5 md:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="editorial-heading text-2xl">
                        {profile?.name || profile?.email || "Candidato"}
                      </h2>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${getBookingStatusClass(request.status)}`}>
                        {getBookingStatusLabel(request.status, "it")}
                      </span>
                      {request.plan_change_status === "pending_user_approval" && (
                        <span className="rounded-full border border-sky-300/70 bg-sky-100/70 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
                          Proposta inviata
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {profile?.email || "No email"} · {getLocalizedBookingVoyageName(voyage, "it") || request.voyage_id} · {request.party_size} pax · {formatBookingDate(request.requested_at, "it-IT")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/profile/${request.profile_id}`}
                      className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink size={13} /> Profilo pubblico
                    </Link>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
                  <section className="min-w-0 rounded-[24px] border border-border/70 bg-background/45 p-4">
                    <div className="mb-4 flex items-start gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-border bg-accent/10">
                        <ProfileAvatar
                          name={profile?.name || profile?.email || "Candidato"}
                          avatarUrl={profile?.avatar_url ?? null}
                          fallback={<span className="flex h-full w-full items-center justify-center text-sm font-semibold text-accent">{(profile?.name || profile?.email || "?").slice(0, 2).toUpperCase()}</span>}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{profile?.name || "Nome non impostato"}</p>
                        <p className="text-xs text-muted-foreground">{profile?.email || "No email"}</p>
                        {(profile?.preferred_language || profile?.secondary_language) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Lingue profilo: {[profile.preferred_language, profile.secondary_language].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    {profile?.bio && (
                      <p className="mb-4 whitespace-pre-line rounded-2xl border border-border/60 bg-background/60 p-3 text-sm leading-relaxed text-muted-foreground">
                        {profile.bio}
                      </p>
                    )}
                    {socialLinks.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {socialLinks.map((link) => (
                          <a
                            key={`${link.label}-${link.value}`}
                            href={normalizeSocialUrl(link.label, link.value)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    )}
                    <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Informazioni candidatura</p>
                    {renderCandidateInfo(request.candidate_info)}
                  </section>

                  <section className="min-w-0 space-y-4 rounded-[24px] border border-border/70 bg-background/45 p-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Tratte richieste</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {currentLegs.map((leg) => (
                          <span key={leg.id} className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                            {getLegLabel(leg, waypointsById, "it")}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-border/70 pt-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Pagamento contributo</p>
                      {requestDeposits.length === 0 ? (
                        <p className="mt-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                          Nessun contributo di candidatura registrato per questa richiesta.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {requestDeposits.map((deposit) => (
                            <div key={deposit.id} className="rounded-2xl border border-border/70 bg-background/60 p-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${depositStatusClass(deposit.status)}`}>
                                  {depositStatusLabel(deposit.status)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {paymentMethodLabel(deposit.payment_method)} · {formatDepositAmount(deposit)}
                                </span>
                              </div>
                              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                                <InfoLine label="Causale" value={deposit.reference} />
                                <InfoLine label="Creato" value={formatBookingDate(deposit.created_at, "it-IT")} />
                                <InfoLine label="Ricevuto" value={deposit.paid_at ? formatBookingDate(deposit.paid_at, "it-IT") : "Non ancora"} />
                                <InfoLine label="Metodo" value={paymentMethodLabel(deposit.payment_method)} />
                              </div>
                            </div>
                          ))}
                          {hasPendingDeposit && (
                            <p className="rounded-2xl border border-amber-300/70 bg-amber-100/70 p-3 text-xs font-semibold text-amber-900">
                              Non approvare finche il conto Bunq non conferma importo e causale: la candidatura resta in pending.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border/70 pt-4">
                      <div className="mb-3">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Gantt revisione</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Vista di contesto: mostra dove entrerebbe il candidato e con chi. I click sulla riga del candidato compongono una proposta, non modificano la booking.
                        </p>
                      </div>
                      <CandidateReviewGantt
                        request={request}
                        requests={voyageRequests}
                        profilesById={profilesById}
                        waypointsById={waypointsById}
                        legs={voyageLegs}
                        requestLegIds={legIdsByRequest}
                        selectedProposalLegIds={selectedProposal}
                        onToggleProposalLeg={(legId) => toggleProposalLeg(request.id, legId)}
                        onSetProposalRange={(legId) => setProposalRange(request.id, voyageLegs, legId)}
                      />
                      <select
                        value={proposalReasons[request.id] || ""}
                        onChange={(event) =>
                          setProposalReasons((current) => ({ ...current, [request.id]: event.target.value }))
                        }
                        className="mt-3 w-full rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="">Motivazione della modifica...</option>
                        {PLAN_CHANGE_REASONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {planChangeReasonOption(proposalReasons[request.id]) && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {planChangeReasonOption(proposalReasons[request.id])?.forceMajeure
                            ? "Forza maggiore: se rifiuta, il rimborso segue le fasce della rinuncia (100% oltre 30gg, 50% tra 15 e 30, 0% sotto i 15)."
                            : "Non forza maggiore: se rifiuta, il rimborso e sempre del 100%."}
                        </p>
                      )}
                      <textarea
                        value={proposalNotes[request.id] || ""}
                        onChange={(event) => setProposalNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        rows={3}
                        className="mt-3 w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        placeholder="Nota per la proposta (es. meglio imbarco dopo, tratta piu breve, aggiungere tappa...)"
                      />
                      <div className="mt-3">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Conguaglio del contributo</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setProposalSettlement((current) => ({ ...current, [request.id]: false }))}
                            aria-pressed={!(proposalSettlement[request.id] ?? false)}
                            className={`rounded-2xl border p-3 text-left text-[11px] leading-relaxed transition-colors ${
                              !(proposalSettlement[request.id] ?? false)
                                ? "border-accent bg-accent/10 text-foreground"
                                : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                            }`}
                          >
                            <span className="block text-xs font-semibold">Senza conguaglio</span>
                            Accettando, le tratte cambiano e non viene chiesto nessun altro pagamento.
                          </button>
                          <button
                            type="button"
                            onClick={() => setProposalSettlement((current) => ({ ...current, [request.id]: true }))}
                            aria-pressed={proposalSettlement[request.id] ?? false}
                            className={`rounded-2xl border p-3 text-left text-[11px] leading-relaxed transition-colors ${
                              proposalSettlement[request.id] ?? false
                                ? "border-accent bg-accent/10 text-foreground"
                                : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                            }`}
                          >
                            <span className="block text-xs font-semibold">Con conguaglio</span>
                            Accettando, resta da versare la differenza fra il nuovo contributo e quanto gia pagato.
                          </button>
                        </div>
                        {(proposalSettlement[request.id] ?? false) && (
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Se la candidatura non e ancora approvata, torna in attesa di pagamento finche la differenza non arriva. Se il posto e gia confermato non viene revocato: la differenza resta dovuta. Se la nuova tratta costa meno, l'eccedenza va rimborsata manualmente.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void proposeLegs(request)}
                        disabled={savingId === request.id}
                        className="glass-chip mt-3 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
                      >
                        {savingId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Invia proposta al candidato
                      </button>
                    </div>

                    {contributionProposal && (
                      <div className="border-t border-border/70 pt-4">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                          Negoziazione contributo / workaway
                        </p>
                        <div className="mt-2 rounded-2xl border border-border/70 bg-background/60 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                contributionProposal.status === "accepted"
                                  ? "border-emerald-300/70 bg-emerald-100/70 text-emerald-900"
                                  : contributionProposal.status === "rejected"
                                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                                    : "border-amber-300/70 bg-amber-100/70 text-amber-900"
                              }`}
                            >
                              {contributionProposal.status === "pending_admin_review"
                                ? "In attesa di revisione"
                                : contributionProposal.status === "pending_user_approval"
                                  ? "Contro-proposta in attesa del candidato"
                                  : contributionProposal.status === "accepted"
                                    ? "Accettata"
                                    : "Rifiutata"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {contributionProposal.proposed_by === "candidate" ? "Proposta del candidato" : "Contro-proposta admin"}
                            </span>
                          </div>

                          {(contributionProposal.proposal_kind === "contribution" || contributionProposal.proposal_kind === "hybrid") && (
                            <p className="mt-2 text-xs text-foreground">
                              Contributo variabile proposto:{" "}
                              <span className="font-semibold">
                                {contributionProposal.proposed_variable_cents != null
                                  ? formatDepositEur(contributionProposal.proposed_variable_cents / 100, "it")
                                  : "—"}
                              </span>{" "}
                              su una quota standard di {formatDepositEur(contributionProposal.standard_variable_cents / 100, "it")}
                              {contributionProposal.proposed_variable_percent != null
                                ? ` (${contributionProposal.proposed_variable_percent}%)`
                                : ""}
                              . Il fisso di €20 resta invariato.
                            </p>
                          )}

                          {(contributionProposal.proposal_kind === "workaway" || contributionProposal.proposal_kind === "hybrid") && (
                            <div className="mt-2 text-xs text-foreground">
                              <p className="font-semibold">Workaway proposto</p>
                              {contributionProposal.workaway_role_keys.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {contributionProposal.workaway_role_keys.map((key) => (
                                    <span key={key} className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1 text-[11px]">
                                      {workawayRoleLabel(key)}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {contributionProposal.workaway_other_role_text && (
                                <p className="mt-1 text-muted-foreground">Altro: {contributionProposal.workaway_other_role_text}</p>
                              )}
                              {contributionProposal.workaway_message && (
                                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{contributionProposal.workaway_message}</p>
                              )}
                              {contributionProposal.workaway_hours_commitment_value != null && (
                                <p className="mt-1 text-muted-foreground">
                                  Ore garantite: {contributionProposal.workaway_hours_commitment_value}{" "}
                                  {contributionProposal.workaway_hours_commitment_type === "per_week" ? "a settimana" : "al giorno"}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2">
                                {contributionProposal.workaway_cv_storage_path && (
                                  <button
                                    type="button"
                                    onClick={() => void downloadWorkawayFile(contributionProposal.workaway_cv_storage_path)}
                                    className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:text-accent"
                                  >
                                    <ExternalLink size={11} /> CV
                                  </button>
                                )}
                                {contributionProposal.workaway_portfolio_storage_path && (
                                  <button
                                    type="button"
                                    onClick={() => void downloadWorkawayFile(contributionProposal.workaway_portfolio_storage_path)}
                                    className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:text-accent"
                                  >
                                    <ExternalLink size={11} /> Portfolio
                                  </button>
                                )}
                                {contributionProposal.workaway_portfolio_url && (
                                  <a
                                    href={contributionProposal.workaway_portfolio_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-foreground hover:text-accent"
                                  >
                                    <ExternalLink size={11} /> Link
                                  </a>
                                )}
                              </div>
                              {contributionProposal.workaway_requests_compensation && (
                                <p className="mt-2 rounded-xl border border-sky-300/70 bg-sky-100/70 p-2 text-[11px] font-semibold text-sky-900">
                                  Il candidato richiede inoltre un compenso di{" "}
                                  {contributionProposal.workaway_requested_compensation_cents != null
                                    ? formatDepositEur(contributionProposal.workaway_requested_compensation_cents / 100, "it")
                                    : "importo non specificato"}{" "}
                                  in aggiunta al viaggio.
                                </p>
                              )}
                            </div>
                          )}

                          {contributionProposal.candidate_message && (
                            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                              Messaggio del candidato: {contributionProposal.candidate_message}
                            </p>
                          )}
                        </div>

                        {hasUnresolvedContributionProposal && contributionProposal.proposed_by === "candidate" && (
                          <div className="mt-3">
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={contributionCounterEur[request.id] || ""}
                                onChange={(event) =>
                                  setContributionCounterEur((current) => ({ ...current, [request.id]: event.target.value }))
                                }
                                placeholder="Contro-proposta (EUR) — lascia vuoto per non toccare l'importo"
                                className="w-full rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void counterContributionProposal(request)}
                                disabled={savingId === request.id}
                                className="glass-chip inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
                              >
                                Contro-proponi
                              </button>
                            </div>
                            {counterPercent != null && (
                              <p className={`mt-1 text-[11px] ${counterOutOfRange ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>
                                Equivale al {counterPercent}% della quota standard
                                {requestBookingSettings
                                  ? ` (range configurato per il candidato: ${requestBookingSettings.contribution_proposal_min_percent}%–${requestBookingSettings.contribution_proposal_max_percent}%)`
                                  : ""}
                                {counterOutOfRange ? " — fuori dal range che vale per il candidato, ma tu come admin puoi comunque inviarla." : ""}
                              </p>
                            )}
                            {(contributionProposal.proposal_kind === "workaway" || contributionProposal.proposal_kind === "hybrid") && (
                              <div className="mt-2">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                  Mansioni della contro-proposta (lascia invariato per non toccarle)
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {workawayRoles.map((role) => {
                                    const selected = (contributionCounterRoleKeys[request.id] ?? contributionProposal.workaway_role_keys).includes(
                                      role.key,
                                    );
                                    return (
                                      <button
                                        key={role.key}
                                        type="button"
                                        onClick={() =>
                                          setContributionCounterRoleKeys((current) => {
                                            const base = current[request.id] ?? contributionProposal.workaway_role_keys;
                                            const next = base.includes(role.key)
                                              ? base.filter((key) => key !== role.key)
                                              : [...base, role.key];
                                            return { ...current, [request.id]: next };
                                          })
                                        }
                                        aria-pressed={selected}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                          selected
                                            ? "border-accent bg-accent/10 text-foreground"
                                            : "border-border/70 bg-background/40 text-muted-foreground hover:border-accent/50"
                                        }`}
                                      >
                                        {role.label_it}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            <textarea
                              value={contributionCounterNote[request.id] || ""}
                              onChange={(event) =>
                                setContributionCounterNote((current) => ({ ...current, [request.id]: event.target.value }))
                              }
                              rows={2}
                              className="mt-2 w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                              placeholder="Nota per il candidato (facoltativa)"
                            />
                            <button
                              type="button"
                              onClick={() => void acceptContributionProposal(request)}
                              disabled={savingId === request.id}
                              className="glass-chip mt-2 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
                            >
                              {savingId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              Accetta come proposto
                            </button>
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                              Per rifiutare la proposta usa "Scarta" qui sotto: il contributo fisso gia versato viene rimborsato automaticamente.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="border-t border-border/70 pt-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Messaggio decisione</p>
                      <textarea
                        value={decisionMessages[request.id] || ""}
                        onChange={(event) => setDecisionMessages((current) => ({ ...current, [request.id]: event.target.value }))}
                        rows={3}
                        className="mt-3 w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        placeholder="Messaggio opzionale per approvazione o rifiuto"
                      />
                      {(hasPendingDeposit || hasUnresolvedContributionProposal || negotiatedBalanceDue) && (
                        <p className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-100/60 px-3 py-2 text-xs font-medium text-amber-900">
                          {hasPendingDeposit
                            ? "Approvazione bloccata: pagamento contributo in attesa di conferma Bunq."
                            : hasUnresolvedContributionProposal
                              ? "Approvazione bloccata: proposta di contributo/workaway non ancora risolta."
                              : "Approvazione bloccata: la proposta e stata accettata ma il saldo negoziato non risulta ancora pagato."}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void setStatus(request, "admin_approved")}
                          disabled={
                            savingId === request.id ||
                            hasPendingDeposit ||
                            Boolean(hasUnresolvedContributionProposal) ||
                            negotiatedBalanceDue
                          }
                          className="glass-chip inline-flex flex-1 items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:text-accent disabled:opacity-50"
                        >
                          {savingId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Approva
                        </button>
                        <button
                          type="button"
                          onClick={() => void setStatus(request, "rejected")}
                          disabled={savingId === request.id}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50"
                        >
                          <X size={14} /> Scarta
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && archivedCandidates.length > 0 && (
        <div className="rounded-[24px] border border-border/70">
          <button
            type="button"
            onClick={() => setShowArchived((current) => !current)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Candidature archiviate</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {archivedCandidates.length} scartate, scadute o annullate per questo viaggio.
              </p>
            </div>
            {showArchived ? (
              <ChevronUp size={18} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown size={18} className="shrink-0 text-muted-foreground" />
            )}
          </button>
          {showArchived && (
            <ul className="space-y-2 border-t border-border/70 px-5 pb-5 pt-4">
              {archivedCandidates.map((request) => {
                const profile = profilesById[request.profile_id];
                const voyage = voyagesById[request.voyage_id];
                const currentLegIds = legIdsByRequest[request.id] || [];
                const currentLegs = currentLegIds.map((id) => legsById[id]).filter(Boolean);
                return (
                  <li
                    key={request.id}
                    className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{profile?.name || profile?.email || "Candidato"}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${getBookingStatusClass(request.status)}`}>
                          {getBookingStatusLabel(request.status, "it")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {profile?.email || "No email"} · {getLocalizedBookingVoyageName(voyage, "it") || request.voyage_id} ·{" "}
                        {currentLegs.length > 0 ? currentLegs.map((leg) => getLegLabel(leg, waypointsById, "it")).join(", ") : "Nessuna tratta"} ·{" "}
                        {request.party_size} pax
                      </p>
                      {request.admin_notes && (
                        <p className="mt-1 text-xs text-muted-foreground/90">{request.admin_notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatBookingDate(request.updated_at, "it-IT")}</span>
                      <Link
                        to={`/profile/${request.profile_id}`}
                        className="glass-chip inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink size={12} /> Profilo
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const InfoLine = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
    <p className="mt-0.5 break-words leading-snug text-foreground">{value}</p>
  </div>
);

/** Pulls proposed_leg_ids out of a request's plan-change metadata bag. */
const readProposedLegIds = (meta: Record<string, unknown> | null | undefined): string[] => {
  const value = meta?.proposed_leg_ids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

type CandidateReviewGanttProps = {
  request: BookingRequest;
  requests: BookingRequest[];
  profilesById: Record<string, CandidateProfile>;
  waypointsById: Record<string, BookingWaypoint>;
  legs: BookableLeg[];
  requestLegIds: Record<string, string[]>;
  selectedProposalLegIds: string[];
  onToggleProposalLeg: (legId: string) => void;
  onSetProposalRange: (legId: string) => void;
};

const CandidateReviewGantt = ({
  request,
  requests,
  profilesById,
  waypointsById,
  legs,
  requestLegIds,
  selectedProposalLegIds,
  onToggleProposalLeg,
  onSetProposalRange,
}: CandidateReviewGanttProps) => {
  const sortedLegs = [...legs].sort((a, b) => a.sort_order - b.sort_order);
  const rows = [
    request,
    ...requests
      .filter((item) => item.id !== request.id && blockingStatuses.has(item.status))
      .sort((a, b) => {
        const aName = profilesById[a.profile_id]?.name || profilesById[a.profile_id]?.email || "";
        const bName = profilesById[b.profile_id]?.name || profilesById[b.profile_id]?.email || "";
        return aName.localeCompare(bName);
      }),
  ];

  if (sortedLegs.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nessuna tratta disponibile per questo viaggio.</p>;
  }

  // Legs the candidate is actually involved in — currently booked or part of the
  // proposal being composed — expand to show full details; the rest stay compact "T#".
  const highlightedLegIds = new Set<string>([
    ...(requestLegIds[request.id] || []),
    ...selectedProposalLegIds,
  ]);

  const columnStyle = {
    gridTemplateColumns: `minmax(132px, 0.9fr) ${sortedLegs
      .map((leg) => (highlightedLegIds.has(leg.id) ? "minmax(184px, 1.8fr)" : "minmax(44px, 0.65fr)"))
      .join(" ")}`,
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/60">
      <div className="min-w-[720px]">
        <div className="grid items-stretch border-b border-border/70 text-[11px] uppercase tracking-[0.14em] text-muted-foreground" style={columnStyle}>
          <div className="flex items-center border-r border-border/70 px-3 py-2">Persona</div>
          {sortedLegs.map((leg) => {
            if (!highlightedLegIds.has(leg.id)) {
              return (
                <div key={leg.id} className="flex items-center justify-center border-r border-border/50 px-2 py-2 text-center last:border-r-0">
                  T{leg.sort_order}
                </div>
              );
            }
            const route = getLegLabel(leg, waypointsById, "it");
            const nm = leg.planned_nautical_miles != null ? Math.round(leg.planned_nautical_miles) : null;
            const hours = getLegDurationHours(leg);
            const durationLabel = hours != null && hours > 0 ? `${Math.round(hours)} h` : null;
            const departure = formatBookingWindow(leg.starts_at_window_start, leg.starts_at_window_end, "it-IT");
            const arrival = formatBookingWindow(leg.ends_at_window_start, leg.ends_at_window_end, "it-IT");
            return (
              <div key={leg.id} className="border-r border-border/50 px-2.5 py-2 text-left normal-case tracking-normal last:border-r-0">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">T{leg.sort_order}</span>
                  <span className="truncate text-[11px] font-semibold text-foreground" title={route}>{route}</span>
                </div>
                {(nm != null || durationLabel) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-foreground/70">
                    {nm != null && <span>{nm} nm</span>}
                    {nm != null && durationLabel && <span className="text-border">·</span>}
                    {durationLabel && <span>{durationLabel}</span>}
                  </div>
                )}
                {(departure || arrival) && (
                  <div className="mt-1 space-y-0.5 text-[10px] leading-tight text-muted-foreground">
                    {departure && <div className="truncate" title={departure}><span className="text-foreground/55">Part.</span> {departure}</div>}
                    {arrival && <div className="truncate" title={arrival}><span className="text-foreground/55">Arr.</span> {arrival}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {rows.map((row) => {
          const isCandidate = row.id === request.id;
          const profile = profilesById[row.profile_id];
          const activeLegs = new Set(requestLegIds[row.id] || []);
          // While composing, show the live selection; once a proposal has been sent (and the
          // composition cleared on reload) keep the pending proposal visible so the admin still
          // sees the outstanding change instead of just the current legs.
          const persistedProposedLegIds =
            isCandidate && row.plan_change_status === "pending_user_approval"
              ? readProposedLegIds(row.plan_change_metadata)
              : [];
          const proposedLegs = new Set(
            selectedProposalLegIds.length > 0 ? selectedProposalLegIds : persistedProposedLegIds,
          );
          return (
            <div key={row.id} className="grid min-h-[54px] border-b border-border/50 last:border-b-0" style={columnStyle}>
              <div className="flex min-w-0 items-center gap-2 border-r border-border/70 px-3 py-2">
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-accent/10">
                  <ProfileAvatar
                    name={profile?.name || profile?.email || "Candidato"}
                    avatarUrl={profile?.avatar_url ?? null}
                    fallback={<span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-accent">{(profile?.name || profile?.email || "?").slice(0, 2).toUpperCase()}</span>}
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{profile?.name || profile?.email || "Candidato"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{isCandidate ? "Candidatura" : getBookingStatusLabel(row.status, "it")}</p>
                </div>
              </div>
              {sortedLegs.map((leg) => {
                const currentlySelected = activeLegs.has(leg.id);
                const proposed = isCandidate && proposedLegs.has(leg.id);
                const emptyCandidateCell = isCandidate && !currentlySelected && !proposed;
                const cellLabel = getLegLabel(leg, waypointsById, "it");
                return (
                  <button
                    key={leg.id}
                    type="button"
                    disabled={!isCandidate}
                    title={cellLabel}
                    onClick={(event) => (event.shiftKey ? onSetProposalRange(leg.id) : onToggleProposalLeg(leg.id))}
                    className={[
                      "relative flex items-center justify-center border-r border-border/40 px-1 py-2 text-[10px] last:border-r-0 disabled:cursor-default",
                      isCandidate ? "hover:bg-accent/10" : "",
                      currentlySelected ? "bg-accent/15" : "",
                      proposed ? "bg-sky-100/60 text-sky-900" : "",
                      emptyCandidateCell ? "text-muted-foreground/55" : "text-foreground",
                    ].join(" ")}
                  >
                    {currentlySelected || proposed ? (
                      <span className={[
                        "h-5 w-full rounded-full",
                        proposed ? "border-2 border-dashed border-sky-500/80 bg-sky-100/70" : "border border-accent/40 bg-accent/30",
                      ].join(" ")} />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-border" />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/70 px-3 py-2.5 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full border border-accent/40 bg-accent/30" /> Tratte attuali</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full border-2 border-dashed border-sky-500/80 bg-sky-100/70" /> Proposta (non ancora confermata)</span>
        <span>Le tratte prenotate o proposte mostrano percorso, distanza, durata e date.</span>
        <span>Maiuscolo+click seleziona un intervallo.</span>
      </div>
    </div>
  );
};

export default VoyageCandidatesPanel;
