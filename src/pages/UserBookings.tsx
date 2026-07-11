import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarCheck, Check, Clock3, Loader2, Ship, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ComplexityIndicator from "@/components/booking/ComplexityIndicator";
import BookingConfirmDialog from "@/components/booking/BookingConfirmDialog";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import { perPersonDepositEur, totalDepositEur } from "@/lib/booking-deposit";
import { startDepositPayment } from "@/lib/booking-payment";
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
  formatBookingDate,
  formatBookingWindow,
  getBookingStatusClass,
  getLegComplexity,
  getLegDangerLevel,
  getBookingStatusLabel,
  getLegLabel,
  getLocalizedBookingVoyageName,
  isLegSelectable,
  isVoyageBookableNow,
} from "@/lib/booking-utils";

type RequestBookingResult = { booking_request_id: string; booking_status: BookingRequest["status"] };

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [myParticipations, setMyParticipations] = useState<MyParticipation[]>([]);
  const [acceptTarget, setAcceptTarget] = useState<MyParticipation | null>(null);
  const [acceptSubmitting, setAcceptSubmitting] = useState(false);
  const [bankTransfer, setBankTransfer] = useState<{ bookingRequestId: string; participantId?: string } | null>(
    null
  );

  const loadData = useCallback(async () => {
    if (!session?.user.id) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const [voyagesRes, requestsRes] = await Promise.all([
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
    ]);

    if (voyagesRes.error || requestsRes.error) {
      toast.error(voyagesRes.error?.message || requestsRes.error?.message || "Unable to load bookings");
      setBusy(false);
      return;
    }

    let loadedVoyages = ((voyagesRes.data as BookingVoyage[] | null) || []);
    const loadedRequests = ((requestsRes.data as BookingRequest[] | null) || []);
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

  const toggleLeg = (legId: string) => {
    setSelectedLegIds((current) =>
      current.includes(legId) ? current.filter((id) => id !== legId) : [...current, legId]
    );
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

  const cancelBooking = async (requestId: string) => {
    if (!confirm(lang === "it" ? "Annullare questa partecipazione?" : "Cancel this participation?")) return;
    setSaving(true);
    const { error } = await typedSupabase.rpc("cancel_voyage_booking", { _booking_request_id: requestId });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(lang === "it" ? "Partecipazione annullata." : "Participation cancelled.");
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

  const handleAcceptConfirm = async () => {
    if (!acceptTarget) return;
    setAcceptSubmitting(true);
    try {
      await acceptParticipation(acceptTarget.participant_id);
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
                      onClick={() => setAcceptTarget(p)}
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
            if (!open) setAcceptTarget(null);
          }}
          lang={lang}
          voyageName={acceptTarget ? participationVoyageName(acceptTarget) : undefined}
          partySize={1}
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
                      selectedVoyageLegs.map((leg) => (
                        <label key={leg.id} className="flex gap-3 rounded-[18px] border border-border/70 p-3 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedLegIds.includes(leg.id)}
                            onChange={() => toggleLeg(leg.id)}
                            className="mt-1 h-4 w-4 accent-[hsl(var(--accent))]"
                          />
                          <span>
                            <span className="block text-foreground">{getLegLabel(leg, waypointsById, lang)}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {[
                                formatBookingWindow(leg.starts_at_window_start, leg.starts_at_window_end, locale),
                                formatBookingWindow(leg.ends_at_window_start, leg.ends_at_window_end, locale),
                              ]
                                .filter(Boolean)
                                .join(" → ") || (lang === "it" ? "Date in definizione" : "Dates being refined")}
                            </span>
                            <ComplexityIndicator
                              className="mt-2"
                              level={getLegComplexity(leg)}
                              dangerLevel={getLegDangerLevel(leg)}
                              leg={leg}
                              lang={lang}
                            />
                          </span>
                        </label>
                      ))
                    )}
                  </div>

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

                  <button
                    type="button"
                    onClick={openBookingConfirm}
                    disabled={saving || selectedLegIds.length === 0}
                    className="glass-chip inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:text-accent disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Clock3 size={15} />}
                    {lang === "it" ? "Invia richiesta" : "Send request"}
                  </button>
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
                { contributionPerNmEur: selectedVoyage?.booking_contribution_per_nm_eur }
              )}
              depositTotalEur={totalDepositEur(
                selectedLegIds.map((id) => legsById[id]).filter(Boolean),
                Math.max(1, Number.parseInt(partySize, 10) || 1),
                { contributionPerNmEur: selectedVoyage?.booking_contribution_per_nm_eur }
              )}
              contributionPerNmEur={selectedVoyage?.booking_contribution_per_nm_eur}
              submitting={saving}
              onConfirm={() => void submitRequest()}
            />

            <section className="glass-panel rounded-[30px] p-5 md:p-6">
              <h2 className="editorial-heading mb-5 text-2xl">
                {lang === "it" ? "Le tue richieste" : "Your requests"}
              </h2>
              <div className="space-y-4">
                {requests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {lang === "it" ? "Non hai ancora richieste di imbarco." : "You do not have booking requests yet."}
                  </p>
                ) : (
                  requests.map((request) => {
                    const voyage = voyagesById[request.voyage_id];
                    const settings = bookingSettings.find((item) => item.voyage_id === request.voyage_id);
                    const voyageTasks = bookingTasks.filter((task) => task.voyage_id === request.voyage_id);
                    const completionSet = new Set(
                      taskCompletions
                        .filter((completion) => completion.booking_request_id === request.id)
                        .map((completion) => completion.task_id)
                    );
                    const predepartureInfo = lang === "it"
                      ? settings?.predeparture_info_it || settings?.predeparture_info_en
                      : settings?.predeparture_info_en || settings?.predeparture_info_it;
                    const briefingContent = lang === "it"
                      ? settings?.briefing_content_it || settings?.briefing_content_en
                      : settings?.briefing_content_en || settings?.briefing_content_it;
                    const termsContent = lang === "it"
                      ? settings?.terms_content_it || settings?.terms_content_en
                      : settings?.terms_content_en || settings?.terms_content_it;
                    const legLabels = requestLegs
                      .filter((link) => link.booking_request_id === request.id)
                      .map((link) => legsById[link.bookable_leg_id])
                      .filter(Boolean)
                      .map((leg) => getLegLabel(leg, waypointsById, lang));

                    return (
                      <article key={request.id} className="rounded-[22px] border border-border/70 bg-background/45 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="font-serif text-xl">
                              {getLocalizedBookingVoyageName(voyage, lang) || request.voyage_id}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatBookingDate(request.requested_at, locale)} · {request.party_size} pax
                            </p>
                          </div>
                          <span className="flex items-center gap-2">
                            {request.is_crew && (
                              <span className="inline-flex items-center rounded-full border border-indigo-300/70 bg-indigo-100/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-indigo-800">
                                {lang === "it" ? "Equipaggio" : "Crew"}
                              </span>
                            )}
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${getBookingStatusClass(request.status)}`}>
                              {getBookingStatusLabel(request.status, lang)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {legLabels.map((label) => (
                            <span key={label} className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                              {label}
                            </span>
                          ))}
                        </div>
                        {request.message && <p className="mt-3 text-sm text-muted-foreground">{request.message}</p>}
                        {(predepartureInfo || briefingContent || termsContent || voyageTasks.length > 0) && (
                          <div className="mt-4 space-y-3 rounded-[18px] border border-border/70 bg-background/45 p-3">
                            {predepartureInfo && (
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                  {lang === "it" ? "Info prepartenza" : "Predeparture info"}
                                </p>
                                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{predepartureInfo}</p>
                              </div>
                            )}
                            {briefingContent && (
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                  {lang === "it" ? "Briefing" : "Briefing"}
                                </p>
                                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{briefingContent}</p>
                              </div>
                            )}
                            {termsContent && (
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                  {lang === "it" ? "Note operative" : "Operational notes"}
                                </p>
                                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{termsContent}</p>
                              </div>
                            )}
                            {voyageTasks.length > 0 && !request.is_crew && (
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                  {lang === "it" ? "Checklist" : "Checklist"}
                                </p>
                                <div className="mt-2 space-y-2">
                                  {voyageTasks.map((task) => {
                                    const completed = completionSet.has(task.id);
                                    const label = lang === "it"
                                      ? task.title_it || task.title_en
                                      : task.title_en || task.title_it;
                                    return (
                                      <label key={task.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                                        <input
                                          type="checkbox"
                                          checked={completed}
                                          disabled={saving || ["cancelled", "rejected", "expired"].includes(request.status)}
                                          onChange={() => void toggleTaskCompletion(request.id, task.id, completed)}
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
                          {request.status === "admin_approved" && (
                            <button
                              type="button"
                              onClick={() => void confirmBooking(request.id)}
                              className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:text-accent"
                            >
                              <Check size={14} /> {lang === "it" ? "Conferma" : "Confirm"}
                            </button>
                          )}
                          {["requested", "waitlisted", "admin_approved", "user_confirmed"].includes(request.status) && (
                            <button
                              type="button"
                              onClick={() => void cancelBooking(request.id)}
                              className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-destructive"
                            >
                              <X size={14} /> {lang === "it" ? "Annulla" : "Cancel"}
                            </button>
                          )}
                          {voyage && (
                            <Link to="/voyages" className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                              {lang === "it" ? "Vedi viaggi" : "View voyages"}
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserBookings;
