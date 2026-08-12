import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Clock, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatIban, isValidBic, isValidIban, normalizeIban } from "@/lib/iban";

type UntypedSupabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const rpcSupabase = supabase as unknown as UntypedSupabase;

type PendingRefund = {
  deposit_id: string;
  voyage_id: string | null;
  voyage_name: string | null;
  voyage_name_it: string | null;
  voyage_name_en: string | null;
  amount_cents: number | null;
  reference: string | null;
  /** Bank details already accepted; the payout itself is still being processed. */
  payout_queued: boolean | null;
};

type FormState = { holder: string; iban: string; bic: string };
type DoneState = { amountEur: number; reference: string; queued: boolean };
type RowState = { submitting: boolean; done: DoneState | null; error: string | null };

const ERROR_LABELS: Record<string, { it: string; en: string }> = {
  invalid_iban: {
    it: "L'IBAN inserito non è valido. Controlla e riprova.",
    en: "The IBAN you entered is not valid. Check it and try again.",
  },
  invalid_bic: {
    it: "Il BIC/SWIFT inserito non è valido.",
    en: "The BIC/SWIFT you entered is not valid.",
  },
  account_holder_required: {
    it: "Inserisci l'intestatario del conto.",
    en: "Enter the account holder's name.",
  },
  refund_not_found: {
    it: "Questo rimborso non è più disponibile.",
    en: "This refund is no longer available.",
  },
  nothing_to_refund: {
    it: "Non risulta alcun importo da rimborsare.",
    en: "There is no amount to refund.",
  },
  refund_already_processing: {
    it: "Il rimborso è già in elaborazione.",
    en: "The refund is already being processed.",
  },
  refund_environment_mismatch: {
    it: "Rimborso non disponibile in questo ambiente.",
    en: "Refund not available in this environment.",
  },
  bunq_not_configured: {
    it: "Il servizio di rimborso non è al momento disponibile. Riprova più tardi.",
    en: "The refund service is not available right now. Please try again later.",
  },
  unauthenticated: {
    it: "Sessione scaduta: accedi di nuovo.",
    en: "Your session has expired: please sign in again.",
  },
};

