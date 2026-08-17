import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getLocalizedBookingVoyageName, type BookingVoyage } from "@/lib/booking-utils";
import {
  CONTRIBUTION_FIXED_MINIMUM_ACTIVE_BOOKING_STATUSES,
  depositForPayerEur,
  depositTargetEur,
  formatDepositEur,
  perPersonDepositEur,
  shouldApplyContributionFixedMinimum,
  type DepositLeg,
  type PriorVoyageContributionBooking,
} from "@/lib/booking-deposit";
import {
  listBookingParticipants,
  saveBookingParticipants,
  sendBookingInvites,
  type PaymentMode,
  type ParticipantInput,
} from "@/lib/booking-participants";
import { startDepositPayment } from "@/lib/booking-payment";
import BankTransferDialog from "@/components/booking/BankTransferDialog";
import PaymentMethodDialog from "@/components/booking/PaymentMethodDialog";

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type QueryBuilder<T> = QueryResult<T> & {
  select: (columns?: string) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  neq: (column: string, value: unknown) => QueryBuilder<T>;
  in: (column: string, values: unknown[]) => QueryBuilder<T>;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T>;
  maybeSingle: () => QueryResult<T>;
};
const q = <T,>(table: string) =>
  (supabase as unknown as { from: (t: string) => QueryBuilder<T> }).from(table);

