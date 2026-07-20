import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Loader2, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type BookableLeg,
  type BookingProfile,
  type BookingRequest,
  type BookingRequestLeg,
  type BookingVoyage,
  type BookingWaypoint,
  type VoyageBookingStatus,
  formatBookingDate,
  getBookingStatusClass,
  getBookingStatusLabel,
  getLegLabel,
  getLocalizedBookingVoyageName,
} from "@/lib/booking-utils";
import { experienceOptions, getCandidateLanguageLabel, languageLevelOptions, normalizeCandidateInfo, type CandidateInfo } from "@/lib/booking-candidate-info";
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
  const [proposalLegIds, setProposalLegIds] = useState<Record<string, string[]>>({});
  const [proposalNotes, setProposalNotes] = useState<Record<string, string>>({});
  const [decisionMessages, setDecisionMessages] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const requestsQuery = voyageId
      ? typedSupabase.from("voyage_booking_requests").select("*").eq("voyage_id", voyageId).order("requested_at", { ascending: false })
      : typedSupabase.from("voyage_booking_requests").select("*").order("requested_at", { ascending: false });
    const [requestsRes, voyagesRes, waypointsRes, legsRes] = await Promise.all([
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
    ]);

    if (requestsRes.error || voyagesRes.error || waypointsRes.error || legsRes.error) {
      toast.error(requestsRes.error?.message || voyagesRes.error?.message || waypointsRes.error?.message || legsRes.error?.message || "Unable to load candidates");
      setLoading(false);
      return;
    }

    const loadedRequests = ((requestsRes.data as BookingRequest[] | null) || []).filter((request) => !request.is_crew);
    const requestIds = loadedRequests.map((request) => request.id);
    const profileIds = [...new Set(loadedRequests.map((request) => request.profile_id))];
    const [requestLegsRes, profilesRes, depositsRes] = await Promise.all([
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
    ]);

    if (requestLegsRes.error || profilesRes.error || depositsRes.error) {
      toast.error(requestLegsRes.error?.message || profilesRes.error?.message || depositsRes.error?.message || "Unable to load candidate details");
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

  const candidates = useMemo(
    () => requests.filter((request) => reviewStatuses.has(request.status) || request.plan_change_status === "pending_user_approval"),
    [requests],
  );

  useEffect(() => {
    onCountChange?.(candidates.length);
  }, [candidates.length, onCountChange]);

  const setStatus = async (request: BookingRequest, status: VoyageBookingStatus) => {
    if (status === "admin_approved" && (depositsByRequest[request.id] || []).some((deposit) => deposit.status === "pending")) {
      toast.error("Pagamento contributo ancora in sospeso: la candidatura resta bloccata finche Bunq non conferma il pagamento.");
      return;
    }
    const adminMessage = decisionMessages[request.id]?.trim() || null;
    setSavingId(request.id);
    const result =
      status === "rejected"
        ? await updateBookingStatusWithRefund({
            bookingRequestId: request.id,
            status: "rejected",
            trigger: "admin_rejected",
            adminNotes: adminMessage || "Candidatura scartata da /admin/bookings.",
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
    setSavingId(request.id);
    const { error } = await typedSupabase.rpc("admin_propose_voyage_booking_legs", {
      _booking_request_id: request.id,
      _proposed_leg_ids: legIds,
      _admin_note: proposalNotes[request.id] || null,
    });
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Proposta inviata al candidato.");
    await load();
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
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <InfoLine label="Esperienza" value={experience} />
        <InfoLine label="Tipo navigazione" value={`${valueList(candidateInfo.sailingKinds)} · ${candidateInfo.navigationRange || "range non indicato"}`} />
        <InfoLine label="Eta" value={candidateInfo.ageRange || "Non indicata"} />
        <InfoLine label="Lingue" value={`${valueList(languageLabels)}${candidateInfo.otherLanguages ? `, ${candidateInfo.otherLanguages}` : ""}`} />
        <InfoLine label="Lavoro remoto" value={candidateInfo.workDuringVoyage || "Non indicato"} />
        <InfoLine label="Professione" value={candidateInfo.workRole || "Non indicata"} />
        <InfoLine label="Cibo/allergie" value={`${valueList(candidateInfo.foodRegimes)}${candidateInfo.allergies ? ` · ${candidateInfo.allergies}` : ""}`} />
        <div className="md:col-span-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Motivazione</p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-foreground">{candidateInfo.motivation || "Non indicata"}</p>
        </div>
        {candidateInfo.notes && (
          <div className="md:col-span-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Altre note</p>
            <p className="mt-1 whitespace-pre-line leading-relaxed text-muted-foreground">{candidateInfo.notes}</p>
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

                <div className="mt-5 grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
                  <section className="rounded-[24px] border border-border/70 bg-background/45 p-4">
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

                  <section className="space-y-4 rounded-[24px] border border-border/70 bg-background/45 p-4">
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
                        legs={voyageLegs}
                        requestLegIds={legIdsByRequest}
                        selectedProposalLegIds={selectedProposal}
                        onToggleProposalLeg={(legId) => toggleProposalLeg(request.id, legId)}
                        onSetProposalRange={(legId) => setProposalRange(request.id, voyageLegs, legId)}
                      />
                      <textarea
                        value={proposalNotes[request.id] || ""}
                        onChange={(event) => setProposalNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        rows={3}
                        className="mt-3 w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        placeholder="Nota per la proposta (es. meglio imbarco dopo, tratta piu breve, aggiungere tappa...)"
                      />
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

                    <div className="border-t border-border/70 pt-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Messaggio decisione</p>
                      <textarea
                        value={decisionMessages[request.id] || ""}
                        onChange={(event) => setDecisionMessages((current) => ({ ...current, [request.id]: event.target.value }))}
                        rows={3}
                        className="mt-3 w-full resize-y rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                        placeholder="Messaggio opzionale per approvazione o rifiuto"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void setStatus(request, "admin_approved")}
                          disabled={savingId === request.id || hasPendingDeposit}
                          title={hasPendingDeposit ? "Pagamento contributo in attesa di conferma Bunq." : undefined}
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
    </div>
  );
};

const InfoLine = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    <p className="mt-1 text-foreground">{value}</p>
  </div>
);

type CandidateReviewGanttProps = {
  request: BookingRequest;
  requests: BookingRequest[];
  profilesById: Record<string, CandidateProfile>;
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

  const columnStyle = {
    gridTemplateColumns: `minmax(132px, 0.9fr) repeat(${sortedLegs.length}, minmax(52px, 1fr))`,
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/60">
      <div className="min-w-[720px]">
        <div className="grid border-b border-border/70 text-[11px] uppercase tracking-[0.14em] text-muted-foreground" style={columnStyle}>
          <div className="border-r border-border/70 px-3 py-2">Persona</div>
          {sortedLegs.map((leg) => (
            <div key={leg.id} className="border-r border-border/50 px-2 py-2 text-center last:border-r-0">
              T{leg.sort_order}
            </div>
          ))}
        </div>
        {rows.map((row) => {
          const isCandidate = row.id === request.id;
          const profile = profilesById[row.profile_id];
          const activeLegs = new Set(requestLegIds[row.id] || []);
          const proposedLegs = new Set(selectedProposalLegIds);
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
                const cellLabel = getLegLabel(leg, {}, "it");
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
                      proposed ? "bg-sky-200/70 text-sky-900" : "",
                      emptyCandidateCell ? "text-muted-foreground/55" : "text-foreground",
                    ].join(" ")}
                  >
                    {currentlySelected || proposed ? (
                      <span className={[
                        "h-5 w-full rounded-full border",
                        proposed ? "border-sky-400 bg-sky-300/80" : "border-accent/40 bg-accent/30",
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
      <div className="flex flex-wrap gap-3 border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded-full bg-accent/30" /> Tratte attuali</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded-full bg-sky-300/80" /> Proposta in composizione</span>
        <span>Maiuscolo+click seleziona un intervallo.</span>
      </div>
    </div>
  );
};

export default VoyageCandidatesPanel;
