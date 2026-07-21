import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
};

type FormState = { holder: string; iban: string; bic: string };
type RowState = { submitting: boolean; done: { amountEur: number; reference: string } | null; error: string | null };

const ERROR_LABELS: Record<string, string> = {
  invalid_iban: "L'IBAN inserito non è valido. Controlla e riprova.",
  invalid_bic: "Il BIC/SWIFT inserito non è valido.",
  account_holder_required: "Inserisci l'intestatario del conto.",
  refund_not_found: "Questo rimborso non è più disponibile.",
  nothing_to_refund: "Non risulta alcun importo da rimborsare.",
  refund_already_processing: "Il rimborso è già in elaborazione.",
  refund_environment_mismatch: "Rimborso non disponibile in questo ambiente.",
  bunq_not_configured: "Il servizio di rimborso non è al momento disponibile. Riprova più tardi.",
  unauthenticated: "Sessione scaduta: accedi di nuovo.",
};

function eur(cents: number | null | undefined): string {
  const value = Math.max(0, Number(cents ?? 0) || 0) / 100;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function voyageLabel(row: PendingRefund): string {
  return row.voyage_name_it || row.voyage_name || row.voyage_name_en || "il tuo viaggio";
}

function friendlyError(code: string): string {
  return ERROR_LABELS[code] || (code ? `Rimborso non riuscito: ${code}` : "Rimborso non riuscito. Riprova.");
}

export default function BookingRefund() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
        done: { amountEur: Number(payload.amountEur ?? 0), reference: String(payload.reference ?? "") },
        error: null,
      },
    }));
  };

  const updateFormError = (id: string, code: string) => {
    setRowState((current) => ({ ...current, [id]: { submitting: false, done: null, error: friendlyError(code) } }));
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
            <ArrowLeft size={14} /> Le mie prenotazioni
          </Link>
          <h1 className="editorial-heading flex items-center gap-3 text-3xl md:text-4xl">
            <Wallet className="opacity-70" size={30} /> Rimborso della quota
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Inserisci le coordinate bancarie su cui ricevere il riaccredito. L'importo è già impostato in base alla tua
            situazione e non è modificabile. Appena confermi, avviamo subito il bonifico.
          </p>
        </section>

        {showPageSpinner ? (
          <div className="glass-panel flex items-center justify-center gap-2 rounded-[34px] py-16 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} /> Caricamento…
          </div>
        ) : refunds.length === 0 ? (
          <section className="glass-panel flex flex-col items-center gap-2 rounded-[34px] py-16 text-center text-muted-foreground">
            <Check size={26} className="opacity-60" />
            <p className="text-sm">Non risultano rimborsi in sospeso sul tuo account.</p>
          </section>
        ) : (
          refunds.map((row) => {
            const form = forms[row.deposit_id] ?? { holder: "", iban: "", bic: "" };
            const state = rowState[row.deposit_id] ?? { submitting: false, done: null, error: null };
            return (
              <section key={row.deposit_id} className="glass-panel rounded-[34px] px-6 py-7 md:px-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{voyageLabel(row)}</p>
                    <p className="text-xs text-muted-foreground/80">Rif. {row.reference || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Importo</p>
                    <p className="text-2xl font-semibold">{eur(row.amount_cents)}</p>
                  </div>
                </div>

                {state.done ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-8 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/20">
                      <Check className="text-emerald-500" size={22} />
                    </div>
                    <p className="font-semibold">Rimborso avviato</p>
                    <p className="text-sm text-muted-foreground">
                      Abbiamo avviato il bonifico di {eur(Math.round(state.done.amountEur * 100))} verso l'IBAN indicato.
                      Riceverai l'accredito a breve. Riferimento: <span className="font-mono">{state.done.reference}</span>.
                    </p>
                  </div>
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
                        Intestatario del conto
                      </label>
                      <Input
                        id={`holder-${row.deposit_id}`}
                        value={form.holder}
                        onChange={(event) => updateForm(row.deposit_id, { holder: event.target.value })}
                        placeholder="Nome e cognome"
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
                        BIC / SWIFT <span className="text-muted-foreground">(opzionale)</span>
                      </label>
                      <Input
                        id={`bic-${row.deposit_id}`}
                        value={form.bic}
                        onChange={(event) => updateForm(row.deposit_id, { bic: event.target.value.toUpperCase() })}
                        placeholder="Solo per conti esteri"
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
                      <span className="ml-2">{state.submitting ? "Invio in corso…" : `Conferma e ricevi ${eur(row.amount_cents)}`}</span>
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Verifica bene l'IBAN: un codice errato può far fallire o deviare il bonifico.
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