const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const ManageBookingParticipants = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { lang } = useI18n();

  const [loading, setLoading] = useState(true);
  const [voyage, setVoyage] = useState<BookingVoyage | null>(null);
  const [priorVoyageContributionBookings, setPriorVoyageContributionBookings] = useState<PriorVoyageContributionBooking[]>([]);
  const [partySize, setPartySize] = useState(1);
  const [legs, setLegs] = useState<DepositLeg[]>([]);
  const [guests, setGuests] = useState<ParticipantInput[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("lead_pays_all");
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentChoiceOpen, setPaymentChoiceOpen] = useState(false);
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [bankTransferOpen, setBankTransferOpen] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id || !id) return;
    setLoading(true);

    const { data: request, error } = await q<{
      voyage_id: string;
      party_size: number;
      profile_id: string;
      status: string;
      payment_mode: PaymentMode | null;
    }>("voyage_booking_requests")
      .select("id, voyage_id, party_size, profile_id, status, payment_mode")
      .eq("id", id)
      .maybeSingle();

    if (error || !request) {
      toast.error(lang === "it" ? "Partecipazione non trovata." : "Participation not found.");
      navigate("/bookings");
      return;
    }
    if (request.profile_id !== session.user.id) {
      navigate("/bookings");
      return;
    }

    const size = Math.max(1, Number(request.party_size) || 1);
    // A solo booking has nobody to invite and no payment split to choose: everything this page
    // offers is decided elsewhere, so sending the traveller here would only confuse them.
    if (size < 2) {
      navigate("/bookings", { replace: true });
      return;
    }
    setPartySize(size);
    setBookingStatus(request.status ?? null);
    if (request.payment_mode === "each_pays_own" || request.payment_mode === "lead_pays_all") {
      setPaymentMode(request.payment_mode);
    }

    // The page is reachable again after the initial redirect (from /bookings), so it has to show
    // what was already saved rather than blank fields that would silently re-send the invites.
    let savedGuests: ParticipantInput[] = [];
    try {
      savedGuests = (await listBookingParticipants(id))
        .filter((participant) => !participant.is_lead && participant.status !== "declined")
        .map((participant) => ({
          first_name: participant.first_name ?? "",
          last_name: participant.last_name ?? "",
          email: participant.email,
        }));
    } catch (participantsError) {
      console.error("[ManageBookingParticipants] failed to load participants", participantsError);
    }
    setGuests(
      Array.from({ length: size - 1 }, (_unused, index) =>
        savedGuests[index] ?? { first_name: "", last_name: "", email: "" },
      ),
    );

    const { data: paidDeposits } = await q<Array<{ id: string }>>("voyage_booking_deposits")
      .select("id")
      .eq("booking_request_id", id)
      .eq("status", "paid");
    setAlreadyPaid((paidDeposits ?? []).length > 0);

    const { data: priorBookings } = await q<PriorVoyageContributionBooking[]>("voyage_booking_requests")
      .select("id, voyage_id, status")
      .eq("profile_id", session.user.id)
      .eq("voyage_id", request.voyage_id)
      .neq("id", id)
      .in("status", [...CONTRIBUTION_FIXED_MINIMUM_ACTIVE_BOOKING_STATUSES]);
    setPriorVoyageContributionBookings(priorBookings ?? []);

    const { data: voyageRow } = await q<BookingVoyage>("voyages")
      .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,booking_contribution_per_nm_eur,start_date,end_date")
      .eq("id", request.voyage_id)
      .maybeSingle();
    setVoyage(voyageRow ?? null);

    const { data: linkRows } = await q<Array<{ bookable_leg_id: string }>>("voyage_booking_request_legs")
      .select("bookable_leg_id")
      .eq("booking_request_id", id);
    const legIds = (linkRows ?? []).map((l) => l.bookable_leg_id);
    if (legIds.length) {
      const { data: legRows } = await q<DepositLeg[]>("voyage_bookable_legs")
        .select(
          "planned_nautical_miles, open_sea, danger_level, starts_at_window_start, ends_at_window_start"
        )
        .in("id", legIds);
      setLegs((legRows ?? []) as DepositLeg[]);
    } else {
      setLegs([]);
    }

    setLoading(false);
  }, [id, lang, navigate, session?.user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const contributionPerNmEur = voyage?.booking_contribution_per_nm_eur;
  const contributionOptions = useMemo(
    () => ({
      contributionPerNmEur,
      fixedMinimumEur: shouldApplyContributionFixedMinimum(priorVoyageContributionBookings, voyage?.id, id)
        ? undefined
        : 0,
    }),
    [contributionPerNmEur, id, priorVoyageContributionBookings, voyage?.id],
  );
  const perPerson = useMemo(() => perPersonDepositEur(legs, contributionOptions), [contributionOptions, legs]);
  const leadPaysAllTotal = useMemo(
    () => depositForPayerEur(legs, { isLead: true, paymentMode: "lead_pays_all", partySize }, contributionOptions),
    [contributionOptions, legs, partySize]
  );
  const leadPaysMeTotal = useMemo(
    () => depositForPayerEur(legs, { isLead: true, paymentMode: "each_pays_own", partySize }, contributionOptions),
    [contributionOptions, legs, partySize]
  );

  const updateGuest = (index: number, field: keyof ParticipantInput, value: string) => {
    setGuests((current) => current.map((g, i) => (i === index ? { ...g, [field]: value } : g)));
  };

  const validate = (): string | null => {
    const leadEmail = (session?.user.email ?? "").trim().toLowerCase();
    const emails = new Set<string>();
    for (const g of guests) {
      if (!g.first_name.trim() || !g.last_name.trim()) {
        return lang === "it" ? "Compila nome e cognome di ogni persona." : "Fill in first and last name for everyone.";
      }
      if (!emailValid(g.email)) {
        return lang === "it" ? "Inserisci un'email valida per ogni persona." : "Enter a valid email for everyone.";
      }
      const key = g.email.trim().toLowerCase();
      // The lead already has their own participant row: reusing their address here would hit the
      // one-email-per-booking unique index and surface a raw database error.
      if (leadEmail && key === leadEmail) {
        return lang === "it"
          ? "Sei già incluso come organizzatore: indica l'email delle altre persone."
          : "You are already included as the organiser: enter the other people's addresses.";
      }
      if (emails.has(key)) {
        return lang === "it" ? "Le email dei partecipanti devono essere diverse." : "Participant emails must be different.";
      }
      emails.add(key);
    }
    return null;
  };

  /** Domain errors raised by set_booking_participants, as readable text. */
  const participantErrorMessage = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : "";
    if (raw.includes("participant_email_is_lead")) {
      return lang === "it"
        ? "Sei già incluso come organizzatore: indica l'email delle altre persone."
        : "You are already included as the organiser: enter the other people's addresses.";
    }
    if (raw.includes("participant_email_duplicated")) {
      return lang === "it"
        ? "Le email dei partecipanti devono essere diverse."
        : "Participant emails must be different.";
    }
    if (raw.includes("participant_email_invalid")) {
      return lang === "it"
        ? "Inserisci un'email valida per ogni persona."
        : "Enter a valid email for everyone.";
    }
    if (raw.includes("participant_already_booked")) {
      return lang === "it"
        ? "Una delle persone invitate ha già un posto su queste tratte: non può essere aggiunta due volte."
        : "One of the invited people already holds a place on these legs: they cannot be added twice.";
    }
    return raw || (lang === "it" ? "Operazione non riuscita." : "Something went wrong.");
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSubmitting(true);
    try {
      await saveBookingParticipants(
        id,
        paymentMode,
        guests.map((g) => ({
          first_name: g.first_name.trim(),
          last_name: g.last_name.trim(),
          email: g.email.trim().toLowerCase(),
        }))
      );

      const invite = await sendBookingInvites(id, lang === "en" ? "en" : "it");
      if ("notConfigured" in invite) {
        toast.info(
          lang === "it"
            ? "Partecipanti salvati. L'invio degli inviti non è ancora attivo."
            : "Participants saved. Invitations are not active yet."
        );
      } else {
        toast.success(
          lang === "it" ? `Inviti inviati a ${invite.sent} persone.` : `Invitations sent to ${invite.sent} people.`
        );
      }

      // Coming back only to edit the guest list must not re-open a payment that is already
      // settled — resolveDepositPayer would just answer "already_settled".
      if (alreadyPaid) {
        toast.success(lang === "it" ? "Partecipanti aggiornati." : "Participants updated.");
        navigate("/bookings");
        return;
      }
      setPaymentChoiceOpen(true);
    } catch (error) {
      toast.error(participantErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const startOnlinePayment = async (reservedWindow?: Window | null) => {
    setPaymentStarting(true);
    try {
      const payment = await startDepositPayment(id);
      if (payment.ok && "shareUrl" in payment) {
        if (reservedWindow && !reservedWindow.closed) {
          reservedWindow.location.href = payment.shareUrl;
        } else {
          window.location.assign(payment.shareUrl);
        }
        return;
      }
      reservedWindow?.close();
      if (!payment.ok && "notConfigured" in payment) {
        toast.info(
          lang === "it"
            ? "Il pagamento del contributo non è ancora attivo: ti invieremo il link a breve."
            : "Contribution payment is not active yet: we'll send you the link shortly."
        );
        navigate("/bookings");
      } else if (!payment.ok) {
        // Keep the user here so they can complete the contribution by bank transfer.
        setPaymentChoiceOpen(false);
        setBankTransferOpen(true);
      } else {
        navigate("/bookings");
      }
    } finally {
      setPaymentStarting(false);
    }
  };

  if (authLoading || loading) {
    return <div className="min-h-screen pt-28 text-center text-sm text-muted-foreground">Loading...</div>;
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: `/bookings/${id}/participants` }} replace />;
  }

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] font-sans uppercase tracking-[0.22em] text-muted-foreground">
            {lang === "it" ? "Partecipanti al viaggio" : "Voyage participants"}
          </p>
          <h1 className="editorial-heading text-3xl">
            {voyage ? getLocalizedBookingVoyageName(voyage, lang) : lang === "it" ? "Partecipazione" : "Participation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "it"
              ? `Hai aderito per ${partySize} persone. Inserisci i dati degli altri ${partySize - 1} partecipanti.`
              : `You joined for ${partySize} people. Enter the details of the other ${partySize - 1} participants.`}
          </p>
        </header>

        {bookingStatus === "pending_payment" && (
          <div className="glass-panel rounded-[24px] border border-orange-300/50 bg-orange-50/60 p-4 text-xs leading-relaxed text-orange-950 dark:bg-orange-400/10 dark:text-orange-100/90">
            {lang === "it"
              ? "La candidatura non è ancora stata inviata: viene registrata solo dopo il pagamento del contributo, che si completa qui sotto dopo aver indicato i partecipanti."
              : "Your application has not been submitted yet: it is registered only once the contribution is paid, which you complete below after listing the participants."}
          </div>
        )}

        <div className="glass-panel rounded-[24px] border border-amber-300/50 bg-amber-50/50 p-4 text-xs leading-relaxed text-amber-900 dark:bg-amber-400/10 dark:text-amber-100/90">
          {lang === "it"
            ? "BITE non è un charter o un'attività commerciale: è un viaggio privato con condivisione equa delle spese vive. Ogni partecipante dovrà avere un proprio account sul portale BITE per prendere parte al viaggio, accettare le condizioni ed eventualmente versare la propria quota di contributo."
            : "BITE is not a charter or a commercial activity: it is a private voyage with fair sharing of out-of-pocket costs. Each participant must have their own BITE portal account to take part, accept the terms and, if applicable, pay their own contribution share."}
        </div>

        <section className="glass-panel space-y-4 rounded-[28px] p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users size={16} /> {lang === "it" ? "Altri partecipanti" : "Other participants"}
          </div>
          {guests.map((guest, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-3">
              <input
                value={guest.first_name}
                onChange={(e) => updateGuest(index, "first_name", e.target.value)}
                placeholder={lang === "it" ? "Nome" : "First name"}
                className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <input
                value={guest.last_name}
                onChange={(e) => updateGuest(index, "last_name", e.target.value)}
                placeholder={lang === "it" ? "Cognome" : "Last name"}
                className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <input
                type="email"
                value={guest.email}
                onChange={(e) => updateGuest(index, "email", e.target.value)}
                placeholder="Email"
                className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          ))}
        </section>

        <section className="glass-panel space-y-3 rounded-[28px] p-5 md:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wallet size={16} /> {lang === "it" ? "Pagamento del contributo" : "Contribution payment"}
          </div>
          <p className="text-xs text-muted-foreground">
            {lang === "it"
              ? `Quota equa di contributo alle spese vive del viaggio: ${formatDepositEur(perPerson, "it")} a persona. Si versa un acconto (50%, fino a €499) ora e il saldo entro 15gg dalla partenza della propria tratta.`
              : `Fair-share contribution to voyage out-of-pocket costs: ${formatDepositEur(perPerson, "en")} per person. A deposit (50%, up to €499) is due now and the balance within 15 days of your leg's departure.`}
          </p>
          {alreadyPaid && (
            <p className="rounded-2xl border border-emerald-300/60 bg-emerald-50/70 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100/90">
              {lang === "it"
                ? "Hai già versato il contributo per questa prenotazione: la modalità di pagamento non è più modificabile. Per rettifiche scrivici."
                : "You have already paid the contribution for this booking: the payment split can no longer be changed. Contact us for adjustments."}
            </p>
          )}
          <label
            className={`flex items-start gap-3 rounded-2xl border p-3 ${
              paymentMode === "lead_pays_all" ? "border-accent bg-accent/5" : "border-border/70"
            } ${alreadyPaid ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === "lead_pays_all"}
              onChange={() => setPaymentMode("lead_pays_all")}
              disabled={alreadyPaid}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">{lang === "it" ? "Pago per tutti" : "I pay for everyone"}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {lang === "it"
                  ? `Paghi ora l'acconto di ${formatDepositEur(depositTargetEur(leadPaysAllTotal), "it")} per l'intero gruppo (saldo di ${formatDepositEur(leadPaysAllTotal - depositTargetEur(leadPaysAllTotal), "it")} entro 15gg dalla partenza). Gli altri dovranno solo iscriversi e accettare le condizioni.`
                  : `Pay the ${formatDepositEur(depositTargetEur(leadPaysAllTotal), "en")} deposit now for the whole group (${formatDepositEur(leadPaysAllTotal - depositTargetEur(leadPaysAllTotal), "en")} balance due within 15 days of departure). The others only need to register and accept the terms.`}
              </span>
            </span>
          </label>
          <label
            className={`flex items-start gap-3 rounded-2xl border p-3 ${
              paymentMode === "each_pays_own" ? "border-accent bg-accent/5" : "border-border/70"
            } ${alreadyPaid ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === "each_pays_own"}
              onChange={() => setPaymentMode("each_pays_own")}
              disabled={alreadyPaid}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">{lang === "it" ? "Pago solo per me" : "I pay for myself only"}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {lang === "it"
                  ? `Paghi ora l'acconto di ${formatDepositEur(depositTargetEur(leadPaysMeTotal), "it")} per te (saldo di ${formatDepositEur(leadPaysMeTotal - depositTargetEur(leadPaysMeTotal), "it")} entro 15gg dalla partenza). Ogni altro partecipante verserà il proprio contributo, con lo stesso acconto/saldo, accettando l'invito.`
                  : `Pay the ${formatDepositEur(depositTargetEur(leadPaysMeTotal), "en")} deposit now for yourself (${formatDepositEur(leadPaysMeTotal - depositTargetEur(leadPaysMeTotal), "en")} balance due within 15 days of departure). Each other participant pays their own contribution, with the same deposit/balance split, when accepting.`}
              </span>
            </span>
          </label>
        </section>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="glass-chip inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:text-accent disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          {alreadyPaid
            ? lang === "it"
              ? "Salva partecipanti e invia inviti"
              : "Save participants & send invites"
            : lang === "it"
              ? "Invia inviti e scegli pagamento"
              : "Send invites & choose payment"}
        </button>
      </div>

      <PaymentMethodDialog
        open={paymentChoiceOpen}
        onOpenChange={setPaymentChoiceOpen}
        loading={paymentStarting}
        onPayNow={(reservedWindow) => void startOnlinePayment(reservedWindow)}
        onBankTransfer={() => {
          setPaymentChoiceOpen(false);
          setBankTransferOpen(true);
        }}
      />

      <BankTransferDialog
        open={bankTransferOpen}
        onOpenChange={(open) => {
          setBankTransferOpen(open);
          if (!open) navigate("/bookings");
        }}
        bookingRequestId={id}
        onConfirmed={() => {
          setBankTransferOpen(false);
          navigate("/bookings");
        }}
      />
    </div>
  );
};

export default ManageBookingParticipants;