function eur(cents: number | null | undefined): string {
  const value = Math.max(0, Number(cents ?? 0) || 0) / 100;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function voyageLabel(row: PendingRefund, it: boolean): string {
  return (
    (it ? row.voyage_name_it || row.voyage_name || row.voyage_name_en : row.voyage_name_en || row.voyage_name || row.voyage_name_it) ||
    (it ? "il tuo viaggio" : "your voyage")
  );
}

function friendlyError(code: string, it: boolean): string {
  const label = ERROR_LABELS[code];
  if (label) return it ? label.it : label.en;
  if (code) return it ? `Rimborso non riuscito: ${code}` : `Refund failed: ${code}`;
  return it ? "Rimborso non riuscito. Riprova." : "Refund failed. Please try again.";
}

export default function BookingRefund() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useI18n();
  const it = lang === "it";

  const [refunds, setRefunds] = useState<PendingRefund[]>([]);
  const [fetching, setFetching] = useState(true);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  // Self-guard: bounce to login, remembering where to return.
  useEffect(() => {
    if (!loading && !session?.user.id) {
      navigate("/login", { state: { from: `${location.pathname}${location.search}` }, replace: true });
    }
  }, [loading, session?.user.id, navigate, location.pathname, location.search]);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setFetching(true);
    const { data, error } = await rpcSupabase.rpc("list_my_pending_refunds");
    setFetching(false);
    if (error) {
      setRefunds([]);
      return;
    }
    const rows = (data as PendingRefund[]) ?? [];
    setRefunds(rows);
    setForms((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!next[row.deposit_id]) next[row.deposit_id] = { holder: "", iban: "", bic: "" };
      }
      return next;
    });
  }, [session?.user.id]);

  useEffect(() => {
    if (!loading && session?.user.id) void load();
  }, [load, loading, session?.user.id]);

  const updateForm = (id: string, patch: Partial<FormState>) => {
    setForms((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setRowState((current) => ({ ...current, [id]: { ...(current[id] ?? { submitting: false, done: null, error: null }), error: null } }));
  };

  const submit = async (row: PendingRefund) => {
    const form = forms[row.deposit_id] ?? { holder: "", iban: "", bic: "" };
    const holder = form.holder.trim();
    const iban = normalizeIban(form.iban);
    const bic = form.bic.trim();
    if (!holder) return updateFormError(row.deposit_id, "account_holder_required");
    if (!isValidIban(iban)) return updateFormError(row.deposit_id, "invalid_iban");
    if (!isValidBic(bic)) return updateFormError(row.deposit_id, "invalid_bic");

    setRowState((current) => ({ ...current, [row.deposit_id]: { submitting: true, done: null, error: null } }));

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return updateFormError(row.deposit_id, "unauthenticated");

    let response: Response;
    try {
      response = await fetch("/api/bookings/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ depositId: row.deposit_id, accountHolder: holder, iban, bic: bic || null }),
      });
    } catch {
      return updateFormError(row.deposit_id, "network");
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      /* ignore malformed body */
    }

    if (!response.ok || payload.ok !== true) {
      return updateFormError(row.deposit_id, String(payload.error ?? `http_${response.status}`));
    }

    setRowState((current) => ({
      ...current,
      [row.deposit_id]: {
        submitting: false,
        done: {
          amountEur: Number(payload.amountEur ?? 0),
          reference: String(payload.reference ?? ""),
          queued: payload.queued === true,
        },
        error: null,
      },
    }));
  };

  const updateFormError = (id: string, code: string) => {
    setRowState((current) => ({ ...current, [id]: { submitting: false, done: null, error: friendlyError(code, it) } }));
  };

  const showPageSpinner = loading || (session?.user.id && fetching);

  return (
    <div className="min-h-screen px-5 pb-16 pt-24 md:px-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="glass-panel rounded-[34px] px-6 py-8 md:px-9">
          <Link
            to="/bookings"
            className="glass-chip mb-6 inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> {it ? "Le mie prenotazioni" : "My bookings"}
          </Link>
          <h1 className="editorial-heading flex items-center gap-3 text-3xl md:text-4xl">
            <Wallet className="opacity-70" size={30} /> {it ? "Rimborso della quota" : "Refund of your contribution"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {it
              ? "Inserisci le coordinate bancarie su cui ricevere il riaccredito. L'importo è già impostato in base alla tua situazione e non è modificabile. Appena confermi, avviamo subito il bonifico."
              : "Enter the bank details where you want to receive the refund. The amount is already set based on your situation and cannot be changed. As soon as you confirm, we start the transfer right away."}
          </p>
        </section>

        {showPageSpinner ? (
          <div className="glass-panel flex items-center justify-center gap-2 rounded-[34px] py-16 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} /> {it ? "Caricamento…" : "Loading…"}
          </div>
        ) : refunds.length === 0 ? (
          <section className="glass-panel flex flex-col items-center gap-2 rounded-[34px] py-16 text-center text-muted-foreground">
            <Check size={26} className="opacity-60" />
            <p className="text-sm">
              {it ? "Non risultano rimborsi in sospeso sul tuo account." : "There are no pending refunds on your account."}
            </p>
          </section>
        ) : (
          refunds.map((row) => {
            const form = forms[row.deposit_id] ?? { holder: "", iban: "", bic: "" };
            const state = rowState[row.deposit_id] ?? { submitting: false, done: null, error: null };
            return (
              <section key={row.deposit_id} className="glass-panel rounded-[34px] px-6 py-7 md:px-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{voyageLabel(row, it)}</p>
                    <p className="text-xs text-muted-foreground/80">
                      {it ? "Rif." : "Ref."} {row.reference || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{it ? "Importo" : "Amount"}</p>
                    <p className="text-2xl font-semibold">{eur(row.amount_cents)}</p>
                  </div>
                </div>

                {state.done || row.payout_queued ? (
                  // Either we just paid it, or the payout is still being processed on our
                  // side. The traveller never sees why — only that it is handled.
                  state.done && !state.done.queued ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-8 text-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/20">
                        <Check className="text-emerald-500" size={22} />
                      </div>
                      <p className="font-semibold">{it ? "Rimborso avviato" : "Refund started"}</p>
                      <p className="text-sm text-muted-foreground">
                        {it ? (
                          <>
                            Abbiamo avviato il bonifico di {eur(Math.round(state.done.amountEur * 100))} verso l'IBAN
                            indicato. Riceverai l'accredito a breve. Riferimento:{" "}
                            <span className="font-mono">{state.done.reference}</span>.
                          </>
                        ) : (
                          <>
                            We started the transfer of {eur(Math.round(state.done.amountEur * 100))} to the IBAN you
                            provided. You will receive the credit shortly. Reference:{" "}
                            <span className="font-mono">{state.done.reference}</span>.
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-5 py-8 text-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/20">
                        <Clock className="text-sky-500" size={22} />
                      </div>
                      <p className="font-semibold">{it ? "Richiesta presa in carico" : "Request received"}</p>
                      <p className="text-sm text-muted-foreground">
                        {it
                          ? "Abbiamo registrato le tue coordinate bancarie. Il rimborso è in lavorazione e riceverai l'accredito a breve. Non serve fare altro."
                          : "We have recorded your bank details. The refund is being processed and you will receive the credit shortly. You do not need to do anything else."}
                      </p>
                    </div>
                  )
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(row);
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor={`holder-${row.deposit_id}`}>
                        {it ? "Intestatario del conto" : "Account holder"}
                      </label>
                      <Input
                        id={`holder-${row.deposit_id}`}
                        value={form.holder}
                        onChange={(event) => updateForm(row.deposit_id, { holder: event.target.value })}
                        placeholder={it ? "Nome e cognome" : "First and last name"}
                        autoComplete="name"
                        disabled={state.submitting}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor={`iban-${row.deposit_id}`}>
                        IBAN
                      </label>
                      <Input
                        id={`iban-${row.deposit_id}`}
                        value={form.iban}
                        onChange={(event) => updateForm(row.deposit_id, { iban: event.target.value })}
                        onBlur={() => updateForm(row.deposit_id, { iban: formatIban(form.iban) })}
                        placeholder="IT60 X054 2811 1010 0000 0123 456"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        disabled={state.submitting}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor={`bic-${row.deposit_id}`}>
                        BIC / SWIFT <span className="text-muted-foreground">{it ? "(opzionale)" : "(optional)"}</span>
                      </label>
                      <Input
                        id={`bic-${row.deposit_id}`}
                        value={form.bic}
                        onChange={(event) => updateForm(row.deposit_id, { bic: event.target.value.toUpperCase() })}
                        placeholder={it ? "Solo per conti esteri" : "Only for foreign accounts"}
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        disabled={state.submitting}
                      />
                    </div>

                    {state.error ? (
                      <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {state.error}
                      </p>
                    ) : null}

                    <Button type="submit" className="w-full" disabled={state.submitting}>
                      {state.submitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                      <span className="ml-2">
                        {state.submitting
                          ? it
                            ? "Invio in corso…"
                            : "Submitting…"
                          : it
                            ? `Conferma e ricevi ${eur(row.amount_cents)}`
                            : `Confirm and receive ${eur(row.amount_cents)}`}
                      </span>
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      {it
                        ? "Verifica bene l'IBAN: un codice errato può far fallire o deviare il bonifico."
                        : "Double-check the IBAN: an incorrect code can cause the transfer to fail or be misdirected."}
                    </p>
                  </form>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
