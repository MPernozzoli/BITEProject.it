import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, ExternalLink, Hand, Loader2, TicketCheck, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import BookingConfirmDialog from "@/components/booking/BookingConfirmDialog";
import PaymentMethodDialog from "@/components/booking/PaymentMethodDialog";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import ContributionEstimateNote from "@/components/booking/ContributionEstimateNote";
import VoyageJoinLegList from "@/components/voyage/VoyageJoinLegList";
import VoyageJoinDialog from "@/components/voyage/VoyageJoinDialog";
import {
  emptyLegSelection,
  getLegSelectionHint,
  selectLegOnTap,
  type LegSelection,
} from "@/lib/booking-leg-selection";
import {
  getVoyageJoinCta,
  getVoyageJoinSteps,
  summarizeLegSelection,
  type VoyageJoinStage,
} from "@/lib/voyage-join-flow";
import { getBookingApplicationBlocker } from "@/lib/booking-application-gate";
import {
  buildCandidateInfoPrefill,
  emptyCandidateInfo,
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
import { applyVoyageBookingWithProposal, uploadWorkawayProposalFiles } from "@/lib/booking-proposal-apply";
import {
  contributionProposalKind,
  emptyContributionProposal,
  toApplyWithProposalPayload,
  type ContributionProposal,
} from "@/lib/booking-workaway-proposal";
import {
  getBookingStatusLabel,
  isVoyageBookableNow,
  type BookableLegAvailability,
  type BookingRequest,
  type BookingSettings,
  type WorkawayRole,
} from "@/lib/booking-utils";
import type { Voyage } from "@/lib/voyage-utils";

/** Statuses that mean "this traveller already has something running on this voyage". */
const ACTIVE_REQUEST_STATUSES = new Set<BookingRequest["status"]>([
  "pending_payment",
  "requested",
  "waitlisted",
  "admin_approved",
  "user_confirmed",
]);

type RequestBookingResult = { booking_request_id: string; booking_status: BookingRequest["status"] };

/** Shared empty array: a fresh `[]` default would be a new dependency on every render, and the
 * prefill effect below would then re-run itself forever. */
const NO_REQUESTS: BookingRequest[] = [];

type SupabaseError = { message: string; code?: string } | null;
type SupabaseResponse = { data: unknown; error: SupabaseError };
/** The booking RPCs and a couple of tables predate the generated types; same shim as /bookings. */
type SupabaseQueryBuilder = PromiseLike<SupabaseResponse> & {
  select: (columns?: string) => SupabaseQueryBuilder;
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => SupabaseQueryBuilder;
};
type UntypedSupabase = {
  from: (table: string) => SupabaseQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResponse>;
};
const typedSupabase = supabase as unknown as UntypedSupabase;

interface VoyageJoinPanelProps {
  voyage: Voyage;
  voyageName: string;
  /** Only the legs anyone could still book, in itinerary order. */
  legs: BookableLegAvailability[];
  lang: "it" | "en";
  waypointLabel: (waypointId: string, fallback: string) => string;
}

/**
 * The whole "partecipa" flow, in place on the voyage page.
 *
 * It used to be a button that threw the traveller at /bookings, where they had to find the
 * voyage again in a select, work out that the Gantt bar was clickable and then scroll past their
 * own past bookings. Here the three steps happen where the route is already being read: tap the
 * legs, answer the questions in a dialog, accept and pay. The sticky bar at the bottom is the
 * single control that carries all of it, and it always says what the next tap does.
 */
const VoyageJoinPanel = ({ voyage, voyageName, legs, lang, waypointLabel }: VoyageJoinPanelProps) => {
  const it = lang === "it";
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;

  const [stage, setStage] = useState<VoyageJoinStage>("intro");
  const [selection, setSelection] = useState<LegSelection>(emptyLegSelection);
  const [partySize, setPartySize] = useState(1);
  const [message, setMessage] = useState("");
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo>(emptyCandidateInfo);
  const [candidateInfoPrefill, setCandidateInfoPrefill] = useState<CandidateInfo>(emptyCandidateInfo);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsStep, setDetailsStep] = useState<"party" | "about">("party");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [proposal, setProposal] = useState<ContributionProposal>(emptyContributionProposal);
  const [proposalCvFile, setProposalCvFile] = useState<File | null>(null);
  const [proposalPortfolioFile, setProposalPortfolioFile] = useState<File | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<{ bookingRequestId: string } | null>(null);
  const [bankTransfer, setBankTransfer] = useState<{ bookingRequestId: string } | null>(null);
  const [workawayRoles, setWorkawayRoles] = useState<WorkawayRole[]>([]);

  const legsSectionRef = useRef<HTMLDivElement | null>(null);
  const draftHydratedRef = useRef(false);
  const candidateInfoTouchedRef = useRef(false);

  const selectedLegIds = selection.legIds;
  const anchorOpen = Boolean(selection.anchorLegId && selectedLegIds.includes(selection.anchorLegId));
  const orderedLegIds = useMemo(() => legs.map((leg) => leg.id), [legs]);
  const legsById = useMemo(
    () => Object.fromEntries(legs.map((leg) => [leg.id, leg])) as Record<string, BookableLegAvailability>,
    [legs]
  );
  const selectedLegs = useMemo(
    () => legs.filter((leg) => selectedLegIds.includes(leg.id)),
    [legs, selectedLegIds]
  );
  const hasSelectableLegs = legs.some((leg) => leg.available);
  const voyageStillOpen = isVoyageBookableNow(voyage);
  const maxGuests = Math.max(1, voyage.booking_max_guests || 1);

  /** Everything the traveller has booked on this voyage already — a second application on the
   * same legs is refused server-side (BK001), so it must not even be offered. */
  const { data: ownRequests = NO_REQUESTS, refetch: refetchOwnRequests } = useQuery<BookingRequest[]>({
    queryKey: ["voyage-join-own-requests", voyage.id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await typedSupabase
        .from("voyage_booking_requests")
        .select("*")
        .eq("profile_id", userId)
        .eq("voyage_id", voyage.id);
      if (error) throw new Error(error.message);
      return (data as BookingRequest[] | null) || [];
    },
  });
  const ownActiveRequest = useMemo(
    () =>
      ownRequests
        .filter((request) => ACTIVE_REQUEST_STATUSES.has(request.status))
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())[0] || null,
    [ownRequests]
  );

  /** Voyage-level negotiation settings (workaway, proposal ceiling): readable once signed in. */
  const { data: bookingSettings = null } = useQuery<BookingSettings | null>({
    queryKey: ["voyage-join-settings", voyage.id, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await typedSupabase
        .from("voyage_booking_settings")
        .select("*")
        .eq("voyage_id", voyage.id);
      if (error) throw new Error(error.message);
      const rows = (data as BookingSettings[] | null) || [];
      return rows[0] ?? null;
    },
  });

  const { data: profileRow = null } = useQuery<{ preferred_language: string | null; secondary_language: string | null } | null>({
    queryKey: ["voyage-join-profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await typedSupabase
        .from("profiles")
        .select("preferred_language,secondary_language")
        .eq("id", userId);
      if (error) throw new Error(error.message);
      const rows = (data as { preferred_language: string | null; secondary_language: string | null }[] | null) || [];
      return rows[0] ?? null;
    },
  });

  // Reuse what the traveller already told us on a previous application, so the questionnaire is
  // mostly pre-answered the second time around.
  useEffect(() => {
    const latest = ownRequests.find((request) => request.candidate_info)?.candidate_info as
      | Partial<CandidateInfo>
      | null
      | undefined;
    const prefill = buildCandidateInfoPrefill({
      latestCandidateInfo: latest,
      preferredLanguage: profileRow?.preferred_language,
      secondaryLanguage: profileRow?.secondary_language,
    });
    setCandidateInfoPrefill(prefill);
    if (!candidateInfoTouchedRef.current && !draftHydratedRef.current) setCandidateInfo(prefill);
  }, [ownRequests, profileRow]);

  // Only needed to label a workaway proposal, which stays a per-voyage opt-in.
  useEffect(() => {
    if (!bookingSettings?.workaway_enabled) return;
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
  }, [bookingSettings?.workaway_enabled]);

  /** A draft survives the trip to /login and back, which is the whole point of saving one. */
  useEffect(() => {
    if (authLoading || draftHydratedRef.current || legs.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadBookingApplicationDraft(voyage.id, userId);
        if (cancelled || !draft) return;
        const legIds = draft.selectedLegIds.filter((legId) => legId in legsById);
        if (legIds.length > 0) {
          setSelection({ legIds, anchorLegId: null });
          setStage("picking");
        }
        setPartySize(Math.max(1, Number.parseInt(draft.partySize, 10) || 1));
        setMessage(draft.message);
        setCandidateInfo(draft.candidateInfo);
        candidateInfoTouchedRef.current = true;
      } catch (error) {
        console.error("Failed to load booking draft", error);
      } finally {
        if (!cancelled) draftHydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, legs.length, legsById, userId, voyage.id]);

  useEffect(() => {
    if (!draftHydratedRef.current || ownActiveRequest) return;
    const draft = buildBookingApplicationDraft({
      voyageId: voyage.id,
      selectedLegIds,
      partySize: String(partySize),
      message,
      candidateInfo,
    });
    if (isBookingApplicationDraftEmpty(draft)) return;
    const timer = window.setTimeout(() => {
      saveLocalBookingApplicationDraft(draft);
      if (userId) {
        void saveCloudBookingApplicationDraft(userId, draft).catch((error) => {
          console.error("Failed to save booking draft", error);
        });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [candidateInfo, message, ownActiveRequest, partySize, selectedLegIds, userId, voyage.id]);

  const contributionOptions = useMemo(
    () => ({
      contributionPerNmEur: voyage.booking_contribution_per_nm_eur,
      fixedMinimumEur: shouldApplyContributionFixedMinimum(ownRequests, voyage.id) ? undefined : 0,
    }),
    [ownRequests, voyage.booking_contribution_per_nm_eur, voyage.id]
  );
  const fixedMinimumEur = useMemo(
    () => contributionFixedMinimumEur(contributionOptions.fixedMinimumEur),
    [contributionOptions]
  );
  const standardVariableEur = useMemo(
    () => selectedLegs.reduce((total, leg) => total + legDepositEur(leg, contributionOptions), 0),
    [contributionOptions, selectedLegs]
  );
  const depositPerPersonEur = useMemo(
    () => perPersonDepositEur(selectedLegs, contributionOptions),
    [contributionOptions, selectedLegs]
  );
  const depositTotalEur = useMemo(
    () => totalDepositEur(selectedLegs, partySize, contributionOptions),
    [contributionOptions, partySize, selectedLegs]
  );

  const legLabelFor = useCallback(
    (leg: BookableLegAvailability) =>
      `${waypointLabel(leg.from_waypoint_id, it ? "Partenza" : "Departure")} → ${waypointLabel(
        leg.to_waypoint_id,
        it ? "Arrivo" : "Arrival"
      )}`,
    [it, waypointLabel]
  );
  const selectedLegLabels = useMemo(() => selectedLegs.map(legLabelFor), [legLabelFor, selectedLegs]);
  const summary = useMemo(
    () => summarizeLegSelection(legs, selectedLegIds, (waypointId) => waypointLabel(waypointId, "—")),
    [legs, selectedLegIds, waypointLabel]
  );
  const routeLine = summary.count > 0 ? `${summary.fromLabel} → ${summary.toLabel}` : "";

  const remainingSeatsByLegId = useMemo(
    () => Object.fromEntries(legs.map((leg) => [leg.id, leg.remaining])),
    [legs]
  );
  const blocker = useMemo(
    () =>
      getBookingApplicationBlocker(
        {
          voyageSelected: true,
          voyageStillOpen,
          selectedLegIds,
          candidateInfo,
          partySize,
          maxGuests,
          remainingSeatsByLegId,
          legLabelById: Object.fromEntries(
            selectedLegs.map((leg) => [leg.id, legLabelFor(leg)])
          ),
        },
        lang
      ),
    [
      candidateInfo,
      lang,
      legLabelFor,
      maxGuests,
      partySize,
      remainingSeatsByLegId,
      selectedLegIds,
      selectedLegs,
      voyageStillOpen,
    ]
  );

  const cta = getVoyageJoinCta(
    { stage, selectedCount: selectedLegIds.length, anchorOpen, hasSelectableLegs },
    lang
  );
  const steps = getVoyageJoinSteps(confirmOpen ? 3 : detailsOpen ? 2 : 1, lang);

  const scrollToLegs = () => {
    const target = legsSectionRef.current;
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const startPicking = () => {
    setStage("picking");
    // The list only becomes tappable now, so it has to be on screen before the first tap.
    window.setTimeout(scrollToLegs, 60);
  };

  const handleTapLeg = (legId: string) => {
    setSelection((current) => selectLegOnTap(orderedLegIds, current, legId));
  };

  const saveDraftAndSignIn = () => {
    saveLocalBookingApplicationDraft(
      buildBookingApplicationDraft({
        voyageId: voyage.id,
        selectedLegIds,
        partySize: String(partySize),
        message,
        candidateInfo,
      })
    );
    navigate("/login", { state: { from: `${location.pathname}${location.search}#partecipa` } });
  };

  const handleCtaPress = () => {
    if (cta.kind === "start") {
      startPicking();
      return;
    }
    if (!cta.enabled) {
      toast.info(cta.helper);
      scrollToLegs();
      return;
    }
    setDetailsStep("party");
    setDetailsOpen(true);
  };

  /** Leaves the dialog and hands the traveller back to the cards they came from. */
  const handleEditLegs = () => {
    setDetailsOpen(false);
    setStage("picking");
    window.setTimeout(scrollToLegs, 60);
  };

  const handleDetailsContinue = () => {
    if (blocker) {
      toast.error(blocker.detail);
      if (blocker.step === "legs") handleEditLegs();
      return;
    }
    if (!userId) {
      saveDraftAndSignIn();
      return;
    }
    // Opening the conditions dialog in the same commit would stack its backdrop on the wizard's
    // while that one animates out, and the screen visibly darkens twice. Hand over instead.
    setDetailsOpen(false);
    window.setTimeout(() => setConfirmOpen(true), 220);
  };

  const resetAfterSubmit = () => {
    setSelection(emptyLegSelection);
    setMessage("");
    setProposal(emptyContributionProposal);
    setProposalCvFile(null);
    setProposalPortfolioFile(null);
    candidateInfoTouchedRef.current = false;
    setCandidateInfo(candidateInfoPrefill);
    setStage("intro");
  };

  const submitApplication = async () => {
    if (!userId) {
      saveDraftAndSignIn();
      return;
    }
    if (blocker) {
      toast.error(blocker.detail);
      return;
    }

    const attachedProposal = toApplyWithProposalPayload(proposal);
    setSubmitting(true);
    let bookingRequestId: string | undefined;
    // Only the €20 fixed share is collected up front when a proposal is attached: the rest is
    // settled after the crew has reviewed it.
    let fixedOnlyAmountEur: number | null = null;

    if (attachedProposal) {
      const applyResult = await applyVoyageBookingWithProposal({
        voyageId: voyage.id,
        legIds: selectedLegIds,
        message: message.trim() || null,
        candidateInfo,
        proposal: attachedProposal,
        candidateMessage: proposal.candidateMessage.trim() || null,
        partySize,
      });
      if (applyResult.ok === false) {
        setSubmitting(false);
        toast.error(
          applyResult.error === "proposal_out_of_range"
            ? it
              ? "L'importo proposto è fuori dal range consentito."
              : "The proposed amount is outside the allowed range."
            : it
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
            userId,
            cvFile: proposalCvFile,
            portfolioFile: proposalPortfolioFile,
          });
        } catch (uploadError) {
          console.error("[VoyageJoinPanel] workaway file upload failed", uploadError);
          toast.warning(
            it
              ? "Candidatura inviata, ma il caricamento dei file non è riuscito. Potrai riprovare dalle tue prenotazioni."
              : "Application sent, but the file upload failed. You can retry from your bookings."
          );
        }
      }
    } else {
      const { data, error } = await typedSupabase.rpc("request_voyage_booking", {
        _voyage_id: voyage.id,
        _leg_ids: selectedLegIds,
        _party_size: partySize,
        _message: message,
        _candidate_info: candidateInfo,
      });
      if (error) {
        setSubmitting(false);
        toast.error(
          error.code === "BK001"
            ? it
              ? "Hai già aderito a una di queste tratte."
              : "You've already joined one of these legs."
            : it
              ? `Non è stato possibile inviare la candidatura. Riprova. (${error.message})`
              : `Unable to submit the application. Please try again. (${error.message})`
        );
        return;
      }
      const result = Array.isArray(data) ? (data[0] as RequestBookingResult | undefined) : undefined;
      bookingRequestId = result?.booking_request_id;
    }

    setSubmitting(false);
    setConfirmOpen(false);
    clearLocalBookingApplicationDraft(voyage.id);
    await clearCloudBookingApplicationDraft(userId, voyage.id).catch((error) => {
      console.error("Failed to clear booking draft", error);
    });

    // Guests have to be named and their share settled on the participants page, so a party
    // booking never pays from here.
    if (bookingRequestId && partySize > 1) {
      resetAfterSubmit();
      toast.info(
        it
          ? "Ultimo passo: indica i partecipanti e completa il pagamento."
          : "One last step: add the participants and complete the payment."
      );
      navigate(`/bookings/${bookingRequestId}/participants`);
      return;
    }

    if (bookingRequestId && fixedOnlyAmountEur != null && fixedOnlyAmountEur <= 0) {
      const settled = await settleBookingIfZeroDue(bookingRequestId);
      toast[settled.ok ? "success" : "warning"](
        settled.ok
          ? it
            ? "Candidatura inviata: non c'è nulla da versare adesso."
            : "Application submitted: nothing to pay right now."
          : it
            ? "Candidatura creata, ma risulta ancora un importo da versare: completalo dalle tue prenotazioni."
            : "Application created, but an amount is still due: complete it from your bookings."
      );
      resetAfterSubmit();
      await refetchOwnRequests();
      return;
    }

    if (bookingRequestId) {
      toast.info(
        it
          ? "Ultimo passo: versa il contributo, altrimenti la candidatura non parte."
          : "One last step: pay the contribution, otherwise the application is not sent."
      );
      setPaymentChoice({ bookingRequestId });
    }
    resetAfterSubmit();
    await refetchOwnRequests();
  };

  const startOnlinePayment = async (reservedWindow?: Window | null) => {
    if (!paymentChoice) return;
    setSubmitting(true);
    try {
      const payment = await startDepositPayment(paymentChoice.bookingRequestId);
      if (payment.ok && "shareUrl" in payment) {
        if (reservedWindow && !reservedWindow.closed) reservedWindow.location.href = payment.shareUrl;
        else window.location.assign(payment.shareUrl);
        return;
      }
      reservedWindow?.close();
      if (payment.ok && "alreadyPaid" in payment) {
        setPaymentChoice(null);
        toast.success(it ? "Hai già saldato per intero." : "You have already paid in full.");
        await refetchOwnRequests();
        return;
      }
      toast.info(
        it
          ? "Non sono riuscito ad aprire Bunq. Puoi completare con bonifico."
          : "Could not open Bunq. You can complete by bank transfer."
      );
      setBankTransfer({ bookingRequestId: paymentChoice.bookingRequestId });
      setPaymentChoice(null);
    } finally {
      setSubmitting(false);
    }
  };

  const interactive = stage === "picking" && !ownActiveRequest;
  const hint = getLegSelectionHint(selectedLegIds.length, anchorOpen, lang);

  return (
    <>
      <div className="glass-panel rounded-[34px] border-emerald-200/60 dark:border-emerald-500/30 bg-gradient-to-br from-emerald-50/85 dark:from-emerald-500/10 to-glass/60 p-5 sm:p-6 md:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-400/20 dark:text-emerald-200">
            <TicketCheck size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="editorial-heading text-2xl text-emerald-950 dark:text-emerald-300 dark:text-emerald-50 md:text-3xl">
              {it ? "Partecipa a questo viaggio" : "Join this voyage"}
            </h2>
            <p className="mt-1 max-w-xl text-[14.5px] leading-relaxed text-emerald-900/80 dark:text-emerald-300 dark:text-emerald-100/80">
              {!hasSelectableLegs
                ? it
                  ? "Le tratte esistono, ma al momento non risultano posti disponibili."
                  : "Legs exist, but no seats are currently available."
                : it
                  ? "Fai tutto da qui, in tre passaggi. Non serve andare da nessun'altra parte."
                  : "You can do it all from here, in three steps. No need to go anywhere else."}
            </p>
          </div>
        </div>

        {/* The three steps, always visible: where you are, and what is still ahead. */}
        <ol className="mt-5 grid list-none gap-2.5 p-0 sm:grid-cols-3">
          {steps.map((step) => (
            <li
              key={step.number}
              aria-current={step.state === "active" ? "step" : undefined}
              className={`rounded-[20px] border-2 p-3.5 transition-colors ${
                step.state === "active"
                  ? "border-emerald-500 bg-glass"
                  : step.state === "done"
                    ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 dark:border-emerald-400/35 dark:bg-emerald-400/10"
                    : "border-emerald-100 dark:border-emerald-500/30 bg-glass/50 dark:border-emerald-400/20"
              }`}
            >
              <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-950 dark:text-emerald-300 dark:text-emerald-50">
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                    step.state === "todo"
                      ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-400/25 dark:text-emerald-100"
                      : "bg-emerald-600 text-white"
                  }`}
                >
                  {step.state === "done" ? <Check size={13} strokeWidth={3} /> : step.number}
                </span>
                {step.title}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-snug text-emerald-900/70 dark:text-emerald-300 dark:text-emerald-100/70">{step.detail}</p>
            </li>
          ))}
        </ol>

        {ownActiveRequest ? (
          <div className="mt-5 rounded-[24px] border-2 border-sky-300/70 dark:border-sky-500/30 bg-sky-50/80 dark:bg-sky-500/10 p-4 dark:border-sky-400/35 dark:bg-sky-400/10 sm:p-5">
            <p className="text-[15px] font-bold text-sky-950 dark:text-sky-300 dark:text-sky-100">
              {it ? "Hai già una candidatura su questo viaggio" : "You already have an application on this voyage"}
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-sky-900/85 dark:text-sky-300 dark:text-sky-100/85">
              {it
                ? `Stato attuale: ${getBookingStatusLabel(ownActiveRequest.status, lang).toLowerCase()}. Tratte, pagamenti e modifiche si gestiscono dalle tue prenotazioni.`
                : `Current status: ${getBookingStatusLabel(ownActiveRequest.status, lang).toLowerCase()}. Legs, payments and changes are handled from your bookings.`}
            </p>
            <Link
              to="/bookings"
              className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-sky-800 px-5 text-[14.5px] font-bold text-white transition-colors hover:bg-sky-900"
            >
              <Wallet size={16} />
              {it ? "Vai alle mie prenotazioni" : "Go to my bookings"}
              <ExternalLink size={14} />
            </Link>
          </div>
        ) : (
          <div ref={legsSectionRef} className="mt-5 scroll-mt-24">
            {/* The one line of instructions, phrased for the step actually being on. */}
            <div
              className={`mb-3 flex items-start gap-2.5 rounded-[20px] border-2 px-3.5 py-3 ${
                interactive
                  ? "border-emerald-500 bg-glass"
                  : "border-dashed border-emerald-300 dark:border-emerald-500/30 bg-glass/60 dark:border-emerald-400/45"
              }`}
            >
              <Hand size={18} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
              <p className="text-[13.5px] font-medium leading-relaxed text-emerald-950 dark:text-emerald-300 dark:text-emerald-50">
                {interactive
                  ? hint
                  : it
                    ? "Queste sono le tratte del viaggio. Premi «Partecipa» qui sotto per poterle scegliere."
                    : "These are the voyage's legs. Press “Join this voyage” below to start choosing them."}
              </p>
            </div>

            {legs.length === 0 ? (
              <p className="rounded-[20px] border border-dashed border-emerald-300 dark:border-emerald-500/30 bg-glass/60 px-4 py-4 text-[14px] text-emerald-900/80 dark:text-emerald-300 dark:border-emerald-400/45 dark:text-emerald-100/80">
                {it
                  ? "Le tratte non sono ancora state pubblicate: torna presto per scoprire come imbarcarti."
                  : "Legs haven't been published yet — check back soon to see how to come aboard."}
              </p>
            ) : (
              <VoyageJoinLegList
                lang={lang}
                legs={legs}
                selectedLegIds={selectedLegIds}
                interactive={interactive}
                onTapLeg={handleTapLeg}
                waypointLabel={waypointLabel}
                contributionOptions={contributionOptions}
                partySize={partySize}
                disabled={submitting}
              />
            )}

            {legs.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="glass-panel-soft rounded-[20px] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                    <Users size={12} /> {it ? "Posti totali" : "Total berths"}
                  </p>
                  <p className="mt-1.5 text-sm">{voyage.booking_max_guests || "-"}</p>
                </div>
                <div className="glass-panel-soft rounded-[20px] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-sans uppercase tracking-[0.2em] text-muted-foreground">
                    <TicketCheck size={12} /> {it ? "Intera rotta" : "Full route"}
                  </p>
                  <p className="mt-1.5 text-sm">
                    {legs.length > 0
                      ? `${formatDepositEur(perPersonDepositEur(legs, contributionOptions), lang)} / ${it ? "persona" : "person"}`
                      : "-"}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 max-w-2xl space-y-1.5 text-[12.5px] leading-relaxed text-emerald-900/65 dark:text-emerald-300 dark:text-emerald-100/65">
              <ContributionEstimateNote
                lang={lang}
                workawayEnabled={bookingSettings?.workaway_enabled}
                className="space-y-1.5"
              />
              <p>
                {it
                  ? `* Agli importi indicati va aggiunta una quota fissa una tantum di ${formatDepositEur(contributionFixedMinimumEur(), lang)} a persona, indipendentemente dal numero di tratte scelte.`
                  : `* A one-time fixed contribution of ${formatDepositEur(contributionFixedMinimumEur(), lang)} per person must be added to the amounts above, regardless of how many legs are chosen.`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Sticky control. It is the only button the traveller has to find, so it never leaves the
          screen and never changes place — only what it says and what it does. */}
      {!ownActiveRequest && legs.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[env(safe-area-inset-bottom)] md:px-4">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <div className="glass-panel rounded-t-[24px] border border-b-0 border-glass-edge/40 bg-glass/85 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl md:px-6">
              {summary.count > 0 && (
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-[14px] font-bold leading-snug text-emerald-950 dark:text-emerald-300 dark:text-emerald-50">
                    <span className="truncate">{routeLine}</span>
                  </p>
                  <p className="text-[14px] font-bold text-emerald-900 dark:text-emerald-300 dark:text-emerald-100">
                    {formatDepositEur(depositTotalEur, lang)}
                    <span className="ml-1 text-[12px] font-normal text-emerald-900/60 dark:text-emerald-300 dark:text-emerald-100/60">
                      {partySize > 1 ? (it ? `per ${partySize}` : `for ${partySize}`) : it ? "a persona" : "per person"}
                    </span>
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={handleCtaPress}
                disabled={cta.kind === "closed" || submitting}
                className={`inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full px-5 text-[16px] font-bold transition-colors ${
                  cta.enabled
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : "border-2 border-emerald-300 dark:border-emerald-500/30 bg-glass text-emerald-800 dark:text-emerald-300 dark:border-emerald-400/50 dark:text-emerald-200"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {cta.label}
              </button>
              <p className="mt-1.5 text-center text-[12.5px] leading-snug text-emerald-900/75 dark:text-emerald-300 dark:text-emerald-100/80">{cta.helper}</p>
            </div>
          </div>
        </div>
      )}

      <VoyageJoinDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        lang={lang}
        voyageName={voyageName}
        routeLine={routeLine}
        legLabels={selectedLegLabels}
        partySize={partySize}
        onPartySizeChange={setPartySize}
        maxGuests={maxGuests}
        message={message}
        onMessageChange={setMessage}
        candidateInfo={candidateInfo}
        onCandidateInfoChange={(next) => {
          candidateInfoTouchedRef.current = true;
          setCandidateInfo(next);
        }}
        depositPerPersonEur={depositPerPersonEur}
        depositTotalEur={depositTotalEur}
        workawayEnabled={bookingSettings?.workaway_enabled}
        blocker={blocker}
        isSignedIn={Boolean(userId)}
        submitting={submitting}
        initialStep={detailsStep}
        onEditLegs={handleEditLegs}
        onContinue={handleDetailsContinue}
      />

      <BookingConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          // Backing out of the last step lands back on the questions, where they were, not on a
          // blank page and not at the top of the wizard.
          if (!open && !submitting) {
            setDetailsStep("about");
            window.setTimeout(() => setDetailsOpen(true), 220);
          }
        }}
        lang={lang}
        voyageName={voyageName}
        legLabels={selectedLegLabels}
        legs={selectedLegs}
        partySize={partySize}
        message={message}
        requiresPayment
        showPaymentMethodChoice={false}
        mode="application"
        fixedOnlyPayment={Boolean(contributionProposalKind(proposal))}
        depositPerPersonEur={
          contributionProposalKind(proposal) ? fixedMinimumEur : depositPerPersonEur
        }
        depositTotalEur={
          contributionProposalKind(proposal) ? fixedMinimumEur * partySize : depositTotalEur
        }
        contributionPerNmEur={voyage.booking_contribution_per_nm_eur}
        standardVariableEur={standardVariableEur}
        fixedMinimumEur={fixedMinimumEur}
        contributionProposalMaxPercent={bookingSettings?.contribution_proposal_max_percent ?? 150}
        workawayEnabled={Boolean(bookingSettings?.workaway_enabled)}
        workawayRoles={workawayRoles}
        activeWorkawayRoleKeys={bookingSettings?.workaway_role_keys ?? []}
        proposal={proposal}
        onProposalChange={setProposal}
        cvFile={proposalCvFile}
        onCvFileChange={setProposalCvFile}
        portfolioFile={proposalPortfolioFile}
        onPortfolioFileChange={setProposalPortfolioFile}
        submitting={submitting}
        onConfirm={() => void submitApplication()}
      />

      <PaymentMethodDialog
        open={paymentChoice !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentChoice(null);
        }}
        loading={submitting}
        bookingRequestId={paymentChoice?.bookingRequestId}
        phase="deposit"
        onPayNow={(reservedWindow) => void startOnlinePayment(reservedWindow)}
        onBankTransfer={() => {
          if (!paymentChoice) return;
          setBankTransfer({ bookingRequestId: paymentChoice.bookingRequestId });
          setPaymentChoice(null);
        }}
      />

      <BankTransferDialog
        open={bankTransfer !== null}
        onOpenChange={(open) => {
          if (!open) setBankTransfer(null);
        }}
        bookingRequestId={bankTransfer?.bookingRequestId ?? ""}
        onConfirmed={() => {
          setBankTransfer(null);
          void refetchOwnRequests();
        }}
      />
    </>
  );
};

export default VoyageJoinPanel;
