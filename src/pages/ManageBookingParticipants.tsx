import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Users, Wallet, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getLocalizedBookingVoyageName, type BookingVoyage } from "@/lib/booking-utils";
import {
  depositForPayerEur,
  formatDepositEur,
  perPersonDepositEur,
  type DepositLeg,
} from "@/lib/booking-deposit";
import {
  saveBookingParticipants,
  sendBookingInvites,
  type PaymentMode,
  type ParticipantInput,
} from "@/lib/booking-participants";
import { startDepositPayment } from "@/lib/booking-payment";

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type QueryBuilder<T> = QueryResult<T> & {
  select: (columns?: string) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
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
  const [partySize, setPartySize] = useState(1);
  const [legs, setLegs] = useState<DepositLeg[]>([]);
  const [guests, setGuests] = useState<ParticipantInput[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("lead_pays_all");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id || !id) return;
    setLoading(true);

    const { data: request, error } = await q<{
      voyage_id: string;
      party_size: number;
      profile_id: string;
    }>("voyage_booking_requests")
      .select("id, voyage_id, party_size, profile_id, status")
      .eq("id", id)
      .maybeSingle();

    if (error || !request) {
      toast.error(lang === "it" ? "Prenotazione non trovata." : "Booking not found.");
      navigate("/bookings");
      return;
    }
    if (request.profile_id !== session.user.id) {
      navigate("/bookings");
      return;
    }

    const size = Math.max(1, Number(request.party_size) || 1);
    setPartySize(size);
    setGuests(Array.from({ length: size - 1 }, () => ({ first_name: "", last_name: "", email: "" })));

    const { data: voyageRow } = await q<BookingVoyage>("voyages")
      .select("id,name,name_it,name_en,status,booking_enabled,booking_max_guests,start_date,end_date")
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
          "open_sea, complexity_override, danger_level, starts_at_window_start, starts_at_window_end, ends_at_window_start, ends_at_window_end"
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

  const perPerson = useMemo(() => perPersonDepositEur(legs), [legs]);
  const leadPaysAllTotal = useMemo(
    () => depositForPayerEur(legs, { isLead: true, paymentMode: "lead_pays_all", partySize }),
    [legs, partySize]
  );
  const leadPaysMeTotal = useMemo(
    () => depositForPayerEur(legs, { isLead: true, paymentMode: "each_pays_own", partySize }),
    [legs, partySize]
  );

  const updateGuest = (index: number, field: keyof ParticipantInput, value: string) => {
    setGuests((current) => current.map((g, i) => (i === index ? { ...g, [field]: value } : g)));
  };

  const validate = (): string | null => {
    const emails = new Set<string>();
    for (const g of guests) {
      if (!g.first_name.trim() || !g.last_name.trim()) {
        return lang === "it" ? "Compila nome e cognome di ogni persona." : "Fill in first and last name for everyone.";
      }
      if (!emailValid(g.email)) {
        return lang === "it" ? "Inserisci un'email valida per ogni persona." : "Enter a valid email for everyone.";
      }
      const key = g.email.trim().toLowerCase();
      if (emails.has(key)) {
        return lang === "it" ? "Le email dei partecipanti devono essere diverse." : "Participant emails must be different.";
      }
      emails.add(key);
    }
    return null;
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

      const invite = await sendBookingInvites(id);
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

      // Lead pays their share now (× party size if paying for all, otherwise × 1).
      const payment = await startDepositPayment(id);
      if (payment.ok && "shareUrl" in payment) {
        window.location.href = payment.shareUrl;
        return;
      }
      if (!payment.ok && "notConfigured" in payment) {
        toast.info(
          lang === "it"
            ? "Il pagamento del deposito non è ancora attivo: ti invieremo il link a breve."
            : "Deposit payment is not active yet: we'll send you the link shortly."
        );
      }
      navigate("/bookings");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    } finally {
      setSubmitting(false);
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
            {voyage ? getLocalizedBookingVoyageName(voyage, lang) : lang === "it" ? "Prenotazione" : "Booking"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "it"
              ? `Hai prenotato per ${partySize} persone. Inserisci i dati degli altri ${partySize - 1} partecipanti.`
              : `You booked for ${partySize} people. Enter the details of the other ${partySize - 1} participants.`}
          </p>
        </header>

        <div className="glass-panel rounded-[24px] border border-amber-300/50 bg-amber-50/50 p-4 text-xs leading-relaxed text-amber-900 dark:bg-amber-400/10 dark:text-amber-100/90">
          {lang === "it"
            ? "Ogni partecipante dovrà avere un proprio account sul portale BITE per prendere parte al viaggio. Riceverà un invito via email per iscriversi (o accedere), accettare le condizioni ed eventualmente pagare il proprio deposito."
            : "Each participant must have their own account on the BITE portal to take part. They will receive an email invitation to register (or sign in), accept the terms and, if applicable, pay their own deposit."}
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
            <Wallet size={16} /> {lang === "it" ? "Pagamento del deposito" : "Deposit payment"}
          </div>
          <p className="text-xs text-muted-foreground">
            {lang === "it"
              ? `Deposito cauzionale: ${formatDepositEur(perPerson, "it")} a persona.`
              : `Security deposit: ${formatDepositEur(perPerson, "en")} per person.`}
          </p>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${
              paymentMode === "lead_pays_all" ? "border-accent bg-accent/5" : "border-border/70"
            }`}
          >
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === "lead_pays_all"}
              onChange={() => setPaymentMode("lead_pays_all")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">{lang === "it" ? "Pago per tutti" : "I pay for everyone"}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {lang === "it"
                  ? `Paghi ora ${formatDepositEur(leadPaysAllTotal, "it")} per l'intero gruppo. Gli altri dovranno solo iscriversi e accettare le condizioni.`
                  : `Pay ${formatDepositEur(leadPaysAllTotal, "en")} now for the whole group. The others only need to register and accept the terms.`}
              </span>
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${
              paymentMode === "each_pays_own" ? "border-accent bg-accent/5" : "border-border/70"
            }`}
          >
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === "each_pays_own"}
              onChange={() => setPaymentMode("each_pays_own")}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">{lang === "it" ? "Pago solo per me" : "I pay for myself only"}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {lang === "it"
                  ? `Paghi ora ${formatDepositEur(leadPaysMeTotal, "it")} per te. Ogni altro partecipante pagherà il proprio deposito accettando l'invito.`
                  : `Pay ${formatDepositEur(leadPaysMeTotal, "en")} for yourself now. Each other participant pays their own deposit when accepting.`}
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
          {lang === "it" ? "Invia inviti e paga il deposito" : "Send invites & pay deposit"}
        </button>
      </div>
    </div>
  );
};

export default ManageBookingParticipants;
